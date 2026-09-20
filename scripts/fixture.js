import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

export const MAX_FIXTURE_FILES = 100_000_000
export const DEFAULT_FILES = '10000,100000,1000000,10000000,100000000'
const fixtureBase = '.tmp/fixtures-json'
export const fileNameWidth = (count) => Math.max(6, String(count - 1).length)
export const fileName = (index, width = 6) => `file-${String(index).padStart(width, '0')}.txt`
export const digestNames = (names) => createHash('sha256').update(names.join('\n') + '\n').digest('hex')
export const positiveInteger = (value, name) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}
const validateCount = (count) => {
  positiveInteger(count, 'files')
  if (count > MAX_FIXTURE_FILES) throw new Error(`Maximum fixture size is ${MAX_FIXTURE_FILES.toLocaleString('en-US')} files`)
}
export async function createFixture(count = 100000, base = fixtureBase) {
  validateCount(count)
  const root = resolve(base, String(count))
  const width = fileNameWidth(count)
  await mkdir(root, { recursive: true })
  // A manifest marks a fully generated fixture; never accept an interrupted replacement.
  await rm(`${root}/manifest.json`, { force: true })
  const hash = createHash('sha256')
  async function* chunks() {
    yield '['
    for (let offset = 0; offset < count; offset += 10000) {
      const entries = []
      const names = []
      for (let index = offset; index < Math.min(offset + 10000, count); index++) {
        const name = fileName(index, width)
        names.push(name)
        entries.push(JSON.stringify({ name, type: 7 }))
      }
      hash.update(names.join('\n') + '\n')
      yield (offset === 0 ? '' : ',') + entries.join(',')
    }
    yield ']'
  }
  // Stream bounded batches instead of allocating millions of objects or filesystem inodes.
  await pipeline(chunks(), createWriteStream(`${root}/entries.json.tmp`))
  await rename(`${root}/entries.json.tmp`, `${root}/entries.json`)
  const { size: jsonBytes } = await stat(`${root}/entries.json`)
  const manifest = { count, shape: 'flat', source: 'synthetic-json', fileBytes: 0, nameWidth: width, first: fileName(0, width), last: fileName(count - 1, width), sha256: hash.digest('hex'), jsonBytes }
  await writeFile(`${root}/manifest.json.tmp`, JSON.stringify(manifest, null, 2) + '\n')
  await rename(`${root}/manifest.json.tmp`, `${root}/manifest.json`)
  return { root, manifest }
}
export async function loadFixture(count, base = fixtureBase) {
  validateCount(count)
  const root = resolve(base, String(count))
  let manifest
  try { manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8')) } catch (error) {
    throw new Error(`Fixture ${count} is not prepared. Run npm run fixture -- --files ${count} first.`, { cause: error })
  }
  const width = fileNameWidth(count)
  if (manifest.source !== 'synthetic-json' || manifest.count !== count || manifest.shape !== 'flat' || manifest.nameWidth !== width || manifest.first !== fileName(0, width) || manifest.last !== fileName(count - 1, width) || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.jsonBytes)) {
    throw new Error(`Invalid fixture manifest for ${count}`)
  }
  const { size } = await stat(`${root}/entries.json`)
  if (size !== manifest.jsonBytes) throw new Error(`Fixture ${count} JSON size does not match its manifest; regenerate it`)
  return { root, manifest }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { parseArgs } = await import('node:util')
  const { values } = parseArgs({ options: { files: { type: 'string', default: DEFAULT_FILES } } })
  const counts = values.files.split(',').map(value => positiveInteger(value, 'files'))
  if (new Set(counts).size !== counts.length) throw new Error('Duplicate fixture sizes')
  counts.forEach(validateCount)
  for (const count of counts) {
    const start = performance.now()
    const { manifest } = await createFixture(count)
    console.log(`Prepared ${count.toLocaleString('en-US')} synthetic entries (${manifest.jsonBytes} JSON bytes) in ${((performance.now() - start) / 1000).toFixed(2)} seconds`)
  }
}
