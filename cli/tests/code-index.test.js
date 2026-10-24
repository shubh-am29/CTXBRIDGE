'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildCodeIndex } = require('../lib/code-index')
const { scanProjectFiles } = require('../lib/scanner')
const { parseSource } = require('../lib/parser')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

console.log('\nContextBridge Code Index Tests\n')

// Creates a temp project, runs fn(dir), always cleans up.
async function withProject(layout, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbridge-index-'))
  try {
    for (const [rel, content] of Object.entries(layout)) {
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content)
    }
    return await fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const entryFor = (result, p) => result.files.find(f => f.path === p)

// ── Basics ──────────────────────────────────────────────────────────────────
test('indexes python, javascript, typescript and tsx files', async () => {
  const layout = {
    'a.py': 'import os\ndef py_fn(): pass\n',
    'b.js': 'export function jsFn() {}\n',
    'c.ts': 'export interface Shape { x: number }\n',
    'd.tsx': 'export function Comp() { return <div/> }\n',
  }
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const r = await buildCodeIndex(files, { cwd: dir })

    assert.strictEqual(r.summary.parsed, 4)
    assert.strictEqual(entryFor(r, 'a.py').symbols[0].name, 'py_fn')
    assert.strictEqual(entryFor(r, 'a.py').imports.length, 1)
    assert.strictEqual(entryFor(r, 'b.js').exports[0].name, 'jsFn')
    assert.strictEqual(entryFor(r, 'c.ts').exports[0].kind, 'interface')
    assert.strictEqual(entryFor(r, 'd.tsx').hasErrors, false)
    assert.deepStrictEqual(r.summary.byLanguage, { python: 1, javascript: 1, typescript: 2 })
  })
})

test('unsupported files are counted, not reported as skipped', async () => {
  const layout = { 'a.js': 'const x = 1', 'README.md': '# hi', 'data.json': '{}' }
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const r = await buildCodeIndex(files, { cwd: dir })
    assert.strictEqual(r.summary.parsed, 1)
    assert.strictEqual(r.summary.unsupported, 2)
    assert.deepStrictEqual(r.skipped, [])
  })
})

test('empty input returns an empty, well-formed index', async () => {
  const r = await buildCodeIndex([])
  assert.deepStrictEqual(r.files, [])
  assert.deepStrictEqual(r.skipped, [])
  assert.strictEqual(r.summary.parsed, 0)
  assert.strictEqual(r.summary.symbols, 0)
})

test('rejects non-array input', async () => {
  await assert.rejects(() => buildCodeIndex('nope'), TypeError)
  await assert.rejects(() => buildCodeIndex(undefined), TypeError)
})

test('throws a clear error when the project root does not exist', async () => {
  await assert.rejects(
    () => buildCodeIndex([], { cwd: '/definitely/not/a/real/dir' }),
    /Project root not found/
  )
})

// ── The truncation problem this module exists to solve ──────────────────────
test('symbols after the scanner truncation point are still found', async () => {
  // ~9,000 chars of filler comments, then a function the scanner will cut off.
  const filler = '// filler line to push the next function past the cutoff\n'.repeat(160)
  const source = `${filler}export function lateFunction() {}\n`
  assert.ok(source.length > 8000, 'fixture must exceed the scanner cutoff')

  await withProject({ 'big.js': source }, async dir => {
    const { files } = scanProjectFiles(dir)

    // Prove the premise: the scanner really did truncate this file...
    assert.ok(files[0].content.includes('[truncated]'), 'scanner should truncate')
    assert.ok(!files[0].content.includes('lateFunction'), 'scanner copy should miss it')

    // ...so parsing the scanner's copy loses the symbol (the bug we avoid)...
    const naive = await parseSource({ source: files[0].content, extension: '.js' })
    assert.ok(!naive.symbols.some(s => s.name === 'lateFunction'))

    // ...but the code index re-reads the full file and finds it.
    const r = await buildCodeIndex(files, { cwd: dir })
    const entry = entryFor(r, 'big.js')
    assert.ok(entry.symbols.some(s => s.name === 'lateFunction'), 'symbol must be found')
    assert.ok(entry.exports.some(e => e.name === 'lateFunction'), 'export must be found')
    assert.strictEqual(entry.hasErrors, false)
  })
})

// ── Ordering and concurrency ────────────────────────────────────────────────
test('output order matches input order', async () => {
  const layout = {}
  for (let i = 0; i < 20; i++) layout[`f${String(i).padStart(2, '0')}.js`] = `export const v${i} = ${i}\n`
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const r = await buildCodeIndex(files, { cwd: dir, concurrency: 8 })
    assert.deepStrictEqual(r.files.map(f => f.path), files.map(f => f.path))
  })
})

test('results are identical for concurrency 1 and 16', async () => {
  const layout = {}
  for (let i = 0; i < 12; i++) layout[`m${i}.ts`] = `export function fn${i}(): void {}\n`
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const a = await buildCodeIndex(files, { cwd: dir, concurrency: 1 })
    const b = await buildCodeIndex(files, { cwd: dir, concurrency: 16 })
    assert.deepStrictEqual(a, b)
  })
})

// ── Failure isolation ───────────────────────────────────────────────────────
test('a syntax-error file is flagged but does not stop other files', async () => {
  const layout = {
    'good.js': 'export function ok() {}\n',
    'bad.ts': 'export function broken( {\n',
    'good2.py': 'def fine(): pass\n',
  }
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const r = await buildCodeIndex(files, { cwd: dir })
    assert.strictEqual(r.summary.parsed, 3)
    assert.strictEqual(r.summary.withErrors, 1)
    assert.strictEqual(entryFor(r, 'bad.ts').hasErrors, true)
    assert.strictEqual(entryFor(r, 'good.js').exports[0].name, 'ok')
    assert.strictEqual(entryFor(r, 'good2.py').symbols[0].name, 'fine')
  })
})

test('a file deleted after the scan is skipped, others still indexed', async () => {
  const layout = { 'keep.js': 'export const a = 1\n', 'gone.js': 'export const b = 2\n' }
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    fs.rmSync(path.join(dir, 'gone.js'))
    const r = await buildCodeIndex(files, { cwd: dir })
    assert.strictEqual(r.summary.parsed, 1)
    assert.deepStrictEqual(r.skipped, [{ path: 'gone.js', reason: 'could not read file' }])
  })
})

test('files over the size cap are skipped with a reason', async () => {
  const layout = { 'small.js': 'export const a = 1\n', 'large.js': 'x'.repeat(5000) }
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const r = await buildCodeIndex(files, { cwd: dir, maxFileBytes: 1000 })
    assert.strictEqual(r.summary.parsed, 1)
    assert.strictEqual(r.skipped.length, 1)
    assert.strictEqual(r.skipped[0].path, 'large.js')
    assert.ok(r.skipped[0].reason.startsWith('file too large'))
  })
})

// ── Path safety ─────────────────────────────────────────────────────────────
test('a ../ path escaping the project root is never read', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbridge-outer-'))
  try {
    fs.writeFileSync(path.join(outer, 'secret.js'), 'export const SECRET = 1\n')
    const project = path.join(outer, 'project')
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, 'ok.js'), 'export const ok = 1\n')

    const r = await buildCodeIndex(
      [{ path: 'ok.js', ext: '.js' }, { path: '../secret.js', ext: '.js' }],
      { cwd: project }
    )
    assert.strictEqual(r.summary.parsed, 1)
    assert.deepStrictEqual(r.skipped, [{ path: '../secret.js', reason: 'outside project root' }])
    assert.ok(!JSON.stringify(r).includes('SECRET'), 'outside content must not leak')
  } finally {
    fs.rmSync(outer, { recursive: true, force: true })
  }
})

test('a symlink pointing outside the project root is never read', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbridge-link-'))
  try {
    fs.writeFileSync(path.join(outer, 'secret.js'), 'export const LEAKED = 1\n')
    const project = path.join(outer, 'project')
    fs.mkdirSync(project)
    try {
      fs.symlinkSync(path.join(outer, 'secret.js'), path.join(project, 'link.js'))
    } catch {
      console.log('    (symlinks not permitted here — skipping)')
      return
    }
    const r = await buildCodeIndex([{ path: 'link.js', ext: '.js' }], { cwd: project })
    assert.strictEqual(r.summary.parsed, 0)
    assert.strictEqual(r.skipped[0].reason, 'outside project root')
    assert.ok(!JSON.stringify(r).includes('LEAKED'))
  } finally {
    fs.rmSync(outer, { recursive: true, force: true })
  }
})

test('a directory named like a source file is skipped, not parsed', async () => {
  await withProject({ 'dir.js/inner.txt': 'x' }, async dir => {
    const r = await buildCodeIndex([{ path: 'dir.js', ext: '.js' }], { cwd: dir })
    assert.strictEqual(r.summary.parsed, 0)
    assert.strictEqual(r.skipped[0].reason, 'not a regular file')
  })
})

// ── Integration with the real scanner's exclusions ──────────────────────────
test('files the scanner excludes (e.g. .env) never reach the index', async () => {
  const layout = { 'app.js': 'export const a = 1\n', '.env': 'API_KEY=hunter2\n' }
  await withProject(layout, async dir => {
    const { files } = scanProjectFiles(dir)
    const r = await buildCodeIndex(files, { cwd: dir })
    assert.strictEqual(r.summary.parsed, 1)
    assert.ok(!JSON.stringify(r).includes('hunter2'))
  })
})

// ── Runner ──────────────────────────────────────────────────────────────────
;(async () => {
  let passed = 0
  let failed = 0

  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`✓ ${name}`)
      passed++
    } catch (error) {
      console.log(`✗ ${name}`)
      console.log(`    ${error.message.split('\n')[0]}`)
      failed++
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
})()