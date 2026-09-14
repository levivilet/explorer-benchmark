import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTrial } from '../scripts/trial.js'

async function attempt(output, scenario, repeat = 0) {
  return runTrial({ implementation: 'pierre', repeat }, {
    output, manifest: { count: 1 },
    report: { protocol: { viewport: { width: 800, height: 720 }, samples: 1, loadTimeoutMs: 1000, settleMs: 0, sampleIntervalMs: 0 } },
    server: { url: 'http://benchmark.test' },
    launchBrowser: async () => {
      const browser = await chromium.launch()
      const newPage = browser.newPage.bind(browser)
      browser.newPage = async (options) => {
        const page = await newPage(options)
        await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: `<script>
          window.benchmark = { load: (phase) => {
            if (phase === 'empty') return {count: 0};
            document.body.innerHTML = '<div role="treeitem" aria-label="file-000000.txt">file-000000.txt</div>';
            return {count: 1};
          }, scroll: () => {} };
        </script>` }))
        const evaluate = page.evaluate.bind(page)
        page.evaluate = async (fn, argument) => {
          if (argument === (scenario === 'empty crash' ? 'empty' : 'loaded')) {
            if (scenario === 'crash' || scenario === 'empty crash') {
              const session = await page.context().newCDPSession(page)
              void session.send('Page.crash').catch(() => {})
              return evaluate(() => new Promise(() => {}))
            }
            if (scenario === 'disconnect') { await browser.close(); return evaluate(fn, argument) }
            if (scenario === 'rpc error') throw new Error('Broken benchmark RPC')
            if (scenario === 'component failure') return { componentFailure: { message: 'Too many entries' } }
          }
          return evaluate(fn, argument)
        }
        if (scenario === 'component failure') page.screenshot = async () => { throw new Error('Screenshot unavailable') }
        return page
      }
      return browser
    },
  })
}

for (const scenario of ['crash', 'disconnect', 'empty crash', 'rpc error', 'component failure']) {
  test(`trial recovery: ${scenario}`, { timeout: 20000 }, async () => {
    const output = await mkdtemp(join(tmpdir(), 'explorer-crash-'))
    try {
      const trial = await attempt(output, scenario)
      if (scenario === 'empty crash' || scenario === 'rpc error') {
        assert.equal(trial.status, 'failed')
        assert.equal(trial.componentFailure, undefined)
      } else {
        assert.equal(trial.status, 'unsupported')
        if (scenario === 'crash') assert.equal(trial.componentFailure.type, 'target-crash')
        assert(trial.phases.empty.usedSize.median > 0)
        assert.equal(trial.deltaUsedSize, undefined)
        assert.equal(trial.screenshots?.failed, undefined)
      }
      if (scenario === 'crash') {
        const next = await attempt(output, 'success', 1)
        assert.equal(next.status, 'passed', 'The following trial must use a healthy fresh browser')
        assert(next.phases.loaded.usedSize.median > 0)
      }
    } finally { await rm(output, { recursive: true, force: true }) }
  })
}
