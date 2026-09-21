# Mobile experience plan

Status: proposed; no application changes or deployment are part of this review.

## Direction

Optimize for iPhone Safari/Home Screen and Android Chrome/installed PWA. Keep the existing desktop experience and shared chat functionality, with a phone-specific layout and touch interactions. Preserve the user's UI scaling preference, smaller grey icons, single-chat presentation, and current navigation organization.

The core phone journey should be: open a session, read progress, send a message or attachment, respond to an approval, and return later without losing context.

Confirmed mobile interaction choices: contextual menus use bottom-sheet modals, and profile reordering is disabled on mobile. Desktop profile reordering remains available.

## Findings from the current implementation

Reviewed wrapper code and synthetic chat/navigation previews at 360, 390, and 430 CSS-pixel widths using touch-enabled Chromium emulation. These checks do not establish actual iOS behavior, software-keyboard behavior, or reliability after background suspension.

- The navigation drawer clips at the right edge in the phone preview. Its `min(21rem,88vw)` width interacts with the app's default 125% CSS zoom. Drawer and portal sizing need a consistent coordinate system.
- Desktop keyboard shortcut hints remain visible in the mobile session list.
- The chat header has separate navigation, chat actions, settings, and panel controls. Several hit areas are only 32 CSS pixels before app scaling.
- The composer includes a branch row, multiple small controls, and an approval-mode row. Some controls have little explanation without hover.
- Profile ordering uses native HTML drag-and-drop. Disable profile reordering on mobile while preserving profile selection and the saved display order.
- Safe-area handling, draft protection, and coordinated PWA updates already exist. Extend these rather than building competing mechanisms.
- The notification bridge can display notifications from a running page. Reliable delivery while the app is suspended requires a separate assessment of server-driven Web Push.
- The PWA precaches all matching application assets, with a generous allowance for large chunks. Measure both startup transfer and installation/cache cost on mobile connections.

## Proposed phone layout

| Area | Proposed behavior |
| --- | --- |
| Header | Sessions control, truncated chat title, and one More menu. Keep the title blank for a new session. |
| Conversation | Full available width, modest side padding, readable message spacing, independently scrollable wide code/tables. |
| Composer | Text field, attachment action, and Send/Stop as the primary controls. A compact options control opens secondary controls. |
| Sessions | Full-width navigation view with Search, New session, session list, and a clearly labelled active profile control. |
| Contextual menus | Bottom-sheet modals for session/message actions, header menus, profile actions, list filters, and composer choices. Nested choices stay within the sheet with a Back action. |
| Secondary tools | Full-screen views with Back for settings, files, logs, and complex tools opened from a sheet. |

Opening Sessions preserves the current draft and scroll position. Selecting a session returns to chat. Browser/Android Back first closes the current sheet or secondary view. Dismissing a sheet restores focus to its trigger. Avoid adding a permanent bottom navigation bar that competes with the composer and keyboard.

Bottom sheets use a dimmed backdrop, a clear title and close control, safe-area padding, and scrollable content bounded by the available height. Keep focus inside the modal and prevent background interaction/scrolling. Backdrop tap and Back dismiss contextual menus without triggering an action; nested Back returns to the previous choices first. Swipe-to-dismiss may supplement these controls but must not be required.

## Delivery 1 — Make the current UI fit and respond reliably

**Priority: essential foundation.**

- Fix drawer, dialog, and menu sizing at the current 125% default and user-selected scales. Use the available container width rather than uncompensated viewport units inside zoomed elements.
- Keep the composer above the software keyboard and the latest message reachable. Account for browser toolbar changes, safe-area insets, rotation, and installed-app mode. Use dynamic viewport sizing and feature-detected visual viewport measurements where necessary: the keyboard can shrink the visible viewport without changing the layout viewport. [MDN: VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
- Avoid opening the keyboard automatically when navigating to a session. Preserve normal text selection and pinch zoom.
- Target 48-by-48 CSS-pixel touch areas at normal scale, with adequate separation. Increase button padding without enlarging the requested small grey glyphs. [web.dev: Accessible tap targets](https://web.dev/articles/accessible-tap-targets)
- Remove desktop shortcut badges on touch layouts. Make all essential actions available through taps and visible labels rather than hover tooltips or right-click.
- Keep the Hermes empty state centered within the remaining conversation space, with responsive text sizing even when the keyboard is visible.

**Acceptance:** no clipped navigation or page-wide horizontal scrolling at 360–430px widths; menus stay within the screen; input and Send remain visible with a real phone keyboard open; desktop layout and saved scale remain intact.

## Delivery 2 — Simplify navigation and writing

**Priority: essential daily-use experience; depends on Delivery 1.**

- Implement the compact header and phone navigation view. Place Search close to the session list and keep New session easy to reach. Retain the existing More/Less secondary navigation and the Systems/Workspace organization in the settings destination.
- Use bottom-sheet modals consistently for contextual menus, including session actions such as Rename, Pin, and Archive. Replace nested flyout menus with choices inside the same sheet and a Back action.
- Consider `Grouping: None` as the default for new mobile preferences; never overwrite an existing selection. Preserve access to all current grouping options.
- Open profiles in a labelled bottom-sheet picker showing avatar, name, and active state. Disable profile reordering on mobile: no draggable avatars, reorder handles, Edit order mode, or Move up/Move down actions. Taps select profiles; scrolling and long presses must not change their order. Preserve the existing saved order and desktop reordering behavior.
- Move model, approval mode, voice settings, and branch details into a composer options bottom-sheet modal. Keep current model/approval state discoverable in a compact summary. Preserve a direct voice shortcut if testing shows it is a frequent action.
- Make Enter insert a newline on the software keyboard and use the explicit Send button to submit. Keep Stop visible while the agent is running.
- Add clear attachment choices for photos, camera, and files where supported, with upload progress, removal, cancellation, and retry. Preserve drafts if a file picker interrupts the page.
- Provide voice recording states for permission, recording, processing, failure, and cancellation. Request microphone access on explicit use and remove reliance on hover-only voice controls.
- Make message actions accessible through an explicit tap control opening a bottom-sheet modal. Approval requests should show the action and scope clearly, with comfortably separated controls.

**Acceptance:** a user can switch profiles, find a session, attach a photo, dictate or type a message, and respond to an approval using only touch. All contextual menus open as bottom-sheet modals with working dismissal and focus restoration. Mobile interactions never reorder profiles; saved order and desktop reordering remain intact. No action requires a tooltip, drag gesture, or hardware keyboard.

## Delivery 3 — Make interruptions and long sessions safe

**Priority: required before treating the phone experience as complete.**

- Test and harden reconnection after screen lock, app switching, and Wi-Fi/mobile-data changes. Reconcile server state on return without duplicate messages or losing the current session.
- Preserve text drafts per session/profile through reloads and interruptions. File blobs are currently held in memory: either persist pending attachments appropriately or explain when they must be reselected; do not promise attachment recovery that does not exist.
- Show concise connection and retry states. Keep unsent messages visible, and require an explicit retry unless duplicate-safe delivery is established. Offline access to an app shell does not imply the agent can run offline.
- Preserve the existing protection against updating during recording, uploads, active work, or unsaved drafts. Make update notices compact on phones.
- Check long conversations and streaming responses for scroll jumps, input lag, and excessive rendering. Keep automatic scrolling conditional on the user already being near the latest message.
- Measure initial load, cache installation size, and repeat launches on a representative Android phone and constrained network. Defer rarely used tools and heavy assets where measurements justify it.
- Verify VoiceOver/TalkBack names, focus order, sheet focus management, contrast, larger text, reduced motion, and keyboard access.

**Acceptance:** background/resume restores the correct conversation and current server state; interruptions do not silently discard drafts or duplicate sends; long chats remain responsive; screen readers can complete the primary chat journey.

## Delivery 4 — Add phone-specific conveniences

**Priority: optional improvements after the core experience is reliable.**

- Offer contextual Home Screen installation guidance and a polished standalone launch experience.
- Add opt-in notifications for task completion and approvals if desired. Audit backend event delivery, push subscriptions, authentication, and session deep links before implementation. On iOS, plan around Home Screen web apps and permission requested from an explicit user interaction. [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- Let users choose notification previews and disable them easily. Avoid permission prompts during first launch.
- Evaluate sharing text/files into Hermes and sharing results out using progressive enhancement, only after checking the target browsers and installed-app behavior.

## Implementation boundaries

Work in `apps/web-desktop/src/experience/` for layout and navigation, `web-overrides.css` and `platform/display.ts` for viewport/scaling integration, `platform/` for browser input and lifecycle behavior, and `pwa/` for installation/update behavior. Use guarded adapters in `upstream/browser-plugin.ts` where shared renderer behavior must change.

Do not edit fetched `apps/desktop/` or `apps/shared/` sources. Keep desktop behavior behind the existing wide-layout path and apply touch affordances based on input capability as well as width. Notifications requiring server-side delivery should be a separately scoped integration.

## Verification and release sequence

Deliver each increment to the demo for phone review before building the next interaction layer. Extend browser tests for touch input, overflow, navigation/Back, bottom-sheet modality and dismissal, draft preservation, and saved preferences. Verify mobile profile drag/long-press gestures do not change the saved order and that profile selection still works. Continue desktop regression checks, including profile reordering.

Manually test on a real iPhone and Android phone, in both browser and installed mode: keyboard open/close, portrait/landscape, app switching, screen lock, photo/file picker return, microphone allow/deny, interrupted uploads, network changes, and large text. Emulation alone cannot validate these behaviors.

Start with Delivery 1 plus a compact composer prototype. These address the greatest immediate friction and establish whether the proposed layout works comfortably with one hand.
