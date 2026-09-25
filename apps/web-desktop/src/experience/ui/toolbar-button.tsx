import type { ComponentPropsWithRef } from 'react'
import { Tip } from '../../upstream/browser-api'

export function BrowserToolbarButton({ tooltip, size = 'default', ...props }: ComponentPropsWithRef<'button'> & { tooltip: string; size?: 'default' | 'compact' }) {
  return <Tip label={tooltip} placement="toolbar" boundary="viewport"><button type="button" {...props} data-browser-toolbar-button="" data-browser-control-size={size} /></Tip>
}
