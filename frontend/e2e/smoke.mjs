import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8010'
const SHOTS = process.env.SHOTS ?? '/tmp'
const email = `e2e_${Date.now()}@example.com`
const password = 'TestPassword123'
const logs = []
const errors = []

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await context.newPage()
page.on('console', (msg) => {
  logs.push(`${msg.type()}: ${msg.text()}`)
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('response', (res) => { if (res.status() >= 400) console.log('HTTP', res.status(), res.url()) })

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 })
  await page.getByText('Understand the market.').first().waitFor()
  await shot('sp-landing')

  await page.getByRole('link', { name: /Open terminal/i }).first().click()
  await page.waitForURL('**/login')
  await page.getByRole('heading', { name: /Sign in to the terminal/i }).waitFor()
  await page.waitForTimeout(900)
  await shot('sp-login')

  await page.getByRole('link', { name: /Create a research account/i }).click()
  await page.waitForURL('**/register')
  await page.getByLabel('Display name').fill('E2E Researcher')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  await page.locator('input[type="checkbox"]').check()
  await shot('sp-register')
  await page.getByRole('button', { name: /Create account/i }).click()
  await page.waitForURL('**/app/overview', { timeout: 60000 })
  await page.getByText('Market command center').waitFor()
  await page.getByText('Market trend').waitFor({ timeout: 60000 })
  await page.waitForTimeout(3000)
  await shot('sp-overview')

  await page.goto(BASE + '/app/screener', { waitUntil: 'domcontentloaded' })
  await page.locator('table tbody tr').first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(1500)
  await shot('sp-screener')

  await page.goto(BASE + '/app/research/AAPL', { waitUntil: 'domcontentloaded' })
  await page.getByText('Adjusted OHLC').first().waitFor({ timeout: 60000 })
  await page.locator('canvas').first().waitFor({ timeout: 60000 })
  await page.waitForTimeout(3000)
  await shot('sp-research')

  await page.goto(BASE + '/app/prediction', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Launch experiment/i }).waitFor()
  await page.getByRole('button', { name: /Launch experiment/i }).click()
  await page.waitForURL('**/app/experiments/**', { timeout: 30000 })
  await page.getByRole('button', { name: /Generate forecast/i }).first().waitFor({ timeout: 120000 })
  await page.waitForTimeout(1200)
  await shot('sp-experiment')
  await page.getByRole('button', { name: /Generate forecast/i }).first().click()
  await page.getByText('Price scenario', { exact: true }).waitFor({ timeout: 60000 })
  await shot('sp-forecast')

  await page.goto(BASE + '/app/strategies', { waitUntil: 'domcontentloaded' })
  await page.getByText('Strategy lab').first().waitFor()
  await page.waitForTimeout(1200)
  await shot('sp-strategies')

  await page.goto(BASE + '/app/portfolios', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /New portfolio/i }).click()
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('button', { name: /Add position/i }).first().waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /Add position/i }).first().click()
  await page.getByRole('button', { name: /Save position/i }).click()
  await page.getByText('Positions & manual cost basis').waitFor({ timeout: 30000 })
  await page.waitForTimeout(3500)
  await shot('sp-portfolio')

  await page.goto(BASE + '/app/paper', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /New paper account/i }).click()
  await page.getByRole('button', { name: /Create account/i }).click()
  await page.getByRole('button', { name: /Review buy order/i }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /Review buy order/i }).click()
  await page.getByRole('button', { name: /Submit paper buy/i }).click()
  await page.getByText('Simulated fills').waitFor({ timeout: 30000 })
  await page.waitForTimeout(3500)
  await shot('sp-paper')

  await page.goto(BASE + '/app/settings', { waitUntil: 'domcontentloaded' })
  await page.getByText('Research preferences').waitFor()
  await shot('sp-settings')

  await page.goto(BASE + '/app/reliability', { waitUntil: 'domcontentloaded' })
  await page.getByText('Model reliability').first().waitFor()
  await page.waitForTimeout(1200)
  await shot('sp-reliability')

  console.log('E2E_OK')
} catch (error) {
  console.log('E2E_FAILED:', error.message)
  await shot('sp-failure')
} finally {
  console.log('ERRORS:', JSON.stringify([...new Set(errors)], null, 2))
  await browser.close()
}
