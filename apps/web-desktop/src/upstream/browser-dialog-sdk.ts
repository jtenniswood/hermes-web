// Keep plugin commands and controls upstream-owned; override only the dialog
// boundary for the registered forms that consume the SDK's component exports.
export * from '@hermes/plugin-sdk'
export { Dialog, DialogContent } from './browser-dialog'
