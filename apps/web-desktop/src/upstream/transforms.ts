import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import registry from './compatibility-registry.json'
const fixtures = registry.filter(entry => entry.kind === 'renderer-transform')

function rewrite(code: string, id: string): { code: string; map: null } | null {

    const normalizedId = id.replaceAll('\\', '/').split('?')[0]
    if (normalizedId.endsWith('/desktop/src/app/gateway/hooks/use-gateway-boot.ts')) {
      // Browser profile selection scopes the sidebar; a background Bot socket
      // becoming ready must not replace an explicit user choice.
      const target = `onActiveRouteChanged: profile => {
        const key = normalizeProfileKey(profile)`
      const patched = code.replace(target, `${target}
        if (window.__HERMES_WEB_BRIDGE__ && window.__HERMES_WEB_ACTIVE_PROFILE__) {
          return
        }`)
      if (patched === code) throw new Error('Browser profile commit guard no longer matches gateway boot')
      return { code: patched, map: null }
    }
    if (normalizedId.endsWith('/desktop/src/components/boot-failure-overlay.tsx')) {
      let patched = code.replace("  if (view === 'connect') {", `
  if (window.__HERMES_WEB_BRIDGE__) {
    actions = [settingsAction, { ...retryAction, variant: 'secondary', onClick: () => {
      setBusy('retry')
      void window.hermesDesktop.applyConnectionConfig({ mode: 'remote' })
        .catch(error => notifyError(error, 'Could not reconnect'))
        .finally(() => setBusy(null))
    } }]
    hint = 'Sign in to the configured gateway, or retry when it is available. The browser app does not run a local backend.'
  }
  if (view === 'connect') {`)
      patched = patched.replace(
        '<Button onClick={openLogs} variant="ghost">',
        '{!window.__HERMES_WEB_BRIDGE__ && <Button onClick={openLogs} variant="ghost">'
      ).replace('{copy.openLogs}\n              </Button>', '{copy.openLogs}\n              </Button>}')
      return { code: patched, map: null }
    }

    if (normalizedId.endsWith('/desktop/src/store/composer.ts')) {
      return { map: null, code: code + `
// Browser update safety: flush the existing composers, then inspect upstream's stash.
window.__HERMES_WEB_DRAFT_SNAPSHOT__ = () => {
  window.__HERMES_WEB_DRAFT_BLOCKED__ = false
  requestComposerDraftSync('flush', 'web-all')
  return {
    blocked: window.__HERMES_WEB_DRAFT_BLOCKED__,
    storageKey: SESSION_DRAFTS_STORAGE_KEY,
    texts: Object.fromEntries([...draftsBySession].filter(([, draft]) => draft.text).map(([key, draft]) => [key, draft.text])),
    attachments: $composerAttachments.get().length + [...draftsBySession.values()].reduce((count, draft) => count + draft.attachments.length, 0)
  }
}
` }
    }
    if (normalizedId.endsWith('/desktop/src/app/chat/composer/hooks/use-composer-draft.ts')) {
      return { map: null, code: code.replace(
        'onComposerDraftSyncRequest(({ mode, target: requested }) => {',
        `onComposerDraftSyncRequest(({ mode, target: requested }) => {
        if (requested === 'web-all') {
          if (queueEditStateRef.current || isBrowsingHistory(sessionIdRef.current)) {
            window.__HERMES_WEB_DRAFT_BLOCKED__ = true
          } else {
            syncDraftRef.current(mode)
          }
          return
        }`
      ) }
    }


    if (normalizedId.endsWith('/apps/desktop/src/sdk/index.ts') || normalizedId.endsWith('/desktop/src/sdk/index.ts')) {
      const retryableMarker = code.indexOf('const retryable')
      const throwError = retryableMarker < 0 ? -1 : code.indexOf('throw error', retryableMarker)
      const patched =
        throwError < 0
          ? code
          : `${code.slice(0, throwError)}if (options.workspaceMode === 'bots' && error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {\n              return\n            }\n            ${code.slice(throwError)}`

      const scoped = patched.replace(
        /if \(!openingStillCurrent\(\)\) \{/g,
        "if (!openingStillCurrent() && !(window.__HERMES_WEB_BRIDGE__ && options.workspaceMode === 'bots')) {"
      )
      const profileCommit = '      if (explicitRoute) {\n        setShowAllProfiles(true)'
      if (scoped.split(profileCommit).length !== 2) throw new Error('Browser Bot profile scope commit changed')
      const webPatched = scoped.replace(profileCommit, `      if (window.__HERMES_WEB_BRIDGE__ && window.__HERMES_WEB_ACTIVE_PROFILE__) {
        setShowAllProfiles(false)
      } else if (explicitRoute) {
        setShowAllProfiles(true)`)

      if (patched === code) {
        throw new Error('Bot Mode cancellation override no longer matches the SDK source')
      }

      return { code: webPatched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/store/gateway.ts') ||
      normalizedId.endsWith('/desktop/src/store/gateway.ts')
    ) {
      const agentStart = code.indexOf('export async function ensureGatewayForAgent')
      const scopeMarker = 'const scope = registryBackendScopeKey(connectionId, profile)'
      const scopeMarkerStart = agentStart < 0 ? -1 : code.indexOf(scopeMarker, agentStart)
      const agentPatched =
        scopeMarkerStart < 0
          ? code
          : `${code.slice(0, scopeMarkerStart + scopeMarker.length)}
  if (window.__HERMES_WEB_BRIDGE__) {
    return !signal?.aborted
  }
${code.slice(scopeMarkerStart + scopeMarker.length)}`

      if (agentStart < 0 || scopeMarkerStart < 0) {
        throw new Error('Web agent activation fast path no longer matches the renderer source')
      }

      const patched = agentPatched.replace(
        /async function sharedPrimaryRoute[\s\S]*?\{/,
        `$&
  if (window.__HERMES_WEB_BRIDGE__) {
    return true
  }`
      )

      if (patched === agentPatched) {
        throw new Error('Web shared-primary route no longer matches the renderer source')
      }

      return { code: patched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/store/profile.ts') ||
      normalizedId.endsWith('/desktop/src/store/profile.ts')
    ) {
      const selectStart = code.indexOf('function selectProfile')
      const targetMarker = 'const target = normalizeProfileKey(name)'
      const targetStart = selectStart < 0 ? -1 : code.indexOf(targetMarker, selectStart)
      const targetEnd = targetStart < 0 ? -1 : targetStart + targetMarker.length
      const patched =
        targetStart < 0
          ? code
          : `${code.slice(0, targetEnd)}
  if (window.__HERMES_WEB_BRIDGE__) {
    window.__HERMES_WEB_ACTIVE_PROFILE__ = target
    return batch(() => {
      $showAllProfiles.set(false)
      $activeGatewayProfile.set(target)
    })
  }
${code.slice(targetEnd)}`

      if (selectStart < 0 || targetStart < 0) {
        if (code.includes('__HERMES_WEB_ACTIVE_PROFILE__ = target')) {
          return { code, map: null }
        }

        throw new Error('Web profile selection scope no longer matches the renderer source')
      }

      const commits = patched.split('\n    batch(() => {')
      if (commits.length !== 3) throw new Error('Browser profile publication guards no longer match profile activation')
      return { code: commits.join(`
    if (window.__HERMES_WEB_BRIDGE__ && window.__HERMES_WEB_ACTIVE_PROFILE__ && window.__HERMES_WEB_ACTIVE_PROFILE__ !== target) {
      return
    }
    batch(() => {`), map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/plugins/hermes-bots/roster-actions.ts') ||
      normalizedId.endsWith('/desktop/src/plugins/hermes-bots/roster-actions.ts')
    ) {
      const withoutStaleFront = code.replace(/const fronted = focusExistingBotTab\(bot\)/, 'const fronted = null')
      const notifyStart = withoutStaleFront.lastIndexOf('notifyBotOpenFailure(error, bot,')
      const lineStart = notifyStart < 0 ? -1 : withoutStaleFront.lastIndexOf('\n', notifyStart) + 1
      const patched =
        lineStart < 0
          ? withoutStaleFront
          : `${withoutStaleFront.slice(0, lineStart)}      if (error instanceof Error && error.message === 'Session open was superseded by a newer selection.') {
        return false
      }

${withoutStaleFront.slice(lineStart)}`

      return { code: patched, map: null }
    }

    if (
      normalizedId.endsWith('/apps/desktop/src/app/session/hooks/use-session-list-actions.ts') ||
      normalizedId.endsWith('/desktop/src/app/session/hooks/use-session-list-actions.ts')
    ) {
      const patched = code
        .replaceAll(
          'sidebarProfileForScope(profileScopeRef.current)',
          "sidebarProfileForScope(window.__HERMES_WEB_BRIDGE__ ? (window.__HERMES_WEB_ACTIVE_PROFILE__ ?? profileScopeRef.current) : profileScopeRef.current)"
        )
        .replaceAll(
          'sidebarProfileForScope(profileScope)',
          "sidebarProfileForScope(window.__HERMES_WEB_BRIDGE__ ? (window.__HERMES_WEB_ACTIVE_PROFILE__ ?? profileScope) : profileScope)"
        )
        .replaceAll(
          'gatewayActivationEpoch() !== activationEpoch',
          '!window.__HERMES_WEB_BRIDGE__ && gatewayActivationEpoch() !== activationEpoch'
        )
        .replaceAll(
          'gatewayActivationEpoch() === activationEpoch',
          '(window.__HERMES_WEB_BRIDGE__ || gatewayActivationEpoch() === activationEpoch)'
        )
      const refreshed = patched.replace(
          /const loadMoreSessions\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{/,
          `  useEffect(() => {
    if (window.__HERMES_WEB_BRIDGE__) {
      void refreshSessions().catch(() => undefined)
    }
  }, [profileScope, refreshSessions])

  const loadMoreSessions = useCallback(async () => {`
      )

      if (refreshed === patched) {
        throw new Error('Web profile session refresh hook no longer matches the renderer source')
      }

      return { code: refreshed, map: null }
    }

    if (
      !normalizedId.endsWith('/apps/desktop/src/plugins/hermes-bots/canonical-chat.ts') &&
      !normalizedId.endsWith('/desktop/src/plugins/hermes-bots/canonical-chat.ts')
    ) {
      return null
    }

    // The desktop shell activates a profile-scoped agent before Bot Mode RPCs.
    // The web bridge already rides one shared gateway socket, so that extra
    // registry activation can create a second, non-landing socket and leave
    // the click waiting forever. Keep the web path on the shared socket.
    const botCode = code.replace(
      /if \(!route && typeof host\.ensureAgent === ['"]function['"]\) \{/,
      'if (false) {'
    )
    const webScopedBotCode = botCode.replace(
      /const \{ bot, name, route \} = botOwner\(owner\);?\s+const ownerKey = botWorkspaceOwnerKey\(bot\);?/,
      `let { bot, name, route } = botOwner(owner)
  if (window.__HERMES_WEB_BRIDGE__ && !route) {
    route = { connectionId: 'web-single', mode: 'remote', profile: name, targetProfile: name }
  }
  const ownerKey = botWorkspaceOwnerKey(bot)`
    )

    if (webScopedBotCode === botCode) {
      throw new Error('Bot Mode web owner route no longer matches the renderer source')
    }
    const webCanonicalLookup = webScopedBotCode
      .replace(
        'awaitHydration: true,',
        'awaitHydration: window.__HERMES_WEB_BRIDGE__ ? false : true,'
      )
      .replace(
        /res = await requestForBot\(bot, ['"]session\.list['"], \{\s*profile: backendTargetProfile\(route, name\),\s*title: CANONICAL_CHAT_TITLE,\s*limit: PROFILE_SESSION_LIST_LIMIT,\s*include_hidden: true\s*\}\)/,
        `res = await (async () => {
          const desktop = typeof window !== 'undefined' ? window.hermesDesktop : null
          const api = desktop?.api

          if (window.__HERMES_WEB_BRIDGE__ && bot?.canonical_session?.id) {
            return {
              sessions: [{
                ...bot.canonical_session,
                title: CANONICAL_CHAT_TITLE
              }]
            }
          }

          if (window.__HERMES_WEB_BRIDGE__ && typeof api === 'function') {
            const response = await api({
              path: '/api/profiles/sessions?limit=200&offset=0&min_messages=0&archived=exclude&order=created&include_hidden=true&title=Bot%20Chat',
              profile: backendTargetProfile(route, name)
            })

            return Array.isArray(response) ? { sessions: response } : response
          }

          return requestForBot(bot, 'session.list', {
            profile: backendTargetProfile(route, name),
            title: CANONICAL_CHAT_TITLE,
            limit: PROFILE_SESSION_LIST_LIMIT,
            include_hidden: true
          })
        })()`
      )
    const startMatch = /(?:export\s+)?async function openBotCanonicalChat\s*\(/.exec(webCanonicalLookup)
    const start = startMatch?.index ?? -1
    const end = start < 0 ? -1 : webCanonicalLookup.slice(start).search(/(?:export\s+)?async function prepareBotSource/) + start
    if (start < 0 || end < start) {
      return null
    }

    const functionSource = webCanonicalLookup
      .slice(start, end)
      .replace(/(?:export\s+)?async function openBotCanonicalChat\s*\(/, 'async function openBotCanonicalChatImpl(')
    const wrapper = `${functionSource}\n\nexport async function openBotCanonicalChat(owner, openingStillCurrent = null) {\n  const { key } = botOwner(owner)\n  const pending = canonicalChatOpens.get(key)\n\n  if (pending) {\n    return pending\n  }\n\n  const run = openBotCanonicalChatImpl(owner, null)\n  canonicalChatOpens.set(key, run)\n  const clear = () => {\n    if (canonicalChatOpens.get(key) === run) {\n      canonicalChatOpens.delete(key)\n    }\n  }\n  run.then(clear, clear)\n\n  return run\n}\n`
    const transformed = `${webCanonicalLookup.slice(0, start)}const canonicalChatOpens = new Map()\n\n${wrapper}${webCanonicalLookup.slice(end)}`

    const guarded = transformed.replace(
      `  if (pending) {
    return pending
  }`,
      `  if (pending) {
    try {
      return await pending
    } catch (error) {
      const current = typeof openingStillCurrent === 'function' && openingStillCurrent()
      const superseded = /superseded by a newer selection/i.test(String(error?.message || error))

      if (!current || !superseded) {
        throw error
      }
    }
  }`
    )

    const retried = guarded.replace(
      `  const run = openBotCanonicalChatImpl(owner, null)
  canonicalChatOpens.set(key, run)`,
      `  const run = openBotCanonicalChatImpl(owner, null).catch(async error => {
    const superseded = /superseded by a newer selection/i.test(String(error?.message || error))

    if (!superseded) {
      throw error
    }

    return openBotCanonicalChatImpl(owner, null)
  })
  canonicalChatOpens.set(key, run)`
    )

    if (retried === guarded) {
      throw new Error('Bot Mode open-race guard no longer matches the generated wrapper')
    }

    if (retried === code) {
      throw new Error('Bot Mode open-race override no longer matches the renderer source')
    }

    return { code: retried, map: null }
}

export const compatibilityTransforms = fixtures
export function transformRenderer(code: string, id: string): { code: string; map: null } | null {
  const normalized = id.replaceAll('\\', '/').split('?')[0]
  const fixture = fixtures.find(item => normalized.endsWith('/desktop/src/' + item.module))
  if (!fixture) return null
  const marker = '// hermes-web-compatibility:' + fixture.name + '\n'
  if (code.startsWith(marker)) {
    if (digest(code.slice(marker.length)) !== fixture.outputHash) throw new Error(`Modified compatibility output: ${fixture.name}`)
    return { code, map: null }
  }
  if (digest(code) !== fixture.sourceHash) throw new Error(`Renderer compatibility changed: ${fixture.name} (${fixture.module}). Review this transform before updating its fixture.`)
  const result = rewrite(code, normalized)
  if (!result || result.code === code || digest(result.code) !== fixture.outputHash) {
    throw new Error(`Incomplete renderer compatibility transform: ${fixture.name}`)
  }
  return { code: marker + result.code, map: null }
}

function digest(code: string): string { return createHash('sha256').update(code).digest('hex') }

export function rendererCompatibilityPlugin(root: string): Plugin {
  return {
    name: 'hermes:renderer-compatibility',
    enforce: 'pre',
    buildStart() {
      for (const fixture of fixtures) transformRenderer(readFileSync(path.join(root, fixture.module!), 'utf8'), path.join(root, fixture.module!))
    },
    transform: transformRenderer
  }
}
