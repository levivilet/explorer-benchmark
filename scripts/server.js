import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { loadFixture } from './fixture.js'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export async function startServer(fixtureRoot, port = 0) {
  const progress = { stage: 'idle' }
  const entriesPath = resolve(fixtureRoot, 'entries.json')
  const { size: jsonBytes } = await stat(entriesPath)
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      if (url.pathname === '/load-stage') {
        const stage = url.searchParams.get('stage')
        if (!['input', 'input-parsed'].includes(stage)) throw new Error('Invalid load stage')
        progress.stage = stage
        response.end('ok')
        return
      }
      if (url.pathname === '/entries') {
        if (!['empty', 'loaded'].includes(url.searchParams.get('state'))) throw new Error('Invalid state')
        response.setHeader('Content-Type', 'application/json')
        if (url.searchParams.get('state') === 'empty') {
          response.end('[]')
        } else {
          response.setHeader('Content-Length', jsonBytes)
          await pipeline(createReadStream(entriesPath), response)
        }
        return
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (!['index.html', 'file.svg', 'lvce.js', 'lvce-worker.js', 'pierre.js', 'arborist.js', 'headless.js', 'jstree.js'].includes(name)) {
        response.writeHead(404).end(); return
      }
      response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html')
      response.end(await readFile(resolve('dist', name)))
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.writeHead(500).end(String(error))
      else response.destroy()
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { progress, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { root } = await loadFixture(Number(process.argv[2] || '100000'))
  const server = await startServer(root, 4173)
  console.log(`${server.url}/?implementation=lvce and ?implementation=pierre`)
}
