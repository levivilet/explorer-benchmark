import { readEntries } from './read-entries.ts'
import { createTree, syncDataLoaderFeature } from '@headless-tree/core'
import type { TreeInstance } from '@headless-tree/core'
import type { Adapter, LoadState } from './types.ts'

const applyProps = (element: HTMLElement, props: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'ref' && typeof value === 'function') value(element)
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value))
  }
}
export async function mount(container: HTMLElement): Promise<Adapter> {
  let tree: TreeInstance<string> | undefined
  container.style.overflow = 'auto'
  return {
    async load(state: LoadState) {
      const ids = (await readEntries(state)).map(({ name }) => name)
      if (tree) {
        for (const item of tree.getItems()) item.registerElement(null)
        tree.registerElement(null)
        tree.setMounted(false)
      }
      container.replaceChildren()
      tree = createTree({
        rootItemId: 'root',
        getItemName: (item) => item.getItemData(),
        isItemFolder: (item) => item.getId() === 'root',
        dataLoader: { getItem: (id) => id, getChildren: (id) => id === 'root' ? ids : [] },
        features: [syncDataLoaderFeature],
      })
      tree.setMounted(true)
      tree.rebuildTree()
      const content = document.createElement('div')
      applyProps(content, tree.getContainerProps('Files'))
      const items = tree.getItems()
      for (const item of items) {
        const row = document.createElement('div')
        row.className = 'TreeItem'
        row.textContent = item.getItemName()
        applyProps(row, item.getProps())
        content.append(row)
      }
      container.append(content)
      return { count: items.length, first: items[0]?.getItemName(), last: items.at(-1)?.getItemName() }
    },
    async scroll(index: number) {
      if (!tree) throw new Error('Headless Tree did not initialize')
      const item = tree.getItems()[index]
      if (!item) throw new Error(`Missing Headless Tree item ${index}`)
      await item.scrollTo({ block: 'start' })
    },
  }
}
