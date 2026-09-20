import { writeFileSync } from 'node:fs'
const { ARCH: arch, WRAPPER: wrapper, RENDERER: renderer, DIGEST: digest } = process.env
if (!['amd64', 'arm64'].includes(arch) || !/^[a-f0-9]{40}$/.test(wrapper) || !/^[a-f0-9]{40}$/.test(renderer) || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid candidate identity')
writeFileSync(`candidate-${arch}.json`, JSON.stringify({ arch, wrapper, renderer, digest, tested: true }) + '\n')
