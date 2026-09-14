import { spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { positiveInteger } from './fixture.js'
const { values } = parseArgs({ options: {
  files: { type: 'string', default: '10000,100000,1000000,10000000' }, repeats: { type: 'string', default: '5' },
  samples: { type: 'string', default: '3' }, seed: { type: 'string', default: '1729' },
  output: { type: 'string', default: 'results' },
} })
const files = values.files.split(',').map((value) => positiveInteger(value, 'files'))
if (new Set(files).size !== files.length) throw new Error('Duplicate fixture sizes')
await mkdir(values.output, { recursive: true })
const manifest = { files, status: 'running', workloads: files.map((count) => ({ count, status: 'pending' })) }
await writeFile(`${values.output}/manifest.json`, JSON.stringify(manifest, null, 2))
let failed = false
for (const workload of manifest.workloads) {
  const { count } = workload
  const timeoutMs = count === 10_000_000 ? 15 * 60 * 1000 : undefined
  const result = spawnSync(process.execPath, ['scripts/benchmark.js', '--files', String(count), '--repeats', values.repeats, '--samples', values.samples, '--seed', values.seed, '--output', `${values.output}/${count}`], { stdio: 'inherit', timeout: timeoutMs })
  if (count === 10_000_000 && result.error?.code === 'ETIMEDOUT') {
    const feasibility = {
      schemaVersion: 1,
      status: 'infeasible',
      files: count,
      reason: 'Benchmark did not complete within the 15-minute feasibility budget',
      code: 'BENCHMARK_TIMEOUT',
      details: { timeoutMs, signal: result.signal, partialResults: true },
      date: new Date().toISOString(),
      host: { platform: os.platform(), release: os.release(), arch: os.arch(), totalMemory: os.totalmem(), node: process.version },
    }
    await mkdir(`${values.output}/${count}`, { recursive: true })
    await writeFile(`${values.output}/${count}/feasibility.json`, JSON.stringify(feasibility, null, 2) + '\n')
    workload.status = 'infeasible'
  } else if (result.error || result.status !== 0) {
    workload.status = 'failed'
    failed = true
  } else {
    try {
      await access(`${values.output}/${count}/feasibility.json`)
      workload.status = 'infeasible'
    } catch { workload.status = 'complete' }
  }
  await writeFile(`${values.output}/manifest.json`, JSON.stringify(manifest, null, 2))
}
manifest.status = failed ? 'failed' : 'complete'
await writeFile(`${values.output}/manifest.json`, JSON.stringify(manifest, null, 2))
if (failed) process.exitCode = 1
