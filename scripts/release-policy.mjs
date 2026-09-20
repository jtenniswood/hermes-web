import { isDeepStrictEqual } from 'node:util'

export function assertRendererOnlyChange(before, after, files = ['flake.lock']) {
  if (files.length !== 1 || files[0] !== 'flake.lock') throw new Error('Renderer updates may change only flake.lock')
  const previous = structuredClone(before), next = structuredClone(after)
  const pin = next.nodes?.hermes?.locked
  if (pin?.type !== 'github' || pin.owner !== 'NousResearch' || pin.repo !== 'hermes-agent' || !/^[a-f0-9]{40}$/.test(pin.rev) || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(pin.narHash) || !Number.isSafeInteger(pin.lastModified) || pin.lastModified <= 0) throw new Error('Invalid exact renderer metadata')
  if (pin.rev === previous.nodes?.hermes?.locked?.rev) throw new Error('Renderer revision did not change')
  for (const key of ['rev', 'narHash', 'lastModified']) {
    delete previous.nodes.hermes.locked[key]
    delete next.nodes.hermes.locked[key]
  }
  if (!isDeepStrictEqual(previous, next)) throw new Error('An update changed more than the renderer lock metadata')
}

export function promotionTags({ sourceRevision, currentMain, ref, nightly = false }) {
  if (!/^[a-f0-9]{40}$/.test(sourceRevision) || sourceRevision !== currentMain) throw new Error('Stale release: source is no longer current main')
  if (ref === 'refs/heads/main') return ['main', 'latest', ...(nightly ? ['nightly'] : [])]
  if (/^refs\/tags\/v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(ref)) return [ref.slice('refs/tags/v'.length)]
  throw new Error('Only main or a version tag can be promoted')
}

export function assertCandidateEvidence(evidence, wrapper, renderer) {
  for (const arch of ['amd64', 'arm64']) {
    const record = evidence.find(item => item.arch === arch)
    if (!record || record.wrapper !== wrapper || record.renderer !== renderer || record.tested !== true || !/^sha256:[a-f0-9]{64}$/.test(record.digest)) throw new Error(`Missing tested ${arch} candidate for this exact wrapper and renderer`)
  }
  if (evidence.length !== 2) throw new Error('Unexpected candidate evidence')
}
