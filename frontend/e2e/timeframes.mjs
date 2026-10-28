import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const email = `e2e-${Date.now()}@example.com`

// Register through the proxied API, then hand the session cookie to the browser
// context. The app is cookie-authenticated, so without this the page redirects
// to /login and there is no chart to inspect.
const res = await fetch(`${BASE}/api/v1/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'stockpulse', Origin: BASE },
  body: JSON.stringify({ email, password: 'TestPassw0rd123' }),
})
console.log('register:', res.status)
const rawCookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sp_session='))
if (!rawCookie) throw new Error('registration did not return a session cookie')
const cookieValue = rawCookie.split(';')[0].split('=').slice(1).join('=')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } })
await context.addCookies([{ name: 'sp_session', value: cookieValue, domain: 'localhost', path: '/' }])
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

const responses = []
page.on('response', async (r) => {
  if (!r.url().includes('/history?')) return
  const body = await r.json().catch(() => null)
  const bars = body?.bars ?? []
  const times = bars.map((b) => b.time)
  const gaps = {}
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1]
    gaps[gap] = (gaps[gap] ?? 0) + 1
  }
  const topGap = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0]
  responses.push({
    query: r.url().split('/history?')[1],
    status: r.status(),
    interval: body?.interval,
    bars: bars.length,
    uniqueTimes: new Set(times).size === times.length,
    ascending: times.every((t, i) => i === 0 || t > times[i - 1]),
    commonGapSeconds: topGap ? Number(topGap[0]) : null,
  })
})

await page.goto(`${BASE}/app/research/AAPL`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
console.log('url after load:', page.url())

for (const label of ['1m', '3m', '1D']) {
  const button = page.getByRole('button', { name: label, exact: true }).first()
  await button.click()
  await page.waitForTimeout(4500)
  const canvasBox = await page.locator('canvas').first().boundingBox().catch(() => null)
  console.log(`clicked ${label}: canvas=${canvasBox ? `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}` : 'none'}`)
}

console.log('history responses:')
for (const r of responses) console.log('  ', JSON.stringify(r))
console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none')
await browser.close()

const intervals = responses.map((r) => r.interval)
const ok =
  intervals.includes('1m') &&
  intervals.includes('3m') &&
  intervals.includes('1d') &&
  responses.every((r) => r.status === 200 && r.bars > 0 && r.uniqueTimes && r.ascending)
console.log(ok ? 'RESULT: all three timeframes loaded genuine data' : 'RESULT: FAILED')
process.exit(ok ? 0 : 1)

