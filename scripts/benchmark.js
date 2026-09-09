import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { createFixture, fileName, positiveInteger } from './fixture.js'
import { startServer } from './server.js'
import { measureHeaps } from './cdp.js'
import { shuffle, summary } from './statistics.js'

const { values } = parseArgs({ options: {
  files: { type: 'string', default: '100000' }, repeats: { type: 'string', default: '5' },
  samples: { type: 'string', default: '3' }, seed: { type: 'string', default: '1729' },
  output: { type: 'string', default: 'results' },
} })
const files = positiveInteger(values.files, 'files')
const repeats = positiveInteger(values.repeats, 'repeats')
const samples = positiveInteger(values.samples, 'samples')
const seed = positiveInteger(values.seed, 'seed')
const output = values.output
const { root, manifest } = await createFixture(files)
await mkdir(output, { recursive: true })
const server = await startServer(root)
const sources = JSON.parse(await readFile('sources.lock.json', 'utf8'))
const packageLockSha256 = createHash('sha256').update(await readFile('package-lock.json')).digest('hex')
const order = shuffle(Array.from({ length: repeats }, (_, repeat) => ['lvce', 'pierre'].map((implementation) => ({ implementation, repeat }))).flat(), seed)
const report = {
  schemaVersion: 1, date: new Date().toISOString(), mode: repeats >= 3 ? 'comparison' : 'smoke',
  sources, packageLockSha256, fixture: manifest,
  protocol: { files, repeats, samples, seed, viewport: { width: 800, height: 720 }, tree: { width: 480, height: 600, rowHeight: 22 }, settleMs: 1000, sampleIntervalMs: 250, order, metric: 'Sum of unique page and worker V8 isolate usedSize; empty and loaded in the same fresh browser', gc: 'Natural sample first, then forced GC in every isolate for retained samples' },
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().map(({ model }) => model), totalMemory: os.totalmem(), node: process.version },
  commit: process.env.BENCHMARK_COMMIT || null, runUrl: process.env.BENCHMARK_RUN_URL || null, trials: [],
}
const checkpoint = async () => {
  await writeFile(`${output}/results.json.tmp`, JSON.stringify(report, null, 2) + '\n')
  await rename(`${output}/results.json.tmp`, `${output}/results.json`)
}
try {
  for (const trialInfo of order) {
    const trial = { ...trialInfo, status: 'failed', phases: {} }
    report.trials.push(trial)
    let browser
    let page
    const errors = []
    try {
      browser = await chromium.launch({ headless: true })
      trial.chromium = browser.version()
      page = await browser.newPage({ viewport: report.protocol.viewport, deviceScaleFactor: 1 })
      page.setDefaultTimeout(90000)
      const evaluate = async (fn, argument) => {
        let timer
        try {
          return await Promise.race([page.evaluate(fn, argument), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Component action timed out after 90 seconds')), 90000) })])
        } finally { clearTimeout(timer) }
      }
      page.on('pageerror', (error) => errors.push(String(error)))
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(`${server.url}/?implementation=${trial.implementation}`)
      await page.waitForFunction(() => Boolean(window.benchmark))
      for (const phase of ['empty', 'loaded']) {
        const start = performance.now()
        const state = await evaluate((phase) => window.benchmark.load(phase), phase)
        if (state.componentFailure) {
          assert.equal(phase, 'loaded', 'Empty component must initialize successfully')
          // An explicit upstream load error is a benchmark outcome, never a memory value.
          trial.status = 'unsupported'
          trial.componentFailure = state.componentFailure
          await page.screenshot({ path: `${output}/${trial.implementation}-${trial.repeat}-failed.png` })
          console.log(`${trial.implementation} #${trial.repeat + 1}: LOAD FAILED: ${state.componentFailure.message}`)
          break
        }
        assert.equal(state.count, phase === 'empty' ? 0 : files)
        if (phase === 'loaded') {
          assert.equal(state.first, manifest.first)
          assert.equal(state.last, manifest.last)
          // Confirm actual DOM text at beginning, middle and end, crossing virtualized ranges.
          for (const index of [...new Set([0, Math.floor(files / 2), files - 1, 0])]) {
            await evaluate((index) => window.benchmark.scroll(index), index)
            const row = page.getByRole('treeitem', { name: fileName(index), exact: true })
            await row.waitFor({ state: 'visible' })
            const box = await row.boundingBox()
            assert(box && box.y < 600 && box.y + box.height > 0 && box.x < 480, 'Row is outside tree viewport')
          }
          await evaluate(() => window.benchmark.scroll(0))
          await page.getByRole('treeitem', { name: fileName(0), exact: true }).waitFor({ state: 'visible' })
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
        await page.screenshot({ path: `${output}/${trial.implementation}-${trial.repeat}-${phase}.png` })
      }
      if (errors.length) throw new Error(errors.join('\n'))
      if (trial.status === 'unsupported') continue
      trial.deltaUsedSize = trial.phases.loaded.usedSize.median - trial.phases.empty.usedSize.median
      trial.status = 'passed'
      console.log(`${trial.implementation} #${trial.repeat + 1}: ${(trial.phases.loaded.usedSize.median / 1048576).toFixed(2)} MiB retained; delta ${(trial.deltaUsedSize / 1048576).toFixed(2)} MiB`)
    } catch (error) {
      trial.status = 'failed'
      trial.error = error.stack || String(error)
      trial.consoleErrors = errors
      console.error(trial.error)
      await page?.screenshot({ path: `${output}/${trial.implementation}-${trial.repeat}-failed.png`, timeout: 5000 }).catch(() => {})
    } finally {
      await browser?.close()
      await checkpoint()
    }
  }
} finally { await server.close() }
if (report.trials.some(({ status }) => status === 'failed')) process.exitCode = 1
