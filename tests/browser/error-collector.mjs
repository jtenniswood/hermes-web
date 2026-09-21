export function installBrowserErrorCollector(page, { ignore = [] } = {}) {
  const errors = []
  const isIgnored = message => ignore.some(pattern => pattern.test(message))
  const record = (kind, value) => {
    const message = `${kind}: ${value}`
    if (!isIgnored(message)) errors.push(message)
  }

  page.on('pageerror', error => record('pageerror', error.message))
  page.on('console', message => {
    if (message.type() === 'error') record('console.error', message.text())
  })

  return {
    errors,
    assertClean() {
      if (errors.length) throw new Error(`Unexpected browser errors:\n${errors.join('\n')}`)
    }
  }
}
