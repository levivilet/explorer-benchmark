export function exitOnTermination() {
  // Run before launching Chromium: Playwright's signal handler only closes the
  // browser. process.exit also runs its synchronous process-tree cleanup hooks.
  process.once('SIGTERM', () => process.exit(143))
  process.once('SIGINT', () => process.exit(130))
}
