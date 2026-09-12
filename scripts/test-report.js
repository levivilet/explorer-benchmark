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
  assert((await page.locator('tbody tr').count()) >= 5)
  for (const name of ['React Arborist', 'Headless Tree (DOM host)', 'jsTree']) assert(await page.getByRole('rowheader', { name, exact: true }).count() >= 1)
  for (const chart of await page.getByRole('img').all()) {
    assert(await chart.evaluate((svg) => [...svg.querySelectorAll('text')].every((text) => { const box = text.getBBox(); return box.y + box.height <= svg.viewBox.baseVal.height })))
  }
  assert((await page.getByRole('img').count()) >= 1)
  assert((await page.getByRole('link', { name: 'Download raw measurements (JSON)' }).count()) >= 1)
  assert(!await page.locator('body').innerText().then((text) => /NaN|undefined/.test(text)))
  await page.screenshot({ path: '.tmp/pages/report.png', fullPage: true })
  assert.deepEqual(errors, [])
} finally { await browser.close() }
