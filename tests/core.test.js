import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { median, shuffle } from '../scripts/statistics.js'
import { createFixture, positiveInteger } from '../scripts/fixture.js'
import { aggregate } from '../scripts/report.js'
import { startServer } from '../scripts/server.js'

test('statistics keep negative deltas and reject missing measurements', () => {
  assert.equal(median([-10, 4, 1]), 1)
  assert.equal(median([4, 2]), 3)
  assert.throws(() => median([]))
  assert.throws(() => median([1, NaN]))
  assert.throws(() => positiveInteger('0', 'files'))
  assert.throws(() => positiveInteger('2.5', 'files'))
  assert.deepEqual(shuffle([1, 2, 3, 4], 1729), shuffle([1, 2, 3, 4], 1729))
  assert.deepEqual(shuffle([1, 2, 3, 4], 1729).sort(), [1, 2, 3, 4])
})
test('fixture is repeatable, served from disk, and rejects contamination', async () => {
  const base = await mkdtemp(join(tmpdir(), 'explorer-benchmark-test-'))
  let server
  try {
    const first = await createFixture(12, base)
    const second = await createFixture(12, base)
    assert.deepEqual(first.manifest, second.manifest)
    server = await startServer(first.root)
    const entries = await (await fetch(`${server.url}/entries?state=loaded`)).json()
    assert.equal(entries.length, 12)
    assert.equal(entries[11].name, 'file-000011.txt')
    assert.deepEqual(await (await fetch(`${server.url}/entries?state=empty`)).json(), [])
    assert.equal((await fetch(`${server.url}/sources.lock.json`)).status, 404)
    await writeFile(`${first.root}/extra.txt`, '')
    await assert.rejects(createFixture(12, base), /unexpected entries/)
  } finally { await server?.close(); await rm(base, { recursive: true, force: true }) }
})
test('report refuses failed, duplicate, or incomplete trials', () => {
  const makeTrial = (implementation) => ({ implementation, repeat: 0, status: 'passed', deltaUsedSize: 2, phases: { empty: { usedSize: { median: 1 } }, loaded: { usedSize: { median: 3 } } } })
  const report = { protocol: { repeats: 1 }, trials: [makeTrial('lvce'), makeTrial('pierre')] }
  assert.equal(aggregate(report).lvce.delta.median, 2)
  report.trials[0].status = 'failed'
  assert.throws(() => aggregate(report), /Failed trials/)
  report.trials[0].status = 'passed'
  report.trials[1].implementation = 'lvce'
  assert.throws(() => aggregate(report), /Duplicate or missing/)
  report.trials.pop()
  assert.throws(() => aggregate(report), /Incomplete/)
})

test('component load failures are shown without fabricated or cherry-picked memory', () => {
  const report = { protocol: { repeats: 1 }, trials: ['lvce', 'pierre'].map((implementation) => ({ implementation, repeat: 0, status: 'unsupported', componentFailure: { message: 'Maximum call stack size exceeded' } })) }
  const groups = aggregate(report)
  assert.equal(groups.lvce.failures, 1)
  assert.equal(groups.lvce.loaded, undefined)
  delete report.trials[0].componentFailure
  assert.throws(() => aggregate(report), /Missing component failure evidence/)
})
