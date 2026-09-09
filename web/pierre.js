import { FileTree } from '@pierre/trees'
export async function mount(container) {
  let tree
  let count = 0
  return {
    async load(state) {
      const response = await fetch(`/entries?state=${state}`)
      if (!response.ok) throw new Error(`Directory read: ${response.status}`)
      const entries = await response.json()
      const paths = entries.map(({ name }) => name)
      count = paths.length
      if (tree) tree.cleanUp()
      tree = new FileTree({ paths, initialExpansion: 'open', flattenEmptyDirectories: false, search: false, itemHeight: 22, icons: { set: 'none' } })
      tree.render({ containerWrapper: container })
      if (tree.getVisibleCount() !== count || tree.getItemHeight() !== 22) throw new Error('Pierre model count or row height mismatch')
      return { count: tree.getVisibleCount(), first: paths[0], last: paths.at(-1) }
    },
    async scroll(index) {
      const path = `file-${String(index).padStart(6, '0')}.txt`
      if (!tree.getItem(path)) throw new Error(`Missing Pierre item ${path}`)
      tree.scrollToPath(path, { focus: false })
    },
  }
}
