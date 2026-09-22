import type { ComponentPropsWithRef } from 'react'
import { Tip } from '../../upstream/browser-api'

export function BrowserToolbarButton({ tooltip, ...props }: ComponentPropsWithRef<'button'> & { tooltip: string }) {
  return <Tip label={tooltip} placement="toolbar" boundary="viewport"><button type="button" {...props} /></Tip>
}
