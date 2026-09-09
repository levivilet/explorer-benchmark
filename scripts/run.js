import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { positiveInteger } from './fixture.js'
const { values } = parseArgs({ options: {
  files: { type: 'string', default: '10000,100000' }, repeats: { type: 'string', default: '5' },
  samples: { type: 'string', default: '3' }, seed: { type: 'string', default: '1729' },
  output: { type: 'string', default: 'results' },
} })
const files = values.files.split(',').map((value) => positiveInteger(value, 'files'))
if (new Set(files).size !== files.length) throw new Error('Duplicate fixture sizes')
await mkdir(values.output, { recursive: true })
const manifest = { files, status: 'running' }
await writeFile(`${values.output}/manifest.json`, JSON.stringify(manifest, null, 2))
let failed = false
for (const count of files) {
  const result = spawnSync(process.execPath, ['scripts/benchmark.js', '--files', String(count), '--repeats', values.repeats, '--samples', values.samples, '--seed', values.seed, '--output', `${values.output}/${count}`], { stdio: 'inherit' })
  if (result.error || result.status !== 0) failed = true
}
manifest.status = failed ? 'failed' : 'complete'
await writeFile(`${values.output}/manifest.json`, JSON.stringify(manifest, null, 2))
if (failed) process.exitCode = 1
