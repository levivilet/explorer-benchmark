import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export async function startServer(fixtureRoot, port = 0) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      if (url.pathname === '/entries') {
        if (!['empty', 'loaded'].includes(url.searchParams.get('state'))) throw new Error('Invalid state')
        const entries = url.searchParams.get('state') === 'empty' ? [] : await readdir(fixtureRoot, { withFileTypes: true })
        if (entries.some((entry) => !entry.isFile())) throw new Error('Flat fixture requires files only')
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(entries.map(({ name }) => ({ name, type: 7 })).sort((a, b) => a.name < b.name ? -1 : 1)))
        return
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (!['index.html', 'file.svg', 'lvce.js', 'lvce-worker.js', 'pierre.js'].includes(name)) {
        response.writeHead(404).end(); return
      }
      response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html')
      response.end(await readFile(resolve('dist', name)))
    } catch (error) { response.writeHead(500).end(String(error)) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer(resolve('.tmp/fixtures', process.argv[2] || '100000'), 4173)
  console.log(`${server.url}/?implementation=lvce and ?implementation=pierre`)
}
