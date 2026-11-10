/**
 * What the app tells people when Canvas will not do something.
 *
 * Plain words first: what happened and what to do, no status codes or technology names. The
 * technical cause (status and Canvas's own wording) travels behind the details marker so the
 * screen can fold it under "Show technical details". Kept free of Electron imports for testing.
 */
import { withDetails } from './errorDetails'

export function canvasApiMessage(status: number, body = ''): string {
  const technical = `Canvas replied with status ${status}${body ? `: ${body.replace(/\s+/g, ' ').trim()}` : '.'}`
  let plain: string
  if (status === 401) {
    plain =
      'Canvas no longer accepts your saved access code. It may have expired. ' +
      'What to do: open Initial Setup, make a new access token in Canvas ' +
      '(Account → Settings → New Access Token), and paste it in.'
  } else if (status === 403) {
    plain =
      'Your Canvas account isn’t allowed to do this in this course. ' +
      'What to do: make sure you are a teacher, designer or course administrator in the course, ' +
      'or ask the course owner to add you.'
  } else if (status === 404) {
    plain =
      'Canvas can’t find this course. ' +
      'What to do: check that the link you pasted is the right course, and that you are signed up in it. ' +
      'Courses that have ended may no longer be available.'
  } else if (status === 429) {
    plain = 'Canvas needs the app to slow down. What to do: wait 5 minutes and try again.'
  } else if (status >= 500) {
    plain =
      'Canvas is having trouble right now. This is not caused by you or your course. ' +
      'What to do: wait a few minutes and try again. If it still fails, tell your Canvas support team.'
  } else {
    plain =
      'Canvas wouldn’t accept that. ' +
      'What to do: try again. If it fails again, send the technical details to the person who supports this app.'
  }
  return withDetails(plain, technical).message
}

/** The request never got an answer. `cause` is the system's own description, kept for support. */
export function canvasUnreachableMessage(cause = ''): string {
  return withDetails(
    'The app can’t reach Canvas. What to do: check your internet connection and try again.',
    cause,
  ).message
}
