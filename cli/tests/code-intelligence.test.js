'use strict'

const assert = require('assert')
const {
  detectLanguage,
  getLanguage,
  getLanguageByExtension,
  listLanguages,
  createFileIR,
  normalizeFileIR,
  IR_SCHEMA_VERSION,
} = require('../lib/code-intelligence')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${error.message}`)
    failed++
  }
}

console.log('\n  ContextBridge Code Intelligence Foundation Tests\n')

test('registers the initial supported languages', () => {
  assert.deepStrictEqual(
    listLanguages().map(language => language.id),
    ['python', 'javascript', 'typescript', 'tsx']
  )
})

test('detects JavaScript extensions', () => {
  for (const file of ['app.js', 'app.jsx', 'app.mjs', 'app.cjs']) {
    assert.strictEqual(detectLanguage(file).id, 'javascript')
  }
})

test('detects Python and TypeScript extensions', () => {
  assert.strictEqual(detectLanguage('src/main.py').id, 'python')
  assert.strictEqual(detectLanguage('src/app.ts').id, 'typescript')
  assert.strictEqual(detectLanguage('src/App.tsx').id, 'tsx')
})

test('returns null for unsupported or invalid file paths', () => {
  assert.strictEqual(detectLanguage('README.md'), null)
  assert.strictEqual(detectLanguage(''), null)
  assert.strictEqual(detectLanguage(null), null)
})

test('resolves aliases case-insensitively', () => {
  assert.strictEqual(getLanguage('PY').id, 'python')
  assert.strictEqual(getLanguage('JS').id, 'javascript')
  assert.strictEqual(getLanguageByExtension('PY').id, 'python')
})

test('creates a stable IR with normalized file paths', () => {
  const ir = createFileIR({
    file: '.\\src\\main.py',
    language: 'Python',
    source: 'def main():\n    return True',
  })

  assert.strictEqual(ir.schemaVersion, IR_SCHEMA_VERSION)
  assert.strictEqual(ir.file, 'src/main.py')
  assert.strictEqual(ir.language, 'python')
  assert.strictEqual(ir.meta.lineCount, 2)
  for (const field of ['symbols', 'imports', 'exports', 'calls', 'conditions', 'routes']) {
    assert.deepStrictEqual(ir[field], [])
  }
})

test('uses unknown language consistently for unrecognized language values', () => {
  const ir = createFileIR({ file: 'src/data.xyz', language: null })
  assert.strictEqual(ir.language, 'unknown')
})

test('normalizes missing collections without losing valid data', () => {
  const ir = normalizeFileIR({
    file: 'src/app.ts',
    language: 'typescript',
    symbols: [{ name: 'App' }],
    calls: 'not-an-array',
    meta: { framework: 'react' },
  })

  assert.deepStrictEqual(ir.symbols, [{ name: 'App' }])
  assert.deepStrictEqual(ir.calls, [])
  assert.strictEqual(ir.meta.framework, 'react')
  assert.ok(Array.isArray(ir.diagnostics))
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
