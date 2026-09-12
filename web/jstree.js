import $ from 'jquery'
import 'jstree'

export async function mount(container) {
  let tree
  container.style.overflow = 'auto'
  return {
    async load(state) {
      const response = await fetch(`/entries?state=${state}`)
      if (!response.ok) throw new Error(`Directory read: ${response.status}`)
      const data = (await response.json()).map(({ name }) => ({ id: name, text: name, icon: false }))
      tree?.destroy()
      await new Promise((resolve, reject) => {
        $(container).one('ready.jstree', resolve).jstree({ core: {
          data, themes: { icons: false, dots: false },
          error: (error) => reject(new Error(error.reason)),
        } })
      })
      tree = $(container).jstree(true)
      const children = tree.get_node('#').children
      return { count: children.length, first: children.length ? tree.get_node(children[0]).text : undefined, last: children.length ? tree.get_node(children.at(-1)).text : undefined }
    },
    async scroll(index) {
      const id = tree.get_node('#').children[index]
      const row = tree.get_node(id, true)[0]
      if (!row) throw new Error(`Missing jsTree item ${index}`)
      row.scrollIntoView({ block: 'start' })
    },
  }
}
