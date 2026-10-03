'use strict'

class Language {
  constructor({ id, extensions = [], aliases = [], grammarPackage = null, grammarName = null }) {
    if (!id || typeof id !== 'string') {
      throw new TypeError('Language requires a non-empty id')
    }

    this.id = id.toLowerCase()
    this.extensions = Object.freeze(
      [...new Set(extensions.map(ext => normalizeExtension(ext)))]
    )
    this.aliases = Object.freeze(
      [...new Set(aliases.map(alias => String(alias).toLowerCase()))]
    )
    this.grammarPackage = grammarPackage
    this.grammarName = grammarName
    Object.freeze(this)
  }

  supportsExtension(extension) {
    return this.extensions.includes(normalizeExtension(extension))
  }

  matches(value) {
    if (!value) return false
    const normalized = String(value).toLowerCase()
    return normalized === this.id || this.aliases.includes(normalized)
  }

  toJSON() {
    return {
      id: this.id,
      extensions: [...this.extensions],
      aliases: [...this.aliases],
      grammarPackage: this.grammarPackage,
      grammarName: this.grammarName,
    }
  }
}

function normalizeExtension(extension) {
  const value = String(extension || '').trim().toLowerCase()
  if (!value) return ''
  return value.startsWith('.') ? value : `.${value}`
}

module.exports = { Language, normalizeExtension }
