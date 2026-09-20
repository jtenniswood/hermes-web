import type { HermesNotification } from '../upstream/types'

const WEB_NOTIFICATION_READY_TIMEOUT_MS = 750

async function readyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {return null}

  try {
    // Do not let a notification wait indefinitely for the PWA registration.
    // This also keeps the bridge useful on plain HTTP dev/preview servers.
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), WEB_NOTIFICATION_READY_TIMEOUT_MS))
    ])
  } catch {
    return null
  }
}

export async function webNotify(payload: HermesNotification): Promise<boolean> {
  if (!('Notification' in window)) {return false}

  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      return false
    }
  }

  if (Notification.permission !== 'granted') {return false}

  const title = payload.title ?? 'Hermes'
  const options: NotificationOptions = {
    body: payload.body,
    icon: '/hermes.png',
    badge: '/hermes.png',
    silent: payload.silent,
    data: { url: window.location.href }
  }

  // A service-worker notification can remain visible when the tab is hidden,
  // and its click handler can focus or reopen the PWA. Use the page API while
  // visible so the notification stays tied to the current browser window.
  if (document.visibilityState === 'hidden') {
    const registration = await readyServiceWorkerRegistration()

    if (registration) {
      try {
        await registration.showNotification(title, options)
        return true
      } catch {
        // Fall through to the page notification when the SW is unavailable.
      }
    }
  }

  try {
    const notification = new Notification(title, options)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }

    return true
  } catch {
    return false
  }
}

