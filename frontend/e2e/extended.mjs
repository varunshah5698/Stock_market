import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? '/tmp'
const SAMPLE = fileURLToPath(new URL('../../samples/synthetic-ohlcv-sample.csv', import.meta.url))
const email = `e2e2_${Date.now()}@example.com`
const password = 'TestPassword123'
const errors = []

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await context.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('response', (res) => { if (res.status() >= 500) errors.push(`http ${res.status()} ${res.url()}`) })

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })

try {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot('sp-login2')

  await page.goto(BASE + '/register', { waitUntil: 'networkidle' })
  await page.getByLabel('Display name').fill('Second Researcher')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: /Create account/i }).click()
  await page.waitForURL('**/app/overview', { timeout: 60000 })
  await page.getByText('Market command center').waitFor()
  await page.waitForTimeout(3000)

  // Command palette
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Search symbols, pages and actions/i).waitFor()
  await page.getByPlaceholder(/Search symbols, pages and actions/i).fill('MSFT')
  await page.waitForTimeout(900)
  await shot('sp-command')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/app/research/MSFT', { timeout: 20000 })
  await page.getByText('Adjusted OHLC').first().waitFor({ timeout: 60000 })
  await page.waitForTimeout(2500)
  await shot('sp-research2')

  await page.goto(BASE + '/app/compare?symbols=AAPL,MSFT,NVDA&period=1y', { waitUntil: 'domcontentloaded' })
  await page.getByText('Growth of 100').waitFor({ timeout: 90000 })
  await page.waitForTimeout(2500)
  await shot('sp-compare')

  await page.goto(BASE + '/app/watchlists', { waitUntil: 'domcontentloaded' })
  await page.getByText('Starter watchlist').first().waitFor({ timeout: 60000 })
  await page.locator('input[placeholder="AAPL"]').fill('TSLA')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText('TSLA').first().waitFor({ timeout: 30000 })
  await page.getByPlaceholder('Symbol (e.g. AAPL)').fill('AAPL')
  await page.getByPlaceholder('Threshold').fill('1')
  await page.getByRole('button', { name: /Create alert/i }).first().click()
  await page.getByText('Alerts & notifications').click()
  await page.getByRole('button', { name: /Check now/i }).click()
  await page.waitForTimeout(3000)
  console.log('ALERT_TIME_TEXT:', await page.locator('table tbody tr').first().innerText())
  await shot('sp-alerts')

  await page.goto(BASE + '/app/data', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Import CSV/i }).first().click()
  await page.locator('input[type="file"]').setInputFiles(SAMPLE)
  await page.getByRole('button', { name: /Validate file/i }).click()
  await page.getByText('Dataset name').waitFor({ timeout: 60000 })
  await shot('sp-data-map')
  await page.getByRole('button', { name: /Confirm import/i }).click()
  await page.getByText('Quality').first().waitFor({ timeout: 60000 })
  await page.waitForTimeout(1500)
  console.log('DATA_OVERFLOW_PX:', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
  await shot('sp-data-stats')

  await page.goto(BASE + '/app/news', { waitUntil: 'domcontentloaded' })
  await page.getByText('No news adapter is active').waitFor()
  await shot('sp-news')

  await page.goto(BASE + '/app/settings', { waitUntil: 'domcontentloaded' })
  await page.getByText('Integrations & trading').click()
  await page.getByText('Live connection state').waitFor()
  await page.waitForTimeout(1000)
  await shot('sp-integrations')

  await page.goto(BASE + '/legal/privacy', { waitUntil: 'networkidle' })
  await page.getByText('Privacy notice').first().waitFor()
  await shot('sp-privacy')

  console.log('DESKTOP_OK')
} catch (error) {
  console.log('DESKTOP_FAILED:', error.message)
  await shot('sp-failure2')
} finally {
  const mobile = await context.newPage()
  await mobile.setViewportSize({ width: 390, height: 844 })
  try {
    await mobile.goto(BASE + '/', { waitUntil: 'networkidle' })
    await mobile.waitForTimeout(1800)
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log('MOBILE_OVERFLOW_PX:', overflow)
    await mobile.screenshot({ path: '/tmp/sp-mobile.png' })
  } catch (error) {
    console.log('MOBILE_FAILED:', error.message)
  }
  console.log('ERRORS:', JSON.stringify([...new Set(errors)], null, 2))
  await browser.close()
}
