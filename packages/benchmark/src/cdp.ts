// Non-flattened target sessions let Playwright's browser CDP session reach worker isolates.
import type { Browser, CDPSession } from 'playwright'
import type { HeapMeasurement, HeapUsage, Isolate } from './types.ts'

interface CdpMessage {
  id: number
  result?: unknown
  error?: unknown
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason?: unknown) => void
  timer: NodeJS.Timeout
}

interface TargetInfo {
  targetId: string
  type: string
}

export class TargetSession {
  private readonly root: CDPSession
  private readonly sessionId: string
  private nextId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listener: (event: { sessionId: string; message: string }) => void

  constructor(root: CDPSession, sessionId: string) {
    this.root = root
    this.sessionId = sessionId
    this.nextId = 0
    this.pending = new Map()
    this.listener = ({ sessionId, message }) => {
      if (sessionId !== this.sessionId) return
      const data = JSON.parse(message) as CdpMessage
      const pending = this.pending.get(data.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(data.id)
      if (data.error) pending.reject(new Error(JSON.stringify(data.error)))
      else pending.resolve(data.result)
    }
    root.on('Target.receivedMessageFromTarget', this.listener)
  }
  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.root.send('Target.sendMessageToTarget', { sessionId: this.sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
        clearTimeout(timer); this.pending.delete(id); reject(error)
      })
    })
  }
  async close() {
    this.root.off('Target.receivedMessageFromTarget', this.listener)
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('CDP session closed')) }
    this.pending.clear()
    await this.root.send('Target.detachFromTarget', { sessionId: this.sessionId })
  }
}
export const measuredTypes = new Set(['page', 'worker', 'shared_worker', 'service_worker', 'iframe'])
export async function measureHeaps(browser: Browser, collectGarbage: boolean): Promise<HeapMeasurement> {
  const root = await browser.newBrowserCDPSession()
  const attached = []
  try {
    const getTargets = async (): Promise<TargetInfo[]> => (await root.send('Target.getTargets') as { targetInfos: TargetInfo[] }).targetInfos.filter(({ type }) => measuredTypes.has(type)).sort((a, b) => a.targetId.localeCompare(b.targetId))
    const targets = await getTargets()
    if (!targets.some(({ type }) => type === 'page')) throw new Error('No page target')
    const isolates = new Map<string, Isolate>()
    for (const target of targets) {
      const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
      const session = new TargetSession(root, sessionId)
      attached.push(session)
      const { id } = await session.send('Runtime.getIsolateId') as { id: string }
      if (isolates.has(id)) { isolates.get(id)!.targets.push(target); continue }
      if (collectGarbage) await session.send('HeapProfiler.collectGarbage')
      const heap = await session.send('Runtime.getHeapUsage') as HeapUsage
      if (!Number.isFinite(heap.usedSize) || heap.usedSize <= 0) throw new Error('Invalid heap reading')
      isolates.set(id, { id, targets: [target], ...heap })
    }
    const after = await getTargets()
    if (targets.map((t) => t.targetId).join() !== after.map((t) => t.targetId).join()) throw new Error('Target membership changed during sample')
    const values = [...isolates.values()]
    return {
      usedSize: values.reduce((sum, value) => sum + value.usedSize, 0),
      backingStorageSize: values.every((value) => Number.isFinite(value.backingStorageSize)) ? values.reduce((sum, value) => sum + value.backingStorageSize!, 0) : undefined,
      embedderHeapUsedSize: values.every((value) => Number.isFinite(value.embedderHeapUsedSize)) ? values.reduce((sum, value) => sum + value.embedderHeapUsedSize!, 0) : undefined,
      isolates: values,
    }
  } finally {
    await Promise.allSettled(attached.map((session) => session.close()))
    await root.detach()
  }
}
