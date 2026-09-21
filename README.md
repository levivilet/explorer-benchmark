# Explorer benchmark

Reproducible memory comparison of [LVCE explorer-view](https://github.com/lvce-editor/explorer-view), [Pierre's trees.software](https://trees.software), [React Arborist](https://github.com/brimdata/react-arborist),
[Headless Tree](https://github.com/lukasbach/headless-tree), and [jsTree](https://www.jstree.com/), using real components in Chromium.

[Live results](https://levivilet.github.io/explorer-benchmark/) ·
[Run benchmark](https://github.com/levivilet/explorer-benchmark/actions/workflows/benchmark.yml)

The default workloads are **10,000, 100,000, 1,000,000, 10,000,000 and 100,000,000 synthetic file entries, each workload representing one open directory**. All implementations
load the same prepared JSON directory listing, expose all entries in their tree model, and
render the first, middle and last files on demand. Built-in virtualization remains enabled. The minimal Headless Tree DOM host and jsTree
render all rows; no external virtualizer is added. DOM row counts expose this difference. Names are zero-padded to a width that keeps
lexicographic and numeric order identical (`file-000000.txt` through `file-099999.txt` for 100,000 files). Each workload has an `entries.json` and `manifest.json` under `.tmp/fixtures-json/<count>/`. No individual files are created.

## Run

Node 24+, Linux/macOS/Windows with a working Chromium environment and `tar`:

```sh
nice npm ci
npm run setup                    # Download and verify pinned LVCE source
npm run build                    # Production bundles for all five components
npx playwright install chromium  # Linux CI uses --with-deps
npm test
npm run test:cdp
npm run test:adapters              # Repeated virtualized scrolling regression
npm run test:crash                 # Actual Chromium crash and recovery regression
npm run fixture                  # Prepare all JSON fixtures outside the benchmark budget
npm run benchmark                # 10k, 100k, 1m, 10m and 100m files; five fresh trials per component
npm run report
npm run test:report
python3 -m http.server 8080 --directory .tmp/pages
```

On platforms without `nice`, use `npm ci`. The benchmark requires no GitHub token,
root privileges, editor installation, or access to your existing workspaces.
Setup writes only the JSON fixtures and manifests in `.tmp/fixtures-json`; it does not access existing workspaces or old `.tmp/fixtures` directories. Benchmark execution requires a completed setup and fails with preparation instructions if a fixture is missing.

```sh
# Quick adapter/CDP smoke; explicitly labeled as too few trials for comparison:
npm run fixture -- --files 1000
npm run benchmark -- --files 1000 --repeats 1 --samples 1 --output results-smoke
node scripts/report-all.ts results-smoke .tmp/smoke-pages

# Open the components manually after generating/building:
npm run fixture -- --files 100000
npm run serve
# http://127.0.0.1:4173/?implementation=lvce
# http://127.0.0.1:4173/?implementation=pierre
# http://127.0.0.1:4173/?implementation=arborist
# http://127.0.0.1:4173/?implementation=headless
# http://127.0.0.1:4173/?implementation=jstree
# In the console: await benchmark.load('loaded')
```

Options: `--files` (comma-separated sizes, each 1–100,000,000), `--repeats`, `--samples`, `--seed`, `--output`, and `--implementation` (one of `lvce`, `pierre`, `arborist`, `headless`, `jstree`; defaults to all).
The 100,000- and 1,000,000-file cases are required measurements, not guarantees that each
component supports those sizes. The 10,000,000- and 100,000,000-file cases record and publish
a feasibility result when the bounded 15-minute benchmark attempt cannot complete. Fixture generation is a separate CI step and is excluded from that budget. Use
different output directories when preserving runs. This measures frontend directory metadata handling; file contents and filesystem enumeration are outside its scope.

## Protocol

1. Prepare synthetic `{name, type}` entries in batches of 10,000 and stream them to one JSON file per size. Hash the sorted, newline-separated
   file names (including the final newline) and record the count, name width, endpoints and JSON byte size in a completion manifest.
   Setup uses bounded memory and creates no individual files. A common loopback server streams the prepared JSON unchanged on each loaded request;
   it does not enumerate a directory, sort, or serialize entries during trials. Every adapter receives the same listing.
   Benchmark execution reads the manifest and checks the JSON size; it never generates missing fixtures. Downloading and parsing JSON in the browser remain part of load readiness. Adapters parse streamed batches into the complete entry array, avoiding a second multi-gigabyte response string; no component sees a partial listing.
2. Pin the LVCE source commit and download checksum in `config/sources.lock.json`. Pin all npm components,
   LVCE runtime dependencies, esbuild and Playwright in `package-lock.json`. Build production,
   minified bundles with the same bundler. Chromium is Playwright's matching revision.
3. Shuffle trials once per job with recorded seed 1729. Run one browser/component at a time within each job.
   Each trial gets a fresh headless Chromium process and browser context, no extensions,
   800×720 viewport and device scale 1. The tree is 480×600 with 22-pixel rows.
4. Mount an empty workspace and sample it. In the same trial load the populated workspace.
   Allow up to five minutes per load for every component (recorded in the protocol);
   jsTree's repeated sibling searches took about 144 seconds for 100k in a local diagnostic.
   Scrolling actions and visibility probes retain the 90-second limit.
   Assert model counts and first/last names. Scroll via each component's API to the first,
   middle and last files; require the corresponding accessible tree rows to appear. Return
   to the start and sample. No traversal of all millions of visible DOM rows is required.
   For filenames wider than six digits, the fixture uses a wider common zero-padding width
   so directory sorting remains numeric.
5. After readiness, settle for one second. Record one natural (no forced GC) sample.
   Then record three retained samples 250 ms apart, forcing `HeapProfiler.collectGarbage`
   in every distinct V8 isolate before `Runtime.getHeapUsage`.
6. Enumerate page, iframe, dedicated/shared/service-worker targets. Attach to all of them;
   deduplicate by `Runtime.getIsolateId`, and reject target membership changes or unavailable
   measurements. LVCE must have a measured worker. Detached CDP sessions and transient RPC
   replies are released; we never copy the full LVCE state into the observer/page for measurement.
7. Take each trial's median across retained samples. Report median and min/max of those
   trial medians, and median of paired loaded-minus-empty differences. Negative differences
   remain negative. Fewer than three repeats are labeled smoke, not a comparison.
8. Checkpoint every attempt, including failures. An explicit component load error, a loaded-tree timeout,
   or a Chromium target crash/disconnection after a successful empty baseline is a
   benchmark outcome: show its message and failure count, with no aggregate memory number
   for that component/size. Do not cherry-pick successful trials if some loads fail.
   Harness/RPC/measurement errors, failed readiness probes, empty-tree initialization errors,
   and incomplete runs still fail CI and block deployment. Failures are never zero-byte measurements.
   Record crash details and console errors without attempting to invent a memory value.
   Screenshots are best effort; crashed targets may have none. Close each browser in cleanup. Take screenshots after measurement so screenshot allocation
   does not affect that phase's samples.

## Initial finding

The [first 100,000-file CI run](https://github.com/levivilet/explorer-benchmark/actions/runs/34349230900)
loaded Pierre successfully in all five trials (about 16.22 MiB retained V8 heap),
but LVCE commit `6bc822f687696bdfc6cae9442d9f9391ebb0ee0f` reported
`Maximum call stack size exceeded` in all five populated-workspace loads.
The benchmark does not patch each component or increase Chromium's stack limit to
hide this result. The 10,000-file workload provides a smaller comparison alongside
the original stress case. Consult the live report for results under the current protocol.

The follow-up [restoration fix](https://github.com/lvce-editor/explorer-view/pull/1882)
removes unbounded argument lists when appending directory entries. In the
[validation run](https://github.com/levivilet/explorer-benchmark/actions/runs/34352237810),
all five LVCE trials loaded 100,000 files, with about 11.18 MiB retained V8 heap
versus 16.22 MiB for Pierre. The current source pin includes this fix; the initial
failure above remains documented as historical evidence.

## Metrics and limits

| Metric | Interpretation |
| --- | --- |
| Retained V8 `usedSize` | Main chart: sum of page and worker isolates after forced GC |
| Empty / loaded | Includes the component runtime and adapter, in the specified state |
| Paired increase | Loaded trial median minus that trial's empty median |
| Natural `usedSize` | Single pre-GC observation per phase; sensitive to GC timing |
| `backingStorageSize` | Separate raw CDP counter for ArrayBuffer/external string backing storage |
| `embedderHeapUsedSize` | Separate experimental raw embedder counter, not added to usedSize |
| DOM counters / rendered rows | Evidence of DOM and virtualization behavior, not byte estimates |

All memory amounts are **MiB = 1,048,576 bytes**. These are component JavaScript
heap measurements, **not total resident browser RAM**, allocation peaks, GPU memory,
minimum operating memory, or full LVCE Editor versus the trees.software website.
The fixture server, filesystem/page cache, Playwright and observer are outside the
measured browser heaps. CPU model, OS, memory, exact Chromium, sources, fixture hash,
dependency lock hash, run URL and benchmark commit are recorded. Host variation still matters.

LVCE is a worker component, not a standalone browser widget. Its adapter bundles
unmodified upstream commands, state, loading, sorting, virtualization and VDOM code
into a dedicated worker. The page uses `@lvce-editor/virtual-dom` to create the real
upstream DOM. The host replaces editor preferences and filesystem RPCs, supplies
simple icons, and uses minimal layout CSS and scroll dispatch. Other editor services,
worker startup plumbing and full renderer-worker bootstrap are not included. This
isolates the tree and is intentionally a different scope from the desktop benchmark.

Pierre uses the vanilla `FileTree` constructor and mounting API, including its
ordinary path preparation (not precomputed/prepared input), internal state, shadow DOM,
styles and built-in runtime. No adapter retains an extra fixture array solely for the observer after loading. File-type icon themes, search, Git integrations, and file
mutation features are disabled/unexercised. Component-specific overscan defaults are
preserved and DOM row counts are reported. Empty baselines help expose differing
fixed host costs, but subtraction cannot remove every integration difference.

React Arborist uses its controlled React `Tree` with the built-in virtualizer and a minimal
text node renderer. React and React DOM are included in its measured runtime. Headless Tree
uses `@headless-tree/core`, its synchronous data loader, item model and accessibility props,
with a minimal vanilla DOM host that renders every item. This is a specific nonvirtualized
integration, not a claim about all Headless Tree integrations; external virtualizers can
change its performance. jsTree uses its jQuery plugin, default worker parsing, and full DOM
rendering with minimal 22-pixel layout CSS. jQuery is included in its measured runtime.
All component and framework versions are pinned in the npm lockfile; source versions are
listed in each report. New runs record their implementation inventory, while historical
two-component reports remain readable. Every component gets the same five fresh trials
at each default size, including first/middle/last DOM probes.

A wide, flat directory is a stress case. Results do not generalize to deep trees,
collapsed/lazy subdirectories, searches, mutations, file contents, or other sizes.
Scrolling probes establish visibility and basic usability, not input latency.
This benchmark is maintained by LVCE and does not predetermine the winner.

## CI and evidence

Pull requests, main pushes and manual dispatch run the full
10,000-, 100,000-, 1,000,000-, 10,000,000- and 100,000,000-file / five-trial protocol on Ubuntu 24.04. Each implementation/file-count pair runs in its own job (25 parallel jobs, subject to runner availability),
with fail-fast disabled. A final job downloads all shards, validates their complete trial inventory,
source/fixture/dependency pins and protocol, then merges measurements and builds the report.
Host metadata and original JSON remain available per job; trial order is randomized within each job,
not globally across implementations. Missing jobs and harness failures still block publication.
A 10M or 100M job that cannot run records host feasibility evidence without discarding other trees
that completed that size. Unit tests cover fixture integrity,
statistics and invalid-report rejection. A Chromium integration test verifies that
worker allocations are included. Functional browser probes are part of every trial.
The generated report is also checked in Chromium. Main publishes GitHub Pages only
after all harness checks pass; component load failures remain visible outcomes. PRs publish downloadable artifacts without deploying.

Each workload writes `results/<file-count>/results.json`. To run an individual shard:

```sh
npm run fixture -- --files 100000
npm run benchmark -- --implementation lvce --files 100000 --output shards/lvce-100000
# After collecting all 25 shards under shards/:
npm run merge
npm run report
```

The merge requires all five implementations at all five default sizes. Each run uploads raw JSON, all successful/failed screenshots and the standalone
HTML report as a 90-day artifact. Pages includes JSON and screenshot downloads.
To update a source, change its exact version/commit and integrity pin together,
regenerate the npm lock when appropriate, and review a fresh comparison.
No component repository is modified by the benchmark.

References: [Pierre API](https://github.com/pierrecomputer/pierre/tree/main/packages/trees),
[CDP heap accounting](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage),
[CDP forced GC](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-collectGarbage),
[Playwright CDP sessions](https://playwright.dev/docs/api/class-cdpsession).

## 100-million-entry stress test

The 100M workload uses the same full-load protocol for all five trees: a flat,
synthetic listing from `file-00000000.txt` to `file-99999999.txt`, streamed in
bounded batches to a 3,800,000,001-byte JSON file. It does not create 100M real
files or replace the tree's input with a partial/lazy model. Allow at least 4 GB
of free disk per shard for this fixture, in addition to dependencies and artifacts.
Each CI shard has its own Ubuntu host and a 15-minute trial budget; five fresh
trials are planned, with the same empty baseline and readiness/GC requirements.

The original 100M CI experiment generated the complete fixture but all five trees
encountered `TypeError: Failed to fetch` while consuming the monolithic JSON body.
The input reader now parses streamed batches into a full array instead of asking
Chromium to buffer and decode the entire response at once. Transport errors remain
fatal; this does not reclassify a generic fetch error as a capacity result.

At this size the full entry array itself may exceed browser capacity before
a component receives its input. The adapters acknowledge `input` and `input-parsed`
to the observer server, including from LVCE's worker. Crashes, load timeouts and
explicit parser RangeErrors during `input` are labeled **Input/harness limit**,
not evidence that the tree cannot hold 100M entries. After parsing, capacity
failures apply to the component plus its adapter, not the standalone library.
Malformed JSON, HTTP failures and other harness errors still fail CI. No failed
trial gets a loaded-memory number. A whole-job timeout preserves checkpoints and
reports host feasibility, rather than selecting the trials that happened to finish.
Host RAM, browser version, fixture bytes/hash and per-trial failure stage are in
the downloadable JSON; these bounded outcomes do not establish minimum RAM or
promise success on larger hosts. A completed load must still pass first/middle/last
visibility checks, including the browser's scrolling limits, before measurement.
