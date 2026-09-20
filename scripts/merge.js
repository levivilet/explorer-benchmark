import assert from 'node:assert/strict'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { DEFAULT_FILES } from './fixture.js'
import { implementations } from './implementations.js'
import { aggregate } from './report.js'

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const writeJson = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n')

export async function mergeResults(source = 'shards', destination = 'results', files = DEFAULT_FILES.split(',').map(Number)) {
  const shards = []
  for (const name of await readdir(source)) {
    const directory = `${source}/${name}`
    const manifest = await readJson(`${directory}/manifest.json`)
    assert.equal(manifest.status, 'complete', `Incomplete shard: ${name}`)
    assert.equal(manifest.implementations.length, 1, 'Expected one implementation per shard')
    assert(implementations.includes(manifest.implementations[0]), 'Unknown shard implementation')
    assert.deepEqual(manifest.workloads.map(({ count }) => count), manifest.files)
    assert(manifest.files.every((count) => files.includes(count)), 'Unexpected workload')
    if (shards.length) {
      for (const key of ['commit', 'runUrl', 'protocol']) assert.deepEqual(manifest[key], shards[0].manifest[key], `Mismatched shard ${key}`)
    }
    shards.push({ directory, manifest, implementation: manifest.implementations[0] })
  }
  assert(shards.length, 'No benchmark shards')
  await mkdir(destination, { recursive: true })
  const manifest = { ...shards[0].manifest, files, implementations, status: 'running', workloads: [] }
  // Invalidate any earlier report before merging; never publish partial output.
  await writeJson(`${destination}/manifest.json`, manifest)
  for (const count of files) {
    const reports = []
    const unavailable = {}
    const provenance = []
    const directory = `${destination}/${count}`
    await mkdir(directory, { recursive: true })
    for (const implementation of implementations) {
      const matches = shards.filter((shard) => shard.implementation === implementation && shard.manifest.files.includes(count))
      assert.equal(matches.length, 1, `Missing or duplicate shard: ${implementation}/${count}`)
      const shard = matches[0]
      const workload = shard.manifest.workloads.find((workload) => workload.count === count)
      const input = `${shard.directory}/${count}`
      await cp(input, `${directory}/shards/${implementation}`, { recursive: true })
      if (workload.status === 'infeasible') {
        assert([10000000, 100000000].includes(count), 'Only 10M and 100M stress workloads may be infeasible')
        const feasibility = await readJson(`${input}/feasibility.json`)
        assert.equal(feasibility.files, count)
        assert.equal(feasibility.status, 'infeasible')
        assert(feasibility.reason && ['FIXTURE_CAPACITY', 'BENCHMARK_TIMEOUT'].includes(feasibility.code), 'Invalid feasibility evidence')
        unavailable[implementation] = feasibility
        continue
      }
      assert.equal(workload.status, 'complete', `Incomplete workload: ${implementation}/${count}`)
      const report = await readJson(`${input}/results.json`)
      assert.equal(report.fixture.count, count)
      assert.equal(report.protocol.files, count)
      assert.deepEqual(report.protocol.implementations, [implementation])
      assert.equal(report.commit, manifest.commit)
      assert.equal(report.runUrl, manifest.runUrl)
      for (const key of ['repeats', 'samples', 'seed']) assert.equal(report.protocol[key], manifest.protocol[key])
      aggregate(report)
      if (reports.length) {
        for (const key of ['schemaVersion', 'mode', 'fixture', 'sources', 'packageLockSha256']) assert.deepEqual(report[key], reports[0][key], `Mismatched ${key}`)
        const sharedProtocol = ({ implementations, order, ...protocol }) => protocol
        assert.deepEqual(sharedProtocol(report.protocol), sharedProtocol(reports[0].protocol), 'Mismatched measurement protocol')
      }
      for (const name of await readdir(input)) {
        if (name.endsWith('.png')) {
          assert(name.startsWith(`${implementation}-`), 'Unexpected screenshot owner')
          await cp(`${input}/${name}`, `${directory}/${name}`)
        }
      }
      reports.push(report)
      provenance.push({ implementation, host: report.host, date: report.date, evidence: `shards/${implementation}/results.json` })
    }
    if (!reports.length) {
      const first = Object.values(unavailable)[0]
      await writeJson(`${directory}/feasibility.json`, { ...first, reason: Object.entries(unavailable).map(([id, result]) => `${id}: ${result.reason}`).join('; '), components: unavailable })
      manifest.workloads.push({ count, status: 'infeasible' })
    } else {
      const report = {
        ...reports[0],
        protocol: { ...reports[0].protocol, implementations, order: reports.flatMap((report) => report.protocol.order), execution: 'Separate CI job per implementation and file count; order is per job' },
        trials: reports.flatMap((report) => report.trials), unavailable, shards: provenance,
      }
      aggregate(report)
      await writeJson(`${directory}/results.json`, report)
      manifest.workloads.push({ count, status: 'complete' })
    }
  }
  manifest.status = 'complete'
  await writeJson(`${destination}/manifest.json`, manifest)
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await mergeResults(process.argv[2], process.argv[3])
