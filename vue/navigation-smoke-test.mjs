// Temporary Chrome-level smoke test of the REAL directory browsing component.
import { chromium } from '/tmp/iib-smoke/node_modules/playwright-core/index.mjs'
import { existsSync } from 'node:fs'

const chrome = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].find(existsSync)
if (!chrome) throw new Error('No system Chrome/Chromium installed')
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const errors = []
const requests = []
const date = '2026-11-07 12:00:00'
const mk = (name, fullpath, type = 'file') => ({
  name, fullpath, type, date, created_time: date,
  size: type === 'dir' ? '-' : '3KB', bytes: 3000,
  is_under_scanned_path: false
})
const roots = [mk('pictures', '/pictures', 'dir'), mk('misc', '/misc', 'dir')]
const pictures = [
  mk('album', '/pictures/album', 'dir'),
  ...Array.from({ length: 60 }, (_, i) =>
    mk('image_' + String(i).padStart(3, '0') + '.jpg', '/pictures/image_' + String(i).padStart(3, '0') + '.jpg')
  )
]
const album = Array.from({ length: 20 }, (_, i) =>
  mk('album_' + String(i).padStart(3, '0') + '.jpg', '/pictures/album/album_' + String(i).padStart(3, '0') + '.jpg')
)
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('requestfailed', request => {
  if (!request.url().includes('/get_thumbnail')) errors.push('request failed ' + request.url())
})
await page.route('**/infinite_image_browsing/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname.endsWith('/files')) {
    const folder = url.searchParams.get('folder_path') || '/'
    requests.push(folder)
    const files = folder === '/' ? roots :
      folder === '/pictures' ? pictures :
      folder === '/pictures/album' ? album :
      folder === '/misc' ? [mk('other_file.jpg', '/misc/other_file.jpg')] : []
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({ files })
    })
    return
  }
  await route.fulfill({ contentType: 'application/json', status: 200, body: '{}' })
})
const log = (...xs) => console.log('SMOKE:', ...xs)
try {
  await page.goto('http://127.0.0.1:3002/navigation-smoke.html')
  await page.waitForFunction(() => window.__navigationAppReady === true)
  const root = page.locator('li.file-item-trigger').filter({ hasText: 'pictures' }).first()
  await root.waitFor({ state: 'visible', timeout: 12000 })
  log('root rendering:', await page.locator('li.file-item-trigger').count())
  await root.click()
  await page.waitForTimeout(150)
  log('after first click:', { requests, n: await page.locator('li.file-item-trigger').count(), text: (await page.locator('.vue-recycle-scroller').innerText()).slice(0,250) })
  const albumNode = page.locator('li.file-item-trigger').filter({ hasText: 'album' }).first()
  await albumNode.waitFor({ state: 'visible', timeout: 8000 })
  if (requests.filter(x => x === '/pictures').length !== 1) throw new Error('one click must issue exactly one /pictures request')
  await albumNode.click()
  const file = page.locator('li.file-item-trigger').filter({ hasText: 'album_000.jpg' }).first()
  await file.waitFor({ state: 'visible', timeout: 8000 })
  if (requests.filter(x => x === '/pictures/album').length !== 1) throw new Error('album navigation must issue exactly one API request')
  log('SUCCESS first click shows album contents', { cards: await page.locator('li.file-item-trigger').count(), requests })
  // Breadcrumb click back to pictures must render the folder contents again.
  const crumb = page.locator('.ant-breadcrumb').getByText('pictures').first()
  await crumb.click()
  await albumNode.waitFor({ state: 'visible', timeout: 8000 })
  log('SUCCESS breadcrumb back renders the previous folder in one click')
  if (errors.length) log('browser console warnings/errors:', errors.slice(0,12))
} catch (error) {
  log('FAIL', String(error), { requests, errors: errors.slice(0,20) })
  await page.screenshot({ path: '/tmp/iib-smoke-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
}
