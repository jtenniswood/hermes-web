import ts from 'typescript'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repositoryRoot } from './renderer.mjs'

const fatalCodes = new Set([2307, 2688, 6053, 7016])
export function classifyDiagnostics(diagnostics, baseline) {
  const remaining = [...baseline]
  const unexpected = []
  for (const diagnostic of diagnostics) {
    const upstream = diagnostic.file?.startsWith('apps/desktop/') || diagnostic.file?.startsWith('apps/shared/')
    const index = remaining.findIndex(item => JSON.stringify(item) === JSON.stringify(diagnostic))
    if (upstream && !fatalCodes.has(diagnostic.code) && index !== -1) remaining.splice(index, 1)
    else unexpected.push(diagnostic)
  }
  return { unexpected, stale: remaining }
}

function check() {
  const configPath = path.join(repositoryRoot, 'apps/web-desktop/tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const aliases = ['desktop', 'shared'].map(name => ({ actual: realpathSync(path.join(repositoryRoot, 'apps', name)), logical: `apps/${name}` }))
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(d => {
    let file = d.file ? path.relative(repositoryRoot, d.file.fileName).replaceAll('\\', '/') : '<compiler>'
    for (const alias of aliases) if (d.file?.fileName.startsWith(alias.actual + path.sep)) file = alias.logical + d.file.fileName.slice(alias.actual.length)
    const position = d.file?.getLineAndCharacterOfPosition(d.start ?? 0)
    return { file, code: d.code, line: position ? position.line + 1 : 0, column: position ? position.character + 1 : 0, message: ts.flattenDiagnosticMessageText(d.messageText, '\n').replaceAll(repositoryRoot, '<repo>') }
  })
  const baseline = JSON.parse(readFileSync(new URL('./upstream-diagnostics.json', import.meta.url), 'utf8'))
  const { unexpected, stale } = classifyDiagnostics(diagnostics, baseline)
  for (const d of unexpected) console.error(`${d.file}:${d.line}:${d.column} TS${d.code}: ${d.message}`)
  for (const d of stale) console.error(`Remove resolved upstream baseline entry: ${d.file}:${d.line} TS${d.code}`)
  if (unexpected.length || stale.length) process.exitCode = 1
  else console.log(`Typecheck passed (${diagnostics.length} explicitly baselined upstream diagnostics).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { check() } catch (error) { console.error(error); process.exitCode = 1 }
}
