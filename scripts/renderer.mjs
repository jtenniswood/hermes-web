import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
export function rendererLock(root = repositoryRoot) {
  const locked = JSON.parse(readFileSync(path.join(root, 'flake.lock'), 'utf8')).nodes.hermes.locked
  if (locked.type !== 'github' || locked.owner !== 'NousResearch' || locked.repo !== 'hermes-agent' || !/^[a-f0-9]{40}$/.test(locked.rev)) {
    throw new Error('flake.lock must identify an exact NousResearch/hermes-agent commit')
  }
  return locked
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const present = p => { try { lstatSync(p); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

export function verifyRenderer(root = repositoryRoot) {
  const { rev } = rendererLock(root)
  for (const name of ['desktop', 'shared']) {
    const source = path.join(root, 'apps', name)
    if (!existsSync(source)) throw new Error(`Missing apps/${name}; run pnpm prepare:renderer`)
    let actual
    try {
      actual = git(realpathSync(source), 'rev-parse', 'HEAD')
      if (git(realpathSync(source), 'status', '--porcelain', '--', '.')) throw new Error('Renderer has local changes')
    } catch (error) {
      throw new Error(`Cannot verify apps/${name}: ${error.message}. Existing sources were not changed.`)
    }
    if (actual !== rev) throw new Error(`apps/${name} uses ${actual}; flake.lock requires ${rev}. Existing sources were not changed.`)
  }
  return rev
}

export function prepareRenderer(root = repositoryRoot) {
  const { rev } = rendererLock(root)
  const names = ['desktop', 'shared']
  const existing = names.filter(name => present(path.join(root, 'apps', name)))
  // Validate every existing path before creating anything. Never replace a checkout or symlink.
  for (const name of existing) {
    const source = path.join(root, 'apps', name)
    let actual
    try { actual = git(realpathSync(source), 'rev-parse', 'HEAD') } catch { throw new Error(`Cannot verify apps/${name}; existing path was not changed`) }
    if (actual !== rev || git(realpathSync(source), 'status', '--porcelain', '--', '.')) {
      throw new Error(`apps/${name} does not contain clean renderer ${rev}; existing path was not changed`)
    }
  }
  if (existing.length === names.length) return verifyRenderer(root)
  const checkout = path.join(root, '.renderer', rev)
  if (!existsSync(checkout)) {
    mkdirSync(checkout, { recursive: true })
    git(checkout, 'init', '-q')
    git(checkout, 'remote', 'add', 'origin', 'https://github.com/NousResearch/hermes-agent.git')
  }
  let actual
  try { actual = git(checkout, 'rev-parse', 'HEAD') } catch { /* A previous fetch may have failed. */ }
  if (!actual) {
    git(checkout, 'fetch', '--depth', '1', 'origin', rev)
    git(checkout, 'checkout', '--detach', 'FETCH_HEAD')
  }
  if (git(checkout, 'rev-parse', 'HEAD') !== rev || git(checkout, 'status', '--porcelain')) throw new Error('Cached renderer is not clean; it was not replaced')
  mkdirSync(path.join(root, 'apps'), { recursive: true })
  for (const name of names.filter(name => !existing.includes(name))) {
    symlinkSync(path.relative(path.join(root, 'apps'), path.join(checkout, 'apps', name)), path.join(root, 'apps', name))
  }
  return verifyRenderer(root)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(process.argv.includes('--revision') ? rendererLock().rev : process.argv.includes('--check') ? verifyRenderer() : prepareRenderer())
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
