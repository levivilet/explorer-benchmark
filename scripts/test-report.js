import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(resolve('.tmp/pages/index.html')).href)
  assert.equal(await page.getByRole('heading', { name: 'Explorer memory benchmark', exact: true }).count(), 1)
  assert.equal(await page.locator('tbody tr').count(), 2)
  assert.equal(await page.getByRole('img').count(), 1)
  assert.equal(await page.getByRole('link', { name: 'Download raw measurements (JSON)' }).count(), 1)
  assert(!await page.locator('body').innerText().then((text) => /NaN|undefined/.test(text)))
  await page.screenshot({ path: '.tmp/pages/report.png', fullPage: true })
  assert.deepEqual(errors, [])
} finally { await browser.close() }
