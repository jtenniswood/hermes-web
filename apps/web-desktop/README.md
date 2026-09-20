# Hermes Desktop in the browser

This workspace composes the upstream Hermes Desktop renderer with browser
services. Upstream files are fetched at the exact revision in the root
`flake.lock`; they are never edited here.

See the root [README](../../README.md) for setup and hosting commands.

## Ownership

- `src/platform`: browser transport, authentication, attachments, clipboard,
  notifications, runtime configuration, and display preferences.
- `src/upstream`: renderer imports, desktop bridge assembly, checked transforms,
  and module overrides.
- `src/overrides`: browser components using upstream visual primitives.
- `src/web-bridge`: stable bridge installation and connection compatibility.
- `vite.config.ts`: build composition and the single-gateway development server.

Docker and development serve `runtime-config.js` with no caching. Browser
requests stay on the app origin and the server forwards them to its one
configured gateway. Profiles and Bots still share that gateway.

Notifications require browser permission and a supported secure context.
They are page/service-worker notifications, not server push subscriptions.
Native terminal, native git, desktop overlays, and desktop updating are not
browser capabilities. File attachments use browser File/Blob handles.
