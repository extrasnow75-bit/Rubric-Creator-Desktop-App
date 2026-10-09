/**
 * Fetch a Drive file and hand it back in the shapes the workflow actually consumes.
 *
 * The rubric components need one of two things from a Drive file: base64 for an attachment bound
 * for Gemini, or an ArrayBuffer for mammoth or pdf.js. Both start from the same bytes, and the
 * "is this a Google Doc? then export it as .docx first" branch is the same every time — so it
 * lives once in the main process (see fetchFileForProcessing) and once here, rather than in the
 * five places that used to repeat it.
 */
import { ipcErrorMessage } from './ipcErrorMessage';

export interface DriveFilePayload {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * Fetch a Drive file as raw bytes, converting Google Docs to .docx on the way.
 *
 * The unwrapping matters as much as the fetch. Anything thrown in the main process comes back
 * re-wrapped, so main's careful "You need to go to Initial Setup and sign into Google first."
 * reached the screen as:
 *
 *     Could not reload document: Error invoking remote method 'drive:fetchForProcessing':
 *     Error: You need to go to Initial Setup…
 *
 * — an internal channel name and the words "remote method" in front of the sentence somebody
 * wrote to be read. geminiService has unwrapped its errors this way all along; the Drive calls
 * never did. Doing it here rather than at each call site means the five callers cannot drift
 * apart, and a sixth gets it for free.
 */
export async function fetchDriveFile(fileId: string): Promise<DriveFilePayload> {
  try {
    return await window.api.drive.fetchForProcessing(fileId);
  } catch (err) {
    throw new Error(ipcErrorMessage(err));
  }
}

/**
 * Base64, for a Gemini attachment.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)` spread: a multi-megabyte .docx spreads
 * into hundreds of thousands of arguments and overflows the call stack. The loop is not an
 * optimisation, it is the difference between working and throwing on a large document.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** An ArrayBuffer sized to exactly this view, for mammoth or pdf.js. */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Fetch a Drive file and return it base64-encoded, ready to attach. */
export async function fetchDriveFileAsBase64(
  fileId: string,
): Promise<{ name: string; mimeType: string; base64: string }> {
  const { name, mimeType, bytes } = await fetchDriveFile(fileId);
  return { name, mimeType, base64: bytesToBase64(bytes) };
}
