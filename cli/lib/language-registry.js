
'use strict'

// Canonical language definitions shared across ContextBridge.
//
// Keep language IDs stable. Display names are for user-facing output.
// Extensions are lowercase and include the leading dot.

const LANGUAGES = {
  javascript: {
    id: 'javascript',
    name: 'JavaScript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },

  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['.ts', '.tsx'],
  },

  python: {
    id: 'python',
    name: 'Python',
    extensions: ['.py', '.pyw'],
  },

  java: {
    id: 'java',
    name: 'Java',
    extensions: ['.java'],
  },

  go: {
    id: 'go',
    name: 'Go',
    extensions: ['.go'],
  },

  rust: {
    id: 'rust',
    name: 'Rust',
    extensions: ['.rs'],
  },

  ruby: {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['.rb'],
  },

  php: {
    id: 'php',
    name: 'PHP',
    extensions: ['.php'],
  },

  csharp: {
    id: 'csharp',
    name: 'C#',
    extensions: ['.cs'],
  },

  cpp: {
    id: 'cpp',
    name: 'C++',
    extensions: ['.cpp', '.cc', '.cxx'],
  },

  c: {
    id: 'c',
    name: 'C',
    extensions: ['.c', '.h'],
  },

  swift: {
    id: 'swift',
    name: 'Swift',
    extensions: ['.swift'],
  },

  kotlin: {
    id: 'kotlin',
    name: 'Kotlin',
    extensions: ['.kt'],
  },

  scala: {
    id: 'scala',
    name: 'Scala',
    extensions: ['.scala'],
  },

  r: {
    id: 'r',
    name: 'R',
    extensions: ['.r'],
  },

  elixir: {
    id: 'elixir',
    name: 'Elixir',
    extensions: ['.ex', '.exs'],
  },

  haskell: {
    id: 'haskell',
    name: 'Haskell',
    extensions: ['.hs'],
  },

  lua: {
    id: 'lua',
    name: 'Lua',
    extensions: ['.lua'],
  },

  shell: {
    id: 'shell',
    name: 'Shell',
    extensions: ['.sh', '.bash', '.zsh'],
  },

  sql: {
    id: 'sql',
    name: 'SQL',
    extensions: ['.sql'],
  },
}

// Build the extension lookup once when this module loads.
const EXTENSION_TO_LANGUAGE = Object.create(null)

for (const language of Object.values(LANGUAGES)) {
  for (const extension of language.extensions) {
    const existing = EXTENSION_TO_LANGUAGE[extension]

    if (existing && existing !== language.id) {
      throw new Error(
        `Duplicate language extension registration: ${extension}`
      )
    }

    EXTENSION_TO_LANGUAGE[extension] = language.id
  }
}

function getLanguageId(extension) {
  if (typeof extension !== 'string') return null

  return EXTENSION_TO_LANGUAGE[extension.toLowerCase()] || null
}

function getLanguage(extension) {
  const id = getLanguageId(extension)
  return id ? LANGUAGES[id] : null
}

function getLanguageDisplayName(extension) {
  return getLanguage(extension)?.name || null
}

module.exports = {
  LANGUAGES,
  EXTENSION_TO_LANGUAGE,
  getLanguageId,
  getLanguage,
  getLanguageDisplayName,
}
