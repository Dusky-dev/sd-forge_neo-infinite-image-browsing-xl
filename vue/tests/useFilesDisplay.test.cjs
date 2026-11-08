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
      useGlobalEventListen: (name, cb) => { (callbacks[name] ??= []).push(cb) }
    },
    '@/util/scroller': { getVisibleRange: s => ({ start: 0, end: s?.visiblePool?.length ? 1 : 0 }) },
    '@/util/gridCellLevel': { nearestGridCellLevel: x => x }
  }
  const exports = {}
  runInNewContext(source, {
    exports,
    requestAnimationFrame: fn => fn(),
    require: name => {
      assert.ok(Object.hasOwn(modules, name), 'Unexpected module ' + name)
      return modules[name]
    }
  })
  const scope = vue.effectScope()
  const gallery = scope.run(() => exports.useFilesDisplay())
  return { state, gallery, scope, callbacks, delays: () => delays, loads: () => loads }
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


test('returning from txt2img rebuilds an empty but visible virtual-scroller pool without dropping files', async () => {
  const c = setup('scanned')
  try {
    const updates = []
    const scrolls = []
    c.state.scroller.value = {
      el: { nodeType: 1, getBoundingClientRect: () => ({ width: 900, height: 550 }) },
      visiblePool: [],
      updateVisibleItems: force => updates.push(force),
      scrollToItem: idx => scrolls.push(idx)
    }
    const images = Array.from({ length: 9 }, (_, i) => ({ fullpath: '/pics/' + i + '.jpg' }))
    c.state.sortedFiles.value = images
    c.state.currPage.value = { scrollIndex: 4 }
    for (const handler of c.callbacks.returnToIIB || []) handler()
    await vue.nextTick()
    assert.deepEqual(updates, [true, true])
    assert.deepEqual(scrolls, [4])
    assert.equal(c.state.sortedFiles.value.length, 9)
  } finally {
    c.scope.stop()
  }
})

test('returning with a healthy visible pool preserves the current scroll position', async () => {
  const c = setup('scanned-fixed')
  try {
    const updates = []
    const scrolls = []
    c.state.scroller.value = {
      el: { nodeType: 1, getBoundingClientRect: () => ({ width: 900, height: 550 }) },
      visiblePool: [{ nr: { index: 7 } }],
      updateVisibleItems: force => updates.push(force),
      scrollToItem: idx => scrolls.push(idx)
    }
    c.state.sortedFiles.value = [{ fullpath: '/pics/a.jxl' }]
    for (const handler of c.callbacks.returnToIIB || []) handler()
    await vue.nextTick()
    assert.deepEqual(updates, [true])
    assert.deepEqual(scrolls, [])
  } finally {
    c.scope.stop()
  }
})

test('host return does not update scrollers in inactive/hidden IIB panes', async () => {
  const c = setup('scanned')
  try {
    const updates = []
    c.state.scroller.value = {
      el: { nodeType: 1, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
      visiblePool: [],
      updateVisibleItems: force => updates.push(force),
      scrollToItem() {}
    }
    c.state.sortedFiles.value = [{ fullpath: '/pics/a.jxl' }]
    for (const handler of c.callbacks.returnToIIB || []) handler()
    await vue.nextTick()
    assert.deepEqual(updates, [])
  } finally {
    c.scope.stop()
  }
})
