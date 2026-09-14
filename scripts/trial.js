import { chromium } from 'playwright'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { fileName } from './fixture.js'
import { measureHeaps } from './cdp.js'
import { summary } from './statistics.js'

export async function runTrial(trialInfo, { report, manifest, server, output, launchBrowser = () => chromium.launch({ headless: true }) }) {
  const files = manifest.count
  const samples = report.protocol.samples
  const trial = { ...trialInfo, status: 'failed', phases: {} }
  let browser
  let page
  let phase
  let targetFailure
  const errors = []
  let rejectTarget
  const targetGone = new Promise((_, reject) => { rejectTarget = reject })
  // A crash can arrive while a CDP sample, scroll, or load is pending.
  targetGone.catch(() => {})
  const onTargetFailure = (type, message) => {
    targetFailure ??= { type, message }
    rejectTarget(new Error(message))
  }
  const screenshot = async (suffix) => {
    if (!page || targetFailure) return
    const name = `${trial.implementation}-${trial.repeat}-${suffix}.png`
    try {
      await page.screenshot({ path: `${output}/${name}`, timeout: 5000 })
      trial.screenshots ??= {}
      trial.screenshots[suffix] = name
    } catch (error) {
      trial.screenshotErrors ??= []
      trial.screenshotErrors.push(error.message)
    }
  }
  try {
    browser = await launchBrowser()
    trial.chromium = browser.version()
    browser.on('disconnected', () => onTargetFailure('browser-disconnected', 'Chromium disconnected during the workload'))
    page = await browser.newPage({ viewport: report.protocol.viewport, deviceScaleFactor: 1 })
    page.on('crash', () => onTargetFailure('target-crash', 'Chromium target crashed during the workload'))
    page.on('close', () => onTargetFailure('target-closed', 'Chromium target closed during the workload'))
    const rootSession = await browser.newBrowserCDPSession()
    rootSession.on('Target.targetCrashed', ({ status, errorCode }) => onTargetFailure('target-crash', `Chromium target crashed (${status}, code ${errorCode})`))
    await rootSession.send('Target.setDiscoverTargets', { discover: true })
    page.setDefaultTimeout(90000)
    const evaluate = async (fn, argument, timeoutMs = 90000) => {
      let timer
      try {
        return await Promise.race([page.evaluate(fn, argument), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Component action timed out after ${timeoutMs / 1000} seconds`)), timeoutMs) })])
      } finally { clearTimeout(timer) }
    }
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const execute = async () => {
      await page.goto(`${server.url}/?implementation=${trial.implementation}`)
      await page.waitForFunction(() => Boolean(window.benchmark))
      for (phase of ['empty', 'loaded']) {
        const start = performance.now()
        let state
        try {
          state = await evaluate((phase) => window.benchmark.load(phase), phase, report.protocol.loadTimeoutMs)
        } catch (error) {
          if (phase !== 'loaded' || !error.message.startsWith('Component action timed out')) throw error
          trial.status = 'unsupported'
          trial.componentFailure = { message: error.message, type: 'load-timeout' }
          return
        }
        if (state.componentFailure) {
          assert.equal(phase, 'loaded', 'Empty component must initialize successfully')
          trial.status = 'unsupported'
          trial.componentFailure = state.componentFailure
          return
        }
        assert.equal(state.count, phase === 'empty' ? 0 : files)
        if (phase === 'loaded') {
          assert.equal(state.first, manifest.first)
          assert.equal(state.last, manifest.last)
          for (const index of [...new Set([0, Math.floor(files / 2), files - 1, 0])]) {
            await evaluate((index) => window.benchmark.scroll(index), index)
            const row = page.getByRole('treeitem', { name: fileName(index, manifest.nameWidth), exact: true })
            await row.waitFor({ state: 'visible' })
            const box = await row.boundingBox()
            assert(box && box.y < 600 && box.y + box.height > 0 && box.x < 480, 'Row is outside tree viewport')
          }
          await evaluate(() => window.benchmark.scroll(0))
          await page.getByRole('treeitem', { name: fileName(0, manifest.nameWidth), exact: true }).waitFor({ state: 'visible' })
        } else assert.equal(await page.getByRole('treeitem').count(), 0)
        const readinessMs = performance.now() - start
        await delay(report.protocol.settleMs)
        const natural = await measureHeaps(browser, false)
        const retained = []
        for (let sample = 0; sample < samples; sample++) {
          retained.push(await measureHeaps(browser, true))
          await delay(report.protocol.sampleIntervalMs)
        }
        if (trial.implementation === 'lvce') assert(retained.every((sample) => sample.isolates.some((isolate) => isolate.targets.some((target) => target.type === 'worker'))), 'Missing LVCE worker heap')
        const pageSession = await page.context().newCDPSession(page)
        const dom = await pageSession.send('Memory.getDOMCounters')
        await pageSession.detach()
        trial.phases[phase] = { readinessMs, natural, retained, usedSize: summary(retained.map((sample) => sample.usedSize)), dom, renderedRows: await page.getByRole('treeitem').count() }
        if (errors.length) throw new Error(errors.join('\n'))
        await screenshot(phase)
      }
      trial.deltaUsedSize = trial.phases.loaded.usedSize.median - trial.phases.empty.usedSize.median
      trial.status = 'passed'
    }
    await Promise.race([execute(), targetGone])
  } catch (error) {
    // A working empty baseline distinguishes a capacity outcome from startup failure.
    const message = error.message || String(error)
    const failure = targetFailure ?? (/Target crashed/i.test(message) ? { type: 'target-crash', message }
      : /Target page, context or browser has been closed/i.test(message) ? { type: 'target-closed', message } : undefined)
    if (phase === 'loaded' && trial.phases.empty && failure) {
      trial.status = 'unsupported'
      trial.componentFailure = failure
      delete trial.deltaUsedSize
    } else {
      trial.status = 'failed'
      trial.error = error.stack || String(error)
      console.error(trial.error)
    }
  } finally {
    trial.consoleErrors = errors
    if (trial.status !== 'passed') await screenshot('failed')
    // Closing our browser disposes its sessions. Detach can hang during disconnection.
    await browser?.close().catch((error) => { trial.cleanupError = error.message })
  }
  if (trial.status === 'unsupported') console.log(`${trial.implementation} #${trial.repeat + 1}: UNSUPPORTED: ${trial.componentFailure.message}`)
  if (trial.status === 'passed') console.log(`${trial.implementation} #${trial.repeat + 1}: ${(trial.phases.loaded.usedSize.median / 1048576).toFixed(2)} MiB retained; delta ${(trial.deltaUsedSize / 1048576).toFixed(2)} MiB`)
  return trial
}
