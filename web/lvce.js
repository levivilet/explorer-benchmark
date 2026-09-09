import { renderInto } from '@lvce-editor/virtual-dom'
export async function mount(container) {
  const worker = new Worker('/lvce-worker.js', { type: 'module' })
  let nextId = 0
  const pending = new Map()
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    clearTimeout(request.timer)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.value)
  }
  worker.onerror = (event) => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(event.message)) }
    pending.clear()
  }
  const invoke = (action, value) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker timeout: ${action}`)) }, 90000)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ id, action, value })
  })
  const update = async (action, value) => {
    const { dom, count, first, last } = await invoke(action, value)
    // Use LVCE's real DOM renderer; event dispatch belongs to this minimal host.
    renderInto(container, dom)
    return { count, first, last }
  }
  let position = 0
  let queue = Promise.resolve()
  const scroll = (index) => {
    position = Math.max(0, index)
    queue = queue.then(() => update('scroll', position))
    return queue
  }
  container.addEventListener('wheel', (event) => { event.preventDefault(); void scroll(position + Math.sign(event.deltaY) * 3) }, { passive: false })
  return { load: (state) => update('load', state), scroll }
}
