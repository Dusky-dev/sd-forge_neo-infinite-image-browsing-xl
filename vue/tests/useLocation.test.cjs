const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test, afterEach } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

// Exercise the real hook without mounting the file browser or calling its APIs.
// The hook source is transpiled to CJS and run inside a vm with the mocked module
// graph in setup(); if useLocation.ts gains/changes an import, the `modules` table
// below must be updated too (the require() assertion fails loudly otherwise).
const source = ts.transpileModule(
  readFileSync(join(__dirname, '../src/page/fileTransfer/hooks/useLocation.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const oldFiles = [{ fullpath: '/images/old.png', date: 'old' }]
const newFiles = [{ fullpath: '/images/new.png', date: 'new' }]
const cleanups = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
})

function setup({ mode = 'scanned', previewing = false, fetchFiles, walker } = {}) {
  const scrollPositions = []
  const gridUpdates = []
  const state = {
    scroller: vue.ref({
      scrollToItem: idx => scrollPositions.push(idx),
      scrollToPosition: idx => scrollPositions.push(idx),
      updateVisibleItems: changed => gridUpdates.push(changed)
    }),
    stackViewEl: vue.ref(),
    stack: vue.ref([{ curr: '/images', files: oldFiles }]),
    currLocation: vue.ref('/images'),
    props: vue.ref({ mode }),
    deletedFiles: vue.ref(new Set()),
    walker: vue.shallowRef(walker),
    previewing: vue.ref(previewing),
    previewIdx: vue.ref(-1),
    sortMethod: vue.ref('date-desc')
  }
  state.currPage = vue.computed(() => state.stack.value.at(-1))
  // 真实实现里 sortedFiles 由 currPage.files 派生，这里保持同样的派生关系
  state.sortedFiles = vue.computed(() => state.stack.value.at(-1)?.files ?? [])
  const listeners = new Map()
  const events = []
  const messages = []
  let fetchCount = 0
  let poll
  let confirm
  let loadingContent
  const unmountCallbacks = []
  state.useEventListen = vue.ref(() => {})
  state.eventEmitter = vue.ref({ emit: event => events.push(event) })
  const global = vue.reactive({
    autoRefreshNormalFixedMode: true,
    autoRefreshWalkMode: true,
    autoRefreshWalkModePosLimit: 100,
    quickMovePaths: []
  })
  const modules = {
    '@/api/files': { getTargetFolderFiles: async () => {
      fetchCount++
      return fetchFiles ? fetchFiles() : { files: newFiles }
    } },
    '@/components/functionalCallableComp': {},
    '../sortedFiles': { computeSortedFiles: files => files.slice() },
    '@/i18n': { t: key => key },
    '@/icon': {},
    '@/util': {
      makeAsyncFunctionSingle: fn => fn,
      useGlobalEventListen: (event, fn) => listeners.set(event, fn)
    },
    'ant-design-vue': {
      message: {
        success: text => messages.push(text),
        info: text => messages.push(String(text)),
        loading: content => { loadingContent = content; return () => {} }
      },
      Modal: { confirm: options => { confirm = options } }
    },
    vue: { ...vue, onMounted() {}, onUnmounted: fn => unmountCallbacks.push(fn) },
    'vue3-ts-util': {
      delay: async () => {},
      ok: (v, msg) => { if (!v) throw new Error(msg || 'missing value'); return v },
      useWatchDocument() {},
      Task: { run: ({ action }) => { poll = action; return { clearTask() {} } } }
    },
    '.': { useHookShareState: () => ({ toRefs: () => state }), stackCache: { get: () => undefined }, global },
    '@/components/numInput.vue': {},
    '@/util/path': {
      normalize: value => value,
      isAbsolute: path => path.startsWith('/'),
      splitPath: path => path.split('/').filter(Boolean),
      join: (...paths) => paths.filter(Boolean).join('/').replace(/\/+/g, '/')
    },
    '@/util/scroller': { getVisibleRange: () => ({ start: 0, end: 20 }) },
    'multi-nprogress': {},
    'lodash-es': { last: items => items.at(-1), debounce: () => () => {} },
    '@vueuse/core': { useLocalStorage: (_, initial) => vue.ref(initial) },
    '@/util/const': { prefix: 'test-' }
  }
  const exports = {}
  runInNewContext(source, {
    exports,
    require: name => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`)
      return modules[name]
    }
  })
  const scope = vue.effectScope()
  const location = scope.run(() => exports.useLocation())
  const unmount = () => {
    unmountCallbacks.splice(0).forEach(fn => fn())
    scope.stop()
  }
  cleanups.push(unmount)
  return {
    state, global, events, messages, location, unmount, scrollPositions, gridUpdates,
    fetchCount: () => fetchCount,
    disableWalkRefresh: () => loadingContent.children[1].props.onClick(),
    returnToIIB: () => listeners.get('returnToIIB')(),
    poll: () => {
      location.onPollRefreshClick()
      confirm.onOk()
      return poll()
    }
  }
}

for (const mode of ['scanned', 'scanned-fixed']) {
  test(`${mode}: automatic refresh applies immediately`, async () => {
    const c = setup({ mode })
    await c.returnToIIB()
    assert.equal(c.fetchCount(), 1)
    assert.deepEqual(c.state.currPage.value.files, newFiles)
    assert.deepEqual(c.messages, ['autoUpdate'])
  })
}

test('polling refresh applies immediately', async () => {
  const c = setup()
  await c.poll()
  assert.deepEqual(c.state.currPage.value.files, newFiles)
})

test('unchanged results neither replace the list nor show a message', async () => {
  const c = setup({ fetchFiles: async () => ({ files: oldFiles.slice() }) })
  const files = c.state.currPage.value.files
  await c.returnToIIB()
  assert.equal(c.state.currPage.value.files, files)
  assert.deepEqual(c.messages, [])
})

// ---- 全屏预览：列表立即更新，预览由应用级组件托管，不会因为列表更新被销毁 ----

test('previewing: applies immediately and keeps the preview on the same image', async () => {
  // 新图插到前面，预览的 old.png 从下标 0 挪到 1
  const next = [newFiles[0], oldFiles[0]]
  const c = setup({ previewing: true, fetchFiles: async () => ({ files: next }) })
  c.state.previewIdx.value = 0
  await c.returnToIIB()
  assert.deepEqual(c.state.currPage.value.files, next)
  assert.equal(c.state.previewIdx.value, 1) // 预览跟到同一张图的新位置
  assert.equal(c.state.previewing.value, true) // 预览保持打开
  assert.deepEqual(c.messages, ['autoUpdate'])
})

test('previewing: closes the preview when the viewed image disappears', async () => {
  const c = setup({ previewing: true })
  c.state.previewIdx.value = 0
  await c.returnToIIB()
  assert.deepEqual(c.state.currPage.value.files, newFiles)
  assert.equal(c.state.previewing.value, false)
  assert.deepEqual(c.messages, ['autoUpdate'])
})

test('previewing walk: applies immediately and keeps the preview on the same image', async () => {
  const replacement = { images: [newFiles[0], oldFiles[0]] }
  const walker = { isExpired: async () => true, seamlessRefresh: async () => replacement }
  const c = setup({ mode: 'walk', previewing: true, walker })
  c.state.previewIdx.value = 0
  await c.returnToIIB()
  assert.equal(c.state.walker.value, replacement)
  assert.equal(c.state.previewIdx.value, 1)
  assert.equal(c.state.previewing.value, true)
  assert.deepEqual(c.events, ['loadNextDir'])
})

test('previewing walk: closes the preview when the viewed image disappears', async () => {
  const replacement = { images: [newFiles[0]] }
  const walker = { isExpired: async () => true, seamlessRefresh: async () => replacement }
  const c = setup({ mode: 'walk', previewing: true, walker })
  c.state.previewIdx.value = 0
  await c.returnToIIB()
  assert.equal(c.state.walker.value, replacement)
  assert.equal(c.state.previewing.value, false)
})

test('walk refresh disabled does not touch the walker', async () => {
  const walker = { isExpired: async () => true, seamlessRefresh: async () => ({ images: newFiles }) }
  const c = setup({ mode: 'walk', walker })
  c.global.autoRefreshWalkMode = false
  await c.returnToIIB()
  assert.equal(c.state.walker.value, walker)
  assert.deepEqual(c.events, [])
})

// ---- 竞态保护 ----

test('only the newest request may apply, even when responses arrive out of order', async () => {
  const first = deferred()
  const second = deferred()
  let calls = 0
  const latestFiles = [{ fullpath: '/images/latest.png', date: 'latest' }]
  const c = setup({ fetchFiles: () => ++calls === 1 ? first.promise : second.promise })
  const oldRequest = c.returnToIIB()
  const newRequest = c.returnToIIB()
  second.resolve({ files: latestFiles })
  await newRequest
  first.resolve({ files: newFiles })
  await oldRequest
  assert.deepEqual(c.state.currPage.value.files, latestFiles)
})

test('navigation invalidates in-flight refreshes', async () => {
  const response = deferred()
  const c = setup({ fetchFiles: () => response.promise })
  const files = c.state.currPage.value.files
  const refresh = c.returnToIIB()
  c.state.currLocation.value = '/elsewhere'
  response.resolve({ files: newFiles })
  await refresh
  assert.equal(c.state.currPage.value.files, files)
  assert.deepEqual(c.messages, [])
})

test('unmount invalidates in-flight refreshes', async () => {
  const response = deferred()
  const c = setup({ fetchFiles: () => response.promise })
  const files = c.state.currPage.value.files
  const refresh = c.returnToIIB()
  c.unmount()
  response.resolve({ files: newFiles })
  await refresh
  assert.equal(c.state.currPage.value.files, files)
})

test('a failed refresh does not reject the caller', async () => {
  const c = setup({ fetchFiles: async () => { throw new Error('boom') } })
  const originalError = console.error
  console.error = () => {}
  try {
    await assert.doesNotReject(async () => { await c.returnToIIB() })
  } finally {
    console.error = originalError
  }
})

test('manual refresh still fetches and reports completion', async () => {
  const c = setup()
  await c.location.refresh()
  assert.equal(c.fetchCount(), 1)
  assert.deepEqual(c.state.currPage.value.files, newFiles)
  assert.deepEqual(c.messages, ['refreshCompleted'])
})


// ---- Folder browsing: navigation must refresh the virtual scroll window ----

// The folder-change watcher flushes after render and then awaits nextTick()
// before reaching the newly mounted RecycleScroller. Let those two phases run
// before checking the scroll-restoration side effects.
const settleFolderNavigation = async () => {
  await vue.nextTick()
  await new Promise(resolve => setImmediate(resolve))
}

test('scanned-fixed sibling navigation resets the scroller even with constant stack depth', async () => {
  const c = setup({ mode: 'scanned-fixed' })
  c.state.stack.value = [{ curr: '/images', files: oldFiles, scrollIndex: 42 }]
  c.state.currLocation.value = '/images/start'
  await settleFolderNavigation()
  c.scrollPositions.length = 0

  c.state.stack.value = [{ curr: '/images/next', files: newFiles }]
  c.state.currLocation.value = '/images/next'
  await settleFolderNavigation()

  assert.equal(c.state.stack.value.length, 1)
  assert.deepEqual(c.scrollPositions, [0])
})

test('breadcrumb navigation restores the saved scroll position in the parent directory', async () => {
  const c = setup({ mode: 'scanned' })
  c.state.stack.value = [
    { curr: '/', files: [], scrollIndex: 8 },
    { curr: 'images', files: oldFiles, scrollIndex: 74 }
  ]
  c.state.currLocation.value = '/images'
  await settleFolderNavigation()
  c.scrollPositions.length = 0

  c.state.stack.value.pop()
  c.state.currLocation.value = '/'
  await settleFolderNavigation()

  assert.deepEqual(c.scrollPositions, [8])
})

test('directory browser keys recycler by folder path', () => {
  const source = readFileSync(
    join(__dirname, '../src/page/fileTransfer/stackView.vue'), 'utf8'
  )
  assert.match(source, /<RecycleScroller\s+:key="currLocation"/)
})


// ---- Actual file click/async response path: one click must be sufficient ----

test('one folder click loads its files', async () => {
  const c = setup({ mode: 'scanned-fixed' })
  await c.location.openNext({
    type: 'dir', name: 'subfolder', fullpath: '/images/subfolder'
  })
  // In the actual browser currLocation is derived from stack, rather than the
  // independent ref in this isolated composable harness.
  c.state.currLocation.value = '/images/subfolder'
  await settleFolderNavigation()
  assert.equal(c.fetchCount(), 1)
  assert.equal(c.state.currPage.value.curr, '/images/subfolder')
  assert.deepEqual(c.state.currPage.value.files, newFiles)
  assert.deepEqual(c.scrollPositions.slice(-1), [0])
})

test('two fast clicks on a directory append it only once', async () => {
  const a = deferred()
  const b = deferred()
  const c = setup({
    fetchFiles: (() => {
      let calls = 0
      return () => ++calls === 1 ? a.promise : b.promise
    })()
  })
  const folder = { type: 'dir', fullpath: '/images/subfolder', name: 'subfolder' }
  const firstClick = c.location.openNext(folder)
  const secondClick = c.location.openNext(folder)
  b.resolve({ files: newFiles })
  await secondClick
  a.resolve({ files: oldFiles })
  await firstClick
  assert.equal(c.fetchCount(), 2)
  assert.equal(c.state.stack.value.length, 2)
  assert.deepEqual(c.state.currPage.value.files, newFiles)
})

test('stale manual refresh may not overwrite folder opened while request was in flight', async () => {
  const response = deferred()
  const c = setup({ fetchFiles: () => response.promise })
  const refreshPromise = c.location.refresh()
  const newPage = { curr: 'other', files: [{ fullpath: '/other/keep.png', name: 'keep.png' }] }
  c.state.stack.value.push(newPage)
  c.state.currLocation.value = '/images/other'
  response.resolve({ files: newFiles })
  await refreshPromise
  assert.equal(c.state.currPage.value.curr, 'other')
  assert.equal(c.state.currPage.value.files[0].name, 'keep.png')
})

test('leaving a folder invalidates its in-flight first click', async () => {
  const response = deferred()
  const c = setup({ fetchFiles: () => response.promise })
  const initial = c.state.stack.value.slice()
  const pending = c.location.openNext({
    type: 'dir', fullpath: '/images/subfolder', name: 'subfolder'
  })
  c.location.back(0)
  response.resolve({ files: newFiles })
  await pending
  assert.equal(c.state.stack.value.length, initial.length)
  assert.deepEqual(c.state.currPage.value.files, oldFiles)
})

test('breadcrumb back truncates folder stack atomically for synchronous observers', () => {
  const c = setup()
  c.state.stack.value = [
    { curr: '/', files: [] },
    { curr: 'pictures', files: [] },
    { curr: 'album', files: oldFiles }
  ]
  const path = vue.computed(() => c.state.stack.value.map(page => {
    if (!page) throw new Error('transient hole during Array.pop()')
    return page.curr
  }).join('/'))
  const stop = vue.watch(path, () => {}, { flush: 'sync' })
  try {
    assert.doesNotThrow(() => c.location.back(1))
    assert.deepEqual(c.state.stack.value.map(page => page.curr), ['/', 'pictures'])
  } finally {
    stop()
  }
})

test('address bar switches sibling folders in one atomic directory-stack update', async () => {
  const c = setup()
  c.global.conf = { is_win: false, sd_cwd: '/' }
  const root = { type: 'dir', fullpath: '/pictures', name: 'pictures' }
  const album = { type: 'dir', fullpath: '/pictures/album', name: 'album' }
  const sibling = { type: 'dir', fullpath: '/pictures/sibling', name: 'sibling' }
  c.state.stack.value = [
    { curr: '/', files: [root] },
    { curr: 'pictures', files: [album, sibling] },
    { curr: 'album', files: oldFiles }
  ]
  c.state.currLocation.value = '/pictures/album'

  const path = vue.computed(() => c.state.stack.value.map(page => {
    if (!page) throw new Error('transient hole in directory stack')
    return page.curr
  }).join('/'))
  const stop = vue.watch(path, () => {}, { flush: 'sync' })
  try {
    c.location.locInputValue.value = '/pictures/sibling'
    await assert.doesNotReject(async () => c.location.onLocEditEnter())
    assert.equal(c.fetchCount(), 1)
    assert.deepEqual(c.state.stack.value.map(page => page.curr), ['/', 'pictures', 'sibling'])
    assert.deepEqual(c.state.currPage.value.files, newFiles)
  } finally {
    stop()
  }
})
