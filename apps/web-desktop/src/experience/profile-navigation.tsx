import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { BrowserActionSurface, type BrowserActionAnchor } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useCompactBrowser } from './ui/use-compact-browser'
import { BotFace, avatarColor, Codicon, Tip } from '../upstream/browser-api'
import { useBrowserProfiles } from '../upstream/profiles'
import { readHideAllProfilesButton, readHiddenProfiles, writeBrowserPreference } from './browser-preferences'

export function BrowserProfileNavigation({ hidden = false }: { hidden?: boolean }) {
  const model = useBrowserProfiles()
  const compact = useCompactBrowser()
  const actionsTrigger = useRef<HTMLButtonElement>(null), draggedProfile = useRef<string | null>(null)
  const [draggingProfile, setDraggingProfile] = useState<string | null>(null)
  const [dropTargetProfile, setDropTargetProfile] = useState<{ key: string; after: boolean } | null>(null)
  const [hiddenProfiles, setHiddenProfiles] = useState<string[]>(readHiddenProfiles)
  const [hideAllProfilesButton, setHideAllProfilesButton] = useState(readHideAllProfilesButton)
  const [profileContextMenuPosition, setProfileContextMenuPosition] = useState<(BrowserActionAnchor & { profile: string | null }) | null>(null)
  const visibleProfileAvatars = model.items.filter(item => !hiddenProfiles.includes(item.key))
  useEffect(() => { if (hidden) setProfileContextMenuPosition(null) }, [hidden])
  useEffect(() => { writeBrowserPreference('hiddenProfiles', JSON.stringify(hiddenProfiles)) }, [hiddenProfiles])
  useEffect(() => { writeBrowserPreference('hideAllProfilesButton', String(hideAllProfilesButton)) }, [hideAllProfilesButton])
  const openProfileContextMenu = (event: React.MouseEvent<HTMLElement>, profile: string | null = null) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    setProfileContextMenuPosition({
      x: event.type === 'contextmenu' ? event.clientX : bounds.left,
      y: event.type === 'contextmenu' ? event.clientY : bounds.bottom,
      returnFocus: event.currentTarget,
      profile
    })
  }
  const hideProfile = (profileName: string) => {
    setHiddenProfiles(current => current.includes(profileName) ? current : [...current, profileName])
    if (model.active === profileName) model.select(null)
    setProfileContextMenuPosition(null)
  }
  const showHiddenProfiles = () => {
    setHiddenProfiles([])
    setHideAllProfilesButton(false)
    setProfileContextMenuPosition(null)
  }
  const beginProfileDrag = (event: ReactDragEvent<HTMLButtonElement>, name: string) => {
    if (compact) { event.preventDefault(); return }
    draggedProfile.current = name
    setDraggingProfile(name)
    setDropTargetProfile(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', name)
  }
  const finishProfileDrag = () => {
    draggedProfile.current = null
    setDraggingProfile(null)
    setDropTargetProfile(null)
  }
  useEffect(() => { if (compact || hidden) finishProfileDrag() }, [compact, hidden])
  const profileDropTarget = (event: ReactDragEvent<HTMLDivElement>) => {
    // Resolve one insertion point across avatars, gaps and trailing space.
    // Markers are positioned out of flow so preview and drop use the same bounds.
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-profile-key]'))
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect()
      if (event.clientX < bounds.left + bounds.width / 2) return { key: button.dataset.profileKey!, after: false }
    }
    const last = buttons.at(-1)
    return last ? { key: last.dataset.profileKey!, after: true } : null
  }
  const hoverProfileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (compact || !draggedProfile.current) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const target = profileDropTarget(event)
    setDropTargetProfile(target?.key === draggedProfile.current ? null : target)
  }
  const reorderProfiles = (event: ReactDragEvent<HTMLDivElement>) => {
    if (compact || !draggedProfile.current) return
    event.preventDefault()
    event.stopPropagation()
    const target = profileDropTarget(event)
    const source = draggedProfile.current
    if (target) model.reorder(source, target.key, target.after)
    finishProfileDrag()
  }
  const lastVisibleProfile = visibleProfileAvatars.at(-1)?.key
  return <>
    <div className="browser-profile-footer" hidden={hidden}>
      <div className="browser-profile-rail" role="radiogroup" aria-label="Profiles" onContextMenu={event => openProfileContextMenu(event)} onDragOver={hoverProfileDrop} onDrop={reorderProfiles} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTargetProfile(null) }}>
        {model.items.length > 1 && !hideAllProfilesButton && <Tip label="All profiles"><button className="browser-profile-choice browser-profile-all" type="button" aria-label="All profiles" aria-pressed={model.all} onClick={() => model.select(null)} onContextMenu={event => openProfileContextMenu(event)}><Codicon name="symbol-misc" size="1rem" /></button></Tip>}
        {model.fallback && <Tip label={model.fallback.label}><button className="browser-profile-choice" type="button" aria-label={model.fallback.label} aria-pressed onClick={() => model.select(model.active)} onContextMenu={event => openProfileContextMenu(event, model.active)}><BotFace color={avatarColor(model.fallback.appearance.color, model.fallback.botName)} name={model.fallback.botName} image={model.fallback.appearance.image} shape={model.fallback.appearance.shape} size={28} /></button></Tip>}
        {visibleProfileAvatars.map(item => <div className="browser-profile-slot" key={item.key}>
          {draggingProfile && dropTargetProfile?.key === item.key && !dropTargetProfile.after && draggingProfile !== item.key && <span className="browser-profile-drop-indicator" aria-hidden="true" />}
          <Tip label={item.label}><button className={`browser-profile-choice${draggingProfile === item.key ? ' is-dragging' : ''}${dropTargetProfile?.key === item.key && draggingProfile !== item.key ? ' is-drop-target' : ''}`} draggable={!compact} data-profile-key={item.key} type="button" aria-label={item.label} aria-pressed={!model.all && model.active === item.key} onClick={() => model.select(item.key)} onContextMenu={event => openProfileContextMenu(event, item.key)} onDragStart={event => beginProfileDrag(event, item.key)} onDragEnd={finishProfileDrag}><BotFace color={avatarColor(item.appearance.color, item.botName)} image={item.appearance.image} name={item.botName} shape={item.appearance.shape} size={28} /></button></Tip>
        </div>)}
        {lastVisibleProfile && <div className="browser-profile-drop-end" aria-hidden="true">
          {draggingProfile && dropTargetProfile?.key === lastVisibleProfile && dropTargetProfile.after && draggingProfile !== lastVisibleProfile && <span className="browser-profile-drop-indicator" />}
        </div>}

      </div>
      <BrowserToolbarButton tooltip="Profile actions" ref={actionsTrigger} className="browser-profile-actions-trigger" type="button" aria-label="Profile actions" aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(profileContextMenuPosition)} onClick={event => openProfileContextMenu(event)}><Codicon name="ellipsis" size="1rem" /></BrowserToolbarButton>
    </div>
    <BrowserActionSurface
      title="Profile actions"
      anchor={profileContextMenuPosition}
      compact={compact}
      fallbackFocus={actionsTrigger}
      onClose={() => setProfileContextMenuPosition(null)}
      actions={[
        ...(profileContextMenuPosition?.profile
          ? [{ key: 'hide', label: 'Hide profile', run: () => hideProfile(profileContextMenuPosition.profile!) }]
          : (model.fallback ? [...visibleProfileAvatars, model.fallback] : visibleProfileAvatars).map(item => ({ key: `hide-${item.key}`, label: `Hide ${item.label}`, run: () => hideProfile(item.key) }))),
        { key: 'toggle-all-profiles', label: `${hideAllProfilesButton ? 'Show' : 'Hide'} All profiles button`, run: () => { setHideAllProfilesButton(value => !value); setProfileContextMenuPosition(null) } },
        { key: 'show-hidden', label: 'Show hidden', disabled: !hiddenProfiles.length && !hideAllProfilesButton, run: showHiddenProfiles }
      ]}
    />
  </>
}
