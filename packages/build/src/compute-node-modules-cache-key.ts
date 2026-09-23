import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const locations = [
  '.nvmrc',
  'package.json',
  'package-lock.json',
  '.github/workflows/benchmark.yml',
  'packages/build/src/compute-node-modules-cache-key.ts',
]

const computeHash = (contents: string[]): string => {
  const hash = createHash('sha1')
  for (const content of contents) {
    hash.update(content)
  }
  return hash.digest('hex')
}

const contents = await Promise.all(locations.map((location) => readFile(location, 'utf8')))
process.stdout.write(computeHash(contents))
