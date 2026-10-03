'use strict'

const IR_SCHEMA_VERSION = '1.0.0'

const COLLECTION_FIELDS = Object.freeze([
  'symbols',
  'imports',
  'exports',
  'calls',
  'conditions',
  'routes',
])

function createFileIR({ file, language, source = '', parseStatus = 'not_parsed' } = {}) {
  if (!file || typeof file !== 'string') {
    throw new TypeError('createFileIR requires a file path')
  }

  const normalizedFile = file.replace(/\\/g, '/').replace(/^\.\//, '')
  const languageId = language && typeof language === 'object'
    ? language.id
    : language

  return {
    schemaVersion: IR_SCHEMA_VERSION,
    file: normalizedFile,
    language: typeof languageId === 'string' && languageId
      ? languageId.toLowerCase()
      : 'unknown',
    parseStatus,
    symbols: [],
    imports: [],
    exports: [],
    calls: [],
    conditions: [],
    routes: [],
    diagnostics: [],
    meta: {
      lineCount: typeof source === 'string' && source.length
        ? source.split(/\\r?\\n/).length
        : 0,
      sourceLength: typeof source === 'string' ? source.length : 0,
    },
  }
}

module.exports = { IR_SCHEMA_VERSION, COLLECTION_FIELDS, createFileIR }
