# Web UI styles

The browser wrapper reuses the Hermes renderer's components and theme. Its
presentation is defined in `apps/web-desktop/src/experience/styles/`:

| File | Responsibility |
| --- | --- |
| `tokens.css` | Theme adapter, spacing, typography, icon sizes, radii, density, touch targets, and safe-area values |
| `controls.css` | Shared toolbar/action button variants, icon alignment, hover states, and keyboard focus |
| `menus.css` | Dropdowns, context menus, nested menus, and browser action sheets |

`experience/browser.css` owns shell layout and product-specific adjustments.
`web-overrides.css` owns compatibility with the upstream renderer, including
portal positioning and mobile composer controls. `web.css` imports the upstream
Tailwind stylesheet. Its startup recovery colours remain independent because
that UI can appear before the renderer has initialized its theme.

## Adding UI

Use the existing components exported through `upstream/browser-api.tsx` for
forms, dialogs, menus, and tooltips. Use `BrowserToolbarButton` for an icon
button and set `size="compact"` for a section-header action. Both sizes become
touch-friendly in compact layouts; avoid inline icon sizes or separate
per-screen padding rules.

Use `BrowserActionSurface` for browser-owned action lists. The same commands
render as a keyboard-accessible menu on desktop or an action sheet on phones.
Use `BrowserModal` for browser-owned dialogs. Keep behavior in React components
and presentation in the shared styles.

Use semantic `--web-*` tokens in new browser CSS. Only `tokens.css` should map
shared colours and fonts to upstream names. Do not reintroduce legacy variables
such as `--border`, `--popover`, or `--muted-foreground`: the current renderer
does not define those variables. Do not change the fetched `apps/desktop` or
`apps/shared` sources to style the browser wrapper.

## Density and responsiveness

- Action icons: 16px; secondary disclosure icons may be 12px.
- Desktop action buttons: 36px, or 24px for compact section actions.
- Desktop menu rows: at least 24px with 12px text.
- Compact or coarse-pointer action buttons and menu rows: at least 52 physical pixels; secondary
  navigation/composer targets use a 44px minimum.
- Compact or coarse-pointer menu text: 13px. Long descriptions can wrap and expand their rows.
- Spacing: use the shared 4/8/12/16/24px scale. Geometry such as avatars, resize
  handles, and drag indicators can keep purpose-specific dimensions.

Compact layout starts below 48rem (768px at the default browser font size), or
on a coarse-pointer viewport no taller than 27rem. At exactly 48rem, a tall
viewport uses the desktop layout. Keep this boundary aligned with
`ui/use-compact-browser.ts`; CSS variables cannot be used as media-query values.

Wide touch tablets retain the desktop layout with larger controls and menu
rows. Layout and touch density are separate decisions.

Touch measurements compensate for the app's CSS zoom. Use `--web-touch-min`
and `--web-touch-target` rather than repeating zoom calculations. The
`--web-sheet-*` tokens keep scrolling sheets inside the viewport and respect
safe-area insets. All tokens are rooted at `:root` so portaled menus and dialogs
receive the same theme as the shell.

## Checking changes

Run `pnpm typecheck`. With the synthetic review gateway and Vite preview running,
run the rendered style checks:

```bash
HERMES_BROWSER_PREVIEW_URL=http://127.0.0.1:5174 \
  pnpm exec playwright test tests/browser/browser.spec.mjs \
  --project=chromium --grep 'shared UI styles'
```

These cover light/dark themes, 100%/150% app zoom, both sides of the navigation
breakpoint, phone and landscape touch layouts, centered icons, physical touch
sizes, focus indicators, menus, nested menus, and sheet scrolling. They compare
browser-owned menus with renderer-owned menus rather than inspecting stylesheet
text. Existing screenshot attachments provide a visual check alongside the
behavioral assertions.
