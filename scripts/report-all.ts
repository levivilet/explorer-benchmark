import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildReport, renderChart, renderFeasibility, renderTable, style } from './report.ts'
import type { BenchmarkReport, Feasibility, Implementation, ReportGroup } from './types.ts'
const source = process.argv[2] || 'results'
const destination = process.argv[3] || '.tmp/pages'
const manifest = JSON.parse(await readFile(`${source}/manifest.json`, 'utf8')) as { status: string; files: number[]; workloads?: Array<{ count: number; status: string }> }
if (manifest.status !== 'complete') throw new Error('Benchmark matrix incomplete or invalid')
if (manifest.workloads && (!Array.isArray(manifest.workloads) || manifest.workloads.length !== manifest.files.length || manifest.workloads.some(({ count, status }) => !manifest.files.includes(count) || !['complete', 'infeasible'].includes(status)))) throw new Error('Benchmark workload inventory incomplete or invalid')
const runs: Array<{ kind: 'feasibility'; feasibility: Feasibility } | { kind: 'benchmark'; report: BenchmarkReport; groups: Record<Implementation, ReportGroup> }> = []
for (const count of manifest.files) {
  let feasibility: Feasibility | undefined
  try { feasibility = JSON.parse(await readFile(`${source}/${count}/feasibility.json`, 'utf8')) as Feasibility } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  if (feasibility) {
    if (feasibility.status !== 'infeasible') throw new Error(`Invalid feasibility result for ${count}`)
    await mkdir(`${destination}/${count}/evidence`, { recursive: true })
    await cp(`${source}/${count}`, `${destination}/${count}/evidence`, { recursive: true })
    await writeFile(`${destination}/${count}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Explorer memory benchmark</title><style>${style}</style><main><h1>Explorer memory benchmark</h1><h2>${count.toLocaleString('en-US')} files</h2>${renderFeasibility(feasibility)}<p><a href="evidence/feasibility.json" download>Download feasibility evidence (JSON)</a></p></main></html>`)
    runs.push({ kind: 'feasibility', feasibility })
  } else {
    runs.push({ kind: 'benchmark', ...(await buildReport(`${source}/${count}`, `${destination}/${count}`)) })
  }
}
const sections = runs.map((run) => run.kind === 'feasibility'
  ? `<section><h2>${run.feasibility.files.toLocaleString('en-US')} files</h2>${renderFeasibility(run.feasibility)}<p><a href="${run.feasibility.files}/index.html">Feasibility evidence</a> · <a href="${run.feasibility.files}/evidence/feasibility.json" download>Download feasibility evidence (JSON)</a></p></section>`
  : `<section><h2>${run.report.fixture.count.toLocaleString('en-US')} files</h2><p>${run.report.protocol.repeats} planned trials per component${run.report.mode === 'smoke' ? ' · SMOKE ONLY: too few repeats for a comparison' : ''}</p>${renderChart(run.groups)}${renderTable(run.groups)}<p><a href="${run.report.fixture.count}/index.html">Protocol, versions and screenshots</a> · <a href="${run.report.fixture.count}/evidence/results.json" download>Download raw measurements (JSON)</a></p></section>`).join('')
await writeFile(`${destination}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Explorer memory benchmark</title><style>${style}</style><main><div class="badge">Five tree implementations</div><h1>Explorer memory benchmark</h1><p>Prepared directory listings, real tree components, fresh Chromium browsers. All implementations receive the same open directory. The number of independent trials is recorded for each size; fewer than three are labeled smoke.</p><p><strong>Retained JavaScript heap, including worker isolates.</strong> These are V8 allocations after forced garbage collection, not total browser RAM. Empty baselines and paired increases expose some fixed host costs. Failed loads are outcomes, never zero-memory results.</p>${sections}<p>Trees retain built-in virtualization where available and use 480×600 viewports with 22-pixel rows. The LVCE worker uses a minimal host and actual upstream state/rendering code; Pierre uses the vanilla FileTree API. React Arborist includes React and its virtualizer. Headless Tree uses a nonvirtualized vanilla DOM host; jsTree includes jQuery and renders all rows. Component runtime and adapters are included; desktop apps and the fixture server are excluded. Results apply to these flat-directory workloads. LVCE maintains this benchmark.</p><p><a href="https://github.com/levivilet/explorer-benchmark">Source, reproduction instructions and measurement limits</a></p></main></html>`)
