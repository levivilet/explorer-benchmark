import type { PageBenchmark } from './types.ts'

declare global {
  interface Window {
    benchmark: PageBenchmark
    worker?: Worker
  }
}

export {}
