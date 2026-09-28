import type { Browser, Page } from 'playwright'

export type Implementation = 'lvce' | 'pierre' | 'arborist' | 'headless' | 'jstree'
export type TrialStatus = 'running' | 'passed' | 'failed' | 'unsupported'

export interface FixtureManifest {
  count: number
  shape: 'flat'
  source: 'synthetic-json'
  fileBytes: number
  nameWidth: number
  first: string
  last: string
  sha256: string
  jsonBytes: number
}

export interface HeapUsage {
  usedSize: number
  totalSize?: number
  backingStorageSize?: number
  embedderHeapUsedSize?: number
}

export interface Isolate extends HeapUsage {
  id: string
  targets: Array<{ targetId: string; type: string }>
}

export interface HeapMeasurement extends HeapUsage {
  isolates: Isolate[]
}

export interface TrialPhase {
  readinessMs: number
  natural: HeapMeasurement
  retained: HeapMeasurement[]
  usedSize: { median: number; min: number; max: number }
  dom: { documents: number; nodes: number; jsEventListeners: number }
  renderedRows: number
}

export interface ComponentFailure {
  message: string
  type?: string
  code?: string
  count?: number
  stack?: string
  stage?: string
  scope?: string
}

export interface Trial {
  implementation: Implementation
  repeat: number
  status: TrialStatus
  phases: Partial<Record<'empty' | 'loaded', TrialPhase>>
  chromium?: string
  deltaUsedSize?: number
  componentFailure?: ComponentFailure
  error?: string
  consoleErrors?: string[]
  screenshots?: Record<string, string>
  screenshotErrors?: string[]
  cleanupError?: string
}

export interface Protocol {
  implementations: Implementation[]
  loadTimeoutMs: number
  files: number
  repeats: number
  samples: number
  seed: number
  viewport: { width: number; height: number }
  tree: { width: number; height: number; rowHeight: number }
  settleMs: number
  sampleIntervalMs: number
  order?: Array<{ implementation: Implementation; repeat: number }>
  metric?: string
  gc?: string
  execution?: string
}

export interface BenchmarkReport {
  schemaVersion: number
  date: string
  mode: 'comparison' | 'smoke'
  sources: Record<string, Record<string, string>>
  packageLockSha256: string
  fixture: FixtureManifest
  protocol: Protocol
  host: Record<string, unknown>
  commit: string | null
  runUrl: string | null
  trials: Trial[]
  unavailable?: Partial<Record<Implementation, Feasibility>>
  shards?: unknown[]
}

export interface Feasibility {
  files: number
  status: 'infeasible'
  code?: string
  reason: string
  details: Record<string, unknown>
}

export interface ReportGroup {
  unavailable?: boolean
  failures?: number
  repeats?: number
  messages: string[]
  empty?: Summary
  loaded?: Summary
  delta?: Summary
}

export interface Summary {
  median: number
  min: number
  max: number
}

export interface BenchmarkServer {
  progress: { stage: string }
  url: string
  close: () => Promise<void>
}

export interface TrialDependencies {
  report: BenchmarkReport
  manifest: FixtureManifest
  server: BenchmarkServer
  output: string
  launchBrowser?: () => Promise<Browser>
}

export interface PageBenchmark {
  load: (state: 'empty' | 'loaded') => Promise<LoadResult>
  scroll: (index: number) => Promise<unknown>
}

export interface LoadResult {
  count: number
  first?: string
  last?: string
  dom?: unknown
  componentFailure?: ComponentFailure
}

export type EvaluateFunction = (page: Page, argument?: unknown, timeoutMs?: number) => Promise<unknown>
