import { beginOperation } from './reload-safety'
import { servingBase } from '../web-bridge/gateways'

/**
 * Plugin folders are served by the dev/preview middleware (and, in
 * production, nginx — see nginx.conf.template) at same-origin URLs
 * (/desktop-plugins and /plugins), each with a `.listing` endpoint returning
 * a JSON array of `{name, type}` entries for the directory's children.
 */
export const pluginRoots = () => [`${servingBase()}/desktop-plugins`, `${servingBase()}/plugins`]

/**
 * True when `path` is one of the plugin roots itself, or something under it.
 * A plain `path.startsWith(root)` (the previous check) is a string-prefix
 * bug: a sibling path like `${root}Secret` also starts with `root`, since
 * `root` carries no trailing slash. Require an exact match or a `/`
 * boundary so a sibling directory can't pass as "under" a plugin root.
 */
export function isUnderPluginRoot(path: string): boolean {
  return pluginRoots().some(root => path === root || path.startsWith(`${root}/`))
}

/**
 * Browser-file registry. The renderer is path-based: in Electron it reads a
 * file off disk by absolute path. A browser has no paths — only File/Blob
 * objects from `<input type=file>`, drop/paste events and the clipboard — so
 * we register those blobs under a synthetic handle (`web-file://<n>`, a shape
 * the renderer accepts anywhere a path is expected) and answer
 * readFileDataUrl / readFileDataUrlForAttach by resolving the handle back to
 * the blob and reading its bytes. The same "memory file" idea as the plugin
 * mechanism (same-origin fetch), but for blobs held by the page instead of
 * served paths.
 */
let webFileSeq = 0
const webFiles = new Map<string, Blob>()
const WEB_FILE_PREFIX = 'web-file://'

export function isWebFileHandle(path: string): boolean {
  return path.startsWith(WEB_FILE_PREFIX)
}

export function registerWebFile(blob: Blob, name?: string): string {
  const seq = ++webFileSeq
  const filename = sanitizeWebFileName(name || mimeToFilename(blob.type, `file${seq}`))
  const handle = `${WEB_FILE_PREFIX}${seq}/${filename}`
  webFiles.set(handle, blob)
  return handle
}

/** Derive a sane default filename from a blob MIME (the renderer's pathLabel
 *  shows the last path segment and imageFilenameFromPath uses it for the
 *  gateway upload name), so a clipboard paste isn't labelled by a bare number. */
function mimeToFilename(type: string, fallback: string): string {
  const m = /^image\/([\w+-]+)/.exec(type || '')

  if (m) {
    const ext = m[1].toLowerCase()

    return `image.${ext === 'jpeg' ? 'jpg' : ext}`
  }

  return fallback
}

/** A browser File name never contains a path separator, but guard anyway so
 *  pathLabel() always extracts exactly one segment — the real filename. Kept
 *  short so an over-long name can't produce an unwieldy handle. */
function sanitizeWebFileName(name: string): string {
  const clean = name.replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')

  return clean.slice(0, 120) || 'file'
}

export function webFileAsDataUrl(handle: string): Promise<string> {
  const blob = webFiles.get(handle)

  if (!blob) {
    return Promise.reject(new Error(`local file access is unavailable in the web app (${handle})`))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read browser file'))
    reader.readAsDataURL(blob)
  })
}

// Persistent hidden <input type=file> backing selectPaths. We reuse one
// element (retargeting `accept`/`multiple` per call) so the picker always
// opens inside a plain user gesture without rebuilding DOM nodes.
let fileInputEl: null | HTMLInputElement = null

export function ensureFileInput(): HTMLInputElement {
  if (!fileInputEl) {
    fileInputEl = document.createElement('input')
    fileInputEl.type = 'file'
    fileInputEl.style.display = 'none'
    document.body.appendChild(fileInputEl)
  }

  return fileInputEl
}

/** Open the native picker and resolve to the chosen files ([] on cancel).
 *  input.click() must stay inside the triggering click's user-gesture window;
 *  the Promise executor runs synchronously, so it does. */
export function pickWithInput(input: HTMLInputElement): Promise<File[]> {
  const finish = beginOperation()
  input.value = '' // allow re-selecting the same file

  return new Promise(resolve => {
    let settled = false

    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)
    try { input.click() } catch (error) { finish(); throw error }

    // Some mobile / webview pickers never fire `cancel`, which would leave this
    // pending forever. Fall back to [] if nothing settles in time — far longer
    // than any real selection, so it only guards against the missed-cancel leak.
    const pendingTimer = setTimeout(fallback, 120_000)

    function settle(files: File[]): void {
      if (settled) return
      settled = true
      clearTimeout(pendingTimer)
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      finish()
      resolve(files)
    }

    function onChange(): void {
      settle(Array.from(input.files ?? []))
    }

    function onCancel(): void {
      settle([])
    }

    function fallback(): void {
      settle([])
    }
  })
}

/** Map Electron-style `filters[].extensions` to the browser `accept` list. */
export function acceptsFor(filters?: Array<{ extensions: string[] }>): string {
  return (filters ?? []).flatMap(f => f.extensions).map(ext => `.${ext.toLowerCase()}`).join(',')
}

