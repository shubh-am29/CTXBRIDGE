'use strict'

const path = require('path')
const { builtinModules } = require('module')

// ── Import resolution ───────────────────────────────────────────────────────
//
// Turns the raw imports recorded by the parser into edges between files of
// the project:
//
//   { from: 'cli/commands/sync.js', to: 'cli/lib/config.js',
//     kind: 'require', line: 6 }
//
// This module is PURE: it never touches the file system. It resolves only
// against the set of files that were actually indexed, so a result is
// always a file we know about. Anything else is classified honestly:
//
//   external   — a package (or Node builtin) rather than project code
//   unresolved — looks local, but no matching indexed file was found
//                (missing, too large, not parseable, or an alias we
//                cannot resolve without reading tsconfig / bundler config)
//
// Known limitations (deliberately not guessed at):
//   - tsconfig "paths", bundler aliases ('@/x', '~/x', '#x') are reported
//     as unresolved, not silently dropped or mis-resolved.
//   - package.json "exports"/"main" of local packages are not consulted.
//   - Python: stdlib vs third-party cannot be told apart, so every
//     absolute import with no local match is "external".
//   - Python absolute imports are resolved against the importing file's
//     ancestor directories (nearest first), which mimics running from a
//     project/source root. It is a heuristic, not an exact sys.path model.
//   - Matching is case-sensitive.

const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']
const ALIAS_PREFIXES = ['@/', '~/', '#', '$']

const BUILTINS = new Set(builtinModules.map(m => m.replace(/^node:/, '')))

function isBuiltin(specifier) {
  const bare = specifier.replace(/^node:/, '')
  return specifier.startsWith('node:') || BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0])
}

function packageName(specifier) {
  const parts = specifier.replace(/^node:/, '').split('/')
  return specifier.startsWith('@') && parts.length > 1
    ? `${parts[0]}/${parts[1]}`
    : parts[0]
}

function isRelativeSpecifier(spec) {
  return spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')
}

function escapesRoot(p) {
  return p === '..' || p.startsWith('../')
}

// ── JavaScript / TypeScript ─────────────────────────────────────────────────

function resolveJsRelative(fromPath, spec, known) {
  let base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec))
  base = base.replace(/\/+$/, '') || '.'

  if (escapesRoot(base)) return { unresolved: 'outside project root' }

  const candidates = [base]
  for (const ext of JS_EXTENSIONS) candidates.push(base + ext)

  // TypeScript ESM convention: `import './x.js'` actually means ./x.ts
  const jsExt = base.match(/\.(js|jsx|mjs|cjs)$/)
  if (jsExt) {
    const stem = base.slice(0, -jsExt[0].length)
    candidates.push(stem + '.ts', stem + '.tsx')
  }

  for (const ext of JS_EXTENSIONS) candidates.push(`${base}/index${ext}`)

  const hit = candidates.find(c => known.has(c))
  return hit ? { to: hit } : { unresolved: 'target not found in index' }
}

function resolveJs(fromPath, spec, known) {
  if (!spec) return { unresolved: 'no static specifier' }
  if (isRelativeSpecifier(spec)) return resolveJsRelative(fromPath, spec, known)
  if (spec.startsWith('/')) return { unresolved: 'absolute path' }
  if (ALIAS_PREFIXES.some(p => spec.startsWith(p))) {
    return { unresolved: 'alias (tsconfig paths / bundler alias not supported)' }
  }
  return isBuiltin(spec)
    ? { builtin: packageName(spec) }
    : { external: packageName(spec) }
}

// ── Python ──────────────────────────────────────────────────────────────────

// Finds the file for a dotted module path under `root`:
//   root/a/b.py   or   root/a/b/__init__.py
// An empty `parts` means the package at `root` itself.
function findPythonModule(root, parts, known) {
  const join = (...p) => p.filter(Boolean).join('/')

  if (parts.length === 0) {
    const init = join(root, '__init__.py')
    return known.has(init) ? init : null
  }

  const base = join(root, ...parts)
  if (known.has(base + '.py')) return base + '.py'
  if (known.has(base + '/__init__.py')) return base + '/__init__.py'
  return null
}

// Resolves the imported names of `from <module> import <names>` under one
// root. A name that is a submodule yields an edge to that submodule;
// anything else (a function, class, variable) is an attribute of the
// module itself, so it yields an edge to the module file.
function pythonTargets(root, parts, names, known) {
  const moduleFile = findPythonModule(root, parts, known)
  const targets = new Set()

  if (!names || names.length === 0) {
    if (moduleFile) targets.add(moduleFile)
    return targets
  }

  for (const name of names) {
    if (name === '*') {
      if (moduleFile) targets.add(moduleFile)
      continue
    }
    const submodule = findPythonModule(root, [...parts, name], known)
    if (submodule) targets.add(submodule)
    else if (moduleFile) targets.add(moduleFile)
  }

  return targets
}

function ancestorDirs(filePath) {
  const segments = path.posix.dirname(filePath).split('/').filter(s => s && s !== '.')
  const dirs = []
  for (let i = segments.length; i >= 0; i--) dirs.push(segments.slice(0, i).join('/'))
  return dirs // nearest first, repo root ('') last
}

function resolvePython(fromPath, entry, known, topLevelNames) {
  const source = entry.source
  if (!source) return { unresolved: 'no static specifier' }

  const dots = source.match(/^\.*/)[0].length
  const rest = source.slice(dots)
  const parts = rest ? rest.split('.') : []

  // Relative: one fixed root, determined by the number of leading dots.
  if (dots > 0) {
    const segments = path.posix.dirname(fromPath).split('/').filter(s => s && s !== '.')
    const up = dots - 1
    if (up > segments.length) return { unresolved: 'outside project root' }

    const root = segments.slice(0, segments.length - up).join('/')
    const targets = pythonTargets(root, parts, entry.names, known)
    return targets.size > 0
      ? { targets: [...targets] }
      : { unresolved: 'target not found in index' }
  }

  // Absolute: try each ancestor directory as the import root, nearest first.
  for (const root of ancestorDirs(fromPath)) {
    const targets = pythonTargets(root, parts, entry.names, known)
    if (targets.size > 0) return { targets: [...targets] }
  }

  // No match. If the first segment is a local top-level module/package under
  // any candidate root, this is a broken local import; otherwise it is a
  // third-party/stdlib package.
  const first = parts[0]
  const looksLocal = ancestorDirs(fromPath).some(root => {
    const joined = [root, first].filter(Boolean).join('/')
    return topLevelNames.has(joined)
  })
  return looksLocal
    ? { unresolved: 'target not found in index' }
    : { external: first }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * @param {Array<{path, language, imports, exports}>} indexFiles
 *        entries as produced by buildCodeIndex()
 * @returns {{
 *   edges: Array<{from, to, kind, line}>,
 *   unresolved: Array<{from, source, kind, line, reason}>,
 *   external: { packages: Object<string, number>, builtins: Object<string, number> }
 * }}
 *   external counts are the number of DISTINCT files importing each name.
 */
function resolveImports(indexFiles) {
  const known = new Set(indexFiles.map(f => f.path))

  // Every directory and extension-less python module that exists locally,
  // used only to tell "broken local import" from "third-party package".
  const topLevelNames = new Set()
  for (const p of known) {
    const segments = p.split('/')
    for (let i = 1; i <= segments.length; i++) {
      topLevelNames.add(segments.slice(0, i).join('/'))
    }
    if (p.endsWith('.py')) topLevelNames.add(p.slice(0, -3))
  }

  const edges = []
  const unresolved = []
  const packageFiles = new Map()
  const builtinFiles = new Map()

  const addEdge = (from, to, kind, line) => {
    if (from === to) return // a module "importing itself" is noise
    edges.push({ from, to, kind, line })
  }
  const note = (map, name, file) => {
    if (!map.has(name)) map.set(name, new Set())
    map.get(name).add(file)
  }

  for (const file of indexFiles) {
    const isPython = file.language === 'python'

    const handle = (spec, entry, kind, line) => {
      const result = isPython
        ? resolvePython(file.path, entry, known, topLevelNames)
        : resolveJs(file.path, spec, known)

      if (result.targets) {
        for (const to of result.targets) addEdge(file.path, to, kind, line)
      } else if (result.to) {
        addEdge(file.path, result.to, kind, line)
      } else if (result.builtin) {
        note(builtinFiles, result.builtin, file.path)
      } else if (result.external) {
        note(packageFiles, result.external, file.path)
      } else {
        unresolved.push({
          from: file.path,
          source: spec,
          kind,
          line,
          reason: result.unresolved,
        })
      }
    }

    for (const imp of file.imports) {
      handle(imp.source, imp, imp.kind, imp.line)
    }

    // Re-exports (`export * from './x'`) are dependencies too. One
    // `export { a, b } from './x'` produces several export entries that
    // share a source and line — count that statement once.
    const seen = new Set()
    for (const exp of file.exports || []) {
      if (!exp.source) continue
      const key = `${exp.line}|${exp.source}`
      if (seen.has(key)) continue
      seen.add(key)
      handle(exp.source, { source: exp.source, names: null }, 'reexport', exp.line)
    }
  }

  const toCounts = map =>
    Object.fromEntries(
      [...map.entries()]
        .map(([name, files]) => [name, files.size])
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    )

  return {
    edges,
    unresolved,
    external: {
      packages: toCounts(packageFiles),
      builtins: toCounts(builtinFiles),
    },
  }
}

module.exports = { resolveImports }