import { chromium } from 'playwright'
import { startServer } from './server.js'
import { createFixture, fileName } from './fixture.js'
const { root } = await createFixture(10000)
const server = await startServer(root)
const browser = await chromium.launch()
try {
 const page = await browser.newPage()
 await page.goto(`${server.url}/?implementation=arborist`)
 await page.waitForFunction(()=>Boolean(window.benchmark))
 await page.evaluate(()=>benchmark.load('empty'))
 await page.evaluate(()=>benchmark.load('loaded'))
 for(let repeat=0;repeat<50;repeat++) {
  for(const index of [0,5000,9999,0,0]) {
   await page.evaluate(index=>benchmark.scroll(index),index)
   await page.getByRole('treeitem',{name:fileName(index),exact:true}).waitFor({state:'visible',timeout:90000})
  }
 }
 console.log('50 scrolling sequences passed')
} finally { await browser.close();await server.close() }
