export interface Entry {
  name: string
  type: 7
}

export type LoadState = 'empty' | 'loaded'

export interface Adapter {
  load: (state: LoadState) => Promise<LoadResult>
  scroll: (index: number) => Promise<unknown>
}

export interface LoadResult {
  count: number
  first?: string
  last?: string
  dom?: unknown
  componentFailure?: { message: string; stack?: string; code?: string; count?: number }
}
