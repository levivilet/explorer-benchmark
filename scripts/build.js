import { build } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
for (const entry of ['lvce', 'lvce-worker', 'pierre']) {
  await build({ entryPoints: [`web/${entry}.js`], outfile: `dist/${entry}.js`, bundle: true, external: ['node:*', 'electron', 'ws'], format: 'esm', platform: 'browser', target: 'chrome140', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
}
await cp('web/index.html', 'dist/index.html')
await cp('web/file.svg', 'dist/file.svg')
