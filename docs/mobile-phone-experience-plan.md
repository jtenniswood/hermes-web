# Mobile phone experience plan

## Goal

Make Hermes Web comfortable for frequent chat use on narrow touch screens, including installed PWAs, while keeping the same core capabilities available on desktop. Optimize around the main phone workflow: open or resume a conversation, read and navigate a long response, compose and send a message, and reach secondary tools without losing context.

This is a planning document based on the repository's current browser shell and public mobile accessibility guidance. It is not a claim that every item below is a confirmed defect; the first phase measures the current experience on devices and turns the open questions into specific changes.

## Current foundations

The browser wrapper now gives compact navigation the full app viewport, keeps the conversation mounted behind it, and provides a Back to chat control. Context menus and wrapper-owned actions become bottom sheets on compact layouts. High-frequency navigation, profile, row, toolbar, sheet, and composer controls compensate for the app's CSS zoom so their rendered hit areas stay usable. The page opts into `viewport-fit=cover`; chat and setup overlays use safe-area values and dynamic viewport height in places. The composer, status bar, and many tool surfaces still come from the upstream renderer, and the remaining real-device and accessibility checks are listed in the implementation checkpoint.

The relevant wrapper-owned code is mainly in `apps/web-desktop/src/experience/browser.css`, `apps/web-desktop/src/web-overrides.css`, `apps/web-desktop/src/experience/browser-shell.tsx`, and `apps/web-desktop/src/platform/display.ts`. Chat, composer, status bar, and many tool surfaces come from the upstream renderer fetched at build time. Keep implementation work in the wrapper's owned sources and upstream transform/override mechanisms described in `AGENTS.md`.

## Principles and measurable goals

- **Keep the conversation primary.** On a phone, the conversation and composer should own the screen; navigation, profile selection, tools, and settings should be easy to reach and then get out of the way.
- **Respond to available space and input.** Use flexible layout and content-driven breakpoints, not assumptions about a particular phone model. Preserve a usable experience at 320 CSS px and with browser zoom. Do not rely on width alone to identify phone layouts: a phone in landscape can have a tablet-like CSS width but very little vertical space. Consider coarse pointer capability and available height alongside width, while preserving split navigation on tablets and hybrid devices where it remains useful.
- **Make touch forgiving.** Aim for 44–48px rendered hit areas for common actions, with enough separation to avoid adjacent mis-taps. Treat WCAG's 24px minimum as a floor, not a comfortable phone target.
- **Keep content visible while typing.** The focused composer, draft, attachment controls, and send/stop action must remain visible above the software keyboard. Long messages and tool results should have a clear scroll owner.
- **Preserve platform behavior.** Support safe areas, browser chrome changes, screen rotation, reduced motion, text resizing, keyboard navigation, and assistive technology.
- **Keep primary actions direct.** Sending, stopping generation, switching conversations, and opening navigation should not require precision gestures or hidden hover states.
- **Use phone-native surfaces.** On phones, navigation should take over the app viewport as a page with a clear way back to the conversation. Contextual actions should open in touch-friendly bottom sheets.
- **Scale the whole control, not just its icon.** Apply mobile UI scale consistently to control dimensions, text, spacing, and overlay bounds. Preserve generous tap areas at every supported scale and with enlarged text.

Suggested acceptance targets for the phone layout:

| Area | Target |
| --- | --- |
| Reflow | At 320 CSS px wide and at 200% text zoom, core reading, composing, sending, and navigation work without page-level horizontal scrolling. |
| Common hit areas | At least 44px square after the app's UI scale is applied for high-frequency toolbar, navigation, sheet, and composer actions; aim for 48px when layout permits. All controls meet WCAG 2.2 Target Size (Minimum), including its spacing exception. |
| Keyboard | In supported iOS Safari/PWA and Android Chrome/PWA configurations, focusing the composer leaves the caret, draft, attachment action, and send/stop action visible and usable. The page does not jump to an unrelated scroll position. |
| Safe area | Composer and bottom actions remain above the home indicator; top controls avoid notches and browser/PWA chrome. |
| Reading | Code blocks, tables, long assistant output, and tool output stay within the conversation surface and have an intentional overflow strategy. |
| Navigation | On phones, navigation opens as a full-page view with a clear Back/Close action. Returning restores the same conversation and scroll position. |
| Contextual options | Context menus on phones open as bottom sheets with readable labels, generous rows, safe-area padding, and an accessible close path. |
| Scaling | At every supported mobile UI scale and with enlarged text, controls retain readable labels, sufficient hit areas, and overlays that fit the available viewport. |

## Recommendations and sequence

### Phase 1 — Measure and identify phone friction

1. Walk through the critical path on narrow viewports: first load/setup, open and search sessions, switch profile, start chat, type a long draft, attach a file/image, send, stop and resume generation, inspect code/tool output, open settings, and recover from offline/reconnect.
2. Record viewport width/height, device/browser, installed-PWA versus browser mode, zoom/text-size setting, whether the keyboard is open, and each point where content is clipped, a tap target is difficult, or context is lost.
3. Capture screenshots at 320, 360/375, and 430 CSS px, plus landscape. Include the keyboard-open state and at least one long response with code and a long session list.
4. Verify both touch-first and hybrid devices. Compact mode uses a width breakpoint plus a coarse-pointer/short-height condition for landscape phones; test landscape phones explicitly, along with a narrow desktop window and a wide touch tablet. Confirm short-height treatment does not force a full-page layout on taller tablets. Compare the mobile default scale, smaller and larger scale settings, and enlarged text where available.

**Deliverable:** a short issue list ranked by impact and frequency, with device evidence for each confirmed issue.

### Phase 2 — Protect the core chat loop

1. Audit the composer in the upstream-rendered chat under keyboard-open states. Keep it anchored to the actually visible viewport, with safe-area padding and enough bottom space for browser chrome. Prefer platform-native resize behavior where reliable; use `VisualViewport` only for browser cases where layout viewport behavior demonstrably leaves the composer occluded. Handle viewport resize and scroll without repeated jumps.
2. Keep the input, attachment affordance, microphone if present, send/stop button, and any active queue indicator discoverable at narrow widths. Move lower-frequency composer actions into a clearly named overflow surface before shrinking their hit areas.
3. Ensure focus does not cause automatic page scrolling to hide the latest conversation context. When a user manually scrolls up to read, do not force them back to the bottom; provide a clear return-to-latest affordance when new output arrives.
4. Check draft preservation through route changes, opening/closing tools and full-page navigation, background/foreground transitions, and transient connection loss.
5. Inspect message actions and code-block actions for touch access. Actions that currently depend on hover should have a visible or explicit touch path; avoid placing multiple tiny icons beside each other.

**Done when:** a user can compose a long message, attach content, send, interrupt generation, and continue reading on an iPhone and Android phone without the keyboard covering controls or losing a draft.

### Phase 3 — Make navigation a full-page phone view and tune controls for thumbs

1. Replace the phone slide-in navigation drawer with a full-page navigation surface below the phone breakpoint. It should occupy the app viewport, including safe-area handling, and offer an obvious Back/Close action. On close or destination selection, return to the prior conversation with its draft and scroll position intact. Keep desktop and tablet navigation responsive to available space. Apply the phone treatment in landscape as well as portrait when the available height and touch input indicate a phone; validate the breakpoint against both landscape phones and wide tablets.
2. Organize the full-page navigation surface for phone scanning: provide clear destinations for Sessions, Bots, search, profiles, and tools; give long lists their own scrolling region; keep profile switching and primary navigation controls reachable without covering the last list item. At short landscape heights, let content scroll instead of compressing rows, and keep primary actions reachable without requiring precision gestures.
3. Convert contextual menus on phones (for example, session, Bot, profile, and group actions) into bottom sheets in portrait and landscape. Use the full available width, respect left/right/bottom safe areas, cap the sheet height to the visual viewport, and let long option lists scroll inside the sheet. Keep a visible title or context label, clear action labels, grouped options, destructive actions separated, and a visible Close/Cancel control. Preserve the originating item context and return focus to its trigger when closed. Desktop can retain anchored menus.
4. Size sheet rows and full-page controls for touch: keep frequent actions at least 44px in both rendered dimensions and aim for 48px, with spacing between adjacent icon controls. Because the app applies CSS zoom through `--web-ui-scale`, check the rendered hit area at the minimum and maximum supported mobile scale. If a smaller scale makes a target too small, compensate the target's minimum dimensions for the scale while allowing its label and surrounding layout to follow the user's scale setting. Increase row height where labels wrap or text is enlarged. Do not rely on hover, long press, or drag as the only way to invoke an action.
5. Measure actual clickable bounds, not just icon dimensions. Bring frequent controls (navigation, new chat, search, profile, settings, send/stop, close) toward 44–48px. Add padding or spacing around compact secondary actions; do not scale icons alone and assume the target is large enough.
6. Review the two-row top chrome on short phones and landscape. Give the conversation title or active context enough room, keep essential actions reachable, and move secondary actions into a labeled bottom sheet when space is constrained.
7. Review status controls and badges. Prevent overflow, truncation of important states, or wrapping that steals too much vertical space on short viewports.

**Done when:** phone navigation is a full-page view that returns cleanly to the previous chat; contextual options use bottom sheets; all common actions have generous hit areas; and no action depends on hover, drag, or a narrow screen-edge target.

## Implementation checkpoint — 2026-09-25

- Implemented in the browser wrapper: compact navigation now takes over the app viewport as a full-page view, with a Back to chat control, focus handling, and the conversation kept mounted while navigation is open.
- Implemented in wrapper styles: contextual menus and the browser-owned action surface open as bottom sheets on compact layouts, with safe-area padding, viewport-bounded height, internal scrolling, and larger option rows.
- Increased compact navigation, profile, session-row, toolbar, and sheet targets. A Chromium viewport check measured navigation and profile controls plus sheet options at 44px or larger at 50%, 75%, 100%, 125%, and 150% UI scale.
- The rendered touch-target audit found message actions reduced to roughly 18px and hidden behind hover, plus undersized session-list, search, filter, and reorder controls at 50% UI scale. Compact message actions are now directly visible and scale-compensated; the session navigation controls, search, and reorder handle also receive scale-compensated minimum dimensions. The focused Chromium regression measures these along with composer, approval, navigation, and sheet targets at 50%, 75%, 100%, 125%, and 150% UI scale.
- A follow-up rendered audit found the Sessions section toggle was only 6px high and the status-row Copy path/New branch actions were 8px and hover-only. Both now have visible, scale-compensated phone hit areas; regression checks require their rendered targets to meet the 44px minimum at all five tested UI scales.
- Added wrapper sizing overrides for frequent composer actions. Chromium checks passed for Add context, Model, and voice-conversation controls at 44px or larger at 50%, 75%, 100%, 125%, and 150% UI scale; at 320px and 200%, Add context, Queue message, and Send remain at least 44px and within the viewport. The Stop control also meets 44px while generation is running at phone width.
- At 320px emulated width and 200% UI scale, the toolbar no longer overlaps the navigation trigger, the document has no horizontal overflow, full-page navigation fills the viewport while hiding chat, and a contextual sheet fits the viewport width and bottom edge.
- Focused Chromium checks passed for the full-page navigation/action-sheet scale loop and pinned-section phone/desktop flows. `pnpm typecheck` passed and the web-desktop production build completed successfully.
- Fixed and verified the session-row kebab tap path. On touch, the sheet moved under the finger between pointer-down and the synthesized click, so the click activated its first option. A wrapper-level capture guard now ignores only that opening click. A touch-enabled Chromium regression confirms the sheet remains open, the conversation row stays in place, Escape returns focus to the kebab, and the sheet fills the phone viewport; the broader phone/layout suite passed 10 checks.
- A WebKit browser smoke check also passes at 390px for switching conversations while preserving drafts. This is cross-engine emulation; it does not replace checks on physical iOS Safari/PWA and Android Chrome/PWA devices.
- Six additional Chromium checks passed for composer placement while idle/running/reconnecting and for retaining an unsent draft and attachment while opening tool modals at phone and desktop widths.
- Four more Chromium checks passed for phone navigation-tab and profile-sheet focus, selection, and draft behavior at 100% and 150% UI scale.
- A 320px long-response check now verifies that a very wide highlighted-code line and a wide table each scroll inside their own content container, while the document itself remains 320px wide.
- Compact layout now also activates for a coarse-pointer viewport no taller than 27rem, so landscape phones receive the full-page navigation, larger controls, and bottom-sheet contextual menus despite their wider CSS viewport. Taller touch tablets retain split navigation.
- A focused touch-enabled Chromium regression passed at 844×390 for full-page navigation and bottom-sheet placement, and at 1024×768 for the taller tablet split layout. This validates responsive behavior in emulation; it does not replace device checks.
- Six focused Chromium browser checks passed against the repository's synthetic gateway for the supported touch-target scales, 320px/200% composer and sheet bounds, landscape phone/tablet layouts, idle/running/reconnecting composer placement, and a tool surface at 320×480.
- Replaced the remaining wrapper-owned `100vh` max-height with `100dvh` so the panels menu follows the visible viewport as mobile browser chrome changes.
- Increased the revealed workspace-panel close target to 44px after app zoom compensation; the 390px phone regression passed at 50% UI scale while preserving the chat draft.
- The expanded target audit passed for the message toolbar, status-row actions, session section toggle and rows, search, New session, Filters, and reorder affordance at all five tested scales. Eleven selected Chromium mobile/layout regressions passed, including 320px/200% scale, short landscape, overflow, tool surfaces, and approval-mode synchronization; the WebKit draft/navigation smoke test passed. The production build completed successfully, typecheck passed, and the compatibility registry reports 84 owned entries with declared behavioral verification.
- Added a keyboard regression for full-page navigation focus containment: focus starts at Back to chat, Shift+Tab stays inside the modal navigation surface, and Tab cycles back to its first control. The focused Chromium check passes.
- Still required before calling the mobile experience complete: checks on physical iOS Safari/PWA and Android Chrome/PWA devices, real software-keyboard behavior, safe-area and browser-chrome changes, VoiceOver/TalkBack, and overflow audits across the remaining tool surfaces. Desktop emulation does not reproduce all browser chrome, software keyboard, or assistive-technology behavior.

### Phase 4 — Improve long-content reading and tool surfaces

1. Check message widths and line lengths on phones. Keep normal prose readable without making code, diagrams, or wide tables force the entire page wider than the viewport.
2. Give wide code/table content a local horizontal scroller with a visible affordance and preserve access to copy/run actions. Keep the page itself vertically scrollable and avoid nested scroll traps.
3. Check file previews, terminal, browser/workspace panels, settings forms, confirmation dialogs, contextual bottom sheets, and tool modals at 320px wide and at short viewport heights. Overlays should fit the visual viewport, scroll internally when needed, and keep close/confirm actions reachable.
4. Review markdown links, citations, status/error banners, and streaming output for wrapping and overflow. Avoid fixed widths that assume desktop cards.
5. Ensure controls remain available when the user enlarges text or zooms. Let content grow and reflow instead of clipping labels or overlapping adjacent controls.

**Done when:** the page has no unintended horizontal scrolling, all long content has an intentional local overflow behavior, and dialogs remain operable in portrait and landscape.

### Phase 5 — Accessibility, resilience, and finish

1. Test the full-page navigation view, bottom sheets, dialogs, session list, and composer with keyboard-only navigation and VoiceOver/TalkBack. Verify labels, selected states, sensible focus order, focus restoration, and that modal sheets contain focus while open. Verify Back/Close behavior with touch, Escape where a hardware keyboard exists, and assistive technology.
2. Check contrast, visible focus, text spacing, reduced motion, and 200% text resizing. Confirm zoom remains enabled; do not disable pinch zoom through viewport metadata.
3. Test safe-area insets on notched iPhones and installed PWA mode, browser address-bar expand/collapse, rotation, and keyboard show/hide. Inspect use of `100vh` versus `dvh`/visual viewport in wrapper-owned fixed surfaces, including full-page navigation and bottom sheets.
4. Test slow/offline/reconnecting states and interrupted streaming on mobile networks. Keep status messages understandable and ensure retries do not cover the composer or navigation controls.
5. Add targeted automated checks for stable geometry and interaction only after the device audit establishes expected behavior. Keep a small manual device checklist because desktop emulation does not fully reproduce mobile browser chrome, virtual keyboards, or assistive technology.

## Manual device pass

Run this pass on a physical iPhone using Safari and its installed PWA, and on a physical Android phone using Chrome and its installed PWA. Record the OS and browser versions, portrait/landscape dimensions, app UI scale, text-size setting, and whether browser chrome or the software keyboard is visible.

| Check | Pass condition | Evidence to record |
| --- | --- | --- |
| Full-page navigation | Navigation fills the app view; Back to chat returns to the same conversation, draft, and reading position. | Portrait and landscape screenshots; note focus after returning. |
| Contextual bottom sheets | Session, profile, Bot, and settings options open at the bottom, fit above the home indicator, scroll when needed, and close without activating the option under the opening tap. | Screenshot each representative sheet; note touch and focus behavior. |
| Touch targets and scaling | Navigation, composer, send/stop, and sheet actions remain comfortably tappable at default and smallest/largest supported UI scales; labels do not collide or clip. | Record the smallest measured hit area and any overlap at each scale. |
| Software keyboard | Focus the composer, type a long draft, attach a file/image, send, and stop generation; the active controls and caret stay visible above the keyboard. | Keyboard-open screenshot; note any viewport jump or hidden action. |
| Safe areas and browser chrome | Notch, home indicator, and expanding/collapsing address bars do not cover controls or leave a dead area. | Screenshots with browser chrome expanded and collapsed; record rotation behavior. |
| Long content and tools | Code and tables scroll inside their content; representative file, terminal, settings, and tool surfaces fit short viewports and keep close/confirm actions reachable. | Screenshot each failing surface and identify the smallest usable viewport. |
| Assistive technology | VoiceOver/TalkBack announces labels and selected states; sheets have a clear close path and return focus to the trigger. | Record screen-reader and keyboard findings separately. |

Log each failure with reproduction steps, device/browser version, dimensions, UI scale, screenshot, and impact. Re-run the same steps after each fix.

## Implementation order

1. Complete the device audit and create reproducible issue cases.
2. Fix keyboard/composer occlusion and any safe-area defects.
3. Implement full-page phone navigation and contextual bottom sheets, preserving navigation state, originating context, and focus return.
4. Increase undersized high-frequency touch targets; confirm sizing across mobile zoom levels and resolve top-chrome collisions.
5. Fix full-page navigation scrolling/focus, sheet sizing, and mobile dialog constraints.
6. Tune long response/code/table reading and remaining tool surfaces.
7. Run accessibility and real-device regression passes, then document supported browser/PWA behavior.

Avoid a broad mobile redesign before Phase 1: the app already contains significant mobile-specific behavior, and device evidence will help distinguish real gaps from deliberate upstream behavior.

## Research and standards

- [WCAG 2.2, Success Criterion 2.5.8: Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum) sets a 24×24 CSS px minimum with defined exceptions. [WAI's explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) explains the spacing exception and why larger targets help touch users.
- [WCAG 2.2, Success Criterion 1.4.10: Reflow](https://www.w3.org/TR/WCAG22/#reflow) expects vertically scrolling content to work at 320 CSS px without two-dimensional scrolling, except where two-dimensional layout is essential.
- [Apple's UI design tips](https://developer.apple.com/design/tips/) recommend a 44×44 point hit target and fitting the layout to the device screen. Apple points are platform units, not CSS pixels; use this as a touch comfort reference rather than a direct CSS conversion.
- [Apple's Buttons guidance](https://developer.apple.com/design/human-interface-guidelines/buttons) likewise recommends at least a 44×44 point hit region for buttons.
- [Android's common layout guidance](https://developer.android.com/design/ui/mobile/guides/layout-and-content/common-layouts) describes bottom sheets as supporting content and controls that keep the primary view focused. This fits contextual actions while leaving the chat as the main phone surface.
- [web.dev's accessible tap target guidance](https://web.dev/articles/accessible-tap-targets) recommends about 48 device-independent px and roughly 8px spacing for touchscreen targets.
- [web.dev's responsive design basics](https://web.dev/articles/responsive-web-design-basics) recommend a device-width viewport, flexible content that avoids horizontal scrolling, and responsive layouts that account for input capabilities.
- [MDN's VisualViewport API reference](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) notes that the on-screen keyboard can shrink the visual viewport without changing the layout viewport. [MDN's `env()` reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env) documents safe-area inset variables for notched displays and related device UI.
- [web.dev's accessible responsive design guidance](https://web.dev/articles/accessible-responsive-design) covers preserving zoom, using relative text units, and checking that visual layout order still matches keyboard/source order.

These sources provide baseline practices; the implementation details should be validated against the iOS Safari/PWA and Android Chrome/PWA versions this project supports.
