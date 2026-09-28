import { readEntries } from './read-entries.ts'
import { FileTree } from '@pierre/trees'
import type { Adapter, LoadState } from './types.ts'
export async function mount(container: HTMLElement): Promise<Adapter> {
  let tree: FileTree | undefined
  let count = 0
  let nameWidth = 6
  return {
    async load(state: LoadState) {
      const entries = await readEntries(state)
      const paths = entries.map(({ name }) => name)
      count = paths.length
      nameWidth = Math.max(6, String(count - 1).length)
      if (tree) tree.cleanUp()
      try {
      tree = new FileTree({ paths, initialExpansion: 'open', flattenEmptyDirectories: false, search: false, itemHeight: 22, icons: { set: 'none' } })
      tree.render({ containerWrapper: container })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        container.textContent = `Tree failed to load: ${message}`
        return { count: 0, componentFailure: { message, stack: error instanceof Error ? error.stack : undefined, count: 0 } }
      }
      if (tree.getVisibleCount() !== count || tree.getItemHeight() !== 22) throw new Error('Pierre model count or row height mismatch')
      return { count: tree.getVisibleCount(), first: paths[0], last: paths.at(-1) }
    },
    async scroll(index: number) {
      if (!tree) throw new Error('Pierre tree did not initialize')
      const path = `file-${String(index).padStart(nameWidth, '0')}.txt`
      if (!tree.getItem(path)) throw new Error(`Missing Pierre item ${path}`)
      tree.scrollToPath(path, { focus: false })
    },
  }
}
