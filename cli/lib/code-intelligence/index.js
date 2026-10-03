'use strict'

const { Language } = require('./language')
const { getLanguage, getLanguageByExtension, listLanguages } = require('./languages')
const { detectLanguage, resolveLanguage } = require('./language-detector')
const { IR_SCHEMA_VERSION, COLLECTION_FIELDS, createFileIR } = require('./ir/schema')
const { normalizeFileIR } = require('./ir/normalizer')

module.exports = {
  Language,
  getLanguage,
  getLanguageByExtension,
  listLanguages,
  detectLanguage,
  resolveLanguage,
  IR_SCHEMA_VERSION,
  COLLECTION_FIELDS,
  createFileIR,
  normalizeFileIR,
}
