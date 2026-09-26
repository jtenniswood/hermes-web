import { useEffect, useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { readDesktopDir, setDesktopFsRemotePicker } from '@/lib/desktop-fs'
import { displayPath, pathLeaf } from '@/lib/display-path'
import { cn } from '@/lib/utils'
import { apiFetch } from '../platform/connection'
import { Button, Input } from '../upstream/ui'

function clean(path: string) {
  return path.replace(/\/+$/, '') || '/'
}

function parentDir(path: string) {
  const value = clean(path)

  if (value === '/') {
    return '/'
  }

  const parent = value.slice(0, value.lastIndexOf('/'))

  return parent || '/'
}

function pathName(path: string) {
  return pathLeaf(path) || path
}

interface PendingSelection {
  defaultPath: string
  resolve: (paths: string[]) => void
  title: string
}

export function RemoteFolderPicker() {
  const { t } = useI18n()
  const r = t.rightSidebar
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)

  useEffect(() => {
    setDesktopFsRemotePicker({
      selectPaths: options =>
        new Promise(resolve => {
          const defaultPath = clean(options?.defaultPath || '/')
          setCurrentPath(defaultPath)
          setPending({ defaultPath, resolve, title: options?.title || r.remotePickerTitle })
        })
    })

    return () => setDesktopFsRemotePicker(null)
  }, [r.remotePickerTitle])

  useEffect(() => {
    if (!pending) {
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    void readDesktopDir(currentPath)
      .then(result => {
        if (!active) {
          return
        }

        if (result.error) {
          setError(result.error)
          setEntries([])

          return
        }

        setEntries(
          result.entries.filter(entry => entry.isDirectory).map(entry => ({ name: entry.name, path: entry.path }))
        )
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setEntries([])
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [currentPath, pending])

  const crumbs = useMemo(() => {
    const parts = clean(currentPath).split('/').filter(Boolean)
    const out = [{ label: '/', path: '/' }]
    let acc = ''

    for (const part of parts) {
      acc += `/${part}`
      out.push({ label: part, path: acc })
    }

    return out
  }, [currentPath])

  const close = (paths: string[] = []) => {
    pending?.resolve(paths)
    setPending(null)
    setEntries([])
    setError(null)
    setCreating(false)
    setFolderName('')
    setCreateError(null)
  }

  const createFolder = async () => {
    const name = folderName.trim()
    if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/.test(name)) {
      setCreateError('Enter one folder name without slashes.')
      return
    }

    const path = `${clean(currentPath)}/${name}`.replace(/^\/\//, '/')
    setCreatingFolder(true)
    setCreateError(null)

    try {
      await apiFetch({
        method: 'POST',
        path: '/api/files/mkdir',
        profile: window.__HERMES_WEB_ACTIVE_PROFILE__ ?? undefined,
        body: { path }
      })
      setCreating(false)
      setFolderName('')
      setCurrentPath(path)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingFolder(false)
    }
  }

  return (
    <Dialog onOpenChange={open => !open && close()} open={Boolean(pending)}>
      <DialogContent
        bodyClassName="flex min-h-0 flex-col gap-0 overflow-hidden p-0"
        className="h-[min(36rem,calc(100vh-4rem))] max-w-lg"
      >
        <div className="shrink-0 border-b border-border/70 px-4 py-3">
          <DialogTitle className="text-sm">{pending?.title || r.remotePickerTitle}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">{r.remotePickerDescription}</DialogDescription>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 flex flex-wrap items-center gap-1 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
            {crumbs.map((crumb, index) => (
              <button
                className={cn(
                  'rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground',
                  index === crumbs.length - 1 && 'text-foreground'
                )}
                key={crumb.path}
                onClick={() => setCurrentPath(crumb.path)}
                type="button"
              >
                {crumb.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <FolderRow
              disabled={currentPath === '/'}
              name=".."
              onClick={() => setCurrentPath(parentDir(currentPath))}
            />
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Codicon name="loading" size="0.8rem" spinning />
                {r.loadingFiles}
              </div>
            ) : error ? (
              <div className="px-2 py-3 text-xs text-destructive">{r.unreadableBody(error)}</div>
            ) : entries.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">{r.emptyBody}</div>
            ) : (
              entries.map(entry => (
                <FolderRow key={entry.path} name={pathName(entry.path)} onClick={() => setCurrentPath(entry.path)} />
              ))
            )}
          </div>
        </div>

        {creating && (
          <form
            className="shrink-0 border-t border-border/50 px-4 py-3"
            onSubmit={event => {
              event.preventDefault()
              void createFolder()
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label="Folder name"
                autoFocus
                autoComplete="off"
                disabled={creatingFolder}
                onChange={event => setFolderName(event.target.value)}
                placeholder="Folder name"
                value={folderName}
              />
              <Button disabled={creatingFolder || !folderName.trim()} size="sm" type="submit">
                {creatingFolder ? 'Creating…' : 'Create'}
              </Button>
              <Button
                disabled={creatingFolder}
                onClick={() => { setCreating(false); setCreateError(null) }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
            {createError && <div className="mt-2 text-xs text-destructive">{createError}</div>}
          </form>
        )}

        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border/70 px-4 py-3">
          <div className="min-w-0 truncate text-xs text-muted-foreground">{displayPath(currentPath)}</div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={loading || creatingFolder}
              onClick={() => { setCreating(true); setCreateError(null) }}
              size="sm"
              variant="ghost"
            >
              New folder
            </Button>
            <Button onClick={() => close()} size="sm" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button onClick={() => close([currentPath])} size="sm">
              {r.remotePickerSelect}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FolderRow({ disabled = false, name, onClick }: { disabled?: boolean; name: string; onClick: () => void }) {
  return (
    <button
      className="row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-(--ui-text-secondary) hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Codicon name="folder" size="0.875rem" />
      <span className="min-w-0 truncate">{name}</span>
    </button>
  )
}
