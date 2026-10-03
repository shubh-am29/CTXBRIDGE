'use strict'

const { IR_SCHEMA_VERSION, COLLECTION_FIELDS, createFileIR } = require('./schema')

function normalizeFileIR(input = {}) {
  const base = createFileIR({
    file: input.file,
    language: input.language,
    source: '',
    parseStatus: input.parseStatus || 'not_parsed',
  })

  for (const field of COLLECTION_FIELDS) {
    base[field] = Array.isArray(input[field]) ? input[field] : []
  }

  base.diagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : []
  base.meta = input.meta && typeof input.meta === 'object'
    ? { ...base.meta, ...input.meta }
    : base.meta

  base.schemaVersion = IR_SCHEMA_VERSION
  return base
}

module.exports = { normalizeFileIR }
