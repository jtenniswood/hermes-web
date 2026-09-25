const RAIL = '[data-slot="thread-timeline-ticks"]'
const TICK = '[data-timeline-index]'
const DRAG_THRESHOLD_PX = 4

/** Let pointer drags scrub the conversation timeline while preserving click-to-jump. */
export function installTimelineRailScrubbing(): () => void {
  let pointerId: number | null = null
  let startX = 0
  let startY = 0
  let dragging = false
  let lastIndex: string | null = null
  let suppressClick = false
  let clearSuppression = 0

  const tickAt = (x: number, y: number): HTMLButtonElement | null => {
    const target = document.elementFromPoint(x, y)
    return target instanceof Element
      ? target.closest<HTMLButtonElement>(`${RAIL} ${TICK}`)
      : null
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(`${RAIL} ${TICK}`)) return
    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    dragging = false
    lastIndex = null
    suppressClick = false
    window.clearTimeout(clearSuppression)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) return
    dragging = true

    const tick = tickAt(event.clientX, event.clientY)
    const index = tick?.dataset.timelineIndex
    if (!tick || index === undefined || index === lastIndex) return

    lastIndex = index
    tick.click()
  }

  const finishPointer = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    pointerId = null
    if (dragging) {
      suppressClick = true
      clearSuppression = window.setTimeout(() => { suppressClick = false }, 0)
    }
    dragging = false
    lastIndex = null
  }

  const onClick = (event: MouseEvent) => {
    if (!suppressClick || !event.isTrusted || !(event.target instanceof Element) || !event.target.closest(`${RAIL} ${TICK}`)) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', finishPointer, true)
  document.addEventListener('pointercancel', finishPointer, true)
  document.addEventListener('click', onClick, true)

  return () => {
    window.clearTimeout(clearSuppression)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', finishPointer, true)
    document.removeEventListener('pointercancel', finishPointer, true)
    document.removeEventListener('click', onClick, true)
  }
}
