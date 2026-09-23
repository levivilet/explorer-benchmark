import { build } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
for (const entry of ['lvce', 'lvce-worker', 'pierre', 'arborist', 'headless', 'jstree']) {
  await build({ entryPoints: [`packages/trees/src/${entry}.ts`], outfile: `dist/${entry}.js`, bundle: true, alias: {
    '@benchmark-vendor/explorer-command-map': './.tmp/vendor/packages/explorer-view/src/parts/CommandMap/CommandMap.ts',
    '@benchmark-vendor/explorer-component-state': './.tmp/vendor/packages/explorer-view/src/parts/GetComponentState/GetComponentState.ts',
  }, external: ['node:*', 'electron', 'ws'], format: 'esm', platform: 'browser', target: 'chrome140', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
}
await cp('packages/trees/src/index.html', 'dist/index.html')
await cp('packages/trees/src/file.svg', 'dist/file.svg')
