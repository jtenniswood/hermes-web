/** Read the first image off the clipboard, if any (modern Chromium Clipboard
 *  API). Returns null when there is none or permission is denied. */
export async function clipboardImageAsFile(): Promise<null | Blob> {
  try {
    if (!navigator.clipboard?.read) {
      return null
    }

    const items = await navigator.clipboard.read()

    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'))

      if (type) {
        const blob = await item.getType(type)

        if (blob && blob.size > 0) {
          return blob
        }
      }
    }
  } catch {
    // Permission denied / clipboard not focused — behave as "no image".
  }

  return null
}

export async function readClipboard(): Promise<string> {
  try { return await navigator.clipboard.readText() } catch { return '' }
}

export async function writeClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
