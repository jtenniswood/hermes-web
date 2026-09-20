import type { Plugin } from 'vite'
import type { BuildInfo } from '../apps/web-desktop/src/build-info'
export function buildInfo(env?: NodeJS.ProcessEnv): BuildInfo
export function buildInfoPlugin(): Plugin
