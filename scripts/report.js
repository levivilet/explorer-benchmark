import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { summary } from './statistics.js'
export function aggregate(report) {
  const { repeats } = report.protocol
  if (!Number.isSafeInteger(repeats) || repeats < 1 || report.trials.length !== repeats * 2) throw new Error('Incomplete trial inventory')
  const groups = {}
  for (const implementation of ['lvce', 'pierre']) {
    const trials = report.trials.filter((trial) => trial.implementation === implementation)
    if (trials.length !== repeats || new Set(trials.map((trial) => trial.repeat)).size !== repeats || trials.some((trial) => !Number.isInteger(trial.repeat) || trial.repeat < 0 || trial.repeat >= repeats)) throw new Error('Duplicate or missing trials')
    if (trials.some((trial) => trial.status !== 'passed')) throw new Error('Failed trials cannot produce a comparison')
    groups[implementation] = Object.fromEntries(['empty', 'loaded'].map((phase) => [phase, summary(trials.map((trial) => trial.phases[phase].usedSize.median))]))
    groups[implementation].delta = summary(trials.map((trial) => trial.deltaUsedSize))
  }
  return groups
}
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const mib = (bytes) => (bytes / 1048576).toFixed(2)
export async function buildReport(source = 'results', destination = '.tmp/pages') {
  const report = JSON.parse(await readFile(`${source}/results.json`, 'utf8'))
  const groups = aggregate(report)
  await mkdir(destination, { recursive: true })
  await cp(source, `${destination}/evidence`, { recursive: true })
  const labels = { lvce: 'LVCE explorer-view', pierre: 'Pierre / trees.software' }
  const max = Math.max(...Object.values(groups).map((group) => group.loaded.max))
  const chart = `<svg viewBox="0 0 800 190" role="img" aria-label="Retained JavaScript heap medians and ranges in MiB"><title>Loaded tree retained JavaScript heap; lower uses less</title>${Object.entries(groups).map(([key, group], i) => {
    const y = 35 + i * 85
    const x = (value) => 235 + value / max * 430
    return `<text x="0" y="${y + 22}" fill="currentColor" font-size="16">${labels[key]}</text><rect x="235" y="${y}" width="${x(group.loaded.median) - 235}" height="32" rx="3" fill="${i ? '#c982de' : '#4db9aa'}"/><path d="M${x(group.loaded.min)},${y + 16}H${x(group.loaded.max)}" stroke="white" stroke-width="3"/><text x="${x(group.loaded.median) + 12}" y="${y + 53}" fill="currentColor">${mib(group.loaded.median)} MiB</text>`
  }).join('')}</svg>`
  const rows = Object.entries(groups).map(([key, group]) => `<tr><th>${labels[key]}</th><td>${mib(group.empty.median)}</td><td>${mib(group.loaded.median)}</td><td>${mib(group.loaded.min)}–${mib(group.loaded.max)}</td><td>${mib(group.delta.median)}</td></tr>`).join('')
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Explorer memory benchmark</title>
<style>body{margin:0;background:#15191e;color:#ecf0f4;font:16px/1.6 system-ui}main{max-width:1000px;margin:60px auto;padding:0 24px}h1{font-size:42px;line-height:1.15}h2{margin-top:40px}a{color:#73d2c5}p{max-width:850px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:12px;border-bottom:1px solid #39434d}svg{width:100%;max-width:850px}small{color:#b0bac4}.scroll{overflow-x:auto}.badge{color:#73d2c5;text-transform:uppercase;letter-spacing:2px}code{overflow-wrap:anywhere}img{max-width:100%}</style>
<main><div class="badge">${report.mode === 'smoke' ? 'Smoke run · not enough repeats for a comparison' : 'Reproducible component comparison'}</div><h1>Explorer memory benchmark</h1>
<p>${report.fixture.count.toLocaleString('en-US')} files. One open directory. ${report.protocol.repeats} fresh Chromium runs per implementation. Both trees must render the first, middle and last files before measurement.</p>
<p><strong>Retained JavaScript heap, including workers.</strong> This measures V8 allocations after forced garbage collection. It is not total browser RAM, process RSS, GPU memory, or a minimum memory requirement.</p>
${chart}<div class="scroll"><table><caption>MiB (1,048,576 bytes). Medians across independent trials; range of trial medians.</caption><thead><tr><th>Implementation</th><th>Empty</th><th>100k loaded*</th><th>Loaded range</th><th>Paired increase</th></tr></thead><tbody>${rows}</tbody></table></div><small>*Actual fixture: ${report.fixture.count.toLocaleString('en-US')} files. Increase = loaded minus empty within each trial; then median across trials.</small>
<p><a href="evidence/results.json" download>Download raw measurements (JSON)</a> · <a href="https://github.com/levivilet/explorer-benchmark">Source and reproduction instructions</a>${report.runUrl ? ` · <a href="${escape(report.runUrl)}">Actions run</a>` : ''}</p>
<h2>What was measured</h2><p>A fresh browser per trial; empty mounted tree followed by the populated tree and scrolling probes. Identical local directory listing, 480×600 tree viewport and 22-pixel rows. Natural pre-GC samples, per-isolate heap details, backing-store and embedder counters, DOM counts, screenshots and failures are retained as evidence. The chart uses only the explicitly named V8 usedSize counter.</p>
<p>LVCE uses pinned upstream explorer state, commands, sorting, virtualization and virtual DOM, in a dedicated worker with a minimal host. Editor filesystem/preferences/icon RPCs are replaced with fixture services. Pierre uses its vanilla FileTree API with normal input preparation. Both disable file icon themes, Git decorations and search. Framework bootstraps, full desktop apps, filesystem server, disk cache, Playwright and observer memory are excluded. The adapter and each component's own runtime costs remain included. Default overscan differs and is preserved.</p>
<p>This flat-directory workload makes all files logically visible but allows virtualization to keep only a small number of DOM rows. It does not establish behavior for deep trees, collapsed folders, file contents, edits, selection, or other sizes. Forced GC estimates retained heap, not allocation peaks. LVCE maintains this benchmark; results do not predetermine a winner.</p>
<h2>Provenance</h2><p>Captured ${escape(report.date)} · Chromium ${escape(report.trials[0].chromium)} · ${escape(report.host.platform)} ${escape(report.host.arch)}<br>LVCE commit <code>${escape(report.sources.lvce.commit)}</code><br>Pierre ${escape(report.sources.pierre.version)}<br>Fixture SHA-256 <code>${escape(report.fixture.sha256)}</code><br>Dependency lock SHA-256 <code>${escape(report.packageLockSha256)}</code></p>
<details><summary>Per-trial evidence</summary><ul>${report.trials.map((trial) => `<li>${labels[trial.implementation]} trial ${trial.repeat + 1}: ${mib(trial.phases.loaded.usedSize.median)} MiB · ${trial.phases.loaded.renderedRows} DOM rows · <a href="evidence/${trial.implementation}-${trial.repeat}-loaded.png">screenshot</a></li>`).join('')}</ul></details></main></html>`
  await writeFile(`${destination}/index.html`, html.replace('100k loaded*', 'Loaded*'))
  console.log(groups)
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await buildReport(process.argv[2], process.argv[3])
