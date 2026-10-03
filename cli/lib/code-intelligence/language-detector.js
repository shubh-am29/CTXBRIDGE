'use strict'

const path = require('path')
const { getLanguage, getLanguageByExtension } = require('./languages')

function detectLanguage(filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  return getLanguageByExtension(path.extname(filePath))
}

function resolveLanguage(value) {
  return getLanguage(value)
}

module.exports = { detectLanguage, resolveLanguage }
