export const median = (values) => {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Expected nonempty finite samples')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
export const summary = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) })
export function shuffle(values, seed) {
  let state = seed >>> 0
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = Math.floor((state / 4294967296) * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
