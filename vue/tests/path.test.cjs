const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const src = ts.transpileModule(
  readFileSync(join(__dirname, '../src/util/path.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText
const moduleObj = { exports: {} }
runInNewContext(src, {
  module: moduleObj,
  exports: moduleObj.exports,
  require(name) {
    assert.equal(name, 'lodash-es')
    return { memoize: fn => fn }
  }
})
const Path = moduleObj.exports

test('path join tolerates sparse reactive arrays during folder removal', () => {
  const fragments = ['/', 'pictures', 'album']
  delete fragments[2] // Array.pop() transiently deletes an index before updating length
  assert.equal(Path.join(...fragments), '/pictures')
  assert.equal(Path.join('/', 'pictures', undefined), '/pictures')
  assert.equal(Path.join('/'), '/')
})

test('root path has no fragments; Windows drive fragments still normalize', () => {
  assert.equal(Path.splitPath('/').length, 0)
  assert.equal(Path.splitPath('').length, 0)
  assert.equal(Path.splitPath('C:/Users')[0], 'C:/')
})
