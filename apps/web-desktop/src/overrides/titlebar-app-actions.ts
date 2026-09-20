import { type Codec, persistentAtom } from '../upstream/persistence'

// Keep this override independent of the upstream titlebar store: the pinned
// renderer predates it, while newer renderers use this module through our alias.
export type TitlebarAppActionsSide = 'left' | 'right'

export const TITLEBAR_APP_ACTIONS_DEFAULT: TitlebarAppActionsSide = 'right'

const codec: Codec<TitlebarAppActionsSide> = {
  decode: raw => (raw === 'left' || raw === 'right' ? raw : TITLEBAR_APP_ACTIONS_DEFAULT),
  encode: value => value
}

export const $titlebarAppActionsSide = persistentAtom<TitlebarAppActionsSide>(
  'hermes.desktop.titlebarAppActions',
  TITLEBAR_APP_ACTIONS_DEFAULT,
  codec
)

export function setTitlebarAppActionsSide(side: TitlebarAppActionsSide) {
  $titlebarAppActionsSide.set(side)
}

/** The web wrapper hides HUD, leaving Settings and Layout as the two app tools. */
export function titlebarAppActionsClusterCounts(
  side: TitlebarAppActionsSide,
  leftExtras = 0,
  rightExtras = 0
): { left: number; right: number } {
  const sidebar = 1
  const appActions = 2
  const rightFixed = 2

  return side === 'left'
    ? { left: sidebar + appActions + leftExtras, right: rightFixed + rightExtras }
    : { left: sidebar + leftExtras, right: appActions + rightFixed + rightExtras }
}
