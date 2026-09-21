import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 45000,
  use: { headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /webkit\.spec\.mjs$/, use: { browserName: 'chromium' } },
    { name: 'webkit', testMatch: /webkit\.spec\.mjs$/, use: { browserName: 'webkit' } }
  ],
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }]
  ]
})
