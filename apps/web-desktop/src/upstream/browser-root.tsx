import { BrowserShell } from '../experience/browser-shell'
import { useEffect } from 'react'
import { $activeGatewayProfile, selectProfile } from './browser-api'
import './browser-initialize'
import '../experience/browser.css'
export default function BrowserRoot() {
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('hermes-web.browser.profile')
      if (saved) selectProfile(saved)
    } catch { /* Optional tab state. */ }
    return $activeGatewayProfile.subscribe(profile => {
      try { sessionStorage.setItem('hermes-web.browser.profile', profile) } catch { /* Optional tab state. */ }
    })
  }, [])
  return <BrowserShell />
}
