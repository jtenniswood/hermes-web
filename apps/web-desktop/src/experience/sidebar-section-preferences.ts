export const HIDDEN_SECTIONS_KEY = 'hermes-web.browser.hidden-sections'

// Frozen migration table for the old English label-derived keys. Never build
// preference identities from current copy, locale, or user project names.
const legacySections: Record<string, string> = {
  projects: 'sessions',
  telegram: 'messaging:telegram', discord: 'messaging:discord', slack: 'messaging:slack',
  mattermost: 'messaging:mattermost', matrix: 'messaging:matrix', signal: 'messaging:signal',
  whatsapp: 'messaging:whatsapp', imessage: 'messaging:bluebubbles', photon: 'messaging:photon',
  homeassistant: 'messaging:homeassistant', email: 'messaging:email', sms: 'messaging:sms',
  webhook: 'messaging:webhook', api: 'messaging:api_server', wechat: 'messaging:weixin',
  wecom: 'messaging:wecom', qq: 'messaging:qqbot', yuanbao: 'messaging:yuanbao',
  dingtalk: 'messaging:dingtalk', feishu: 'messaging:feishu'
}

export function readHiddenSections(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const saved = JSON.parse(storage.getItem(HIDDEN_SECTIONS_KEY) || 'null')
    const strings = (values: unknown[]): string[] => values.filter((value): value is string => typeof value === 'string' && value !== 'sessions')
    if (saved?.version === 2 && Array.isArray(saved.hidden)) return [...new Set(strings(saved.hidden))]
    if (Array.isArray(saved)) return [...new Set(strings(saved).map(key => Object.hasOwn(legacySections, key) ? legacySections[key] : key).filter(key => key !== 'sessions'))]
    const hidden: string[] = []
    if (storage.getItem('hermes-web.browser.pinned-section-hidden') === 'true') hidden.push('pinned')
    if (storage.getItem('hermes-web.browser.cron-section-hidden') === 'true') hidden.push('cron-jobs')
    return hidden
  } catch { return [] }
}
