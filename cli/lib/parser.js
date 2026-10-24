'use strict'

const { Parser, Language } = require('web-tree-sitter')
const { getLanguageId } = require('./language-registry')

// Canonical language ids this parser can handle. These come from the
// shared language registry (.tsx maps to 'typescript' there).
const SUPPORTED_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'python',
])

// Grammars that exist in tree-sitter-wasm. The registry has no separate
// id for TSX, but TSX needs its own grammar: the plain TypeScript grammar
// cannot parse JSX and reports syntax errors on every React component.
const GRAMMAR_IDS = new Set(['javascript', 'typescript', 'tsx', 'python'])

let initializationPromise = null
let grammarPackagePromise = null

const grammarCache = new Map()

async function initializeParser() {
  if (!initializationPromise) {
    initializationPromise = Parser.init().catch(error => {
      initializationPromise = null
      throw error
    })
  }

  await initializationPromise
}

async function getGrammar(grammarId) {
  if (!GRAMMAR_IDS.has(grammarId)) {
    return null
  }

  if (!grammarPackagePromise) {
    // tree-sitter-wasm is an ES module.
    // Dynamic import works inside our CommonJS CLI.
    grammarPackagePromise = import('tree-sitter-wasm')
      .catch(error => {
        grammarPackagePromise = null
        throw error
      })
  }

  const { getWasmPath } = await grammarPackagePromise

  if (!grammarCache.has(grammarId)) {
    const grammarPromise = Language.load(
      getWasmPath(grammarId)
    ).catch(error => {
      grammarCache.delete(grammarId)
      throw error
    })

    grammarCache.set(grammarId, grammarPromise)
  }

  return grammarCache.get(grammarId)
}

function resolveLanguage({ language, extension }) {
  if (typeof language === 'string') {
    const normalized = language.toLowerCase()

    if (SUPPORTED_LANGUAGES.has(normalized)) {
      return normalized
    }

    if (normalized.startsWith('.')) {
      return getLanguageId(normalized)
    }
  }

  if (typeof extension === 'string') {
    return getLanguageId(extension)
  }

  return null
}

// Picks the tree-sitter grammar for a language id. Only .tsx needs a
// different grammar from its registry language.
function resolveGrammarId(languageId, { language, extension }) {
  if (languageId !== 'typescript') return languageId

  const hint = [extension, language].find(
    value => typeof value === 'string' && value.startsWith('.')
  )

  return hint && hint.toLowerCase() === '.tsx' ? 'tsx' : 'typescript'
}

const FUNCTION_VALUE_TYPES = new Set([
  'arrow_function',
  'function_expression',
  'function',
  'generator_function',
])

const SYMBOL_NODE_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_definition',
  'class_declaration',
  'abstract_class_declaration',
  'class_definition',
  'method_definition',
  // TypeScript-only declarations
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
])

function extractSymbols(rootNode) {
  const symbols = []

  function visit(node) {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      const nameNode = node.childForFieldName('name')

      symbols.push({
        type: node.type,
        name: nameNode ? nameNode.text : null,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      })
    } else if (node.type === 'variable_declarator') {
      // const handler = () => {}  /  const f = function () {}
      const value = node.childForFieldName('value')
      const nameNode = node.childForFieldName('name')

      if (
        value &&
        FUNCTION_VALUE_TYPES.has(value.type) &&
        nameNode &&
        nameNode.type === 'identifier'
      ) {
        symbols.push({
          type: value.type === 'arrow_function'
            ? 'arrow_function'
            : 'function_expression',
          name: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        })
      }
    }

    for (const child of node.namedChildren) {
      visit(child)
    }
  }

  visit(rootNode)
  return symbols
}

// ── Import extraction ───────────────────────────────────────────────────────
//
// Each import is { text, line, source, kind }:
//   text   : the source text of the statement / call
//   line   : 1-based start line
//   source : the module specifier exactly as written ('./a', 'fs',
//            'app.core', '.mod', '..pkg.mod'), or null if it cannot be
//            determined statically
//   kind   : 'import' (ESM / Python) | 'require' (CommonJS, and TS
//            `import x = require()`) | 'dynamic_import' (`import('x')`)
//
// A Python `import a, b` is one statement with two modules, so it yields
// one entry per module (same text and line).
//
// Not recorded (cannot be resolved without running the code):
//   require(someVariable), require(`./${x}`), import(someVariable)
// `require.resolve('x')` is not an import and is ignored.
// Re-exports (`export * from './x'`) are dependencies too, but they are
// reported in `exports` (with a `source`), not here.

function literalSpecifier(argNode) {
  if (!argNode) return null

  if (argNode.type === 'string') {
    const value = stripQuotes(argNode.text)
    return value === '' ? null : value
  }

  // A template literal is only static if it has no ${} substitutions.
  if (argNode.type === 'template_string' && !argNode.text.includes('${')) {
    const value = argNode.text.replace(/^`|`$/g, '')
    return value === '' ? null : value
  }

  return null
}

function pythonModuleNames(node) {
  if (node.type === 'import_from_statement') {
    const moduleNode = node.childForFieldName('module_name')
    return moduleNode ? [moduleNode.text.replace(/\s+/g, '')] : []
  }

  // import_statement: `import a.b, c as d`
  const names = []
  for (const child of node.namedChildren) {
    if (child.type === 'dotted_name') {
      names.push(child.text)
    } else if (child.type === 'aliased_import') {
      const inner = child.childForFieldName('name')
      if (inner) names.push(inner.text)
    }
  }
  return names
}

function extractImports(rootNode, languageId) {
  const imports = []
  const isPython = languageId === 'python'

  const add = (node, source, kind) => imports.push({
    text: node.text,
    line: node.startPosition.row + 1,
    source,
    kind,
  })

  function visit(node) {
    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      if (isPython) {
        const names = pythonModuleNames(node)
        if (names.length === 0) add(node, null, 'import')
        for (const name of names) add(node, name, 'import')
      } else {
        // TypeScript `import x = require('y')` keeps its specifier on the
        // import_require_clause instead of on the statement itself.
        const requireClause = node.namedChildren.find(
          c => c.type === 'import_require_clause'
        )
        if (requireClause) {
          add(node, literalSpecifier(requireClause.childForFieldName('source')), 'require')
        } else {
          add(node, literalSpecifier(node.childForFieldName('source')), 'import')
        }
      }
    } else if (node.type === 'import_declaration') {
      add(node, null, 'import')
    } else if (!isPython && node.type === 'call_expression') {
      const fn = node.childForFieldName('function')
      const args = node.childForFieldName('arguments')

      if (fn && args && fn.type === 'identifier' && fn.text === 'require') {
        // Exactly one argument, and it must be a static string.
        if (args.namedChildCount === 1) {
          const source = literalSpecifier(args.namedChild(0))
          if (source !== null) add(node, source, 'require')
        }
      } else if (fn && args && fn.type === 'import') {
        // import('x') may carry an options object as a second argument.
        const source = literalSpecifier(args.namedChild(0))
        if (source !== null) add(node, source, 'dynamic_import')
      }
    }

    for (const child of node.namedChildren) {
      visit(child)
    }
  }

  visit(rootNode)
  return imports
}

// ── Export detection (JavaScript / TypeScript) ──────────────────────────────
//
// Each export is { name, kind, isDefault, source, style, line }:
//   kind   : function | class | variable | interface | type | enum |
//            named | reexport | namespace_reexport | star_reexport | default
//   source : module specifier for re-exports, otherwise null
//   style  : 'esm' | 'commonjs'
//
// Only top-level statements are inspected, so an `exports.x = ...` buried
// inside a function body is not reported as a module export.

const DECLARATION_KINDS = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
}

function stripQuotes(text) {
  return text.replace(/^['"`]|['"`]$/g, '')
}

function valueKind(valueNode) {
  if (!valueNode) return 'variable'
  if (FUNCTION_VALUE_TYPES.has(valueNode.type)) return 'function'
  if (valueNode.type === 'class') return 'class'
  return 'variable'
}

function collectEsmExport(node, push) {
  const line = node.startPosition.row + 1
  const sourceNode = node.childForFieldName('source')
  const source = sourceNode ? stripQuotes(sourceNode.text) : null
  const isDefault = node.children.some(
    child => !child.isNamed && child.type === 'default'
  )

  const make = (name, kind, extra = {}) => push({
    name,
    kind,
    isDefault,
    source,
    style: 'esm',
    line,
    ...extra,
  })

  const declaration = node.childForFieldName('declaration')

  if (declaration) {
    if (
      declaration.type === 'lexical_declaration' ||
      declaration.type === 'variable_declaration'
    ) {
      for (const declarator of declaration.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue

        const nameNode = declarator.childForFieldName('name')
        // Destructuring exports (export const { a, b } = obj) are not
        // reported — see "known limitations" in the docs.
        if (!nameNode || nameNode.type !== 'identifier') continue

        make(
          nameNode.text,
          valueKind(declarator.childForFieldName('value'))
        )
      }
      return
    }

    const kind = DECLARATION_KINDS[declaration.type]
    if (kind) {
      const nameNode = declaration.childForFieldName('name')
      make(nameNode ? nameNode.text : 'default', kind)
    }
    return
  }

  const clause = node.namedChildren.find(c => c.type === 'export_clause')
  if (clause) {
    for (const specifier of clause.namedChildren) {
      if (specifier.type !== 'export_specifier') continue

      const local = specifier.childForFieldName('name')
      const alias = specifier.childForFieldName('alias')
      if (!local) continue

      make(
        alias ? alias.text : local.text,
        source ? 'reexport' : 'named',
        { local: local.text }
      )
    }
    return
  }

  const namespaceExport = node.namedChildren.find(
    c => c.type === 'namespace_export'
  )
  if (namespaceExport) {
    const nameNode = namespaceExport.namedChildren[0]
    make(nameNode ? nameNode.text : '*', 'namespace_reexport')
    return
  }

  const value = node.childForFieldName('value')
  if (value) {
    // export default foo / export default class {} / export default () => {}
    make(
      value.type === 'identifier' ? value.text : 'default',
      value.type === 'identifier' ? 'default' : valueKind(value)
    )
    return
  }

  if (source && node.children.some(c => !c.isNamed && c.type === '*')) {
    make('*', 'star_reexport')
  }
}

function collectCommonJsExport(statement, push) {
  const assignment = statement.namedChildren.find(
    c => c.type === 'assignment_expression'
  )
  if (!assignment) return

  const left = assignment.childForFieldName('left')
  const right = assignment.childForFieldName('right')
  if (!left || !right || left.type !== 'member_expression') return

  const line = statement.startPosition.row + 1
  const target = left.text.replace(/\s+/g, '')

  const make = (name, kind, isDefault) => push({
    name,
    kind,
    isDefault,
    source: null,
    style: 'commonjs',
    line,
  })

  if (target === 'module.exports') {
    if (right.type === 'object') {
      for (const member of right.namedChildren) {
        if (member.type === 'shorthand_property_identifier') {
          make(member.text, 'variable', false)
        } else if (member.type === 'pair') {
          const key = member.childForFieldName('key')
          if (key) {
            make(
              stripQuotes(key.text),
              valueKind(member.childForFieldName('value')),
              false
            )
          }
        } else if (member.type === 'method_definition') {
          const key = member.childForFieldName('name')
          if (key) make(key.text, 'function', false)
        }
      }
      return
    }

    make(
      right.type === 'identifier' ? right.text : 'default',
      valueKind(right),
      true
    )
    return
  }

  // exports.name = ... / module.exports.name = ...
  const match = target.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/)
  if (match) {
    make(match[1], valueKind(right), false)
  }
}

function extractExports(rootNode, languageId) {
  if (languageId !== 'javascript' && languageId !== 'typescript') {
    return []
  }

  const exports = []
  const push = entry => exports.push(entry)

  for (const node of rootNode.namedChildren) {
    if (node.type === 'export_statement') {
      collectEsmExport(node, push)
    } else if (node.type === 'expression_statement') {
      collectCommonJsExport(node, push)
    }
  }

  return exports
}

function emptyResult(extra) {
  return {
    supported: false,
    language: null,
    hasErrors: false,
    imports: [],
    exports: [],
    symbols: [],
    ...extra,
  }
}

async function parseSource({
  source,
  language,
  extension,
} = {}) {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string')
  }

  const languageId = resolveLanguage({
    language,
    extension,
  })

  if (!SUPPORTED_LANGUAGES.has(languageId)) {
    return emptyResult({ language: languageId })
  }

  const grammarId = resolveGrammarId(languageId, { language, extension })

  let parser = null

  try {
    await initializeParser()

    const grammar = await getGrammar(grammarId)

    parser = new Parser()
    parser.setLanguage(grammar)

    const tree = parser.parse(source)

    if (!tree) {
      throw new Error('Tree-sitter returned no syntax tree')
    }

    try {
      return {
        supported: true,
        language: languageId,
        hasErrors: tree.rootNode.hasError,
        imports: extractImports(tree.rootNode, languageId),
        exports: extractExports(tree.rootNode, languageId),
        symbols: extractSymbols(tree.rootNode),
      }
    } finally {
      tree.delete()
    }
  } catch (error) {
    // One file that cannot be parsed (or a grammar that fails to load)
    // must not abort a whole project scan. Report it and carry on.
    return emptyResult({
      supported: true,
      language: languageId,
      hasErrors: true,
      error: error.message || String(error),
    })
  } finally {
    if (parser) parser.delete()
  }
}

module.exports = {
  parseSource,
  SUPPORTED_LANGUAGES,
}