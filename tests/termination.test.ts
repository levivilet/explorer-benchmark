import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

// A feasibility deadline must terminate the runner, not just close its current browser.
// Playwright otherwise handles SIGTERM and lets the benchmark start another trial.
test('deadline SIGTERM exits the runner and kills its Chromium process', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { chromium } from 'playwright';
    import { exitOnTermination } from './scripts/termination.ts';
    exitOnTermination();
    const browser = await chromium.launch();
    const root = await browser.newBrowserCDPSession();
    const { processInfo } = await root.send('SystemInfo.getProcessInfo');
    console.log(processInfo.find(info => info.type === 'browser').id);
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] })
  let browserPid
  const exited = once(child, 'exit')
  try {
    const [data] = await once(child.stdout, 'data')
    browserPid = Number(String(data).trim())
    assert(Number.isSafeInteger(browserPid) && browserPid > 0)
    child.kill('SIGTERM')
    const result = await Promise.race([exited, delay(3000).then(() => null)])
    assert.deepEqual(result, [143, null], 'The budget must stop the runner immediately')
    // Chromium may briefly be a zombie until the OS reaps it; it must not remain live.
    const { readFile } = await import('node:fs/promises')
    if (process.platform === 'linux') {
      for (let i = 0; i < 30; i++) {
        try {
          const stat = await readFile('/proc/' + browserPid + '/stat', 'utf8')
          if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) return
        } catch (error) { if (error.code === 'ENOENT') return; throw error }
        await delay(100)
      }
      assert.fail('Deadline left Chromium running')
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    if (browserPid) { try { process.kill(browserPid, 'SIGKILL') } catch {} }
  }
})
