import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { fileURLToPath } from 'node:url'
import { createFaultControls } from './faults.mjs'

/** Deterministic review backend. No model provider, external API or real user data. */
export function createPreviewGateway({ log = () => {}, delay = 95, strict = false } = {}) {
  const controls = createFaultControls()
  const now = () => Math.floor(Date.now() / 1000)
  const info = { desktop_contract: 7, model: 'hermes-preview', provider: 'custom', version: 'synthetic-preview-v1', cwd: '/workspace', tools: {}, skills: [], reasoning_effort: 'medium' }
  const modelOptions = { model: info.model, provider: 'custom', providers: [{ slug: 'custom', name: 'Preview', models: [info.model], authenticated: true, is_current: true, capabilities: { [info.model]: { fast: false, reasoning: false } } }] }
  const profiles = [
    { name: 'default', display_name: 'Hermes', description: 'Your everyday assistant', is_default: true, model: info.model },
    { name: 'research', display_name: 'Research', description: 'Explore questions and connect ideas', model: info.model },
    { name: 'writer', display_name: 'Writer', description: 'Shape rough notes into clear writing', model: info.model }
  ]
  const skills = [{ name: 'preview-planning', category: 'Productivity', description: 'A synthetic planning skill for interface review.', enabled: true, provenance: 'bundled' }]
  const toolsets = [{ name: 'preview', label: 'Preview tools', description: 'Synthetic tools; no external services are called.', enabled: true, configured: true, tools: ['preview_note'] }]
  const platforms = [{ id: 'discord', name: 'Discord', description: 'Synthetic preview only. No external messages are sent.', docs_url: '', enabled: false, configured: true, env_vars: [], gateway_running: true, state: 'disabled' }]
  const sessions = new Map(), messages = new Map(), timers = new Map(), clients = new Set(), approvalModes = new Map()
  let count = 0
  function addSession(id, title, profile = 'default', text = '') {
    const rows = text ? [{ id: `${id}-u`, role: 'user', content: 'Help me make a thoughtful plan.', timestamp: now() - 60 }, { id: `${id}-a`, role: 'assistant', content: text, timestamp: now() - 40 }] : []
    const session = { id, title, profile, source: 'desktop', created_at: now() - 3600, started_at: now() - 3600, last_active: now(), ended_at: null, is_active: false, model: info.model, message_count: rows.length, input_tokens: 48, output_tokens: 120, cwd: '/workspace', hidden: title === 'Bot Chat' }
    sessions.set(id, session); messages.set(id, rows); return session
  }
  addSession('preview-week', 'Plan a calmer working week', 'default', '## A little more room to think\n\nStart with three things that matter most this week. Give each one a clear block of time, and leave some space between meetings.\n\n- **Monday:** choose priorities and protect focus time.\n- **Midweek:** check what changed and adjust.\n- **Friday:** close loose ends and write down what worked.\n\nWhat would you like to make more time for?')
  addSession('preview-idea', 'Explore a product idea', 'default', 'A useful starting point is one person, one problem, and one small experiment. Tell me what you have in mind and we can turn it into a testable idea.')
  addSession('preview-research', 'Bot Chat', 'research', 'I can help you investigate a question, compare approaches, and organize your findings. What are you curious about?')
  addSession('preview-writer', 'Bot Chat', 'writer', 'Bring a rough outline or a first draft. We can work on its structure, clarity, and voice together.')
  const roster = () => profiles.map(profile => ({ ...profile, running: false, session_count: 1, canonical_session: profile.name === 'default' ? null : sessions.get(`preview-${profile.name}`), last_session: profile.name === 'default' ? sessions.get('preview-week') : sessions.get(`preview-${profile.name}`) }))
  const page = (profile = 'all', all = false, archived = 'exclude') => {
    const rows = [...sessions.values()].filter(row => (archived === 'include' || Boolean(row.archived) === (archived === 'only')) && (all || !row.hidden) && (profile === 'all' || row.profile === profile))
    return { sessions: rows, total: rows.length, has_more: false, limit: 40, offset: 0 }
  }
  function event(type, id, payload = {}) {
    const frame = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: id, payload, timestamp: Date.now() } })
    for (const client of clients) if (client.readyState === 1) client.send(frame)
  }
  function snapshot(id) {
    const session = sessions.get(id) || addSession(id, 'New conversation')
    return { session_id: id, resumed: id, stored_session_id: id, messages: messages.get(id), message_count: messages.get(id).length, info: { ...info, profile: session.profile }, running: timers.has(id), pending_approval: null, open_requests: [], inflight: null }
  }
  function complete(id, status = 'complete', text = '') {
    clearInterval(timers.get(id)); timers.delete(id)
    if (text) messages.get(id)?.push({ id: `${id}-${Date.now()}`, role: 'assistant', content: text, timestamp: now() })
    const session = sessions.get(id)
    if (session) { session.is_active = false; session.message_count = messages.get(id).length }
    event('message.complete', id, { text, status, usage: { input_tokens: 48, output_tokens: 75 } })
    event('sessions.changed', null, {})
  }
  function rpc(method, params = {}, profile = 'default') {
    log('RPC', method)
    const id = params.session_id || params.id
    if (method === 'session.control.read') return { control: { goal: null, loop: null, heartbeat: null, revision: '', updated_at: 0 } }
    if (method === 'model.options') return modelOptions
    if (method === 'setup.status') return { provider_configured: true, ready: true, inference_provider: 'custom' }
    if (method === 'setup.runtime_check') return { ok: true, provider: 'custom', model: info.model, source: 'config' }
    if (method === 'session.active_list') return { sessions: [...sessions.values()].filter(s => s.is_active) }
    if (method === 'commands.catalog') return { commands: [] }
    if (method === 'plugins.manage' && params.action === 'list') return { plugins: [] }
    if (method === 'ping') return { pong: true }
    // Explicit optional startup probes from the pinned renderer. These have no
    // provider, running process, local pet, or speech service in the fixture.
    if (method === 'free_tier.status') return { has_guest: false, enabled: false, available: false }
    if (method === 'wake.status') return { available: false, enabled: false, listening: false }
    if (method === 'pet.info' || method === 'pet.info.meta') return { enabled: false, active: '', spritesheet: null }
    if (method === 'subagent.list') return { subagents: [] }
    if (method === 'process.list') return { processes: [] }
    if (method === 'complete.path') return { items: [] }
    if (method === 'complete.slash' && typeof params.text === 'string' && params.text.startsWith('/')) return { items: [], replace_from: 1 }
    if (method === 'profiles.set_asset' && params.asset === 'avatar') return { ok: true }
    if (method === 'image.generate') throw new Error('Image generation is unavailable in the synthetic gateway')
    if (method === 'config.get' && params.key === 'approvals.mode') return { value: approvalModes.get(profile) || 'smart' }
    if (method === 'config.set' && params.key === 'approvals.mode') {
      if (!['manual', 'smart', 'off'].includes(params.value)) throw new Error('Invalid approval mode')
      approvalModes.set(profile, params.value)
      return { value: params.value }
    }
    if (method === 'profiles.list') return { profiles: roster(), bot_mode_protocol: true }
    if (method === 'profiles.configure' && params.name === 'default' && Object.keys(params.ui_meta || {}).length === 1 && params.ui_meta['hermes-bots-groups']) {
      const snapshot = params.ui_meta['hermes-bots-groups']
      if (snapshot.version !== 3 || !snapshot.rooms || typeof snapshot.rooms !== 'object' || Array.isArray(snapshot.rooms)) throw new Error('Invalid group room projection')
      const owner = profiles.find(item => item.name === 'default')
      owner.ui_meta = { ...owner.ui_meta, 'hermes-bots-groups': structuredClone(snapshot) }
      return { applied: { ui_meta: true } }
    }
    if (method === 'profiles.configure' && Object.keys(params.ui_meta || {}).length === 1 && params.ui_meta['hermes-bots']) {
      const owner = profiles.find(item => item.name === params.name)
      const metadata = params.ui_meta['hermes-bots']
      if (!owner || !Array.isArray(metadata.groups) || metadata.groups.some(group => typeof group !== 'string')) throw new Error('Invalid Bot group membership')
      owner.ui_meta = { ...owner.ui_meta, 'hermes-bots': structuredClone(metadata) }
      return { applied: { ui_meta: true } }
    }
    if (method === 'session.list') return page(params.profile || 'all', true)
    if (method === 'session.resume' || method === 'session.activate') return snapshot(id)
    if (method === 'session.usage') return { calls: 1, input: 48, output: 120, total: 168 }
    if (method === 'projects.tree') return { projects: [], active_id: null, scoped_session_ids: [] }
    if (method === 'session.create') {
      const session = addSession(`preview-new-${++count}`, params.title || 'New conversation', params.profile || 'default')
      event('sessions.changed', null, {})
      return { session_id: session.id, stored_session_id: session.id, info, ...session, messages: [] }
    }
    if (method === 'config.get' || method === 'model.info') return { ...info, model: info.model, provider: 'custom', config: { model: { default: info.model, provider: 'custom' }, display: {} } }
    if (method === 'profiles.get') return { ...profiles.find(p => p.name === params.name), config: { model: { default: info.model } } }
    if (method === 'pet.gallery') return { enabled: false, active: '', pets: [] }
    if (method === 'prompt.submit') {
      if (!sessions.has(id)) addSession(id, 'New conversation')
      messages.get(id).push({ id: `${id}-${Date.now()}`, role: 'user', content: params.text || '', timestamp: now() })
      const session = sessions.get(id); session.is_active = true; session.last_active = now()
      if (session.title === 'New conversation') session.title = (params.text || 'New conversation').slice(0, 48)
      const text = 'This is a synthetic response for the interface preview. Your message reached the shared Hermes chat engine and its normal streaming flow.\n\nTry reopening this conversation, switching between Sessions and Bots, or changing the Experience after this response finishes. No external model was called.'
      const parts = text.match(/.{1,9}|\n/g) || [text]
      let index = 0, sent = ''
      setTimeout(() => event('message.start', id, { role: 'assistant' }), 20)
      const timer = setInterval(() => {
        if (index >= parts.length) { complete(id, 'complete', sent); return }
        const piece = parts[index++]; sent += piece; event('message.delta', id, { text: piece })
      }, delay)
      timers.set(id, timer)
      return { status: 'accepted', session_id: id }
    }
    if (/cancel|interrupt/.test(method)) { complete(id, 'interrupted', 'Response cancelled.'); return { ok: true } }
    if (method === 'file.attach') {
      if (!sessions.has(id) || !params.name || !params.data_url) throw new Error('File attachment requires a session, name, and bytes')
      return { attached: true, ref_text: `@file:/workspace/${params.name}`, path: `/workspace/${params.name}` }
    }
    if (method === 'session.attach') return { ok: true, path: `/workspace/${params.filename || 'attachment'}` }
    if (method === 'session.rename' && sessions.has(id)) { sessions.get(id).title = params.title; return { ok: true, title: params.title } }
    if (method === 'session.close') return { ok: true }
    if (method === 'events.replay') return { events: [], cursor: 0 }
    if (strict) return controls.unknown({ transport: 'rpc', method, params, profile })
    if (method.includes('list')) return { items: [], sessions: [], skills: [], jobs: [], tools: [] }
    return { ok: true }
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), pathname = url.pathname
    log(req.method, pathname)
    let body = ''; for await (const part of req) body += part
    let parsed = {}; try { parsed = JSON.parse(body || '{}') } catch { /* Text/multipart attachments are accepted by this fixture. */ }
    const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
    try {
      await controls.before({ transport: 'http', method: req.method, path: pathname, query: Object.fromEntries(url.searchParams), body: parsed })
      if (pathname === '/api/status') return send({ status: 'ok', auth_required: false, version: info.version, profile: 'default', desktop_contract: info.desktop_contract })
      if (pathname === '/api/hermes/update/check') return send({ install_method: 'synthetic', current_version: info.version, behind: 0, update_available: false, can_apply: false, update_command: null, message: null, commits: [] })
      if (pathname === '/api/config/defaults') return send({ model: { default: info.model, provider: 'custom' }, display: {} })
      if (req.method === 'GET' && pathname === '/api/config/schema') return send({ fields: {} })
      if (req.method === 'GET' && pathname === '/api/env') return send({})
      if (pathname === '/api/audio/voice-live/status') return send({ mode: 'chained', available: false, reason: 'Synthetic fixture has no voice service', model: '', voice: '' })
      if (pathname === '/api/fs/default-cwd') return send({ branch: '', cwd: '/workspace' })
      if (pathname === '/api/git/worktrees') return send({ worktrees: [] })
      if (pathname === '/api/profiles/projects/tree') return send({ projects: [], active_id: null, scoped_session_ids: [] })
      if (pathname === '/api/mcp/catalog') return send({ entries: [], diagnostics: [] })
      if (pathname === '/api/git/status') return send({ is_repo: false, files: [], branch: '' })
      if (/^\/api\/sessions\/[^/]+\/timeline$/.test(pathname)) return send({ events: [], has_more: false })
      if (pathname === '/auth/me' || pathname === '/api/auth/me') return send({ authenticated: true })
      if (pathname === '/auth/ws-ticket' || pathname === '/api/auth/ws-ticket') return send({ ticket: `preview-${Date.now()}` })
      if (pathname === '/auth/logout') return send({ ok: true })
      if (pathname === '/login') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>Synthetic gateway: signed in. You can close this window.</p>') }
      if (pathname === '/api/profiles/sessions/sidebar') return send({ recents: page(url.searchParams.get('recents_profile') || 'all'), cron: page('none'), messaging: page('none') })
      if (pathname === '/api/sessions' || pathname === '/api/profiles/sessions') return send(page(url.searchParams.get('profile') || 'all', false, url.searchParams.get('archived') || 'exclude'))
      const match = /^\/api\/sessions\/([^/]+)(\/messages)?$/.exec(pathname)
      if (match) {
        const id = decodeURIComponent(match[1])
        if (req.method === 'DELETE') { sessions.delete(id); messages.delete(id); return send({ ok: true }) }
        if (req.method === 'PATCH') { Object.assign(sessions.get(id) || {}, parsed); return send({ ok: true }) }
        return send(match[2] ? { session_id: id, messages: messages.get(id) || [], profile: sessions.get(id)?.profile } : sessions.get(id) || {})
      }
      if (pathname === '/api/profiles') return send({ profiles: profiles.map(p => ({ ...p, is_active: p.name === 'default', path: `/workspace/${p.name}`, has_config: true, has_soul: true })) })
      if (pathname === '/api/profile' || pathname === '/api/profiles/active') return send({ profile: 'default', current: 'default' })
      if (pathname === '/api/config') return send({ config: { model: { default: info.model, provider: 'custom' }, display: {}, terminal: {} }, raw: '', path: '/workspace/config.yaml' })
      if (pathname === '/api/model/info') return send({ ...info, context_length: 128000, provider_configured: true })
      if (pathname === '/api/model/options') return send(modelOptions)
      if (pathname === '/api/tools/terminal/backends') return send({ backends: [] })
      if (pathname === '/api/projects') return send({ projects: [], active_id: null })
      if (pathname === '/api/skills') return send(skills)
      if (pathname === '/api/skills/content') return send({ name: 'preview-planning', path: '/workspace/skills/preview-planning/SKILL.md', content: '# Preview planning\n\nChoose three priorities and leave room for changes.' })
      if (pathname === '/api/skills/toggle') { const skill = skills.find(item => item.name === parsed.name); if (skill) skill.enabled = Boolean(parsed.enabled); return send({ ok: Boolean(skill), ...skill }) }
      if (pathname === '/api/skills/hub/official') return send({ skills: [] })
      if (pathname === '/api/tools/toolsets') return send(toolsets)
      if (pathname === '/api/tools/toolsets/preview' && req.method === 'PUT') { toolsets[0].enabled = Boolean(parsed.enabled); return send({ ok: true, ...toolsets[0] }) }
      if (pathname === '/api/tools/toolsets/preview/config') return send({ name: 'preview', providers: [], env_vars: [], configured: true })
      if (pathname === '/api/messaging/platforms') return send({ platforms })
      if (pathname === '/api/messaging/platforms/discord' && req.method === 'PUT') { platforms[0].enabled = Boolean(parsed.enabled); platforms[0].state = platforms[0].enabled ? 'connected' : 'disabled'; return send({ ok: true, platform: 'discord', hot_served: true }) }
      if (pathname === '/api/messaging/platforms/discord/test') return send({ ok: true, message: 'Synthetic preview connection; no external service was contacted.', state: platforms[0].state })
      if (pathname === '/api/pairing') return send({ approved: [], pending: [] })
      if (pathname === '/api/webhooks') return send({ base_url: 'https://preview.invalid', enabled: false, subscriptions: [] })
      if (pathname === '/api/learning/graph') return send({ nodes: [], edges: [], clusters: [], memory: [], stats: {} })
      if (pathname === '/api/cron/jobs') return send([])
      if (pathname === '/api/cron/blueprints') return send({ blueprints: [] })
      if (pathname === '/api/cron/delivery-targets') return send({ targets: [] })
      if (pathname === '/api/cron') return send({ jobs: [] })
      if (strict) return controls.unknown({ transport: 'http', method: req.method, path: pathname })
      if (pathname.includes('plugins')) return send({ plugins: [] })
      if (pathname.includes('soul')) return send({ content: 'A helpful synthetic assistant for interface review.', exists: true })
      if (pathname.includes('files') || pathname.includes('browse')) return send({ entries: [], files: [], path: '/workspace' })
      if (pathname.includes('toolsets')) return send({ toolsets: [], enabled: [] })
      if (pathname.includes('upload') || pathname.includes('attach')) return send({ ok: true, path: '/workspace/preview-attachment.txt' })
      if (pathname.includes('onboarding')) return send({ complete: true, completed: true, required: false, enabled: false, stage: 'completed' })
      return send({ ok: true, items: [], entries: [], tools: [], providers: [], channels: [], jobs: [], models: [], configured: true })
    } catch (error) { return send({ error: error.message }, error.status || 500) }
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', (client, request) => {
    const profile = new URL(request.url, 'http://fixture').searchParams.get('profile') || 'default'
    clients.add(client)
    client.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { version: info.version, profile: 'default', cwd: '/workspace', skin: {}, change_events: true, replay_epoch: 'preview', ...info } } }))
    client.on('close', () => clients.delete(client))
    client.on('message', async data => {
      let message
      try {
        message = JSON.parse(String(data))
        await controls.before({ transport: 'rpc', id: message.id, method: message.method, params: message.params || {}, profile })
        const result = rpc(message.method, message.params, profile)
        if (message.id !== undefined && client.readyState === 1) client.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      } catch (error) {
        log('ERROR', error.message)
        if (message?.id !== undefined && client.readyState === 1) client.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: error.code || -32000, message: error.message } }))
      }
    })
  })
  const disconnect = () => { for (const client of clients) client.terminate() }
  return { server, sessions, messages, profiles, controls, disconnect, close: async () => { controls.releaseAll(); for (const timer of timers.values()) clearInterval(timer); disconnect(); sockets.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gateway = createPreviewGateway({ log: (method, route) => console.log(method, route) })
  gateway.server.listen(Number(process.env.PORT || 9129), process.env.HOST || '127.0.0.1', () => console.log('Synthetic review gateway ready'))
}
