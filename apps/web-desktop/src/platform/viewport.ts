/** Keep the app above the software keyboard, including browsers that pan
 * the visual viewport without resizing the layout viewport. */
export function trackVisualViewport(): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => {}

  const style = document.documentElement.style
  let frame = 0
  const update = (): void => {
    frame = 0
    // Pinch zoom should magnify the existing layout, not resize it. CSS UI
    // zoom is separate and is compensated in the stylesheet.
    if (Math.abs(viewport.scale - 1) > 0.01 || viewport.height <= 0) return
    style.setProperty('--web-viewport-height', `${viewport.height}px`)
    style.setProperty('--web-viewport-top', `${viewport.offsetTop}px`)
  }
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  viewport.addEventListener('resize', schedule)
  viewport.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  update()

  return () => {
    cancelAnimationFrame(frame)
    viewport.removeEventListener('resize', schedule)
    viewport.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    style.removeProperty('--web-viewport-height')
    style.removeProperty('--web-viewport-top')
  }
}
