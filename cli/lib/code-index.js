'use strict'

const fs = require('fs')
const path = require('path')
const { parseSource, SUPPORTED_LANGUAGES } = require('./parser')
const { getLanguageId } = require('./language-registry')
const { MAX_FILE_SIZE_BYTES } = require('./scanner')

const DEFAULT_CONCURRENCY = 8

/**
 * Builds a code index (symbols / imports / exports per file) for the files
 * returned by the scanner.
 *
 * Why this reads from disk instead of using `file.content`:
 * the scanner truncates content to a few thousand characters before it is
 * sent to the backend. Parsing that truncated copy would cut large files
 * mid-function and silently drop symbols — and the largest files are
 * usually the most important ones. So we re-read the full file here.
 *
 * Safety:
 *  - only paths the scanner already approved are read (the scanner is what
 *    excludes .env files, keys, etc.), and each one must resolve inside
 *    `cwd` — a "../" path or a symlink pointing outside the project is
 *    skipped, never read.
 *  - one unreadable or unparseable file never aborts the rest.
 *
 * @param {Array<{path: string, ext?: string}>} files  scanner output
 * @param {object}  [options]
 * @param {string}  [options.cwd=process.cwd()]       project root
 * @param {number}  [options.concurrency=8]           parallel parses
 * @param {number}  [options.maxFileBytes]            per-file size cap
 * @returns {Promise<{files: object[], skipped: object[], summary: object}>}
 */
async function buildCodeIndex(files, options = {}) {
  if (!Array.isArray(files)) {
    throw new TypeError('files must be an array')
  }

  const cwd = path.resolve(options.cwd || process.cwd())
  const maxFileBytes = options.maxFileBytes || MAX_FILE_SIZE_BYTES
  const concurrency = Math.max(
    1,
    Math.floor(options.concurrency || DEFAULT_CONCURRENCY)
  )

  let realRoot
  try {
    realRoot = await fs.promises.realpath(cwd)
  } catch {
    throw new Error(`Project root not found: ${cwd}`)
  }

  // Decide which files are parseable up front; everything else is only counted.
  const candidates = []
  let unsupported = 0

  for (const file of files) {
    const ext = file.ext || path.extname(file.path || '')
    const language = getLanguageId(ext)

    if (language && SUPPORTED_LANGUAGES.has(language)) {
      candidates.push({ file, ext, language })
    } else {
      unsupported++
    }
  }

  // Results are written by index so output order always matches input order,
  // no matter which parse finishes first.
  const slots = new Array(candidates.length)
  let cursor = 0

  async function processOne(index) {
    const { file, ext, language } = candidates[index]
    const relPath = file.path

    const abs = path.resolve(cwd, relPath)
    let realAbs
    try {
      realAbs = await fs.promises.realpath(abs)
    } catch {
      slots[index] = { skipped: { path: relPath, reason: 'could not read file' } }
      return
    }

    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
      slots[index] = { skipped: { path: relPath, reason: 'outside project root' } }
      return
    }

    let source
    try {
      const stat = await fs.promises.stat(realAbs)
      if (!stat.isFile()) {
        slots[index] = { skipped: { path: relPath, reason: 'not a regular file' } }
        return
      }
      if (stat.size > maxFileBytes) {
        slots[index] = {
          skipped: {
            path: relPath,
            reason: `file too large (${Math.round(stat.size / 1024)}KB)`,
          },
        }
        return
      }
      source = await fs.promises.readFile(realAbs, 'utf8')
    } catch {
      slots[index] = { skipped: { path: relPath, reason: 'could not read file' } }
      return
    }

    const parsed = await parseSource({ source, extension: ext })

    const entry = {
      path: relPath,
      language,
      hasErrors: parsed.hasErrors,
      symbols: parsed.symbols,
      imports: parsed.imports,
      exports: parsed.exports,
    }
    if (parsed.error) entry.error = parsed.error

    slots[index] = { entry }
  }

  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor++
      try {
        await processOne(index)
      } catch (error) {
        // Defensive: nothing should reach here, but a bug in one file's
        // processing must not take down the whole index.
        slots[index] = {
          skipped: {
            path: candidates[index].file.path,
            reason: `unexpected error: ${error.message}`,
          },
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker)
  )

  const indexed = []
  const skipped = []
  for (const slot of slots) {
    if (slot.entry) indexed.push(slot.entry)
    else skipped.push(slot.skipped)
  }

  const byLanguage = {}
  for (const entry of indexed) {
    byLanguage[entry.language] = (byLanguage[entry.language] || 0) + 1
  }

  return {
    files: indexed,
    skipped,
    summary: {
      parsed: indexed.length,
      skipped: skipped.length,
      unsupported,
      withErrors: indexed.filter(e => e.hasErrors).length,
      symbols: indexed.reduce((n, e) => n + e.symbols.length, 0),
      imports: indexed.reduce((n, e) => n + e.imports.length, 0),
      exports: indexed.reduce((n, e) => n + e.exports.length, 0),
      byLanguage,
    },
  }
}

module.exports = { buildCodeIndex }