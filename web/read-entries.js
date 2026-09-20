// Progress lives in the observer server so it survives a page or worker crash.
export async function readEntries(state) {
  const mark = async (stage) => {
    const response = await fetch(`/load-stage?stage=${stage}`)
    if (!response.ok) throw new Error(`Load progress: ${response.status}`)
  }
  await mark('input')
  const response = await fetch(`/entries?state=${state}`)
  if (!response.ok) throw new Error(`Directory read: ${response.status}`)
  let entries
  try {
    entries = await response.json()
  } catch (error) {
    // Malformed JSON and transport errors remain harness failures that block CI.
    if (error instanceof RangeError) throw new Error(`INPUT_CAPACITY: ${error.message}`)
    throw error
  }
  await mark('input-parsed')
  return entries
}
