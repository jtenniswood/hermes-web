export interface BrowserCapabilities {
  nativeTerminal: false
  nativeGit: false
  desktopUpdater: false
  desktopOverlay: false
  secureTokenStorage: false
  fileAttachments: true
  clipboard: boolean
  notifications: boolean
  microphone: boolean
}

export function browserCapabilities(): BrowserCapabilities {
  return {
    nativeTerminal: false,
    nativeGit: false,
    desktopUpdater: false,
    desktopOverlay: false,
    secureTokenStorage: false,
    fileAttachments: true,
    clipboard: Boolean(navigator.clipboard),
    notifications: 'Notification' in window,
    microphone: Boolean(navigator.mediaDevices?.getUserMedia)
  }
}
