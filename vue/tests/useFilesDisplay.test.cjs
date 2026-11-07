const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

// Exercise the real display hook with an empty gallery. In a non-walk pane
// there is no next-page loader; a scroll event must not spin indefinitely.
const source = ts.transpileModule(
  readFileSync(join(__dirname, '../src/page/fileTransfer/hooks/useFilesDisplay.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText

function setup(mode, canLoad = false) {
  let delays = 0
  let loads = 0
  const callbacks = {}
  const state = {
    scroller: vue.ref({ scrollToItem() {} }),
    sortedFiles: vue.ref([]),
    sortMethod: vue.ref('date-desc'),
    currLocation: vue.ref(''),
    currPage: vue.ref(undefined),
    stackViewEl: vue.ref(null),
    canLoadNext: vue.ref(canLoad),
    previewIdx: vue.ref(0),
    props: vue.ref({ mode }),
    walker: vue.ref(null),
    getViewableAreaFiles: vue.ref(() => [])
  }
  state.walker.value = { next: async () => {
    loads++
    state.canLoadNext.value = false
    state.sortedFiles.value = [{ fullpath: '/test.png', name: 'test.png' }]
  } }
  const shared = {
    toRefs: () => state,
    state: {
      useEventListen: (name, cb) => { callbacks[name] = cb },
      eventEmitter: { emit: () => {} }
    }
  }
  const modules = {
    '@vueuse/core': { useElementSize: () => ({ width: vue.ref(800) }) },
    'vue': vue,
    '@/api': { batchGetDirTop4MediaInfo: async () => ({}) },
    'vue3-ts-util': { delay: async () => {
      if (++delays > 3) throw new Error('endless gallery pagination')
    } },
    '../fileSort': { sortMethodConv: {} },
    'lodash-es': { debounce: fn => fn },
    '@/util/file': { isMediaFile: () => true },
    '.': {
      useHookShareState: () => shared,
      global: { defaultGridCellWidth: 256 },
      tagStore: { fetchImageTags: () => {} }
    },
    '@/util': {
      makeAsyncFunctionSingle: fn => fn,
      useGlobalEventListen: () => {}
    },
    '@/util/scroller': { getVisibleRange: () => ({ start: 0, end: 0 }) },
    '@/util/gridCellLevel': { nearestGridCellLevel: x => x }
  }
  const exports = {}
  runInNewContext(source, {
    exports,
    require: name => {
      assert.ok(Object.hasOwn(modules, name), 'Unexpected module ' + name)
      return modules[name]
    }
  })
  const scope = vue.effectScope()
  const gallery = scope.run(() => exports.useFilesDisplay())
  return { state, gallery, scope, delays: () => delays, loads: () => loads }
}

for (const mode of [undefined, 'scanned', 'scanned-fixed', 'walk']) {
  test('empty ' + (mode ?? 'random') + ' gallery does not load when no next page exists', async () => {
    const c = setup(mode)
    try {
      await c.gallery.onScroll()
      assert.equal(c.delays(), 0)
      assert.equal(c.loads(), 0)
    } finally {
      c.scope.stop()
    }
  })
}

test('walk-mode empty gallery loads a next folder if available', async () => {
  const c = setup('walk', true)
  try {
    await c.gallery.onScroll()
    assert.equal(c.loads(), 1)
    assert.equal(c.state.sortedFiles.value.length, 1)
  } finally {
    c.scope.stop()
  }
})
