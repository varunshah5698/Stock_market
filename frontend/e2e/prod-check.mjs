/**
 * Production browser diagnostic: loads each page with a real session and reports
 * console errors, failed requests and whether anything actually rendered.
 *
 *   BASE=https://<deployment> node e2e/prod-check.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'https://stockpulse-sigma-kohl.vercel.app'
const PAGES = ['/', '/login', '/app/overview', '/app/screener', '/app/research/AAPL', '/app/prediction', '/app/settings']

const email = `prodcheck-${Date.now()}@example.com`
let cookieValue = null
try {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'stockpulse', Origin: BASE },
    body: JSON.stringify({ email, password: 'TestPassw0rd123' }),
  })
  console.log('register:', res.status)
  const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sp_session='))
  if (raw) cookieValue = raw.split(';')[0].split('=').slice(1).join('=')
} catch (error) {
  console.log('register failed:', String(error))
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
if (cookieValue) {
  await context.addCookies([
    { name: 'sp_session', value: cookieValue, domain: new URL(BASE).hostname, path: '/', secure: true, sameSite: 'Lax' },
  ])
}
const page = await context.newPage()

const consoleErrors = []
const pageErrors = []
const badResponses = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
})
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`)
})

for (const path of PAGES) {
  consoleErrors.length = 0
  pageErrors.length = 0
  badResponses.length = 0
  let navError = null
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => {
    navError = String(e).slice(0, 160)
  })
  await page.waitForTimeout(3000)
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const rootHtml = await page.locator('#root').innerHTML().catch(() => '')
  console.log(`\n=== ${path} ===`)
  console.log('  final url :', page.url())
  console.log('  nav error :', navError ?? 'none')
  console.log('  #root size:', rootHtml.length)
  console.log('  text      :', JSON.stringify(bodyText.replace(/\s+/g, ' ').slice(0, 160)))
  console.log('  canvases  :', await page.locator('canvas').count())
  console.log('  pageErrors:', pageErrors.length ? pageErrors : 'none')
  console.log('  consoleErr:', consoleErrors.length ? consoleErrors.slice(0, 3) : 'none')
  console.log('  http>=400 :', badResponses.length ? [...new Set(badResponses)].slice(0, 6) : 'none')
}

await browser.close()
