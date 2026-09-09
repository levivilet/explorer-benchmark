import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const fileName = (index) => `file-${String(index).padStart(6, '0')}.txt`
export const digestNames = (names) => createHash('sha256').update(names.join('\n') + '\n').digest('hex')
export const positiveInteger = (value, name) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}
export async function createFixture(count = 100000, base = '.tmp/fixtures') {
  positiveInteger(count, 'files')
  if (count > 1000000) throw new Error('Maximum fixture size is 1,000,000 files')
  const root = resolve(base, String(count))
  await mkdir(root, { recursive: true })
  // Bounded filesystem concurrency; zero-byte files isolate directory metadata.
  let next = 0
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (next < count) await writeFile(`${root}/${fileName(next++)}`, '')
  }))
  const entries = await readdir(root, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort()
  if (entries.some((entry) => !entry.isFile()) || names.length !== count || names.some((name, i) => name !== fileName(i))) {
    throw new Error('Fixture has unexpected entries')
  }
  const manifest = { count, shape: 'flat', fileBytes: 0, first: names[0], last: names.at(-1), sha256: digestNames(names) }
  await writeFile(`${root}.json`, JSON.stringify(manifest, null, 2) + '\n')
  return { root, manifest }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await createFixture(positiveInteger(process.argv[2] || 100000, 'files')))
