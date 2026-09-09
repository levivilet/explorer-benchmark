import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const { lvce } = JSON.parse(await readFile('sources.lock.json', 'utf8'))
const response = await fetch(lvce.url)
if (!response.ok) throw new Error(`Source download: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== lvce.sha256) throw new Error('LVCE source checksum mismatch')
await mkdir('.tmp', { recursive: true })
await writeFile('.tmp/lvce.tgz', bytes)
await rm('.tmp/vendor', { recursive: true, force: true })
await mkdir('.tmp/vendor', { recursive: true })
execFileSync('tar', ['-xzf', '.tmp/lvce.tgz', '--strip-components=1', '-C', '.tmp/vendor'])
console.log(`Verified LVCE ${lvce.commit}`)
