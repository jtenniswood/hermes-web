import type { CSSProperties } from 'react'

const viewportWidth = 'calc(100vw / var(--web-ui-scale, 1) - 2rem)'
const viewportHeight = 'calc(85dvh / var(--web-ui-scale, 1))'
const length = (value: string | number) => typeof value === 'number' ? `${value}px` : value

/** Constrain existing dialog dimensions without depending on a form's markup. */
export function browserDialogStyle(style: CSSProperties = {}): CSSProperties {
  return {
    ...style,
    // Leave the upstream max-width class in charge of the normal dialog size.
    width: `min(${length(style.width ?? '100%')}, ${viewportWidth})`,
    maxHeight: viewportHeight,
    ...(style.maxWidth !== undefined && { maxWidth: `min(${length(style.maxWidth)}, ${viewportWidth})` }),
    // Advanced forms expose a native resize handle through the content props.
    ...(style.resize === 'both' && { maxWidth: `min(48rem, ${viewportWidth})` }),
    ...(style.minWidth !== undefined && { minWidth: `min(${length(style.minWidth)}, ${viewportWidth})` }),
    ...(style.minHeight !== undefined && { minHeight: `min(${length(style.minHeight)}, ${viewportHeight})` })
  }
}
