/**
 * What the app tells people when Canvas will not do something.
 *
 * Plain words first: what happened and what to do, no status codes or technology names. The
 * technical cause (status and Canvas's own wording) travels behind the details marker so the
 * screen can fold it under "Show technical details". Kept free of Electron imports for testing.
 */
import { withDetails, SUPPORT_CONTACT } from './errorDetails'

/**
 * `what` names the thing that was being asked for when it is not "this course" (for example "your
 * list of courses"), so a 403 or 404 on a list or a sub-resource is not blamed on the course link.
 */
export function canvasApiMessage(status: number, body = '', what?: string): string {
  const technical = `Canvas replied with status ${status}${body ? `: ${body.replace(/\s+/g, ' ').trim()}` : '.'}`
  let plain: string
  if (status === 401) {
    plain =
      'Canvas no longer accepts your saved access token. It may have expired. ' +
      'What to do: make a new access token in Canvas (Account → Settings → New Access Token). ' +
      'Then open Initial Setup, click Remove Token, and paste the new one.'
  } else if (status === 403) {
    plain = what
      ? `Canvas says your account isn’t allowed to see ${what}. ` +
        'What to do: check that you chose the right Canvas site and that you are signed up there.'
      : 'Your Canvas account isn’t allowed to do this in this course. ' +
        'What to do: make sure you are a teacher, designer or course administrator in the course, ' +
        'or ask the course owner to add you.'
  } else if (status === 404) {
    plain = what
      ? `Canvas couldn’t find ${what}. What to do: check the Canvas site address and try again.`
      : 'Canvas can’t find this course. ' +
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
      `What to do: try again. If it fails again, send the technical details to ${SUPPORT_CONTACT}.`
  }
  return withDetails(plain, technical).message
}

/** Canvas refused the rubric itself (a 400 or 422): the contents need changing, so retrying will not help. */
export function canvasRubricRejectedMessage(status: number, body = ''): string {
  const technical = `Canvas replied with status ${status}${body ? `: ${body.replace(/\s+/g, ' ').trim()}` : '.'}`
  return withDetails(
    'Canvas rejected this rubric’s contents. ' +
      'What to do: use the repair option if it appears, or check the criteria and point values and upload again.',
    technical,
  ).message
}

/** The request never got an answer. `cause` is the system's own description, kept for support. */
export function canvasUnreachableMessage(cause = ''): string {
  return withDetails(
    'The app can’t reach Canvas. What to do: check your internet connection and try again.',
    cause,
  ).message
}
