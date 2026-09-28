import { readEntries } from './read-entries.ts'
import $ from 'jquery'
import 'jstree'
import type { Adapter, LoadState } from './types.ts'

export async function mount(container: HTMLElement): Promise<Adapter> {
  let tree: JSTree | undefined
  container.style.overflow = 'auto'
  return {
    async load(state: LoadState) {
      const data = (await readEntries(state)).map(({ name }) => ({ id: name, text: name, icon: false }))
      tree?.destroy()
      await new Promise((resolve, reject) => {
        $(container).one('ready.jstree', resolve).jstree({ core: {
          data, themes: { icons: false, dots: false },
          error: (error: { reason: string }) => reject(new Error(error.reason)),
        } })
      })
      tree = $(container).jstree(true)
      const children = tree.get_node('#').children
      return { count: children.length, first: children.length ? tree.get_node(children[0]).text : undefined, last: children.length ? tree.get_node(children.at(-1)).text : undefined }
    },
    async scroll(index: number) {
      if (!tree) throw new Error('jsTree did not initialize')
      const id = tree.get_node('#').children[index]
      const row = tree.get_node(id, true)[0]
      if (!row) throw new Error(`Missing jsTree item ${index}`)
      row.scrollIntoView({ block: 'start' })
    },
  }
}
