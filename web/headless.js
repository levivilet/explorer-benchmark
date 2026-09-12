import { createTree, syncDataLoaderFeature } from '@headless-tree/core'

const applyProps = (element, props) => {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'ref') value(element)
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value !== undefined) element.setAttribute(key, value)
  }
}
export async function mount(container) {
  let tree
  container.style.overflow = 'auto'
  return {
    async load(state) {
      const response = await fetch(`/entries?state=${state}`)
      if (!response.ok) throw new Error(`Directory read: ${response.status}`)
      const ids = (await response.json()).map(({ name }) => name)
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
    async scroll(index) {
      const item = tree.getItems()[index]
      if (!item) throw new Error(`Missing Headless Tree item ${index}`)
      await item.scrollTo({ block: 'start' })
    },
  }
}
