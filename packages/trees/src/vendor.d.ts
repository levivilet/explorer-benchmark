declare module '@benchmark-vendor/explorer-command-map' {
  interface ExplorerState {
    errorCode: string
    errorMessage: string
    hasError: boolean
    itemHeight: number
    items: Array<{ name: string }>
  }

  interface CommandMap {
    'Explorer.create': (...args: any[]) => any
    'Explorer.loadContent': (...args: any[]) => any
    'Explorer.setDeltaY': (...args: any[]) => any
    'Explorer.diff2': (...args: any[]) => any
    'Explorer.render2': (...args: any[]) => any
    'Explorer.getComponentDom': (...args: any[]) => any
  }

  export const commandMap: CommandMap
}

declare module '@benchmark-vendor/explorer-component-state' {
  interface ExplorerState {
    errorCode: string
    errorMessage: string
    hasError: boolean
    itemHeight: number
    items: Array<{ name: string }>
  }

  export function getComponentState(uid: number): ExplorerState
}
