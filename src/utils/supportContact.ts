/**
 * Who someone stuck on a Google sign-in problem should contact.
 *
 * The main process has its own copy (SUPPORT_CONTACT in electron/ipc/errorDetails.ts), because the
 * two sides of the app cannot import each other. tests/supportContact.test.ts fails if they differ.
 */
export const SUPPORT_CONTACT = 'Greg Snow (gregsnow@boisestate.edu or extrasnow75@gmail.com)'
