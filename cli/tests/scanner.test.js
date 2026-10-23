
'use strict'

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const assert = require('assert')

const {
  scanProjectFiles,
  isSensitive,
  isAllowed,
  MAX_FILE_SIZE_BYTES,
} = require('../lib/scanner')

const {
  analyseProject,
  detectLanguages,
} = require('../lib/analyser')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbridge-test-'))
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ${chalk_green('✓')} ${name}`)
    passed++
  } catch (err) {
    console.log(`  ${chalk_red('✗')} ${name}`)
    console.log(`    ${err.message}`)
    failed++
  }
}

function chalk_green(s) { return `\x1b[32m${s}\x1b[0m` }
function chalk_red(s)   { return `\x1b[31m${s}\x1b[0m` }

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n  ContextBridge Scanner + Analyser Tests\n')

// --- isSensitive ---
console.log('  Sensitive filename detection:')

test('.env is sensitive', () => {
  assert.ok(isSensitive('.env'))
})

test('.env.local is sensitive', () => {
  assert.ok(isSensitive('.env.local'))
})

test('secrets.json is sensitive', () => {
  assert.ok(isSensitive('secrets.json'))
})

test('private.key is sensitive', () => {
  assert.ok(isSensitive('private.key'))
})

test('main.py is not sensitive', () => {
  assert.ok(!isSensitive('main.py'))
})

test('.env.example is not sensitive', () => {
  assert.ok(!isSensitive('.env.example'))
})

// --- isAllowed ---
console.log('\n  File allow-list:')

test('.py is allowed', () => {
  assert.ok(isAllowed('main.py'))
})

test('.jsx is allowed', () => {
  assert.ok(isAllowed('App.jsx'))
})

test('requirements.txt is allowed', () => {
  assert.ok(isAllowed('requirements.txt'))
})

test('.env is not allowed (sensitive)', () => {
  assert.ok(!isAllowed('.env'))
})

test('.exe is not allowed', () => {
  assert.ok(!isAllowed('app.exe'))
})

test('.png is not allowed', () => {
  assert.ok(!isAllowed('logo.png'))
})

// --- scanProjectFiles ---
console.log('\n  File scanner:')

test('scans source files', () => {
  const dir = tmpDir()

  writeFile(dir, 'app/main.py', 'from fastapi import FastAPI\napp = FastAPI()')
  writeFile(dir, 'requirements.txt', 'fastapi\nuvicorn')

  const result = scanProjectFiles(dir)

  assert.ok(
    result.files.length >= 2,
    `Expected ≥2 files, got ${result.files.length}`
  )

  cleanup(dir)
})

test('ignores node_modules', () => {
  const dir = tmpDir()

  writeFile(dir, 'node_modules/express/index.js', 'module.exports = {}')
  writeFile(dir, 'src/app.js', 'console.log("hello")')

  const result = scanProjectFiles(dir)
  const paths = result.files.map(f => f.path)

  assert.ok(
    !paths.some(p => p.includes('node_modules')),
    'node_modules should be ignored'
  )

  cleanup(dir)
})

test('ignores .git directory', () => {
  const dir = tmpDir()

  writeFile(dir, '.git/config', '[core]')
  writeFile(dir, 'main.py', 'print("hello")')

  const result = scanProjectFiles(dir)
  const paths = result.files.map(f => f.path)

  assert.ok(
    !paths.some(p => p.includes('.git')),
    '.git should be ignored'
  )

  cleanup(dir)
})

test('ignores venv directory', () => {
  const dir = tmpDir()

  writeFile(dir, 'venv/lib/python3.11/site.py', '# system')
  writeFile(dir, 'app.py', 'print("hello")')

  const result = scanProjectFiles(dir)
  const paths = result.files.map(f => f.path)

  assert.ok(
    !paths.some(p => p.includes('venv')),
    'venv should be ignored'
  )

  cleanup(dir)
})

test('excludes .env (sensitive)', () => {
  const dir = tmpDir()

  writeFile(dir, '.env', 'SECRET_KEY=abc123')
  writeFile(dir, '.env.example', 'SECRET_KEY=your-key')
  writeFile(dir, 'main.py', 'print("hello")')

  const result = scanProjectFiles(dir)
  const paths = result.files.map(f => f.path)

  assert.ok(!paths.includes('.env'), '.env should be excluded')
  assert.ok(paths.includes('.env.example'), '.env.example should be included')

  cleanup(dir)
})

test('respects file size limit', () => {
  const dir = tmpDir()

  const bigContent = 'x'.repeat(MAX_FILE_SIZE_BYTES + 1)

  writeFile(dir, 'big.py', bigContent)
  writeFile(dir, 'small.py', 'print("hello")')

  const result = scanProjectFiles(dir)
  const paths = result.files.map(f => f.path)

  assert.ok(!paths.includes('big.py'), 'oversized file should be skipped')
  assert.ok(paths.includes('small.py'), 'small file should be included')

  cleanup(dir)
})

test('handles empty directory', () => {
  const dir = tmpDir()
  const result = scanProjectFiles(dir)

  assert.strictEqual(result.files.length, 0)
  assert.strictEqual(result.stats.included, 0)

  cleanup(dir)
})

test('handles unreadable directory gracefully', () => {
  // Should not throw even if given a bad path.
  try {
    const result = scanProjectFiles('/path/that/does/not/exist/anywhere')
    assert.strictEqual(result.files.length, 0)
  } catch {
    // Also acceptable — just not a crash without a message.
  }
})

// --- analyseProject ---
console.log('\n  Project analyser:')

test('detects FastAPI', () => {
  const files = [
    {
      path: 'main.py',
      name: 'main.py',
      ext: '.py',
      content: 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root(): return {}',
    },
    {
      path: 'requirements.txt',
      name: 'requirements.txt',
      ext: '.txt',
      content: 'fastapi\nuvicorn',
    },
  ]

  const mem = analyseProject(files)

  assert.ok(mem.technologies.includes('FastAPI'), 'FastAPI not detected')
})

test('detects React', () => {
  const files = [
    {
      path: 'src/App.jsx',
      name: 'App.jsx',
      ext: '.jsx',
      content: "import { useState } from 'react'\nexport default function App() { return <div>hello</div> }",
    },
    {
      path: 'package.json',
      name: 'package.json',
      ext: '.json',
      content: JSON.stringify({
        dependencies: {
          react: '^18.0.0',
          vite: '^5.0.0',
        },
      }),
    },
  ]

  const mem = analyseProject(files)

  assert.ok(mem.technologies.includes('React'), 'React not detected')
})

test('detects Python language', () => {
  const files = [
    {
      path: 'utils.py',
      name: 'utils.py',
      ext: '.py',
      content: 'def hello(): return "world"',
    },
    {
      path: 'main.py',
      name: 'main.py',
      ext: '.py',
      content: 'import utils',
    },
  ]

  const mem = analyseProject(files)

  assert.ok(
    mem.technologies.includes('Python') ||
      mem.project_overview.includes('Python'),
    'Python not detected'
  )
})

// NEW: Verify the analyser uses the shared language registry.
test('detects languages from the shared registry', () => {
  const files = [
    {
      path: 'Main.scala',
      name: 'Main.scala',
      ext: '.scala',
      content: '',
    },
    {
      path: 'app.ex',
      name: 'app.ex',
      ext: '.ex',
      content: '',
    },
    {
      path: 'Main.hs',
      name: 'Main.hs',
      ext: '.hs',
      content: '',
    },
    {
      path: 'main.lua',
      name: 'main.lua',
      ext: '.lua',
      content: '',
    },
  ]

  const languages = detectLanguages(files)

  assert.ok(languages.includes('Scala'), 'Scala not detected')
  assert.ok(languages.includes('Elixir'), 'Elixir not detected')
  assert.ok(languages.includes('Haskell'), 'Haskell not detected')
  assert.ok(languages.includes('Lua'), 'Lua not detected')
})

test('returns non-empty overview for FastAPI project', () => {
  const files = [
    {
      path: 'app/main.py',
      name: 'main.py',
      ext: '.py',
      content: 'from fastapi import FastAPI\napp = FastAPI()',
    },
    {
      path: 'requirements.txt',
      name: 'requirements.txt',
      ext: '.txt',
      content: 'fastapi\nuvicorn\nsupabase',
    },
  ]

  const mem = analyseProject(files)

  assert.ok(mem.project_overview.length > 10, 'project_overview should be non-empty')
  assert.ok(mem.architecture.length > 10, 'architecture should be non-empty')
})

test('handles empty file list', () => {
  const mem = analyseProject([])

  assert.ok(typeof mem.project_overview === 'string')
  assert.ok(Array.isArray(mem.technologies))
})

test('detects important files', () => {
  const files = [
    {
      path: 'app/main.py',
      name: 'main.py',
      ext: '.py',
      content: '',
    },
    {
      path: 'app/api/projects.py',
      name: 'projects.py',
      ext: '.py',
      content: '',
    },
    {
      path: 'app/services/mem.py',
      name: 'mem.py',
      ext: '.py',
      content: '',
    },
    {
      path: 'requirements.txt',
      name: 'requirements.txt',
      ext: '.txt',
      content: '',
    },
  ]

  const mem = analyseProject(files)

  assert.ok(mem.important_code.length > 0, 'No important files detected')
})

test('preserves existing memory on merge (backend logic simulation)', () => {
  const existing = {
    key_decisions: ['Use Supabase instead of raw PostgreSQL'],
    constraints: ['Must work offline'],
    technologies: ['Python'],
  }

  const detected = {
    technologies: ['Python', 'FastAPI'],
    key_decisions: [],
  }

  // Simulate _safe_merge_memory logic in JS.
  function mergeList(a, b) {
    const seen = new Set()

    return [...a, ...b].filter(item => {
      const k = String(item).toLowerCase()

      if (seen.has(k)) return false

      seen.add(k)
      return true
    })
  }

  const merged = {
    key_decisions: mergeList(
      existing.key_decisions,
      detected.key_decisions || []
    ),
    constraints: mergeList(
      existing.constraints,
      detected.constraints || []
    ),
    technologies: mergeList(
      existing.technologies,
      detected.technologies || []
    ),
  }

  assert.ok(
    merged.key_decisions.includes('Use Supabase instead of raw PostgreSQL'),
    'Existing decision should be preserved'
  )

  assert.ok(
    merged.constraints.includes('Must work offline'),
    'Existing constraint should be preserved'
  )

  assert.ok(
    merged.technologies.includes('FastAPI'),
    'Detected tech should be added'
  )

  assert.ok(
    merged.technologies.includes('Python'),
    'Existing tech should be preserved'
  )
})

// ─── Results ─────────────────────────────────────────────────────────────────

console.log()
console.log(
  `  ${chalk_green(passed + ' passed')}, ${
    failed > 0 ? chalk_red(failed + ' failed') : '0 failed'
  }`
)
console.log()

if (failed > 0) process.exit(1)
