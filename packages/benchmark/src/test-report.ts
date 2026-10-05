import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(resolve('.tmp/pages/index.html')).href)
  assert.equal(await page.getByRole('heading', { name: 'Explorer memory benchmark', exact: true }).count(), 1)
  assert((await page.locator('tbody tr').count()) >= 5)
  for (const name of ['React Arborist', 'Headless Tree (DOM host)', 'jsTree']) assert(await page.getByRole('rowheader', { name, exact: true }).count() >= 1)
  for (const chart of await page.getByRole('img').all()) {
    assert(await chart.evaluate((svg) => {
      const viewBox = (svg as SVGSVGElement).viewBox.baseVal
      const texts = [...svg.querySelectorAll('text')]
      const contained = texts.every((text) => {
        const box = text.getBBox()
        return box.x >= viewBox.x && box.y >= viewBox.y && box.x + box.width <= viewBox.x + viewBox.width && box.y + box.height <= viewBox.y + viewBox.height
      })
      const aligned = [...svg.querySelectorAll('rect')].every((bar) => {
        const value = bar.nextElementSibling?.nextElementSibling
        if (!(value instanceof SVGTextElement)) return false
        const barBox = bar.getBBox()
        const valueBox = value.getBBox()
        return Math.abs((barBox.y + barBox.height / 2) - (valueBox.y + valueBox.height / 2)) <= 1
      })
      return contained && aligned
    }))
  }
  assert((await page.getByRole('img').count()) >= 1)
  assert((await page.getByRole('link', { name: 'Download raw measurements (JSON)' }).count()) >= 1)
  assert.equal(await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(244, 247, 250)')
  const chartContainer = page.locator('.chart-scroll').first()
  assert.equal(await chartContainer.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)')
  assert.equal(await page.locator('svg path').first().evaluate((element) => getComputedStyle(element).stroke), 'rgb(71, 128, 173)')
  const failureStyle = await page.evaluate(() => {
    const element = document.createElement('div')
    element.className = 'failure'
    document.body.append(element)
    const { color, backgroundColor } = getComputedStyle(element)
    element.remove()
    return { color, backgroundColor }
  })
  assert.deepEqual(failureStyle, { color: 'rgb(143, 61, 0)', backgroundColor: 'rgb(255, 244, 229)' })
  assert(!await page.locator('body').innerText().then((text) => /NaN|undefined/.test(text)))
  await page.screenshot({ path: '.tmp/pages/report.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
  assert(await chartContainer.evaluate((element) => element.scrollWidth > element.clientWidth))
  assert.deepEqual(errors, [])
} finally { await browser.close() }
