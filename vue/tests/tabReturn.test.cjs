const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')

test('Gradio tab return resizes the same IIB iframe after the tab becomes visible', async () => {
  const source = readFileSync(join(__dirname, '../index.tpl.js'), 'utf8')
    .replace('__built_html__', '<html><body>IIB</body></html>')
  let activeId = 'tab_txt2img'
  const callbacks = []
  const frames = []
  const resized = []
  const iframe = {
    style: '',
    srcdoc: '',
    contentWindow: { dispatchEvent: event => resized.push(event.type) }
  }
  const wrap = {
    style: '',
    childNodes: [],
    appendChild(el) { this.childNodes.push(el) },
    removeChild(el) { this.childNodes.splice(this.childNodes.indexOf(el), 1) }
  }
  const gradioApp = () => ({
    querySelector(selector) {
      if (selector === '#infinite_image_browsing_container_wrapper') return wrap
      if (selector === '#iib_top') return { getBoundingClientRect: () => ({ top: 145 }) }
      return null
    }
  })
  runInNewContext(source, {
    console,
    setTimeout,
    Math,
    Date,
    Promise,
    gradioApp,
    localStorage: { getItem: () => null },
    window: { location: { pathname: '/' } },
    document: { createElement: tag => {
      assert.equal(tag, 'iframe')
      return iframe
    } },
    get_uiCurrentTabContent: () => ({ id: activeId }),
    onUiTabChange: callback => callbacks.push(callback),
    requestAnimationFrame: callback => frames.push(callback),
    Event: class { constructor(type) { this.type = type } },
    BroadcastChannel: class { addEventListener() {} }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(callbacks.length, 1)
  assert.equal(wrap.childNodes[0], iframe)
  const initialSrc = iframe.srcdoc

  // Returning from txt2img must not attempt to resize during Gradio's
  // synchronous tab-change callback, before the tab DOM is visible.
  activeId = 'tab_infinite-image-browsing'
  callbacks[0]()
  assert.deepEqual(resized, [])
  const flushFrame = () => frames.splice(0).forEach(fn => fn())
  flushFrame()
  assert.deepEqual(resized, [])
  flushFrame()
  assert.deepEqual(resized, ['resize'])
  assert.match(wrap.style, /position: fixed/)
  assert.equal(iframe.style, 'width: 100%;height:100%')

  activeId = 'tab_txt2img'
  callbacks[0]()
  assert.equal(frames.length, 0)
  activeId = 'tab_infinite-image-browsing'
  callbacks[0]()
  flushFrame()
  flushFrame()
  assert.deepEqual(resized, ['resize', 'resize'])
  assert.equal(iframe.srcdoc, initialSrc, 'tab switch must preserve iframe state')
  assert.deepEqual(wrap.childNodes, [iframe], 'tab return must not remount iframe')
})

test('rapid tab exit cancels queued IIB layout restoration', async () => {
  const source = readFileSync(join(__dirname, '../index.tpl.js'), 'utf8')
    .replace('__built_html__', '<html></html>')
  let activeId = 'tab_txt2img'
  const callbacks = []
  const frames = []
  const resized = []
  const wrap = { childNodes: [], style: '', appendChild(el) { this.childNodes.push(el) } }
  runInNewContext(source, {
    console, setTimeout, Math, Date, Promise,
    gradioApp: () => ({ querySelector: key =>
      key === '#infinite_image_browsing_container_wrapper' ? wrap : null }),
    localStorage: { getItem: () => null },
    window: { location: { pathname: '/' } },
    document: { createElement: () => ({
      style: '',
      contentWindow: { dispatchEvent: event => resized.push(event.type) }
    }) },
    get_uiCurrentTabContent: () => ({ id: activeId }),
    onUiTabChange: cb => callbacks.push(cb),
    requestAnimationFrame: cb => frames.push(cb),
    Event: class { constructor(type) { this.type = type } },
    BroadcastChannel: class { addEventListener() {} }
  })
  await new Promise(resolve => setImmediate(resolve))
  activeId = 'tab_infinite-image-browsing'
  callbacks[0]()
  activeId = 'tab_txt2img'
  const first = frames.splice(0)
  first.forEach(fn => fn())
  frames.splice(0).forEach(fn => fn())
  assert.deepEqual(resized, [])
})
