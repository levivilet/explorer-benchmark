import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { median, shuffle } from '../scripts/statistics.js'
import { createFixture, fileName, fileNameWidth, positiveInteger } from '../scripts/fixture.js'
import { aggregate, renderChart, renderFeasibility, renderTable } from '../scripts/report.js'
import { startServer } from '../scripts/server.js'

test('statistics keep negative deltas and reject missing measurements', () => {
  assert.equal(median([-10, 4, 1]), 1)
  assert.equal(median([4, 2]), 3)
  assert.throws(() => median([]))
  assert.throws(() => median([1, NaN]))
  assert.throws(() => positiveInteger('0', 'files'))
  assert.throws(() => positiveInteger('2.5', 'files'))
  assert.equal(fileNameWidth(100000), 6)
  assert.equal(fileNameWidth(1000001), 7)
  assert.equal(fileName(999999, 7), 'file-0999999.txt')
  assert(fileName(999999, 7) < fileName(1000000, 7))
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

test('fixture feasibility evidence is rendered as a non-measurement', () => {
  const html = renderFeasibility({ files: 10000000, reason: 'Not enough filesystem inodes', details: { availableInodes: '2', requiredInodes: '10000000' } })
  assert.match(html, /10,000,000-file workload was infeasible/)
  assert.match(html, /No complete component comparison was published/)
})


test('five-component reports require every trial and fit every chart row', () => {
  const implementations = ['lvce', 'pierre', 'arborist', 'headless', 'jstree']
  const report = { protocol: { repeats: 1, implementations }, trials: implementations.map((implementation) => ({ implementation, repeat: 0, status: 'passed', deltaUsedSize: 2, phases: { empty: { usedSize: { median: 1 } }, loaded: { usedSize: { median: 3 } } } })) }
  const groups = aggregate(report)
  assert.deepEqual(Object.keys(groups), implementations)
  const chart = renderChart(groups)
  assert.match(chart, /viewBox="0 0 800 445"/)
  assert.match(chart, /React Arborist/)
  assert.match(chart, /Headless Tree/)
  assert.match(chart, /jsTree/)
  report.trials.pop()
  assert.throws(() => aggregate(report), /Incomplete/)
  report.protocol.implementations = ['lvce', 'lvce']
  assert.throws(() => aggregate(report), /Invalid implementation inventory/)
  report.protocol.implementations = ['unknown']
  assert.throws(() => aggregate(report), /Invalid implementation inventory/)
})

test('reports sort successful comparisons by loaded heap and keep failures last', () => {
  const inventory = ['lvce', 'pierre', 'arborist', 'headless', 'jstree']
  const loaded = { lvce: 30, pierre: 10, arborist: 20, jstree: 10 }
  const makeReport = (measurements) => {
    const makeTrial = (implementation) => measurements[implementation] === undefined
      ? { implementation, repeat: 0, status: 'unsupported', componentFailure: { message: 'Load failed' } }
      : { implementation, repeat: 0, status: 'passed', deltaUsedSize: 2, phases: { empty: { usedSize: { median: 1 } }, loaded: { usedSize: { median: measurements[implementation] } } } }
    return { protocol: { repeats: 1, implementations: inventory }, trials: inventory.map(makeTrial) }
  }
  const report = makeReport(loaded)
  const groups = aggregate(report)
  const expectedOrder = ['pierre', 'jstree', 'arborist', 'lvce', 'headless']
  assert.deepEqual(Object.keys(groups), expectedOrder)
  const orderIn = (markup) => expectedOrder.map((implementation) => markup.indexOf({ lvce: 'LVCE explorer-view', pierre: 'Pierre / trees.software', arborist: 'React Arborist', headless: 'Headless Tree (DOM host)', jstree: 'jsTree' }[implementation]))
  assert.deepEqual(orderIn(renderChart(groups)).every((position, index, positions) => index === 0 || position > positions[index - 1]), true)
  assert.deepEqual(orderIn(renderTable(groups)).every((position, index, positions) => index === 0 || position > positions[index - 1]), true)
  assert.match(renderChart(groups), /<rect[^>]+fill="#4db9aa"/)
  assert.match(renderChart(groups), /Not supported \(1\/1\) — no memory result/)
  assert.deepEqual(Object.keys(aggregate(makeReport({ lvce: 300, pierre: 200, arborist: 100, headless: 400, jstree: 50 }))), ['jstree', 'arborist', 'pierre', 'lvce', 'headless'])
})
