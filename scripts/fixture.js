import { createHash } from 'node:crypto'
import { access, mkdir, readdir, statfs, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_FIXTURE_FILES = 10_000_000
export const fileNameWidth = (count) => Math.max(6, String(count - 1).length)
export const fileName = (index, width = 6) => `file-${String(index).padStart(width, '0')}.txt`
export const digestNames = (names) => createHash('sha256').update(names.join('\n') + '\n').digest('hex')
export const positiveInteger = (value, name) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}
export class FixtureCapacityError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'FixtureCapacityError'
    this.code = 'FIXTURE_CAPACITY'
    this.details = details
  }
}
async function checkCapacity(count, base) {
  const basePath = resolve(base)
  await mkdir(basePath, { recursive: true })
  try { await access(resolve(basePath, String(count))) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    let filesystem
    try { filesystem = await statfs(basePath, { bigint: true }) } catch (error) {
      if (error.code === 'ENOSYS' || error.code === 'ERR_METHOD_NOT_IMPLEMENTED') return
      throw error
    }
    const requiredInodes = BigInt(count)
    if (filesystem.ffree < requiredInodes) {
      const details = {
        path: basePath,
        availableInodes: filesystem.ffree.toString(),
        requiredInodes: requiredInodes.toString(),
        availableBytes: (filesystem.bavail * filesystem.bsize).toString(),
      }
      throw new FixtureCapacityError(`Not enough filesystem inodes for ${count.toLocaleString('en-US')} files`, details)
    }
  }
}
export async function createFixture(count = 100000, base = '.tmp/fixtures') {
  positiveInteger(count, 'files')
  if (count > MAX_FIXTURE_FILES) throw new Error(`Maximum fixture size is ${MAX_FIXTURE_FILES.toLocaleString('en-US')} files`)
  await checkCapacity(count, base)
  const root = resolve(base, String(count))
  const width = fileNameWidth(count)
  await mkdir(root, { recursive: true })
  // Bounded filesystem concurrency; zero-byte files isolate directory metadata.
  let next = 0
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (next < count) {
      const index = next++
      await writeFile(`${root}/${fileName(index, width)}`, '')
    }
  }))
  const entries = await readdir(root, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort()
  if (entries.some((entry) => !entry.isFile()) || names.length !== count || names.some((name, i) => name !== fileName(i, width))) {
    throw new Error('Fixture has unexpected entries')
  }
  const manifest = { count, shape: 'flat', fileBytes: 0, nameWidth: width, first: names[0], last: names.at(-1), sha256: digestNames(names) }
  await writeFile(`${root}.json`, JSON.stringify(manifest, null, 2) + '\n')
  return { root, manifest }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await createFixture(positiveInteger(process.argv[2] || 100000, 'files')))
