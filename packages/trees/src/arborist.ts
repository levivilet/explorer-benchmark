import { readEntries } from './read-entries.ts'
import { createElement, createRef } from 'react'
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Tree } from 'react-arborist'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { Adapter, LoadState } from './types.ts'

interface NodeData { id: string; name: string }
const Node = ({ node, style }: { node: NodeApi<NodeData>; style: CSSProperties }) => createElement('div', { style }, node.data.name)
export async function mount(container: HTMLElement): Promise<Adapter> {
  const root = createRoot(container)
  const ref = createRef<TreeApi<any>>()
  return {
    async load(state: LoadState) {
      const data = (await readEntries(state)).map(({ name }) => ({ id: name, name }))
      // react-arborist's render prop is typed through JSX but this benchmark uses
      // the equivalent createElement form to keep the browser bundle minimal.
      flushSync(() => root.render(createElement(Tree as any, { ref, data, width: 480, height: 600, rowHeight: 22, disableDrag: true, disableDrop: true, disableEdit: true }, Node as any)))
      const api = ref.current
      if (!api) throw new Error('Arborist tree did not initialize')
      const nodes = api.visibleNodes
      return { count: nodes.length, first: nodes[0]?.data.name, last: nodes.at(-1)?.data.name }
    },
    async scroll(index: number) {
      const api = ref.current
      if (!api) throw new Error('Arborist tree did not initialize')
      const node = api.at(index)
      if (!node) throw new Error(`Missing Arborist item ${index}`)
      flushSync(() => api.scrollToOffset(index * 22))
    },
  }
}
