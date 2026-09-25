/**
 * Gemini, as seen from the renderer.
 *
 * The implementation moved to the main process (electron/ipc/gemini.ts); this is the thin layer
 * that gets calls across the boundary. It keeps the old module's export names and signatures on
 * purpose, so the six components that import from here did not have to change.
 *
 * The one thing worth understanding is how cancellation survives the trip. Callers here pass an
 * `AbortSignal`, which cannot be sent over IPC. So each call invents a job id, hands that to main,
 * and wires the signal's `abort` event to a `gemini:cancel` message carrying the same id. Main
 * turns the id back into a real AbortSignal (see electron/ipc/jobs.ts), which is what the throttle
 * queue and retry back-off in gemini.ts have always used. The abort semantics the components
 * relied on still hold; only the transport is different.
 */
import {
  GenerationSettings,
  RubricData,
  Attachment,
  RubricMeta,
} from '../types';
import { repairRatingBands } from '../utils/rubricPoints';
import { ipcErrorMessage } from '../utils/ipcErrorMessage';
import { alignByTitle, chunk } from '../utils/rubricBatching';

// These mirror the declarations in electron/ipc/gemini.ts. Kept in step by hand: the two
// processes compile separately, so there is no shared source to import from.

export interface CsvAnalysisResult {
  rubricName: string;
  criteriaCount: number;
  totalPoints: number;
  isValid: boolean;
  notes: string;
}

export interface RubricDiscovery {
  name: string;
  scoringMethod: 'ranges' | 'fixed';
}

/** One separately-submitted piece of work found in an assignment description. */
export interface Deliverable {
  /** The name the description gives it, e.g. "Part 1: Systems Analysis". */
  title: string;
  /** One line from the description saying what it covers, shown so the user can judge the row. */
  focus: string;
}

export interface BatchRubricResult {
  title: string;
  csv: string;
}

/**
 * A CSV repair the main process has already checked.
 *
 * `ok: false` is the ordinary outcome for a proposal that failed a gate — the AI produced
 * something that still would not load, or that quietly lost a criterion — and `reason` is written
 * to be shown to the user as it stands.
 */
export type CsvRepairResult =
  | {
      ok: true;
      repairedCsv: string;
      /** The model's description of its own work. Shown as a claim, never as the record. */
      notes: string;
      diff: CsvRepairDiff;
    }
  | { ok: false; reason: string };

export interface CsvCellChange {
  column: string;
  before: string;
  after: string;
  /** A changed number is what a student is graded on, so the UI treats these differently. */
  isPointValue: boolean;
}

export interface CsvCriterionDiff {
  criterion: string;
  kind: 'changed' | 'added' | 'removed';
  changes: CsvCellChange[];
}

export interface CsvPointChange {
  criterion: string;
  column: string;
  before: string;
  after: string;
}

export interface CsvRepairDiff {
  headerAdded: boolean;
  headerChanges: CsvCellChange[];
  criteria: CsvCriterionDiff[];
  pointChanges: CsvPointChange[];
  changedCells: number;
}

let jobCounter = 0;

/**
 * Run an IPC call under a cancellable job id.
 *
 * The listener is removed in `finally` whether the call resolved, rejected or was cancelled. Left
 * attached, every generation would leak a listener onto a long-lived AbortSignal — and the batch
 * paths reuse one signal across a whole run of rubrics, so it would accumulate quickly.
 */
async function withCancellation<T>(
  signal: AbortSignal | undefined,
  run: (jobId: string) => Promise<T>,
): Promise<T> {
  const jobId = `job-${++jobCounter}-${Date.now()}`;

  if (signal?.aborted) throw new Error('Request cancelled');

  const onAbort = () => {
    void window.api.gemini.cancel(jobId);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await run(jobId);
  } catch (err) {
    // Every Gemini call funnels through here, so this is the one place worth unwrapping Electron's
    // "Error invoking remote method '...'" framing — see ipcErrorMessage. Without it the first
    // thing a user sees when a document will not convert is an IPC channel name.
    throw new Error(ipcErrorMessage(err));
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// ─── API key ──────────────────────────────────────────────────────────────────

/**
 * Check a key before it is saved.
 *
 * Takes the candidate directly, because at this point it is something the user has typed and not
 * yet committed. Once saved it goes to the OS keychain and is never read back out here.
 */
export const validateGeminiApiKey = (apiKey: string): Promise<boolean> =>
  window.api.gemini.validateKey(apiKey);

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const startNewChat = (): Promise<void> => window.api.gemini.startNewChat();

export const sendMessageToGemini = (
  text: string,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
): Promise<string> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.sendMessage({ text, attachments, jobId }),
  );

/**
 * Chain a rubric's rating bands before anyone sees it.
 *
 * Wrapped here rather than in main so it sits on one line of each call instead of four return
 * statements, and so the fix and the warnings that pair with it stay in one tested module.
 *
 * Applied only to the two calls where the AI *writes* the points. `generateRubricFromScreenshot`
 * and `extractRubricFromDocument` transcribe a rubric that already exists, and quietly editing
 * someone's own numbers to match a house rule is not a repair — those are left to
 * `pointsFindings`, which reports rather than rewrites.
 */
const chained = (call: Promise<RubricData>): Promise<RubricData> =>
  call.then((rubric) => repairRatingBands(rubric).rubric);

// ─── Rubric generation and extraction ─────────────────────────────────────────

export const extractRubricMetadata = (
  attachments: Attachment[],
  signal?: AbortSignal,
): Promise<RubricMeta[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.extractRubricMetadata({ attachments, jobId }),
  );

export const validateAssignmentDescription = (
  text: string,
  signal?: AbortSignal,
): Promise<{ isValid: boolean; message: string }> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.validateAssignmentDescription({ text, jobId }),
  );

/** `target` narrows the rubric to one deliverable; omit it for the assignment as a whole. */
export const generateRubricFromDescription = (
  assignmentDescription: string,
  settings: GenerationSettings,
  signal?: AbortSignal,
  target?: { title: string; focus: string },
): Promise<RubricData> =>
  chained(
    withCancellation(signal, (jobId) =>
      window.api.gemini.generateRubricFromDescription({
        assignmentDescription,
        settings,
        jobId,
        target,
      }),
    ),
  );

export const generateRubricFromScreenshot = (
  imageData: { data: string; mimeType: string },
  settings: GenerationSettings,
  signal?: AbortSignal,
): Promise<RubricData> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateRubricFromScreenshot({ imageData, settings, jobId }),
  );

export const extractRubricFromDocument = (
  documentText: string,
  signal?: AbortSignal,
): Promise<RubricData> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.extractRubricFromDocument({ documentText, jobId }),
  );

export const applyRubricChanges = (
  rubric: RubricData,
  changeRequest: string,
  signal?: AbortSignal,
): Promise<RubricData> =>
  chained(
    withCancellation(signal, (jobId) =>
      window.api.gemini.applyRubricChanges({ rubric, changeRequest, jobId }),
    ),
  );

// ─── CSV ──────────────────────────────────────────────────────────────────────

export const analyzeCsvForCanvas = (
  csvContent: string,
  signal?: AbortSignal,
): Promise<CsvAnalysisResult> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.analyzeCsvForCanvas({ csvContent, jobId }),
  );

/**
 * Ask for a repair of a CSV Canvas rejected, passing Canvas's own words along.
 *
 * The rejection message is half the input: it is what turns "something about this rubric is wrong"
 * into "the points column on one criterion is blank".
 */
export const repairRubricCsv = (
  csvContent: string,
  canvasMessage: string,
  signal?: AbortSignal,
): Promise<CsvRepairResult> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.repairRubricCsv({ csvContent, canvasMessage, jobId }),
  );

export const generateCsvForRubric = (
  rubricName: string,
  totalPoints: string,
  scoringMethod: 'ranges' | 'fixed',
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<string> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateCsvForRubric({
      rubricName,
      totalPoints,
      scoringMethod,
      attachment,
      jobId,
    }),
  );

/**
 * The separately-submitted parts of an assignment description, for the user to confirm.
 *
 * Nothing is generated from this. It fills a checklist, and only what the user ticks is built —
 * what counts as a deliverable is a teaching decision, not a fact in the text, so the model's
 * answer is a proposal in every case. An empty array is a real answer: most assignments are one
 * piece of work.
 */
export const discoverDeliverables = (
  description: string,
  signal?: AbortSignal,
): Promise<Deliverable[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.discoverDeliverables({ description, jobId }),
  );

export const discoverRubricTitles = (
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<RubricDiscovery[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.discoverRubricTitles({ attachment, jobId }),
  );

/**
 * How many rubrics `generateCsvsForRubrics` will take in one request.
 *
 * The model's output ceiling is 64k tokens, shared with its thinking tokens, and a batch
 * extraction is all-or-nothing: one truncated response loses every rubric in it. A 26-rubric
 * document proved that by failing with "Unterminated string in JSON at position 126176". Eight
 * sits comfortably inside the ceiling.
 *
 * It lives here rather than in a component because it is a property of the call, not of any one
 * screen, and both Part 2 and the Part 3 analyze-and-deploy panel have to agree on it.
 */
export const BATCH_RUBRIC_LIMIT = 8;

/** A named subset of a document's rubrics, in one call. Names it cannot find are omitted. */
export const generateCsvsForRubrics = (
  attachment: Attachment,
  rubricNames: string[],
  signal?: AbortSignal,
): Promise<BatchRubricResult[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateCsvsForRubrics({ attachment, rubricNames, jobId }),
  );

export interface ChunkedCsvOutcome {
  /** Index into the `rubrics` array that was passed in, so a caller can update the right card. */
  index: number;
  name: string;
  csv?: string;
  error?: string;
}

/** Wait, but give up the moment the run is cancelled. */
const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * Convert every rubric in a document, in groups.
 *
 * The one place the batching policy lives. Both screens that convert a document call this, which
 * is the point: Part 2 and the analyze-and-deploy panel had separate copies of this loop, they
 * drifted, and Part 2 spent a release never batching at all because the optimisation was only
 * ever added to the other copy.
 *
 * Why groups. Every call carries the whole document, so the cost of converting a document is
 * driven by how many calls are made, not by how many rubrics each one covers. The old code went
 * straight from "one call" to "one call per rubric" at the batch limit, so a 26-rubric document
 * sent that document 27 times and waited out 25 pacing gaps — about four minutes, most of it
 * spent re-reading the same file. In groups of eight it is four calls and three gaps.
 *
 * Why eight and not everything. The model's output ceiling is shared with its thinking tokens and
 * a batch is all-or-nothing: one truncated response loses every rubric in it. That is exactly how
 * the 26-rubric document failed before, with "Unterminated string in JSON at position 126176".
 * Eight is the proven-safe group, so a truncation now costs eight rubrics rather than all of them
 * — and even those are re-fetched one at a time rather than lost.
 *
 * Failure is therefore always local. A group that throws, and any rubric inside a group that came
 * back unrecognisable, falls to a single-rubric call for that rubric alone. A rubric that fails
 * even then is reported through `onResult` with an error and the rest of the document carries on.
 * Only cancellation stops everything, and it throws.
 */
export async function generateCsvsChunked(
  attachment: Attachment,
  rubrics: RubricDiscovery[],
  options: {
    signal?: AbortSignal;
    /** Minimum spacing between calls, to stay inside the per-minute request quota. */
    gapMs?: number;
    /** Indices about to be worked on, for flipping their cards to a working state. */
    onGroupStart?: (indices: number[]) => void;
    onResult: (outcome: ChunkedCsvOutcome) => void;
    /** Progress worth writing to a visible log. */
    onNote?: (message: string) => void;
  },
): Promise<void> {
  const { signal, gapMs = 6000, onGroupStart, onResult, onNote } = options;

  const numbered = rubrics.map((r, index) => ({ ...r, index }));
  const groups = chunk(numbered, BATCH_RUBRIC_LIMIT);

  // Pacing is measured from the start of the previous call, so a call that already took longer
  // than the gap adds no delay of its own. Zero means nothing has been called yet.
  let lastCallStart = 0;
  const pace = async () => {
    if (lastCallStart === 0) return;
    const since = Date.now() - lastCallStart;
    if (since < gapMs) await delay(gapMs - since, signal);
  };

  const cancelled = () => {
    if (signal?.aborted) throw new Error('Request cancelled');
  };

  if (groups.length > 1) {
    onNote?.(
      `Converting ${rubrics.length} rubrics in ${groups.length} groups of up to ` +
        `${BATCH_RUBRIC_LIMIT}. Each group is independent — if one has trouble, only those ` +
        'rubrics are retried.',
    );
  }

  for (const group of groups) {
    cancelled();
    await pace();
    cancelled();

    onGroupStart?.(group.map((g) => g.index));
    lastCallStart = Date.now();

    let aligned: (BatchRubricResult | null)[];
    try {
      const extracted = await generateCsvsForRubrics(
        attachment,
        group.map((g) => g.name),
        signal,
      );
      aligned = alignByTitle(group.map((g) => g.name), extracted);
    } catch (err: any) {
      cancelled();
      onNote?.(`That group could not be converted together (${err.message}). Retrying one at a time.`);
      aligned = group.map(() => null);
    }

    for (let i = 0; i < group.length; i++) {
      const entry = group[i];
      const hit = aligned[i];

      if (hit) {
        onResult({ index: entry.index, name: entry.name, csv: hit.csv });
        continue;
      }

      // Whatever the group did not answer for, ask for on its own. Slower, and never ambiguous.
      cancelled();
      await pace();
      cancelled();
      lastCallStart = Date.now();
      try {
        const csv = await generateCsvForRubric(entry.name, '', entry.scoringMethod, attachment, signal);
        onResult({ index: entry.index, name: entry.name, csv });
      } catch (err: any) {
        cancelled();
        onResult({ index: entry.index, name: entry.name, error: err.message });
      }
    }
  }
}

/**
 * Re-exported from its new home so existing imports keep working.
 *
 * It never involved Gemini — it is a pure formatter — so it lives in the renderer rather than
 * making an IPC round trip to do string work.
 */
export { generateCsvFromRubricObject } from '../utils/rubricCsv';
