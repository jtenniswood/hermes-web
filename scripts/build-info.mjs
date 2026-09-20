import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { rendererLock, repositoryRoot } from './renderer.mjs'

export function buildInfo(env = process.env) {
  let wrapperRevision = env.HERMES_WRAPPER_REV
  if (!wrapperRevision) {
    try { wrapperRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim() }
    catch { wrapperRevision = 'unknown' }
  }
  return {
    wrapperRevision,
    rendererRevision: rendererLock().rev,
    dependencyLockHash: createHash('sha256').update(readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'))).digest('hex'),
    builtAt: new Date(env.SOURCE_DATE_EPOCH ? Number(env.SOURCE_DATE_EPOCH) * 1000 : Date.now()).toISOString(),
    channel: env.HERMES_RELEASE_CHANNEL || 'development'
  }
}

export function buildInfoPlugin() {
  const info = buildInfo()
  return {
    name: 'hermes:build-info',
    config: () => ({ define: { __HERMES_BUILD_INFO__: JSON.stringify(info) } }),
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(info, null, 2) + '\n' }) }
  }
}
