import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { createPortal } from 'react-dom'
import { BotFace, avatarColor, Codicon, Tip } from '../upstream/browser-api'
import { useBrowserProfiles } from '../upstream/profiles'
import { readHiddenProfiles, writeBrowserPreference } from './browser-preferences'

export function BrowserProfileNavigation({ hidden = false }: { hidden?: boolean }) {
  const model = useBrowserProfiles()
  const profileContextMenu = useRef<HTMLDivElement>(null), draggedProfile = useRef<string | null>(null)
  const [draggingProfile, setDraggingProfile] = useState<string | null>(null)
  const [dropTargetProfile, setDropTargetProfile] = useState<{ key: string; after: boolean } | null>(null)
  const [hiddenProfiles, setHiddenProfiles] = useState<string[]>(readHiddenProfiles)
  const [profileContextMenuPosition, setProfileContextMenuPosition] = useState<{ x: number; y: number; profile: string | null } | null>(null)
  const visibleProfileAvatars = model.items.filter(item => !hiddenProfiles.includes(item.key))
  useEffect(() => { if (hidden) setProfileContextMenuPosition(null) }, [hidden])
  useEffect(() => { writeBrowserPreference('hiddenProfiles', JSON.stringify(hiddenProfiles)) }, [hiddenProfiles])
  useEffect(() => {
    if (!profileContextMenuPosition) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!profileContextMenu.current?.contains(event.target as Node)) setProfileContextMenuPosition(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileContextMenuPosition(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    requestAnimationFrame(() => profileContextMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileContextMenuPosition])
  const openProfileContextMenu = (event: React.MouseEvent, profileName: string | null = null) => {
    event.preventDefault()
    event.stopPropagation()
    const uiScale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--web-ui-scale')) || 1
    const viewportWidth = window.innerWidth / uiScale
    const viewportHeight = window.innerHeight / uiScale
    // Keep the small menu reachable when the rail is close to a viewport edge.
    setProfileContextMenuPosition({
      x: Math.max(4, Math.min(event.clientX / uiScale, viewportWidth - 180)),
      y: Math.max(4, Math.min(event.clientY / uiScale, viewportHeight - 96)),
      profile: profileName
    })
  }
  const hideProfile = (profileName: string) => {
    setHiddenProfiles(current => current.includes(profileName) ? current : [...current, profileName])
    if (model.active === profileName) model.select(null)
    setProfileContextMenuPosition(null)
  }
  const showHiddenProfiles = () => {
    setHiddenProfiles([])
    setProfileContextMenuPosition(null)
  }
  const beginProfileDrag = (event: ReactDragEvent<HTMLButtonElement>, name: string) => {
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
    if (!draggedProfile.current) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const target = profileDropTarget(event)
    setDropTargetProfile(target?.key === draggedProfile.current ? null : target)
  }
  const reorderProfiles = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedProfile.current) return
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
            {model.items.length > 1 && <Tip label="All profiles"><button className="browser-profile-choice browser-profile-all" type="button" aria-label="All profiles" aria-pressed={model.all} onClick={() => model.select(null)} onContextMenu={event => openProfileContextMenu(event)}><Codicon name="symbol-misc" size="1rem" /></button></Tip>}
            {model.fallback && <Tip label={model.fallback.label}><button className="browser-profile-choice" type="button" aria-label={model.fallback.label} aria-pressed onClick={() => model.select(model.active)} onContextMenu={event => openProfileContextMenu(event, model.active)}><BotFace color={avatarColor(model.fallback.appearance.color, model.fallback.botName)} name={model.fallback.botName} image={model.fallback.appearance.image} shape={model.fallback.appearance.shape} size={28} /></button></Tip>}
            {visibleProfileAvatars.map(item => <div className="browser-profile-slot" key={item.key}>
              {draggingProfile && dropTargetProfile?.key === item.key && !dropTargetProfile.after && draggingProfile !== item.key && <span className="browser-profile-drop-indicator" aria-hidden="true" />}
              <Tip label={item.label}><button className={`browser-profile-choice${draggingProfile === item.key ? ' is-dragging' : ''}${dropTargetProfile?.key === item.key && draggingProfile !== item.key ? ' is-drop-target' : ''}`} draggable data-profile-key={item.key} type="button" aria-label={item.label} aria-pressed={!model.all && model.active === item.key} onClick={() => model.select(item.key)} onContextMenu={event => openProfileContextMenu(event, item.key)} onDragStart={event => beginProfileDrag(event, item.key)} onDragEnd={finishProfileDrag}><BotFace color={avatarColor(item.appearance.color, item.botName)} image={item.appearance.image} name={item.botName} shape={item.appearance.shape} size={28} /></button></Tip>
            </div>)}
            {lastVisibleProfile && <div className="browser-profile-drop-end" aria-hidden="true">
              {draggingProfile && dropTargetProfile?.key === lastVisibleProfile && dropTargetProfile.after && draggingProfile !== lastVisibleProfile && <span className="browser-profile-drop-indicator" />}
            </div>}
          </div>
        </div>
    {createPortal(<>
      {profileContextMenuPosition && <div ref={profileContextMenu} className="browser-profile-context-menu" role="menu" aria-label="Profile actions" style={{ left: profileContextMenuPosition.x, top: profileContextMenuPosition.y }}>
        {profileContextMenuPosition.profile && <button type="button" role="menuitem" onClick={() => hideProfile(profileContextMenuPosition.profile!)}>Hide profile</button>}
        <button type="button" role="menuitem" disabled={!hiddenProfiles.length} onClick={showHiddenProfiles}>Show hidden</button>
      </div>}
    </>, document.querySelector('[data-browser-shell]') || document.body)}
  </>
}
