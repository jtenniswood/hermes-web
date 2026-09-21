# Browser compatibility transform inventory

The browser wrapper owns controls and presentation that differ from the desktop
renderer. The remaining transforms below are deliberately narrow compatibility
boundaries for upstream state, lifecycle, or runtime assumptions. They are not
browser UI implementations and should be removed only when the corresponding
upstream contract or adapter makes them unnecessary.

| Boundary | Current purpose | Removal condition |
| --- | --- | --- |
| Browser-scoped storage | Keeps browser navigation, tab, width, and hidden-profile preferences separate from desktop layout state. | Upstream exposes a stable browser storage namespace and migration contract. |
| Panel overlays and empty-panel close | Preserves browser panel presentation and close behavior while reusing contributed panel bodies. | Upstream panel composition supports the browser shell's single-conversation and overlay lifecycle directly. |
| Statusbar export | Keeps the upstream statusbar actions available to the browser toolbar without importing desktop composition. | Upstream provides a stable statusbar item adapter with the required callbacks and selected-state updates. |
| Activity, keybind, session, and Bot-row compatibility | Bridges renderer hooks and row behavior whose data/action contracts remain upstream-owned. | The adapter can consume public contracts without source-level compatibility handling. |
| Ungrouped sessions and session-tab suppression | Prevents desktop grouping and chat-tab presentation from leaking into the browser's single-conversation shell. | Upstream offers explicit composition flags for these modes. |
| Tooltip, microphone, and composer metrics | Preserves interaction affordances and layout measurements while the browser shell changes surrounding chrome. | The upstream components accept browser layout and accessibility configuration directly. |
| Gateway, batch, and source compatibility | Protects runtime wiring and the locked dependency behavior required by the production bundle. | The renderer and dependency versions provide the same runtime guarantees without an in-memory compatibility patch. |
| Settings, Bots, and approval controls | These are wrapper-owned components resolved through the override boundary; their former JSX rewrites have been removed. | Keep wrapper ownership while product requirements differ; migrate only when upstream supplies equivalent browser composition points. |

The rule for new work is to add an adapter or explicit wrapper boundary when a
browser requirement is stable, and to avoid adding another string-generated JSX
rewrite. Every transform should have a source guard, an idempotent application
path, and a browser test that exercises the user-visible contract. The adapter
test and production-image browser suite are the enforcement points for this
inventory.
