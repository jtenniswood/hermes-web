import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Baselines move only in reviewed changes, never with a mutable registry tag.
const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/upgrade-baseline.json', import.meta.url), 'utf8'))
if (!/^ghcr\.io\/jtenniswood\/hermes-web@sha256:[a-f0-9]{64}$/.test(baseline.image) || baseline.platform !== 'linux/amd64' || !/^[a-f0-9]{40}$/.test(baseline.wrapperRevision) || !/^[a-f0-9]{40}$/.test(baseline.rendererRevision)) throw new Error('Invalid reviewed upgrade baseline')
execFileSync('docker', ['pull', '--platform', baseline.platform, baseline.image], { stdio: 'inherit' })
