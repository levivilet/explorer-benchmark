import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { measureHeaps } from './cdp.js'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  const baseline = await measureHeaps(browser, true)
  await page.evaluate(async () => {
    const blob = new Blob(['self.values = new Array(1000000).fill(123.5); self.postMessage("ready")'], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    window.worker = new Worker(url)
    await new Promise((resolve, reject) => { window.worker.onmessage = resolve; window.worker.onerror = reject })
    URL.revokeObjectURL(url)
  })
  const loaded = await measureHeaps(browser, true)
  assert(loaded.isolates.some((isolate) => isolate.targets.some(({ type }) => type === 'worker')), 'Worker missing')
  assert(loaded.usedSize - baseline.usedSize > 7000000, 'Worker allocation missing from total')
  assert.equal(new Set(loaded.isolates.map(({ id }) => id)).size, loaded.isolates.length)
  console.log('CDP worker allocation and isolate accounting passed')
} finally { await browser.close() }
