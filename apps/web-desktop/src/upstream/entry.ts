/** Evaluate upstream startup only after the caller prepares the browser bridge. */
export async function startUpstreamRenderer(): Promise<void> {
  await import('../../../desktop/src/main')
}
