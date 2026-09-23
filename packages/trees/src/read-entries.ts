// The fixture is a JSON array of flat {name,type} records. Parse complete batches
// while retaining the full entry array, without also retaining a multi-GB string.
import type { Entry, LoadState } from './types.ts'

export async function parseEntries(response: Response): Promise<Entry[]> {
  if (!response.body) throw new Error('Missing fixture response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const entries: Entry[] = []
  let pending = ''
  let started = false
  const append = (json: string): void => {
    for (const entry of JSON.parse(`[${json}]`) as Entry[]) {
      if (!/^file-[0-9]+\.txt$/.test(entry.name) || entry.type !== 7) throw new Error('Invalid fixture entry')
      entries.push(entry)
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      if (!started && pending.length) {
        if (pending[0] !== '[') throw new SyntaxError('Missing fixture array start')
        pending = pending.slice(1)
        started = true
      }
      const boundary = pending.lastIndexOf('},')
      if (boundary !== -1) {
        append(pending.slice(0, boundary + 1))
        pending = pending.slice(boundary + 2)
      }
      if (done) break
    }
    if (!started || !pending.endsWith(']')) throw new SyntaxError('Incomplete fixture array')
    if (entries.length && pending === ']') throw new SyntaxError('Trailing fixture comma')
    append(pending.slice(0, -1))
    return entries
  } finally { reader.releaseLock() }
}

// Progress lives in the observer server so it survives a page or worker crash.
export async function readEntries(state: LoadState): Promise<Entry[]> {
  const mark = async (stage: 'input' | 'input-parsed'): Promise<void> => {
    const response = await fetch(`/load-stage?stage=${stage}`)
    if (!response.ok) throw new Error(`Load progress: ${response.status}`)
  }
  await mark('input')
  const response = await fetch(`/entries?state=${state}`)
  if (!response.ok) throw new Error(`Directory read: ${response.status}`)
  let entries
  try {
    entries = await parseEntries(response)
  } catch (error) {
    // Malformed JSON and transport errors remain harness failures that block CI.
    if (error instanceof RangeError) throw new Error(`INPUT_CAPACITY: ${error.message}`)
    throw error
  }
  await mark('input-parsed')
  return entries
}
