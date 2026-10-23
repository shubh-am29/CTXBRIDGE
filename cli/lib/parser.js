
'use strict'

const { Parser, Language } = require('web-tree-sitter')
const { getLanguageId } = require('./language-registry')

// These are the grammars we have verified are available.
const SUPPORTED_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'python',
])

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

async function getGrammar(languageId) {
  if (!SUPPORTED_LANGUAGES.has(languageId)) {
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

  if (!grammarCache.has(languageId)) {
    const grammarPromise = Language.load(
      getWasmPath(languageId)
    ).catch(error => {
      grammarCache.delete(languageId)
      throw error
    })

    grammarCache.set(languageId, grammarPromise)
  }

  return grammarCache.get(languageId)
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

function extractSymbols(rootNode) {
  const symbols = []

  function visit(node) {
    if ([
      'function_declaration',
      'function_definition',
      'class_declaration',
      'class_definition',
      'method_definition',
    ].includes(node.type)) {
      const nameNode = node.childForFieldName('name')

      symbols.push({
        type: node.type,
        name: nameNode ? nameNode.text : null,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      })
    }

    for (const child of node.namedChildren) {
      visit(child)
    }
  }

  visit(rootNode)
  return symbols
}

function extractImports(rootNode) {
  const imports = []

  function visit(node) {
    if ([
      'import_statement',
      'import_from_statement',
      'import_declaration',
    ].includes(node.type)) {
      imports.push({
        text: node.text,
        line: node.startPosition.row + 1,
      })
    }

    for (const child of node.namedChildren) {
      visit(child)
    }
  }

  visit(rootNode)
  return imports
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
    return {
      supported: false,
      language: languageId,
      hasErrors: false,
      imports: [],
      symbols: [],
    }
  }

  await initializeParser()

  const grammar = await getGrammar(languageId)

  const parser = new Parser()

  try {
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
        imports: extractImports(tree.rootNode),
        symbols: extractSymbols(tree.rootNode),
      }
    } finally {
      tree.delete()
    }
  } finally {
    parser.delete()
  }
}

module.exports = {
  parseSource,
  SUPPORTED_LANGUAGES,
}
