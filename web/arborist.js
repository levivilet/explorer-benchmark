import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Tree } from 'react-arborist'

const Node = ({ node, style }) => createElement('div', { style }, node.data.name)
export async function mount(container) {
  const root = createRoot(container)
  const ref = createRef()
  return {
    async load(state) {
      const response = await fetch(`/entries?state=${state}`)
      if (!response.ok) throw new Error(`Directory read: ${response.status}`)
      const data = (await response.json()).map(({ name }) => ({ id: name, name }))
      flushSync(() => root.render(createElement(Tree, { ref, data, width: 480, height: 600, rowHeight: 22, disableDrag: true, disableDrop: true, disableEdit: true }, Node)))
      const nodes = ref.current.visibleNodes
      return { count: nodes.length, first: nodes[0]?.data.name, last: nodes.at(-1)?.data.name }
    },
    async scroll(index) {
      const node = ref.current.at(index)
      if (!node) throw new Error(`Missing Arborist item ${index}`)
      flushSync(() => ref.current.scrollToOffset(index * 22))
    },
  }
}
