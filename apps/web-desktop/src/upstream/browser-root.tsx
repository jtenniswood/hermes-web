import { BrowserShell } from '../experience/browser-shell'
import { useEffect } from 'react'
import { restoreBrowserProfile } from './profiles'
import './browser-initialize'
import '../experience/browser.css'
export default function BrowserRoot() {
  useEffect(restoreBrowserProfile, [])
  return <BrowserShell />
}
