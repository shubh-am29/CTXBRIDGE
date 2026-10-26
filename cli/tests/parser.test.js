
'use strict'

const assert = require('assert')
const { parseSource, SUPPORTED_LANGUAGES } = require('../lib/parser')

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

const byName = (list, name) => list.find(item => item.name === name)

console.log('\nContextBridge Parser Tests\n')

// ── Contract ────────────────────────────────────────────────────────────────
test('supports javascript, typescript and python', () => {
  assert.deepStrictEqual(
    [...SUPPORTED_LANGUAGES].sort(),
    ['javascript', 'python', 'typescript']
  )
})

test('rejects non-string source', async () => {
  await assert.rejects(() => parseSource({ source: 42, extension: '.js' }), TypeError)
  await assert.rejects(() => parseSource(), TypeError)
})

test('unsupported language returns a safe empty result', async () => {
  const r = await parseSource({ source: 'package main', extension: '.go' })
  assert.strictEqual(r.supported, false)
  assert.strictEqual(r.language, 'go')
  assert.deepStrictEqual([r.imports, r.exports, r.symbols], [[], [], []])
})

test('unknown extension returns a safe empty result', async () => {
  const r = await parseSource({ source: 'x', extension: '.zzz' })
  assert.strictEqual(r.supported, false)
  assert.strictEqual(r.language, null)
})

test('accepts language id or extension in the language field', async () => {
  const a = await parseSource({ source: 'def f(): pass', language: 'python' })
  const b = await parseSource({ source: 'def f(): pass', language: '.py' })
  assert.strictEqual(a.symbols[0].name, 'f')
  assert.strictEqual(b.symbols[0].name, 'f')
})

// ── JavaScript exports ──────────────────────────────────────────────────────
const ESM = `
import fs from 'fs'
import { a, b as c } from './mod'
export function foo() {}
export const bar = () => 1
export let count = 0
export default class Baz { method() {} }
export { a }
export { x as y } from './other'
export * from './all'
export * as ns from './space'
`

test('JS: detects ESM declaration exports with kinds', async () => {
  const { exports } = await parseSource({ source: ESM, extension: '.js' })
  assert.strictEqual(byName(exports, 'foo').kind, 'function')
  assert.strictEqual(byName(exports, 'bar').kind, 'function')
  assert.strictEqual(byName(exports, 'count').kind, 'variable')
  const baz = byName(exports, 'Baz')
  assert.strictEqual(baz.kind, 'class')
  assert.strictEqual(baz.isDefault, true)
})

test('JS: detects named, aliased and re-exports', async () => {
  const { exports } = await parseSource({ source: ESM, extension: '.js' })
  assert.strictEqual(byName(exports, 'a').kind, 'named')
  assert.strictEqual(byName(exports, 'a').source, null)

  const y = byName(exports, 'y')
  assert.strictEqual(y.kind, 'reexport')
  assert.strictEqual(y.local, 'x')
  assert.strictEqual(y.source, './other')

  assert.strictEqual(byName(exports, '*').kind, 'star_reexport')
  assert.strictEqual(byName(exports, '*').source, './all')
  assert.strictEqual(byName(exports, 'ns').kind, 'namespace_reexport')
  assert.strictEqual(byName(exports, 'ns').source, './space')
})

test('JS: detects default exports in each form', async () => {
  const ident = await parseSource({ source: 'const f = 1\nexport default f', extension: '.js' })
  assert.strictEqual(ident.exports[0].name, 'f')
  assert.strictEqual(ident.exports[0].isDefault, true)

  const anon = await parseSource({ source: 'export default () => 1', extension: '.js' })
  assert.strictEqual(anon.exports[0].name, 'default')
  assert.strictEqual(anon.exports[0].kind, 'function')

  const fn = await parseSource({ source: 'export default function main() {}', extension: '.js' })
  assert.strictEqual(fn.exports[0].name, 'main')
  assert.strictEqual(fn.exports[0].isDefault, true)

  const anonClass = await parseSource({ source: 'export default class {}', extension: '.js' })
  assert.strictEqual(anonClass.exports[0].name, 'default')
  assert.strictEqual(anonClass.exports[0].kind, 'class')
})

test('JS: reports one export per declarator', async () => {
  const { exports } = await parseSource({ source: 'export const a = 1, b = 2', extension: '.js' })
  assert.deepStrictEqual(exports.map(e => e.name), ['a', 'b'])
})

test('JS: non-exported code produces no exports', async () => {
  const { exports } = await parseSource({ source: 'function f() {}\nconst x = 1', extension: '.js' })
  assert.deepStrictEqual(exports, [])
})

test('JS: detects CommonJS exports', async () => {
  const src = `
module.exports = { x, y: 1, z() {} }
exports.a = function () {}
module.exports.b = 2
`
  const { exports } = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(exports.map(e => e.name).sort(), ['a', 'b', 'x', 'y', 'z'])
  assert.ok(exports.every(e => e.style === 'commonjs'))
  assert.strictEqual(byName(exports, 'a').kind, 'function')
})

test('JS: module.exports = identifier is a default export', async () => {
  const { exports } = await parseSource({ source: 'class A {}\nmodule.exports = A', extension: '.js' })
  assert.strictEqual(exports[0].name, 'A')
  assert.strictEqual(exports[0].isDefault, true)
})

test('JS: exports.x inside a function is not a module export', async () => {
  const src = 'function setup() { exports.leak = 1 }'
  const { exports } = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(exports, [])
})

test('JS: .jsx parses JSX without errors', async () => {
  const src = 'export default function App() { return <div>hi</div> }'
  const r = await parseSource({ source: src, extension: '.jsx' })
  assert.strictEqual(r.hasErrors, false)
  assert.strictEqual(r.exports[0].name, 'App')
})

// ── TypeScript ──────────────────────────────────────────────────────────────
test('TS: detects interface, type, enum, function and class exports', async () => {
  const src = `
export interface Props { a: number }
export type Id = string
export enum Color { Red }
export function typed(a: number): string { return '' }
export class Svc { run(): void {} }
export abstract class Base {}
`
  const { exports, hasErrors } = await parseSource({ source: src, extension: '.ts' })
  assert.strictEqual(hasErrors, false)
  assert.strictEqual(byName(exports, 'Props').kind, 'interface')
  assert.strictEqual(byName(exports, 'Id').kind, 'type')
  assert.strictEqual(byName(exports, 'Color').kind, 'enum')
  assert.strictEqual(byName(exports, 'typed').kind, 'function')
  assert.strictEqual(byName(exports, 'Svc').kind, 'class')
  assert.strictEqual(byName(exports, 'Base').kind, 'class')
})

test('TS: extracts interface, type alias and enum symbols', async () => {
  const src = 'interface A {}\ntype B = string\nenum C { X }'
  const { symbols } = await parseSource({ source: src, extension: '.ts' })
  assert.deepStrictEqual(
    symbols.map(s => `${s.type}:${s.name}`),
    ['interface_declaration:A', 'type_alias_declaration:B', 'enum_declaration:C']
  )
})

test('TSX: parses JSX without syntax errors (uses the tsx grammar)', async () => {
  const src = `
import React from 'react'
export function App(): JSX.Element {
  return <div className="x">hello</div>
}
export default App
`
  const r = await parseSource({ source: src, extension: '.tsx' })
  assert.strictEqual(r.hasErrors, false, '.tsx must not report syntax errors')
  assert.strictEqual(r.language, 'typescript')
  assert.ok(byName(r.exports, 'App'))
  assert.ok(byName(r.symbols, 'App'))
})

test('TS: a .ts file keeps the plain typescript grammar', async () => {
  // Type assertions with angle brackets are valid in .ts but not in .tsx.
  const r = await parseSource({ source: 'const x = <string>y', extension: '.ts' })
  assert.strictEqual(r.hasErrors, false)
})

// ── Symbols ─────────────────────────────────────────────────────────────────
test('JS: captures function, class, method and arrow-function symbols', async () => {
  const src = `
function foo() {}
const bar = () => 1
const baz = function () {}
class Qux { method() {} }
`
  const { symbols } = await parseSource({ source: src, extension: '.js' })
  const got = symbols.map(s => `${s.type}:${s.name}`)
  assert.deepStrictEqual(got, [
    'function_declaration:foo',
    'arrow_function:bar',
    'function_expression:baz',
    'class_declaration:Qux',
    'method_definition:method',
  ])
})

test('symbols report 1-based start and end lines', async () => {
  const { symbols } = await parseSource({ source: 'function a() {\n  return 1\n}', extension: '.js' })
  assert.strictEqual(symbols[0].startLine, 1)
  assert.strictEqual(symbols[0].endLine, 3)
})

// ── Python ──────────────────────────────────────────────────────────────────
test('Python: extracts imports and symbols', async () => {
  const src = `
import os
from typing import List
def foo(): pass
class Bar:
    def method(self): pass
async def afn(): pass
`
  const r = await parseSource({ source: src, extension: '.py' })
  assert.strictEqual(r.hasErrors, false)
  assert.deepStrictEqual(r.imports.map(i => i.text), ['import os', 'from typing import List'])
  assert.deepStrictEqual(
    r.symbols.map(s => s.name),
    ['foo', 'Bar', 'method', 'afn']
  )
})

test('Python: does not report JS-style exports', async () => {
  const r = await parseSource({ source: 'def f(): pass', extension: '.py' })
  assert.deepStrictEqual(r.exports, [])
})

// ── Import specifiers and require() ─────────────────────────────────────────
const sources = r => r.imports.map(i => i.source)
const kinds = r => r.imports.map(i => i.kind)

test('imports: ESM records source and kind', async () => {
  const src = [
    "import x from './x'",
    "import { a } from '../up/a'",
    "import './side.css'",
    "import * as ns from 'pkg'",
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(sources(r), ['./x', '../up/a', './side.css', 'pkg'])
  assert.ok(kinds(r).every(k => k === 'import'))
  assert.strictEqual(r.imports[0].line, 1)
  assert.strictEqual(r.imports[0].text, "import x from './x'")
})

test('require: captures static require() calls with source and kind', async () => {
  const src = [
    "const a = require('./a')",
    'const { b } = require("./b")',
    "require('./side')",
    "const fs = require('fs')",
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(sources(r), ['./a', './b', './side', 'fs'])
  assert.ok(kinds(r).every(k => k === 'require'))
  assert.deepStrictEqual(r.imports.map(i => i.line), [1, 2, 3, 4])
})

test('require: finds requires nested in functions and arrow bodies', async () => {
  const src = [
    "function f() { return require('./inner') }",
    "const lazy = () => require('./lazy')",
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(sources(r), ['./inner', './lazy'])
})

test('require: static template literal counts, interpolated one does not', async () => {
  const src = [
    'const a = require(`./tpl`)',
    'const b = require(`./${name}`)',
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(sources(r), ['./tpl'])
})

test('require: dynamic or non-import forms are not recorded', async () => {
  const src = [
    'const a = require(name)',
    "const b = require.resolve('./r')",
    "const c = require('./a', 'extra')",
    "const d = require('')",
    'const e = require()',
    "const f = obj.require('./notmodule')",
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(r.imports, [])
})

test('require: text inside strings and comments is not an import', async () => {
  const src = [
    "// const x = require('./commented')",
    'const s = "require(\'./in-string\')"',
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(r.imports, [])
})

test('dynamic import(): captured with its own kind', async () => {
  const src = [
    "const m = await import('./dyn')",
    'const n = import(variable)',
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(sources(r), ['./dyn'])
  assert.deepStrictEqual(kinds(r), ['dynamic_import'])
})

test('imports: ESM and require in one file keep source order', async () => {
  const src = [
    "import a from './a'",
    "const b = require('./b')",
    "import c from './c'",
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(sources(r), ['./a', './b', './c'])
  assert.deepStrictEqual(kinds(r), ['import', 'require', 'import'])
})

test('TS: import type and import = require record specifiers', async () => {
  const src = "import type { T } from './t'\nimport fs = require('fs')"
  const r = await parseSource({ source: src, extension: '.ts' })
  assert.deepStrictEqual(sources(r), ['./t', 'fs'])
  assert.deepStrictEqual(kinds(r), ['import', 'require'])
})

test('TSX: imports are captured with the tsx grammar', async () => {
  const src = [
    "import React from 'react'",
    "import { Button } from './Button'",
    'export const A = () => <Button/>',
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.tsx' })
  assert.deepStrictEqual(sources(r), ['react', './Button'])
})

test('Python: records module for import and from-import', async () => {
  const src = [
    'import os',
    'import a.b.c',
    'from typing import List',
    'from app.core import database',
  ].join('\n')
  const r = await parseSource({ source: src, extension: '.py' })
  assert.deepStrictEqual(sources(r), ['os', 'a.b.c', 'typing', 'app.core'])
  assert.ok(kinds(r).every(k => k === 'import'))
})

test('Python: relative imports keep their leading dots', async () => {
  const src = 'from . import x\nfrom .mod import y\nfrom ..pkg.mod import z'
  const r = await parseSource({ source: src, extension: '.py' })
  assert.deepStrictEqual(sources(r), ['.', '.mod', '..pkg.mod'])
})

test('Python: one entry per module in a multi-module import, aliases resolved', async () => {
  const r = await parseSource({ source: 'import os, sys as s, json', extension: '.py' })
  assert.deepStrictEqual(sources(r), ['os', 'sys', 'json'])
  assert.ok(r.imports.every(i => i.line === 1))
})

test('Python: require() is not treated as an import', async () => {
  const r = await parseSource({ source: "x = require('./a')", extension: '.py' })
  assert.deepStrictEqual(r.imports, [])
})

// ── Python imported names ───────────────────────────────────────────────────
test('Python: from-import records the original imported names', async () => {
  const src = 'from app.api import projects, memory as mem, sessions'
  const r = await parseSource({ source: src, extension: '.py' })
  assert.strictEqual(r.imports.length, 1)
  assert.strictEqual(r.imports[0].source, 'app.api')
  assert.deepStrictEqual(r.imports[0].names, ['projects', 'memory', 'sessions'])
})

test('Python: parenthesised multi-line from-import lists every name', async () => {
  const src = 'from a import (\n    b,\n    c as d,\n    e,\n)'
  const r = await parseSource({ source: src, extension: '.py' })
  assert.deepStrictEqual(r.imports[0].names, ['b', 'c', 'e'])
})

test('Python: wildcard and relative from-imports', async () => {
  const src = 'from x import *\nfrom . import y\nfrom .mod import z'
  const r = await parseSource({ source: src, extension: '.py' })
  assert.deepStrictEqual(r.imports.map(i => i.names), [['*'], ['y'], ['z']])
  assert.deepStrictEqual(r.imports.map(i => i.source), ['x', '.', '.mod'])
})

test('Python: plain `import a, b` has no names (null)', async () => {
  const r = await parseSource({ source: 'import os, sys', extension: '.py' })
  assert.deepStrictEqual(r.imports.map(i => i.names), [null, null])
})

test('JS/TS imports have names null (not captured)', async () => {
  const src = "import { a, b } from './x'\nconst c = require('./y')"
  const r = await parseSource({ source: src, extension: '.js' })
  assert.deepStrictEqual(r.imports.map(i => i.names), [null, null])
})

// ── Robustness ──────────────────────────────────────────────────────────────
test('syntax errors set hasErrors and never throw', async () => {
  const r = await parseSource({ source: 'export function broken( {', extension: '.ts' })
  assert.strictEqual(r.supported, true)
  assert.strictEqual(r.hasErrors, true)
})

test('empty source parses cleanly in every language', async () => {
  for (const extension of ['.js', '.ts', '.tsx', '.py']) {
    const r = await parseSource({ source: '', extension })
    assert.strictEqual(r.supported, true, extension)
    assert.strictEqual(r.hasErrors, false, extension)
    assert.deepStrictEqual(r.symbols, [], extension)
  }
})

test('handles many concurrent parses', async () => {
  const jobs = Array.from({ length: 30 }, (_, i) =>
    parseSource({
      source: `export const v${i} = ${i}`,
      extension: ['.js', '.ts', '.tsx'][i % 3],
    })
  )
  const results = await Promise.all(jobs)
  results.forEach((r, i) => {
    assert.strictEqual(r.hasErrors, false)
    assert.strictEqual(r.exports[0].name, `v${i}`)
  })
})

test('repeated parsing is stable', async () => {
  for (let i = 0; i < 200; i++) {
    const r = await parseSource({ source: 'export function f() {}', extension: '.js' })
    assert.strictEqual(r.exports.length, 1)
  }
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
