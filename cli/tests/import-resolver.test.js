'use strict'

const assert = require('assert')
const { resolveImports } = require('../lib/import-resolver')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

console.log('\nContextBridge Import Resolver Tests\n')

// ── helpers ─────────────────────────────────────────────────────────────────
const imp = (source, kind = 'import', line = 1, names = null) =>
  ({ source, kind, line, names, text: '' })

const js = (path, imports = [], exports = []) =>
  ({ path, language: 'javascript', imports, exports })
const ts = (path, imports = [], exports = []) =>
  ({ path, language: 'typescript', imports, exports })
const py = (path, imports = []) =>
  ({ path, language: 'python', imports, exports: [] })

// Resolve one importer against a set of other (empty) files.
function run(importer, ...others) {
  return resolveImports([importer, ...others])
}
const targets = r => r.edges.map(e => e.to)

// ── JavaScript / TypeScript ─────────────────────────────────────────────────
test('JS: relative specifier gets its extension inferred', () => {
  const r = run(js('src/a.js', [imp('./b')]), js('src/b.js'))
  assert.deepStrictEqual(r.edges, [{ from: 'src/a.js', to: 'src/b.js', kind: 'import', line: 1 }])
})

test('JS: a file beats a directory index of the same name', () => {
  const r = run(js('a.js', [imp('./x')]), js('x.js'), js('x/index.js'))
  assert.deepStrictEqual(targets(r), ['x.js'])
})

test('JS: directory import resolves to index file (with and without trailing slash)', () => {
  const importer = js('a.js', [imp('./lib'), imp('./lib/', 'import', 2)])
  const r = run(importer, js('lib/index.js'))
  assert.deepStrictEqual(targets(r), ['lib/index.js', 'lib/index.js'])
})

test('JS: parent-directory specifiers resolve correctly', () => {
  const r = run(js('a/b/c.js', [imp('../d'), imp('../../top')]), js('a/d.js'), js('top.js'))
  assert.deepStrictEqual(targets(r), ['a/d.js', 'top.js'])
})

test('JS: "." and ".." resolve to index files', () => {
  const r = run(js('a/b/c.js', [imp('.'), imp('..')]), js('a/b/index.js'), js('a/index.js'))
  assert.deepStrictEqual(targets(r), ['a/b/index.js', 'a/index.js'])
})

test('JS: explicit extension matches exactly', () => {
  const r = run(js('a.js', [imp('./b.js')]), js('b.js'))
  assert.deepStrictEqual(targets(r), ['b.js'])
})

test('TS: ./x.js maps to x.ts / x.tsx (ESM TypeScript convention)', () => {
  const r = run(ts('a.ts', [imp('./b.js'), imp('./c.js', 'import', 2)]), ts('b.ts'), ts('c.tsx'))
  assert.deepStrictEqual(targets(r), ['b.ts', 'c.tsx'])
})

test('JS: extension priority is .js before .ts', () => {
  const r = run(js('a.js', [imp('./b')]), js('b.js'), ts('b.ts'))
  assert.deepStrictEqual(targets(r), ['b.js'])
})

test('JS: a specifier escaping the project root is unresolved', () => {
  const r = run(js('a.js', [imp('../outside')]))
  assert.deepStrictEqual(r.edges, [])
  assert.strictEqual(r.unresolved[0].reason, 'outside project root')
})

test('JS: missing target is unresolved with source, kind and line', () => {
  const r = run(js('a.js', [imp('./nope', 'require', 7)]))
  assert.deepStrictEqual(r.unresolved, [
    { from: 'a.js', source: './nope', kind: 'require', line: 7, reason: 'target not found in index' },
  ])
})

test('JS: packages and Node builtins are classified as external, not edges', () => {
  const importer = js('a.js', [
    imp('react'), imp('lodash/fp'), imp('@scope/pkg/sub'),
    imp('fs'), imp('node:path'), imp('fs/promises'),
  ])
  const r = run(importer)
  assert.deepStrictEqual(r.edges, [])
  assert.deepStrictEqual(Object.keys(r.external.packages).sort(), ['@scope/pkg', 'lodash', 'react'])
  assert.deepStrictEqual(Object.keys(r.external.builtins).sort(), ['fs', 'path'])
})

test('JS: external counts are distinct files, not statements', () => {
  const r = resolveImports([
    js('a.js', [imp('chalk'), imp('chalk', 'require', 5)]),
    js('b.js', [imp('chalk')]),
  ])
  assert.strictEqual(r.external.packages.chalk, 2)
})

test('JS: aliases are reported unresolved; scoped packages are not aliases', () => {
  const r = run(js('a.js', [imp('@/components/x'), imp('~/y'), imp('#internal'), imp('@scope/pkg')]))
  assert.strictEqual(r.unresolved.length, 3)
  assert.ok(r.unresolved.every(u => u.reason.startsWith('alias')))
  assert.ok('@scope/pkg' in r.external.packages)
})

test('JS: absolute paths and missing specifiers are unresolved', () => {
  const r = run(js('a.js', [imp('/etc/x'), imp(null)]))
  assert.deepStrictEqual(r.unresolved.map(u => u.reason), ['absolute path', 'no static specifier'])
})

test('JS: edge kind and line are preserved for require and dynamic import', () => {
  const r = run(
    js('a.js', [imp('./b', 'require', 3), imp('./c', 'dynamic_import', 9)]),
    js('b.js'), js('c.js')
  )
  assert.deepStrictEqual(r.edges.map(e => [e.kind, e.line]), [['require', 3], ['dynamic_import', 9]])
})

test('JS: re-exports become edges once per statement', () => {
  const exportsList = [
    { name: 'a', kind: 'reexport', source: './x', line: 1 },
    { name: 'b', kind: 'reexport', source: './x', line: 1 },   // same statement
    { name: '*', kind: 'star_reexport', source: './y', line: 2 },
    { name: 'ns', kind: 'namespace_reexport', source: './z', line: 3 },
    { name: 'local', kind: 'variable', source: null, line: 4 }, // not a re-export
  ]
  const r = run(js('index.js', [], exportsList), js('x.js'), js('y.js'), js('z.js'))
  assert.deepStrictEqual(r.edges.map(e => [e.to, e.kind]), [
    ['x.js', 'reexport'], ['y.js', 'reexport'], ['z.js', 'reexport'],
  ])
})

test('JS: a file importing itself produces no edge', () => {
  const r = run(js('a.js', [imp('./a')]))
  assert.deepStrictEqual(r.edges, [])
})

// ── Python ──────────────────────────────────────────────────────────────────
test('Python: absolute import resolves from an ancestor source root', () => {
  const r = run(
    py('backend/app/api/memory.py', [imp('app.core.database', 'import', 3, ['supabase'])]),
    py('backend/app/core/database.py')
  )
  assert.deepStrictEqual(targets(r), ['backend/app/core/database.py'])
})

test('Python: nearest ancestor root wins when a module exists in two places', () => {
  const r = run(
    py('backend/app/x.py', [imp('app.core', 'import', 1, ['f'])]),
    py('backend/app/core.py'),
    py('app/core.py')
  )
  assert.deepStrictEqual(targets(r), ['backend/app/core.py'])
})

test('Python: `from pkg import submodule` links the submodule, not __init__', () => {
  const r = run(
    py('backend/app/main.py', [imp('app.api', 'import', 1, ['projects', 'memory'])]),
    py('backend/app/api/__init__.py'),
    py('backend/app/api/projects.py'),
    py('backend/app/api/memory.py')
  )
  assert.deepStrictEqual(targets(r), ['backend/app/api/projects.py', 'backend/app/api/memory.py'])
})

test('Python: a name that is not a submodule links the package __init__', () => {
  const r = run(
    py('app/main.py', [imp('app.api', 'import', 1, ['helper'])]),
    py('app/api/__init__.py')
  )
  assert.deepStrictEqual(targets(r), ['app/api/__init__.py'])
})

test('Python: mixed submodule and attribute names link both targets', () => {
  const r = run(
    py('main.py', [imp('pkg', 'import', 1, ['sub', 'attr'])]),
    py('pkg/__init__.py'),
    py('pkg/sub.py')
  )
  assert.deepStrictEqual(targets(r).sort(), ['pkg/__init__.py', 'pkg/sub.py'])
})

test('Python: wildcard import links the module file', () => {
  const r = run(py('a.py', [imp('b', 'import', 1, ['*'])]), py('b.py'))
  assert.deepStrictEqual(targets(r), ['b.py'])
})

test('Python: plain `import a.b.c` links the leaf module', () => {
  const r = run(py('main.py', [imp('a.b.c')]), py('a/b/c.py'))
  assert.deepStrictEqual(targets(r), ['a/b/c.py'])
})

test('Python: relative imports use the dot count', () => {
  const r = run(
    py('pkg/sub/mod.py', [
      imp('.', 'import', 1, ['sibling']),
      imp('.other', 'import', 2, ['f']),
      imp('..', 'import', 3, ['top']),
      imp('..up', 'import', 4, ['g']),
    ]),
    py('pkg/sub/__init__.py'), py('pkg/sub/sibling.py'), py('pkg/sub/other.py'),
    py('pkg/__init__.py'), py('pkg/top.py'), py('pkg/up.py')
  )
  assert.deepStrictEqual(targets(r), [
    'pkg/sub/sibling.py', 'pkg/sub/other.py', 'pkg/top.py', 'pkg/up.py',
  ])
})

test('Python: relative import in a directory without __init__.py still finds submodules', () => {
  const r = run(py('scripts/run.py', [imp('.', 'import', 1, ['helper'])]), py('scripts/helper.py'))
  assert.deepStrictEqual(targets(r), ['scripts/helper.py'])
})

test('Python: too many leading dots is unresolved (outside project root)', () => {
  const r = run(py('a/b.py', [imp('...x', 'import', 1, ['y'])]))
  assert.strictEqual(r.unresolved[0].reason, 'outside project root')
})

test('Python: stdlib and third-party imports are external', () => {
  const r = run(py('main.py', [imp('os'), imp('fastapi', 'import', 2, ['FastAPI'])]))
  assert.deepStrictEqual(r.edges, [])
  assert.deepStrictEqual(Object.keys(r.external.packages).sort(), ['fastapi', 'os'])
})

test('Python: a broken import under a local package is unresolved, not external', () => {
  const r = run(
    py('backend/app/x.py', [imp('app.core.missing', 'import', 5, ['thing'])]),
    py('backend/app/core/database.py')
  )
  assert.deepStrictEqual(r.edges, [])
  assert.strictEqual(r.unresolved[0].reason, 'target not found in index')
  assert.deepStrictEqual(r.external.packages, {})
})

test('Python: module imported twice in one file keeps both edges (per statement)', () => {
  const r = run(py('a.py', [imp('b', 'import', 1, ['x']), imp('b', 'import', 9, ['y'])]), py('b.py'))
  assert.deepStrictEqual(r.edges.map(e => e.line), [1, 9])
})

// ── General ─────────────────────────────────────────────────────────────────
test('mixed-language project resolves each language independently', () => {
  const r = resolveImports([
    js('web/a.js', [imp('./b')]), js('web/b.js'),
    py('api/main.py', [imp('api.util', 'import', 1, ['f'])]), py('api/util.py'),
  ])
  assert.deepStrictEqual(r.edges.map(e => `${e.from}->${e.to}`), [
    'web/a.js->web/b.js', 'api/main.py->api/util.py',
  ])
})

test('empty input yields an empty, well-formed graph', () => {
  assert.deepStrictEqual(resolveImports([]), {
    edges: [], unresolved: [], external: { packages: {}, builtins: {} },
  })
})

test('files with no imports or exports fields do not crash', () => {
  const r = resolveImports([{ path: 'a.js', language: 'javascript', imports: [] }])
  assert.deepStrictEqual(r.edges, [])
})

test('result is deterministic across repeated calls', () => {
  const files = [js('a.js', [imp('./b'), imp('chalk')]), js('b.js')]
  assert.deepStrictEqual(resolveImports(files), resolveImports(files))
})

// ── Runner ──────────────────────────────────────────────────────────────────
;(async () => {
  let passed = 0
  let failed = 0

  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`✓ ${name}`)
      passed++
    } catch (error) {
      console.log(`✗ ${name}`)
      console.log(`    ${error.message.split('\n')[0]}`)
      failed++
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
})()