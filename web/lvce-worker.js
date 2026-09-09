// This host replaces editor services only. Tree algorithms and VDOM are unmodified upstream source.
import { RendererWorker, IconThemeWorker } from '@lvce-editor/rpc-registry'
import { commandMap } from '../.tmp/vendor/packages/explorer-view/src/parts/CommandMap/CommandMap.ts'
import { getComponentState } from '../.tmp/vendor/packages/explorer-view/src/parts/GetComponentState/GetComponentState.ts'
let fixtureState = 'empty'
RendererWorker.set({ invoke: async (method, ...args) => {
  switch (method) {
    case 'Preferences.get': return args[0] === 'files.exclude' ? {} : false
    case 'Workspace.getUri': return '/workspace'
    case 'FileSystem.isReadonly': return true
    case 'FileSystem.readDirWithFileTypes': {
      if (args[0] !== '/workspace') throw new Error(`Unexpected directory ${args[0]}`)
      const response = await fetch(`/entries?state=${fixtureState}`)
      if (!response.ok) throw new Error(`Directory read: ${response.status}`)
      return response.json()
    }
    default: throw new Error(`Unsupported host RPC: ${method}`)
  }
}})
IconThemeWorker.set({ invoke: async (method, requests) => {
  if (!method.endsWith('getIcons')) throw new Error(`Unsupported icon RPC: ${method}`)
  return requests.map(() => '/file.svg')
}})
const uid = 1
commandMap['Explorer.create'](uid, '', 0, 0, 480, 600, {}, 0)
self.onmessage = async ({ data: { id, action, value } }) => {
  try {
    if (action === 'load') {
      fixtureState = value
      await commandMap['Explorer.loadContent'](uid)
    } else if (action === 'scroll') {
      const state = getComponentState(uid)
      await commandMap['Explorer.setDeltaY'](uid, value * state.itemHeight)
    } else throw new Error(`Unknown action ${action}`)
    const state = getComponentState(uid)
    if (state.hasError) throw new Error(state.errorMessage)
    // Commit upstream rendering state so obsolete versions are not held artificially.
    await commandMap['Explorer.diff2'](uid)
    await commandMap['Explorer.render2'](uid)
    const dom = commandMap['Explorer.getComponentDom'](uid)
    self.postMessage({ id, value: { dom, count: state.items.length, first: state.items[0]?.name, last: state.items.at(-1)?.name } })
  } catch (error) { self.postMessage({ id, error: error.stack || String(error) }) }
}
