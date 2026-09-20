import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { matchesGatewayRoute, runtimeConfiguration, runtimeScripts, renderNginx } from './runtime-config.mjs'

test('runtime identity changes with the backend and excludes credentials', () => {
  const a = runtimeConfiguration({ HERMES_GATEWAY_URL: 'http://gateway.example.test:9119' })
  const b = runtimeConfiguration({ HERMES_GATEWAY_URL: 'http://other.example.test:9119' })
  assert.notEqual(a.publicConfig.gateway.id, b.publicConfig.gateway.id)
  assert.equal(a.publicConfig.gateway.id, runtimeConfiguration({ HERMES_GATEWAY_URL: a.target + '/' }).publicConfig.gateway.id)
  for (const url of ['file:///tmp/config', 'http://user:secret@gateway.test', 'https://gateway.test/prefix', 'https://gateway.test/?token=secret']) {
    assert.throws(() => runtimeConfiguration({ HERMES_GATEWAY_URL: url }), /HTTP\(S\) origin/)
  }
  const scripts = runtimeScripts(runtimeConfiguration({ HERMES_GATEWAY_NAME: '</script>"\n' }))
  const context = vm.createContext({ window: {} })
  vm.runInContext(scripts['runtime-config.js'], context)
  assert.equal(context.window.__HERMES_RUNTIME_CONFIG__.gateway.name, '</script>"\n')
  assert.ok(!scripts['runtime-config.js'].includes('</script>'))
})

test('production and development routes have exact path boundaries', () => {
  for (const url of ['/api', '/api/status', '/auth/callback', '/login?return=/']) assert.equal(matchesGatewayRoute(url), true)
  for (const url of ['/apiary', '/authentication', '/logins', '/assets/app.js']) assert.equal(matchesGatewayRoute(url), false)
  const config = runtimeConfiguration({ HERMES_HOME: '/tmp/plugin files' })
  const rendered = renderNginx(readFileSync(new URL('../nginx.conf.template', import.meta.url), 'utf8'), config)
  assert.ok(!rendered.includes('${HERMES_'))
  assert.ok(rendered.includes('alias "/tmp/plugin files/plugins/"'))
  assert.ok(rendered.includes('proxy_pass http://127.0.0.1:9119;'))
  assert.throws(() => runtimeConfiguration({ HERMES_HOME: '/tmp/"; include arbitrary;' }), /Hosting paths/)
})
