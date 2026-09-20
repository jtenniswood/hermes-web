import { BrowserShell } from '../experience/browser-shell'
import { useEffect } from 'react'
import { $activeGatewayProfile, selectProfile } from './comparison-api'
import './comparison-initialize'
import '../experience/comparison.css'
export default function ComparisonRoot() {
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('hermes-web.comparison.profile')
      if (saved) selectProfile(saved)
    } catch { /* Optional tab state. */ }
    return $activeGatewayProfile.subscribe(profile => {
      try { sessionStorage.setItem('hermes-web.comparison.profile', profile) } catch { /* Optional tab state. */ }
    })
  }, [])
  return <BrowserShell />
}
