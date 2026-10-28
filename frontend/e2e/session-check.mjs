import { chromium } from 'playwright'
const BASE = process.env.BASE || 'https://stockpulse-sigma-kohl.vercel.app'
const browser = await chromium.launch()

async function probe(label, cookie) {
  const ctx = await browser.newContext()
  if (cookie) await ctx.addCookies([{ name: 'sp_session', value: cookie, domain: new URL(BASE).hostname, path: '/', secure: true, sameSite: 'Lax' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url().replace(BASE, '')}`) })
  await page.goto(`${BASE}/app/overview`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => errs.push('NAV ' + String(e).slice(0, 80)))
  await page.waitForTimeout(3500)
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 150)
  console.log(`${label}: url=${page.url().replace(BASE, '')}`)
  console.log(`   text=${JSON.stringify(text)}`)
  console.log(`   problems=${errs.length ? [...new Set(errs)].slice(0, 5) : 'none'}`)
  await ctx.close()
}

await probe('anonymous  ', null)
await probe('bad cookie ', 'totally-invalid-session-token')
await browser.close()
