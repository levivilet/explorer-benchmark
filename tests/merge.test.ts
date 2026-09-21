import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mergeResults } from '../scripts/merge.ts'
import { implementations } from '../scripts/implementations.ts'
import { aggregate, buildReport } from '../scripts/report.ts'

const writeJson = async (path, value) => writeFile(path, JSON.stringify(value))
async function fixture(t, files = 100000) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-merge-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = `${root}/shards`
  const output = `${root}/results`
  for (const implementation of implementations) {
    const directory = `${source}/${implementation}`
    await mkdir(`${directory}/${files}`, { recursive: true })
    const protocol = { repeats: 1, samples: 1, seed: 1729 }
    await writeJson(`${directory}/manifest.json`, { files: [files], implementations: [implementation], protocol, commit: 'abc', runUrl: 'run', status: 'complete', workloads: [{ count: files, status: 'complete' }] })
    await writeJson(`${directory}/${files}/results.json`, {
      schemaVersion: 1, date: 'today', mode: 'smoke', fixture: { count: files, sha256: 'fixture' }, sources: { lvce: { commit: 'source' } }, packageLockSha256: 'lock', host: { platform: 'linux', arch: 'x64', name: implementation }, commit: 'abc', runUrl: 'run',
      protocol: { ...protocol, files, implementations: [implementation], order: [{ implementation, repeat: 0 }] },
      trials: [{ implementation, repeat: 0, chromium: '123', status: 'passed', deltaUsedSize: 2, phases: { empty: { usedSize: { median: 1 } }, loaded: { usedSize: { median: 3 }, renderedRows: 1 } } }],
    })
  }
  return { root, source, output, files }
}
async function edit(path, change) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  change(value)
  await writeJson(path, value)
}

test('merge preserves successful trees, crash outcomes, per-job provenance, and raw evidence', async (t) => {
  const { root, source, output, files } = await fixture(t)
  await edit(`${source}/pierre/${files}/results.json`, (report) => {
    report.trials[0] = { implementation: 'pierre', repeat: 0, chromium: '123', status: 'unsupported', componentFailure: { type: 'target-crash', message: 'Chromium target crashed' }, screenshots: {} }
  })
  await mergeResults(source, output, [files])
  const { report, groups } = await buildReport(`${output}/${files}`, `${root}/pages`)
  assert.equal(groups.pierre.loaded, undefined)
  assert.equal(groups.lvce.loaded.median, 3)
  assert.equal(report.shards.length, 5)
  assert.deepEqual(report.shards.map(({ host }) => host.name), implementations)
  const html = await readFile(`${root}/pages/index.html`, 'utf8')
  assert.match(html, /Chromium target crashed/)
  assert(!html.includes('pierre-0-failed.png'))
  assert.equal(JSON.parse(await readFile(`${output}/manifest.json`)).status, 'complete')
  assert.equal(JSON.parse(await readFile(`${output}/${files}/shards/pierre/results.json`)).trials[0].status, 'unsupported')
})

for (const defect of ['missing', 'duplicate', 'unfinished', 'failed trial', 'incomplete trials', 'different commit', 'different protocol', 'different fixture']) {
  test(`merge rejects ${defect}`, async (t) => {
    const { source, output, files } = await fixture(t)
    const directory = `${source}/pierre`
    if (defect === 'missing') await rm(directory, { recursive: true })
    if (defect === 'duplicate') await cp(directory, `${source}/duplicate`, { recursive: true })
    if (defect === 'unfinished') await edit(`${directory}/manifest.json`, (manifest) => { manifest.status = 'running' })
    if (defect === 'different commit') await edit(`${directory}/manifest.json`, (manifest) => { manifest.commit = 'other' })
    if (defect === 'different protocol') await edit(`${directory}/${files}/results.json`, (report) => { report.protocol.samples = 2 })
    if (defect === 'different fixture') await edit(`${directory}/${files}/results.json`, (report) => { report.fixture.sha256 = 'other' })
    if (defect === 'failed trial') await edit(`${directory}/${files}/results.json`, (report) => { report.trials[0].status = 'failed' })
    if (defect === 'incomplete trials') await edit(`${directory}/${files}/results.json`, (report) => { report.trials = [] })
    await assert.rejects(mergeResults(source, output, [files]))
  })
}

test('10M host infeasibility preserves measurements from jobs that could run', async (t) => {
  const { source, output, files } = await fixture(t, 10000000)
  await edit(`${source}/pierre/manifest.json`, (manifest) => { manifest.workloads[0].status = 'infeasible' })
  await writeJson(`${source}/pierre/${files}/feasibility.json`, { files, status: 'infeasible', code: 'FIXTURE_CAPACITY', reason: 'Not enough inodes', details: {} })
  await mergeResults(source, output, [files])
  const report = JSON.parse(await readFile(`${output}/${files}/results.json`))
  const groups = aggregate(report)
  assert.equal(groups.pierre.unavailable, true)
  assert.equal(groups.pierre.loaded, undefined)
  assert.equal(groups.lvce.loaded.median, 3)
  assert.equal(report.trials.length, 4)
})

test('all infeasible 10M jobs produce workload evidence with every host result', async (t) => {
  const { source, output, files } = await fixture(t, 10000000)
  for (const id of implementations) {
    await edit(`${source}/${id}/manifest.json`, (manifest) => { manifest.workloads[0].status = 'infeasible' })
    await writeJson(`${source}/${id}/${files}/feasibility.json`, { files, status: 'infeasible', code: 'FIXTURE_CAPACITY', reason: 'Not enough inodes', details: {} })
  }
  await mergeResults(source, output, [files])
  const result = JSON.parse(await readFile(`${output}/${files}/feasibility.json`))
  assert.deepEqual(Object.keys(result.components), implementations)
  assert.equal(JSON.parse(await readFile(`${output}/manifest.json`)).workloads[0].status, 'infeasible')
})

for (const all of [false, true]) {
  test(`100M timeout checkpoints preserve every component (all infeasible: ${all})`, async (t) => {
    const { source, output, files } = await fixture(t, 100000000)
    for (const id of all ? implementations : ['pierre']) {
      await edit(`${source}/${id}/manifest.json`, (manifest) => { manifest.workloads[0].status = 'infeasible' })
      await edit(`${source}/${id}/${files}/results.json`, (report) => { report.trials[0].status = 'running' })
      await writeJson(`${source}/${id}/${files}/feasibility.json`, { files, status: 'infeasible', code: 'BENCHMARK_TIMEOUT', reason: '15-minute host budget exhausted; component capacity unknown', details: { timeoutMs: 900000, partialResults: true } })
    }
    await mergeResults(source, output, [files])
    if (all) {
      const result = JSON.parse(await readFile(`${output}/${files}/feasibility.json`))
      assert.deepEqual(Object.keys(result.components), implementations)
    } else {
      const report = JSON.parse(await readFile(`${output}/${files}/results.json`))
      assert.equal(aggregate(report).pierre.loaded, undefined)
      assert.equal(aggregate(report).lvce.loaded.median, 3)
    }
    const checkpoint = JSON.parse(await readFile(`${output}/${files}/shards/pierre/results.json`))
    assert.equal(checkpoint.trials[0].status, 'running')
  })
}
