'use strict'

const { Language } = require('./language')

const definitions = [
  new Language({
    id: 'python',
    extensions: ['.py', '.pyw'],
    aliases: ['py', 'python3'],
    grammarPackage: 'tree-sitter-python',
    grammarName: 'python',
  }),
  new Language({
    id: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    aliases: ['js', 'node', 'nodejs'],
    grammarPackage: 'tree-sitter-javascript',
    grammarName: 'javascript',
  }),
  new Language({
    id: 'typescript',
    extensions: ['.ts', '.mts', '.cts'],
    aliases: ['ts'],
    grammarPackage: 'tree-sitter-typescript',
    grammarName: 'typescript',
  }),
  new Language({
    id: 'tsx',
    extensions: ['.tsx'],
    aliases: [],
    grammarPackage: 'tree-sitter-typescript',
    grammarName: 'tsx',
  }),
]

const byId = new Map()
const byExtension = new Map()

for (const language of definitions) {
  byId.set(language.id, language)
  for (const alias of language.aliases) byId.set(alias, language)
  for (const extension of language.extensions) {
    byExtension.set(extension, language)
  }
}

function getLanguage(value) {
  if (!value) return null
  return byId.get(String(value).toLowerCase()) || null
}

function getLanguageByExtension(extension) {
  if (!extension) return null
  const normalized = String(extension).toLowerCase()
  const key = normalized.startsWith('.') ? normalized : `.${normalized}`
  return byExtension.get(key) || null
}

function listLanguages() {
  return [...definitions]
}

module.exports = { getLanguage, getLanguageByExtension, listLanguages }
