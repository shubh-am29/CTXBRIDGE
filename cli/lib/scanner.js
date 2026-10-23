'use strict'

const fs   = require('fs')
const path = require('path')
const { LANGUAGES } = require('./language-registry')

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'venv', '.venv', 'env',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'dist', 'build', 'out', 'target', 'obj',
  '.next', '.nuxt', '.svelte-kit', '.turbo',
  'vendor', 'coverage', '.coverage',
  '.contextbridge', '.cache', 'tmp', 'temp',
  '.idea', '.vscode', '.DS_Store',
  'htmlcov', 'site', '.tox',
])

// Files that must never be read regardless of extension
const SENSITIVE_FILENAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.staging',
  '.env.development', '.env.test', '.env.backup',
  'secrets.json', 'secrets.yaml', 'secrets.yml',
  'credentials.json', 'credentials.yaml',
  'service-account.json', 'serviceaccount.json',
  'private.key', 'private.pem', 'id_rsa', 'id_ed25519',
  'id_ecdsa', 'id_dsa', '.netrc', '.npmrc', '.pypirc',
  'auth.json', 'token.json', '.htpasswd',
])

// Patterns that signal sensitive content in filenames
const SENSITIVE_PATTERNS = [
  /secret/i, /password/i, /passwd/i, /credential/i,
  /private[._-]key/i, /api[._-]key/i, /\.pem$/i,
  /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.cer$/i,
  /\.crt$/i, /id_rsa/i, /id_ed25519/i,
]

// Allowed extensions — only these are scanned
const ALLOWED_EXTENSIONS = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf',
  '.html', '.css', '.scss', '.sass',
  '.go', '.rs', '.java', '.rb', '.php', '.cs',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.prisma', '.graphql', '.gql',
  '.dockerfile', '.containerfile',
])

// Include extensions supported by the shared language registry.
// Keep the existing allowlist for configuration and documentation files.
for (const language of Object.values(LANGUAGES)) {
  for (const extension of language.extensions) {
    ALLOWED_EXTENSIONS.add(extension)
  }
}

// Exact filenames always included (even without common extension)
const ALWAYS_INCLUDE_NAMES = new Set([
  'Dockerfile', 'dockerfile', 'Makefile', 'makefile',
  'requirements.txt', 'requirements-dev.txt', 'requirements-test.txt',
  'Pipfile', 'Pipfile.lock',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.toml', 'Cargo.lock',
  'go.mod', 'go.sum',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'composer.json',
  'Gemfile', 'Gemfile.lock',
  'pyproject.toml', 'setup.py', 'setup.cfg',
  'docker-compose.yml', 'docker-compose.yaml',
  'docker-compose.dev.yml', 'docker-compose.prod.yml',
  '.env.example', '.env.sample', '.env.template',
  'CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md',
  'ARCHITECTURE.md', 'CHANGELOG.md',
  'vercel.json', 'netlify.toml', 'render.yaml', 'fly.toml',
  'tsconfig.json', 'jsconfig.json', 'vite.config.js', 'vite.config.ts',
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'jest.config.js', 'jest.config.ts',
  'vitest.config.js', 'vitest.config.ts',
  'webpack.config.js', 'eslint.config.js', '.eslintrc.json',
  'pytest.ini', 'conftest.py', 'tox.ini', 'mypy.ini',
  '.flake8', '.pylintrc',
])

const MAX_FILE_SIZE_BYTES  = 150 * 1024  // 150 KB per file
const MAX_TOTAL_FILES      = 300
const MAX_SCAN_DEPTH       = 6
const MAX_CONTENT_PER_FILE = 8000        // chars sent to backend

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isSensitive(filename) {
  if (SENSITIVE_FILENAMES.has(filename)) return true
  return SENSITIVE_PATTERNS.some(p => p.test(filename))
}

function isAllowed(filename) {
  if (isSensitive(filename)) return false
  if (ALWAYS_INCLUDE_NAMES.has(filename)) return true
  const ext = path.extname(filename).toLowerCase()
  return ALLOWED_EXTENSIONS.has(ext)
}

function readFileSafe(absPath) {
  try {
    const stat = fs.statSync(absPath)
    if (!stat.isFile()) return null
    if (stat.size > MAX_FILE_SIZE_BYTES) return null   // too large — skip content
    return fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively scan cwd and return an array of file objects:
 * [{ path: 'relative/path', content: '...' }, ...]
 *
 * Also returns stats about the scan.
 */
function scanProjectFiles(cwd) {
  const files      = []    // { path, content, size, skipped_reason }
  const skipped    = []    // { path, reason }
  let   totalFound = 0

  function walk(dir, depth, relBase) {
    if (depth > MAX_SCAN_DEPTH) return
    if (files.length >= MAX_TOTAL_FILES) return

    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (files.length >= MAX_TOTAL_FILES) break

      const abs = path.join(dir, entry.name)
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          walk(abs, depth + 1, rel)
        }
        continue
      }

      if (!entry.isFile()) continue
      totalFound++

      // Sensitivity check first
      if (isSensitive(entry.name)) {
        skipped.push({ path: rel, reason: 'sensitive filename' })
        continue
      }

      // Extension / name allow-list
      if (!isAllowed(entry.name)) {
        continue  // silently skip non-source files
      }

      // Size check
      let stat
      try { stat = fs.statSync(abs) } catch { continue }

      if (stat.size > MAX_FILE_SIZE_BYTES) {
        skipped.push({ path: rel, reason: `file too large (${Math.round(stat.size / 1024)}KB)` })
        continue
      }

      // Read content
      const raw = readFileSafe(abs)
      if (raw === null) {
        skipped.push({ path: rel, reason: 'could not read file' })
        continue
      }

      // Truncate content sent to backend (keeps tokens manageable)
      const content = raw.length > MAX_CONTENT_PER_FILE
        ? raw.slice(0, MAX_CONTENT_PER_FILE) + '\n... [truncated]'
        : raw

      files.push({
        path:    rel,
        content: content,
        size:    stat.size,
        ext:     path.extname(entry.name).toLowerCase(),
        name:    entry.name,
      })
    }
  }

  walk(cwd, 0, '')

  return {
    files,
    skipped,
    stats: {
      totalFound,
      included:  files.length,
      skippedCount: skipped.length,
      totalSizeBytes: files.reduce((s, f) => s + f.size, 0),
    }
  }
}

module.exports = { scanProjectFiles, isSensitive, isAllowed, MAX_FILE_SIZE_BYTES }