import { readEntries } from './read-entries.ts'
import type { Entry, LoadState } from './types.ts'
// This host replaces editor services only. Tree algorithms and VDOM are unmodified upstream source.
import { RendererWorker, IconThemeWorker } from '@lvce-editor/rpc-registry'
import { commandMap } from '@benchmark-vendor/explorer-command-map'
import { getComponentState } from '@benchmark-vendor/explorer-component-state'
let fixtureState: LoadState = 'empty'
let hostFailure: Error | undefined
;(RendererWorker as any).set({ invoke: async (method: string, ...args: any[]) => {
  try {
  switch (method) {
    case 'Preferences.get': return args[0] === 'files.exclude' ? {} : false
    case 'Workspace.getUri': return '/workspace'
    case 'FileSystem.isReadonly': return true
    case 'FileSystem.readDirWithFileTypes': {
      if (args[0] !== '/workspace') throw new Error(`Unexpected directory ${args[0]}`)
      return await readEntries(fixtureState)
    }
    default: throw new Error(`Unsupported host RPC: ${method}`)
  }
  } catch (error) { hostFailure = error instanceof Error ? error : new Error(String(error)); throw error }
}})
;(IconThemeWorker as any).set({ invoke: async (method: string, requests: unknown[]) => {
  if (!method.endsWith('getIcons')) throw new Error(`Unsupported icon RPC: ${method}`)
  return requests.map(() => '/file.svg')
}})
const uid = 1
commandMap['Explorer.create'](uid, '', 0, 0, 480, 600, {}, 0)
self.onmessage = async ({ data: { id, action, value } }) => {
  try {
    if (action === 'load') {
      fixtureState = value as LoadState
      await commandMap['Explorer.loadContent'](uid)
    } else if (action === 'scroll') {
      const state = getComponentState(uid)
      await commandMap['Explorer.setDeltaY'](uid, value * state.itemHeight)
    } else throw new Error(`Unknown action ${action}`)
    const state = getComponentState(uid)
    if (hostFailure) throw hostFailure
    if (state.hasError) {
      self.postMessage({ id, value: { componentFailure: { message: state.errorMessage, code: state.errorCode, count: state.items.length } } })
      return
    }
    // Commit upstream rendering state so obsolete versions are not held artificially.
    await commandMap['Explorer.diff2'](uid)
    await commandMap['Explorer.render2'](uid)
    const dom = commandMap['Explorer.getComponentDom'](uid)
    self.postMessage({ id, value: { dom, count: state.items.length, first: state.items[0]?.name, last: state.items.at(-1)?.name } })
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.stack || error.message : String(error) }) }
}
