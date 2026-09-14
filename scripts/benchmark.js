import { implementations } from './implementations.js'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { createFixture, FixtureCapacityError, positiveInteger } from './fixture.js'
import { startServer } from './server.js'
import { runTrial } from './trial.js'
import { shuffle } from './statistics.js'

const { values } = parseArgs({ options: {
  files: { type: 'string', default: '100000' }, repeats: { type: 'string', default: '5' },
  samples: { type: 'string', default: '3' }, seed: { type: 'string', default: '1729' },
  output: { type: 'string', default: 'results' },
  implementation: { type: 'string' },
} })
if (values.implementation && !implementations.includes(values.implementation)) throw new Error('Unknown implementation')
const inventory = values.implementation ? [values.implementation] : implementations
const files = positiveInteger(values.files, 'files')
const repeats = positiveInteger(values.repeats, 'repeats')
const samples = positiveInteger(values.samples, 'samples')
const seed = positiveInteger(values.seed, 'seed')
const output = values.output
await mkdir(output, { recursive: true })
let root
let manifest
try {
  ({ root, manifest } = await createFixture(files))
} catch (error) {
  if (!(error instanceof FixtureCapacityError) || files !== 10_000_000) throw error
  const feasibility = {
    schemaVersion: 1,
    status: 'infeasible',
    files,
    reason: error.message,
    code: error.code,
    details: error.details,
    date: new Date().toISOString(),
    commit: process.env.BENCHMARK_COMMIT || null,
    runUrl: process.env.BENCHMARK_RUN_URL || null,
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), totalMemory: os.totalmem(), node: process.version },
  }
  await writeFile(`${output}/feasibility.json`, JSON.stringify(feasibility, null, 2) + '\n')
  console.log(`${files.toLocaleString('en-US')}-file workload is infeasible: ${error.message}`)
  process.exit(0)
}
const server = await startServer(root)
const sources = JSON.parse(await readFile('sources.lock.json', 'utf8'))
const packageLockSha256 = createHash('sha256').update(await readFile('package-lock.json')).digest('hex')
const order = shuffle(Array.from({ length: repeats }, (_, repeat) => inventory.map((implementation) => ({ implementation, repeat }))).flat(), seed)
const report = {
  schemaVersion: 1, date: new Date().toISOString(), mode: repeats >= 3 ? 'comparison' : 'smoke',
  sources, packageLockSha256, fixture: manifest,
  protocol: { implementations: inventory, loadTimeoutMs: 300000, files, repeats, samples, seed, viewport: { width: 800, height: 720 }, tree: { width: 480, height: 600, rowHeight: 22 }, settleMs: 1000, sampleIntervalMs: 250, order, metric: 'Sum of unique page and worker V8 isolate usedSize; empty and loaded in the same fresh browser', gc: 'Natural sample first, then forced GC in every isolate for retained samples' },
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().map(({ model }) => model), totalMemory: os.totalmem(), node: process.version },
  commit: process.env.BENCHMARK_COMMIT || null, runUrl: process.env.BENCHMARK_RUN_URL || null, trials: [],
}
const checkpoint = async () => {
  await writeFile(`${output}/results.json.tmp`, JSON.stringify(report, null, 2) + '\n')
  await rename(`${output}/results.json.tmp`, `${output}/results.json`)
}
try {
  for (const trialInfo of order) {
    const trial = await runTrial(trialInfo, { report, manifest, server, output })
    report.trials.push(trial)
    await checkpoint()
  }
} finally { await server.close() }
if (report.trials.some(({ status }) => status === 'failed')) process.exitCode = 1
