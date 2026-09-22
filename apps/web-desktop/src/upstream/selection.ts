import { openSession } from '@/app/open-session'
import { forgetSessionOwnerHintsForSession, requestSessionResume, sessionOwnerRouteFromRow } from '@/store/session'
import { bumpBotOpenGeneration } from '@/plugins/hermes-bots/shared'
import { reportActionFailure } from '../experience/action-errors'
import type { BrowserNavigate, BrowserSessionSelection } from '../experience/contracts/selection'

/** Preserve row ownership and cancel older Bot navigation before selecting a session. */
export function selectBrowserSession(selection: BrowserSessionSelection, navigate: BrowserNavigate): void {
  if (!selection.sessionId) return
  bumpBotOpenGeneration()
  try {
    const owner = sessionOwnerRouteFromRow({ connection_id: selection.connectionId, profile: selection.profile })
    if (owner) requestSessionResume(selection.sessionId, owner)
    else {
      forgetSessionOwnerHintsForSession(selection.sessionId)
      requestSessionResume(selection.sessionId)
    }
    openSession(selection.sessionId, navigate)
  } catch {
    reportActionFailure('Could not open conversation.')
  }
}
