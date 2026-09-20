// The browser shell uses the upstream contribution wiring, but it does not
// render the desktop controller. Importing the controller module still matters:
// its module-level setup registers panes, layout presets, bundled plugins,
// session routing, and the overlay bindings consumed by BrowserShell.
import '../../../desktop/src/app/contrib/controller'

export function initializeBrowserShell(): void {
  // The import above is intentionally side-effect-only. BrowserShell mounts
  // the single ContribWiring instance; mounting ContribController here would
  // create a second wiring tree and duplicate overlays.
}
