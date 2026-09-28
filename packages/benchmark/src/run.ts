import { spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { implementations } from './implementations.ts'
import { DEFAULT_FILES, positiveInteger } from './fixture.ts'
import type { Implementation } from './types.ts'
const { values } = parseArgs({ options: {
  files: { type: 'string', default: DEFAULT_FILES }, repeats: { type: 'string', default: '5' },
  samples: { type: 'string', default: '3' }, seed: { type: 'string', default: '1729' },
  output: { type: 'string', default: 'results' },
  implementation: { type: 'string' },
} })
if (values.implementation && !implementations.includes(values.implementation as Implementation)) throw new Error('Unknown implementation')
const inventory: Implementation[] = values.implementation ? [values.implementation as Implementation] : implementations
const files = values.files.split(',').map((value) => positiveInteger(value, 'files'))
if (new Set(files).size !== files.length) throw new Error('Duplicate fixture sizes')
await mkdir(values.output, { recursive: true })
const manifest = { files, implementations: inventory, protocol: { repeats: positiveInteger(values.repeats, 'repeats'), samples: positiveInteger(values.samples, 'samples'), seed: positiveInteger(values.seed, 'seed') }, commit: process.env.BENCHMARK_COMMIT || null, runUrl: process.env.BENCHMARK_RUN_URL || null, status: 'running', workloads: files.map((count) => ({ count, status: 'pending' })) }
await writeFile(`${values.output}/manifest.json`, JSON.stringify(manifest, null, 2))
let failed = false
for (const workload of manifest.workloads) {
  const { count } = workload
  const timeoutMs = count >= 10_000_000 ? 15 * 60 * 1000 : undefined
  const result = spawnSync(process.execPath, ['packages/benchmark/src/benchmark.ts', ...(values.implementation ? ['--implementation', values.implementation] : []), '--files', String(count), '--repeats', values.repeats, '--samples', values.samples, '--seed', values.seed, '--output', `${values.output}/${count}`], { stdio: 'inherit', timeout: timeoutMs })
  if (count >= 10_000_000 && result.error instanceof Error && 'code' in result.error && result.error.code === 'ETIMEDOUT') {
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
