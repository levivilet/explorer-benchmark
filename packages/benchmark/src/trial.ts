import { chromium } from 'playwright'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { fileName } from './fixture.ts'
import { measureHeaps } from './cdp.ts'
import { summary } from './statistics.ts'
import type { Browser, Page } from 'playwright'
import type { BenchmarkReport, ComponentFailure, HeapMeasurement, Implementation, Trial, TrialDependencies } from './types.ts'

export async function runTrial(trialInfo: { implementation: Implementation; repeat: number }, { report, manifest, server, output, launchBrowser = () => chromium.launch({ headless: true }) }: TrialDependencies): Promise<Trial> {
  const files = manifest.count
  const samples = report.protocol.samples
  const trial: Trial = { ...trialInfo, status: 'failed', phases: {} }
  let browser: Browser | undefined
  let page: Page | undefined
  let phase: 'empty' | 'loaded' | undefined
  let targetFailure: ComponentFailure | undefined
  const errors: string[] = []
  let rejectTarget: (reason?: unknown) => void = () => {}
  const targetGone: Promise<never> = new Promise((_, reject) => { rejectTarget = reject })
  // A crash can arrive while a CDP sample, scroll, or load is pending.
  targetGone.catch(() => {})
  const onTargetFailure = (type: string, message: string): void => {
    targetFailure ??= { type, message }
    rejectTarget(new Error(message))
  }
  const screenshot = async (suffix: string): Promise<void> => {
    if (!page || targetFailure) return
    const name = `${trial.implementation}-${trial.repeat}-${suffix}.png`
    try {
      await page.screenshot({ path: `${output}/${name}`, timeout: 5000 })
      trial.screenshots ??= {}
      trial.screenshots[suffix] = name
    } catch (error) {
      trial.screenshotErrors ??= []
      trial.screenshotErrors.push(error instanceof Error ? error.message : String(error))
    }
  }
  try {
    const currentBrowser = await launchBrowser()
    browser = currentBrowser
    trial.chromium = currentBrowser.version()
    currentBrowser.on('disconnected', () => onTargetFailure('browser-disconnected', 'Chromium disconnected during the workload'))
    const currentPage = await currentBrowser.newPage({ viewport: report.protocol.viewport, deviceScaleFactor: 1 })
    page = currentPage
    currentPage.on('crash', () => onTargetFailure('target-crash', 'Chromium target crashed during the workload'))
    currentPage.on('close', () => onTargetFailure('target-closed', 'Chromium target closed during the workload'))
    const rootSession = await currentBrowser.newBrowserCDPSession()
    rootSession.on('Target.targetCrashed', ({ status, errorCode }) => onTargetFailure('target-crash', `Chromium target crashed (${status}, code ${errorCode})`))
    await rootSession.send('Target.setDiscoverTargets', { discover: true })
    currentPage.setDefaultTimeout(90000)
    const evaluate = async (fn: (...args: any[]) => unknown, argument?: unknown, timeoutMs = 90000): Promise<any> => {
      let timer
      try {
        return await Promise.race([currentPage.evaluate(fn as any, argument as any), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Component action timed out after ${timeoutMs / 1000} seconds`)), timeoutMs) })])
      } finally { clearTimeout(timer) }
    }
    currentPage.on('pageerror', (error) => errors.push(String(error)))
    currentPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    const execute = async () => {
      await currentPage.goto(`${server.url}/?implementation=${trial.implementation}`)
      await currentPage.waitForFunction(() => Boolean(window.benchmark))
      for (const currentPhase of ['empty', 'loaded'] as const) {
        phase = currentPhase
        if (server.progress) server.progress.stage = 'idle'
        const start = performance.now()
        let state
        try {
          state = await evaluate((phase) => window.benchmark.load(phase), currentPhase, report.protocol.loadTimeoutMs)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (currentPhase !== 'loaded' || (!message.startsWith('Component action timed out') && !message.includes('INPUT_CAPACITY:'))) throw error
          trial.status = 'unsupported'
          trial.componentFailure = { message, type: message.includes('INPUT_CAPACITY:') ? 'input-capacity' : 'load-timeout' }
          return
        }
        if (state.componentFailure) {
          assert.equal(currentPhase, 'loaded', 'Empty component must initialize successfully')
          trial.status = 'unsupported'
          trial.componentFailure = state.componentFailure
          return
        }
        assert.equal(state.count, currentPhase === 'empty' ? 0 : files)
        if (currentPhase === 'loaded') {
          assert.equal(state.first, manifest.first)
          assert.equal(state.last, manifest.last)
          for (const index of [...new Set([0, Math.floor(files / 2), files - 1, 0])]) {
            await evaluate((index) => window.benchmark.scroll(index), index)
            const row = currentPage.getByRole('treeitem', { name: fileName(index, manifest.nameWidth), exact: true })
            await row.waitFor({ state: 'visible' })
            const box = await row.boundingBox()
            assert(box && box.y < 600 && box.y + box.height > 0 && box.x < 480, 'Row is outside tree viewport')
          }
          await evaluate(() => window.benchmark.scroll(0))
          await currentPage.getByRole('treeitem', { name: fileName(0, manifest.nameWidth), exact: true }).waitFor({ state: 'visible' })
        } else assert.equal(await currentPage.getByRole('treeitem').count(), 0)
        const readinessMs = performance.now() - start
        await delay(report.protocol.settleMs)
        const natural = await measureHeaps(currentBrowser, false)
        const retained: HeapMeasurement[] = []
        for (let sample = 0; sample < samples; sample++) {
          retained.push(await measureHeaps(currentBrowser, true))
          await delay(report.protocol.sampleIntervalMs)
        }
        if (trial.implementation === 'lvce') assert(retained.every((sample) => sample.isolates.some((isolate) => isolate.targets.some((target) => target.type === 'worker'))), 'Missing LVCE worker heap')
        const pageSession = await currentPage.context().newCDPSession(currentPage)
        const dom = await pageSession.send('Memory.getDOMCounters')
        await pageSession.detach()
        trial.phases[currentPhase] = { readinessMs, natural, retained, usedSize: summary(retained.map((sample) => sample.usedSize)), dom, renderedRows: await currentPage.getByRole('treeitem').count() }
        if (errors.length) throw new Error(errors.join('\n'))
        await screenshot(currentPhase)
      }
      trial.deltaUsedSize = trial.phases.loaded!.usedSize.median - trial.phases.empty!.usedSize.median
      trial.status = 'passed'
    }
    await Promise.race([execute(), targetGone])
  } catch (error) {
    // A working empty baseline distinguishes a capacity outcome from startup failure.
    const message = error instanceof Error ? error.message : String(error)
    const failure = targetFailure ?? (/Target crashed/i.test(message) ? { type: 'target-crash', message }
      : /Target page, context or browser has been closed/i.test(message) ? { type: 'target-closed', message } : undefined)
    if (phase === 'loaded' && trial.phases.empty && failure) {
      trial.status = 'unsupported'
      trial.componentFailure = failure
      delete trial.deltaUsedSize
    } else {
      trial.status = 'failed'
      trial.error = error instanceof Error ? error.stack || error.message : String(error)
      console.error(trial.error)
    }
  } finally {
    if (trial.componentFailure) {
      trial.componentFailure.stage = server.progress?.stage ?? 'unknown'
      trial.componentFailure.scope = trial.componentFailure.stage === 'input' ? 'input-harness' : 'component-or-adapter'
      if (trial.componentFailure.scope === 'input-harness') trial.componentFailure.message = `Input/harness limit before the full listing reached the component: ${trial.componentFailure.message}`
    }
    trial.consoleErrors = errors
    if (trial.status !== 'passed') await screenshot('failed')
    // Closing our browser disposes its sessions. Detach can hang during disconnection.
    if (browser) await browser.close().catch((error) => { trial.cleanupError = error instanceof Error ? error.message : String(error) })
  }
  if (trial.status === 'unsupported') console.log(`${trial.implementation} #${trial.repeat + 1}: UNSUPPORTED: ${trial.componentFailure!.message}`)
  if (trial.status === 'passed') console.log(`${trial.implementation} #${trial.repeat + 1}: ${(trial.phases.loaded!.usedSize.median / 1048576).toFixed(2)} MiB retained; delta ${(trial.deltaUsedSize! / 1048576).toFixed(2)} MiB`)
  return trial
}
