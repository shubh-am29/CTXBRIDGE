
'use strict'

const assert = require('assert')

const registry = require('../lib/language-registry')
const detector = require('../lib/project-detector')

console.log('\nContextBridge Language Registry Tests\n')

// Registry lookups
assert.strictEqual(registry.getLanguageId('.py'), 'python')
assert.strictEqual(registry.getLanguageId('.tsx'), 'typescript')
assert.strictEqual(registry.getLanguageId('.scala'), 'scala')
assert.strictEqual(registry.getLanguageId('.ex'), 'elixir')
assert.strictEqual(registry.getLanguageId('.hs'), 'haskell')
assert.strictEqual(registry.getLanguageId('.unknown'), null)

console.log('✓ Registry resolves supported extensions')

// Display names
assert.strictEqual(registry.getLanguageDisplayName('.py'), 'Python')
assert.strictEqual(registry.getLanguageDisplayName('.tsx'), 'TypeScript')
assert.strictEqual(registry.getLanguageDisplayName('.hs'), 'Haskell')

console.log('✓ Registry returns display names')

// Project detector compatibility
assert.strictEqual(detector.EXT_LANG['.py'], 'python')
assert.strictEqual(detector.LANG_DISPLAY.python, 'Python')
assert.strictEqual(detector.EXT_LANG['.scala'], 'scala')
assert.strictEqual(detector.LANG_DISPLAY.haskell, 'Haskell')

console.log('✓ Project detector uses canonical language definitions')

console.log('\nAll language registry tests passed.')
