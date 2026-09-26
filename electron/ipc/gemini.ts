/**
 * Gemini, in the main process.
 *
 * Moved wholesale from src/services/geminiService.ts. The prompts, the schemas, the throttle
 * queue and the retry back-off are unchanged — that logic was carefully tuned against the free
 * tier's quotas and had no reason to change just because it changed processes.
 *
 * Three things did change:
 *
 *   1. The API key is read from the OS keychain here rather than from import.meta.env or a
 *      localStorage value passed in by the renderer.
 *   2. .docx text extraction uses Buffer rather than atob, since this is Node.
 *   3. Nothing else. The functions still take `signal?: AbortSignal`; jobs.ts maps a renderer's
 *      job id onto one at the IPC boundary.
 *
 * Moving this is what lets the renderer's CSP be `connect-src 'none'`: with the Gemini calls
 * here, no part of the visible app needs a socket.
 */
import { GoogleGenAI, Chat, Type } from '@google/genai'
import { createHash } from 'node:crypto'
import { extractDocxText } from './docxText'
import { buildRubricCsv, ExtractedCriterion } from './rubricCsv'
import { getGeminiApiKey } from './credentials'
import {
  GenerationSettings,
  PointStyle,
  ProcessingType,
  RubricData,
  Attachment,
  RubricMeta,
} from './geminiTypes';

let client: GoogleGenAI | null = null;
let chatSession: Chat | null = null;

/**
 * Primary model — everything except reading a screenshot.
 *
 * Chosen for its free-tier quota, not its price. Every user of this app brings their own free key
 * from AI Studio, and Google has cut the full Flash models to roughly 20 requests a day. This app
 * spends 5–8 requests in an ordinary Part 1 session and N+1 on a document, so a full Flash model
 * would hit a wall on the first afternoon and read, to the user, as the app being broken.
 * Flash-Lite is ~1,500 a day, which nobody here will reach.
 *
 * It is also the right shape for the work: Google describes it as optimised for document parsing,
 * it takes PDFs and images as well as text, and its 1M context / 64k output matches what the
 * previous model gave, so the limits on how many rubrics fit in one response are unchanged.
 *
 * Every task it runs — CSV extraction, discovery, repair, rubric drafting — is either gated by a
 * deterministic check afterwards (parseRatingPoints, the csvRepair gates) or reviewed by a human
 * before it reaches Canvas, so a smaller model costs quality at worst, never correctness.
 *
 * Replaces gemini-2.5-flash, which Google shuts down on 16 October 2026 and which had already
 * begun returning 404 to newly created API keys — a failure that would have hit every new user
 * while continuing to work for everyone already set up.
 */
const PRIMARY_MODEL = 'gemini-3.5-flash-lite';

/**
 * Vision model — reading a rubric out of a screenshot, and nothing else.
 *
 * This is the one task where model quality maps onto grade correctness. Misreading an "8" as a
 * "3" produces a perfectly valid number, so neither the closed grammar in parseRatingPoints nor
 * the repair gates can catch it; only the person checking the draft can. Everywhere else a weak
 * answer produces a visible refusal, which is why the cheaper model is safe there and not here.
 *
 * The trade-off to know about: the full Flash tier is ~20 requests a day free, so heavy
 * screenshot use in one day will hit a quota wall and back off. That is a visible failure rather
 * than a wrong grade, which is the way round this codebase prefers. If it proves annoying in
 * practice, pointing this at PRIMARY_MODEL is a one-line change.
 */
const VISION_MODEL = 'gemini-3.8-flash';

/**
 * The shape both rubric-extraction calls ask for.
 *
 * Points are a STRING, not a number, and that is deliberate. A numeric field forces the model to
 * return some number for a cell it could not read, and an invented point value deploys cleanly
 * and grades students wrongly — the exact failure this codebase has already fixed twice. As text,
 * an unreadable value reaches buildRubricPayload, which refuses the file and names the rating.
 */
const CRITERIA_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name:        { type: Type.STRING },
      description: { type: Type.STRING },
      ratings: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name:        { type: Type.STRING },
            description: { type: Type.STRING },
            points:      { type: Type.STRING },
          },
          required: ['name', 'description', 'points'],
        },
      },
    },
    required: ['name', 'description', 'ratings'],
  },
} as const

/** MIME type for Word documents */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─── Client management ──────────────────────────────────────────────

/**
 * The Gemini client, built from the key in the OS keychain.
 *
 * Read lazily and cached, then dropped by `resetClient` when the stored key changes. The key
 * never travels to the renderer — the renderer knows only that one is saved (see credentials.ts).
 */
const getClient = (): GoogleGenAI => {
  if (!client) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error(
        'No Gemini API key is saved. Add one under Initial Setup to use the AI features.',
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

/** Drop the cached client and chat after the stored key changes. */
export const resetClient = (): void => {
  client = null;
  chatSession = null;
};

// ─── Rate limiter (throttle) ─────────────────────────────────────────

/**
 * Queue-based throttle — serialises all outgoing API calls with a
 * MIN_REQUEST_INTERVAL_MS gap between them regardless of how many
 * callers arrive concurrently.
 *
 * WHY queue-based instead of lastRequestTime:
 *   If 13 rubrics all call throttle() simultaneously, a simple
 *   lastRequestTime check lets them all read "elapsed = 0" at the
 *   same instant, schedule identical 4-second timers, and fire at
 *   the same time — triggering a burst of 13 simultaneous requests.
 *   The queue approach chains each call after the previous one so
 *   they execute one-at-a-time with a guaranteed 4 s gap.
 *
 * Abort behaviour: clearing the timer rejects the slot immediately
 *   and the rejection is swallowed in pendingThrottle so the NEXT
 *   queued caller can proceed without waiting.
 */
let pendingThrottle: Promise<void> = Promise.resolve();
const MIN_REQUEST_INTERVAL_MS = 2000; // 2 s between API calls — enough to respect rate limits without adding noticeable delay

async function throttle(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Request cancelled');

  const mySlot = pendingThrottle.then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Request cancelled')); return; }
        // The listener is removed on the normal path too. Batch runs reuse one signal across
        // every rubric in the document, so a listener left behind per call accumulates — and
        // past ten, Node prints MaxListenersExceededWarning, which a 13-rubric document reaches.
        const onAbort = () => { clearTimeout(timer); cleanup(); reject(new Error('Request cancelled')); };
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, MIN_REQUEST_INTERVAL_MS);
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  );

  // Advance the global queue — swallow rejections so an abort on one
  // slot doesn't stall every subsequent caller.
  pendingThrottle = mySlot.catch(() => {});

  return mySlot;
}

// ─── Retry with exponential back-off ────────────────────────────────

/**
 * True when the 429 includes "limit: 0" — a hard daily cap.
 * Retrying won't help; the user needs a fresh project/key.
 */
function isHardQuotaLimit(error: any): boolean {
  return String(error?.message || error || '').includes('limit: 0');
}

/**
 * True for temporary rate-limit 429s that ARE worth retrying
 * (e.g. hit 15 RPM but daily quota is fine).
 */
function isTemporaryRateLimit(error: any): boolean {
  const msg = String(error?.message || error || '');
  return (
    (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) &&
    !isHardQuotaLimit(error)
  );
}

/**
 * Retry `fn` up to `maxRetries` times on temporary 429s using
 * exponential back-off with ±20 % jitter (60 s → 120 s → 240 s).
 * Hard "limit: 0" errors and non-quota errors surface immediately.
 *
 * Defaults are tuned for batch-then-split: 3 retries starting at 60 s
 * gives Gemini free-tier quota a full minute to reset between attempts.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3,
  initialDelayMs = 60000,
): Promise<T> {
  const JITTER = 0.2; // ±20 %
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Request cancelled');
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (isHardQuotaLimit(error)) throw error;     // hard daily cap — stop
      if (!isTemporaryRateLimit(error)) throw error; // non-quota error — stop
      // Temporary rate limit — wait then retry with jitter
      const base = initialDelayMs * Math.pow(2, attempt);
      const delay = Math.round(base * (1 - JITTER + Math.random() * JITTER * 2));
      console.warn(`Rate limit hit. Retrying in ${(delay / 1000).toFixed(1)}s… (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); cleanup(); reject(new Error('Request cancelled')); };
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
  throw lastError;
}

// ─── Local .docx extraction ──────────────────────────────────────────

function isDocx(att: Attachment): boolean {
  return (
    att.mimeType === DOCX_MIME ||
    att.name?.toLowerCase().endsWith('.docx') ||
    att.name?.toLowerCase().endsWith('.doc')
  );
}

/**
 * The .docx text of the document currently being worked on.
 *
 * Every call that carries a document — discovery, each batch, each single rubric — used to run
 * `extractDocxText` again on the identical bytes. A 26-rubric document therefore base64-decoded
 * and fully XML-parsed the same file 27 times, in the main process, which is simultaneously
 * serving every other IPC call the app makes. The parse is pure: same bytes, same text.
 *
 * One entry, because a run works through one document at a time and holding more would mean
 * holding whole documents in memory for no reason. Keyed by a digest of the bytes rather than by
 * filename, so two files that happen to share a name cannot be confused for each other.
 */
let docxTextCache: { key: string; text: string } | null = null;

/**
 * Build the Gemini part that carries the document.
 *
 * A .docx becomes extracted text (cached, above); anything else — PDF, image — goes across as
 * inline data, which needs no parsing on this side.
 */
async function documentPart(attachment: Attachment, leadIn = 'Document content from'): Promise<any> {
  if (!isDocx(attachment)) {
    return { inlineData: { mimeType: attachment.mimeType, data: attachment.data } };
  }

  const key = createHash('sha256').update(attachment.data).digest('hex');
  if (docxTextCache?.key !== key) {
    docxTextCache = { key, text: await extractDocxText(attachment) };
  }
  return { text: `\n\n[${leadIn} "${attachment.name}"]:\n${docxTextCache.text}` };
}

// ─── API key validation ──────────────────────────────────────────────

export const validateGeminiApiKey = async (apiKey: string): Promise<boolean> => {
  try {
    const testClient = new GoogleGenAI({ apiKey });
    await testClient.models.generateContent({
      model: PRIMARY_MODEL,
      contents: 'Say "ok"',
    });
    return true;
  } catch (error: any) {
    const msg = String(error?.message || error || '');
    if (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('API_KEY_INVALID') ||
      msg.includes('invalid_api_key')
    ) {
      return false;
    }
    return true; // 429 or other errors → key reached Google → key is valid
  }
};

// ─── Chat session ────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are the "Canvas Rubric Creator", an expert AI assistant specialized in instructional design and assessment.

**RUBRIC DETECTION GUIDELINES:**
A rubric is generally a table or structured list used for grading. It typically features:
1. Criteria (e.g., "Analysis", "Presentation").
2. Performance levels (e.g., "Excellent", "Poor").
3. Points or point ranges assigned to those levels.

**BE BALANCED:**
- If a document is purely narrative (like a simple memo, letter, or prompt) with NO grading structure, return an empty list.
- However, do NOT be so strict that you ignore tables just because they are inside a project description. If a table looks like it could be used for grading, even if it lacks some headers, attempt to identify it as a rubric.

**CRITICAL: CSV TEMPLATE ADHERENCE**
You must produce CSV files that match the standard Canvas Rubric Import template EXACTLY.

**CSV Structure Rules:**
1. **Header Row:** You MUST include the following exact header row:
   \`Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points\`
2. **Column Order:**
   - Col A: Rubric Name.
   - Col B: Criteria Name.
   - Col C: Criteria Description.
   - Col D: Criteria Enable Range ('TRUE' or 'FALSE').
   - Col E, F, G: Rating triplets (repeating).
3. **Data Integrity:** Ratings MUST be ordered from HIGHEST points to LOWEST points.
4. **Point Range Format:** When "Criteria Enable Range" is true, the "Rating Points" column must contain ONLY the maximum single point value for each rating (e.g., "10", "8", "4", "0"). Do NOT use range strings like "10-8" or "10-8.1" — Canvas computes range boundaries automatically from adjacent rating values. Source rubrics write a band several ways and every one of them means the same thing: take the HIGHEST number in the cell. "4 to >3 pts" (the wording Canvas itself uses, where ">3" just restates the rating below) is 4. "4-3.5 points" is 4. "40–50 pts" is 50. "2.4-0 points" is 2.4. Never carry the "to", the ">" or the dash into Rating Points. Any of those forms also means the rubric uses ranges, so set "Criteria Enable Range" to true for that criterion.
5. **Formatting:** Wrap cells in double quotes if they contain commas. Output ONLY the CSV inside a markdown code block labeled "csv".

**Part 2 Behavior (Extraction):**
- Analyze the structure of the document text provided.
- Extract data into the CSV template.
- If multiple rubrics are present, transform the one specified in the user prompt.

**Screenshot Behavior:**
- If the user provides an image, treat it as a visual source.
- Extract the text and structure into a high-quality Markdown table that can be easily copied into MS Word.`;

export const startNewChat = (): void => {
  const ai = getClient();
  chatSession = ai.chats.create({
    model: PRIMARY_MODEL,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.1,
    },
    history: [],
  });
};

/**
 * Send a message to the chat session.
 * .docx attachments are extracted locally with mammoth and sent as text.
 * PDFs are sent as inline data (the API supports PDF natively).
 * Throttled to max 1 request / 4 s; retries up to 3× on temporary 429s.
 * Pass an AbortSignal to cancel pending throttle waits or retry delays.
 */
export const sendMessageToGemini = async (
  text: string,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
): Promise<string> => {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');

    if (!chatSession) startNewChat();
    if (!chatSession) throw new Error("Failed to initialize chat session.");

    const parts: any[] = [];
    if (text) parts.push({ text });

    for (const att of attachments) {
      parts.push(await documentPart(att, 'Document content extracted from'));
    }

    const result = await chatSession.sendMessage({ message: parts });
    return result.text || "";
  }, signal);
};

// ─── Standalone API calls ────────────────────────────────────────────

/**
 * Extract rubric metadata from attached files.
 * Throttled + retried automatically.
 */
export const extractRubricMetadata = async (
  attachments: Attachment[],
  signal?: AbortSignal,
): Promise<RubricMeta[]> => {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const parts: any[] = [
      {
        text: "Analyze the following content and identify any structured assessment rubrics. Look for tables containing criteria, performance ratings, and points. If the content is purely narrative with no evaluation criteria, return an empty array. If a grading structure is present, extract its Name, Total Points, and whether it uses Point Ranges or Fixed Points.",
      },
    ];

    for (const att of attachments) {
      parts.push(await documentPart(att, 'Document content extracted from'));
    }

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  totalPoints: { type: Type.STRING },
                  scoringMethod: {
                    type: Type.STRING,
                    description: "Must be exactly 'ranges' or 'fixed'",
                  },
                },
                required: ["name", "totalPoints", "scoringMethod"],
              },
            },
          },
          required: ["rubrics"],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    return (result.rubrics || []).map((r: any) => ({
      name: r.name || "",
      totalPoints: r.totalPoints || "",
      scoringMethod: r.scoringMethod === "fixed" ? "fixed" : "ranges",
    }));
  }, signal);
};

/**
 * Validate whether text is a recognizable assignment description.
 */
export async function validateAssignmentDescription(
  text: string,
  signal?: AbortSignal,
): Promise<{ isValid: boolean; message: string }> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `
    You are an expert in educational assessment and instructional design.
    Analyze the following text and determine whether it is a recognizable assignment description
    for an educational course. A valid assignment description typically describes what students
    are expected to do, the objectives, deliverables, or assessment criteria for a course assignment.

    TEXT TO ANALYZE:
    ${text}

    Respond with a JSON object:
    - "isValid": true if the text is a recognizable assignment description, false if it is nonsensical,
      random characters, gibberish, completely off-topic, or otherwise not an assignment description.
    - "message": A brief explanation of your determination.
    `;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isValid: { type: Type.BOOLEAN },
            message: { type: Type.STRING },
          },
          required: ["isValid", "message"],
        },
      },
    });

    if (!response.text) {
      return { isValid: true, message: "Validation could not be completed." };
    }
    return JSON.parse(response.text.trim()) as { isValid: boolean; message: string };
  }, signal);
}

/**
 * Ask only for the weighting: how many of `totalPoints` each criterion should carry.
 *
 * The narrowest call in the file, and deliberately so. It exists for a rubric whose criteria and
 * wording are fine but whose points were mis-divided — most often every criterion given the whole
 * budget. Regenerating the rubric to fix that would rewrite twelve rating descriptions nobody
 * complained about, take ten seconds, and risk losing wording someone had already read and
 * approved. Here the model sees the criterion names and nothing else, and answers with numbers.
 *
 * Its answer is a proposal, not an instruction. The caller checks the length, rejects anything
 * unusable, and re-apportions shares that do not add up (see applyPointSplit) — so a plausible
 * but wrong reply cannot put a rubric back into the state this was called to fix.
 */
export async function suggestPointSplit(
  criteria: string[],
  totalPoints: number,
  signal?: AbortSignal,
): Promise<number[]> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `
    Act as an expert in instructional design and assessment.

    A rubric worth ${totalPoints} points in total has these criteria, in this order:
    ${criteria.map((name, i) => `${i + 1}. ${name}`).join('\n    ')}

    Decide how many of the ${totalPoints} points each criterion should be worth.

    RULES:
    - Give one number per criterion, in the same order, and return exactly ${criteria.length}
      numbers.
    - The numbers must ADD UP to exactly ${totalPoints}.
    - Use whole numbers.
    - Weight them by how much each criterion matters to the work being assessed. Give more to the
      criteria that carry the assignment's main thinking, less to presentation and mechanics.
    - An even split is the right answer only when the criteria really are equally important.
    - Do NOT give every criterion ${totalPoints}. That is the total for the whole rubric.

    Return JSON: an object with "points", an array of ${criteria.length} numbers.
    `;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            points: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          },
          required: ["points"],
        },
      },
    });

    if (!response.text) throw new Error('The AI returned no point split.');
    const parsed = JSON.parse(response.text.trim()) as { points?: unknown };
    return Array.isArray(parsed.points) ? parsed.points.map(Number) : [];
  }, signal);
}

/**
 * Generate a rubric from an assignment description.
 */
/**
 * House style for rubric text the model writes itself.
 *
 * Generated descriptions ran long — several lines per cell, four cells per row — which makes a
 * rubric that is slower to grade with and, in Canvas's fixed-width rating columns, one the
 * student scrolls rather than reads. The brief is not "shorter" but "as short as it can be while
 * still telling the two adjacent levels apart", so the rule carries a word budget *and* an
 * explicit demand that the levels stay distinct: a model told only to be concise will happily
 * compress four levels into the same sentence with the adjective swapped, which is shorter and
 * useless.
 *
 * This applies only where the model is the author. Extraction — from a document, from a
 * screenshot — copies the instructor's wording verbatim, because that rubric is already written
 * and already approved, and quietly rewriting it changes what students are graded against.
 *
 * The first line of the rule exists because the rule without it caused real damage. Told only to
 * be brief, the model shortened the wrong thing: a seven-criterion rubric came back as a single
 * criterion worth the whole hundred points, with tidy fifteen-word ratings. It had read "be
 * brief" as being about the rubric rather than about the sentences. The length of a cell and the
 * number of criteria are unrelated decisions, and this rule governs only the first — the second
 * belongs to CRITERIA_COVERAGE_RULE.
 */
const RATING_BREVITY_RULE = `WRITING THE DESCRIPTIONS — be brief:
    - This rule governs the WORDING INSIDE one cell and nothing else. It is never a reason to
      write fewer criteria, to merge two criteria into one, or to drop a rating level. You are
      being asked to shorten the sentences, not the rubric.
    - One sentence per rating, 20 words maximum. Aim for 10 to 15.
    - State the observable difference and stop: what the work has, lacks, or does inconsistently.
    - Cut throat-clearing openers ("The student...", "This submission...", "Work at this level
      demonstrates..."), hedges ("generally", "for the most part", "may at times"), and any
      restatement of the criterion name — whoever is grading is already reading that row.
    - Brevity must not cost distinctness. Each level has to be unmistakably different from the
      ones directly above and below it. Vary the substance, not the adjective: never write one
      sentence four times with "excellent / good / fair / poor" swapped in.
    - Criterion descriptions follow the same rule: one short line, and none at all when the
      criterion name already says it.`;

/**
 * How many criteria a generated rubric has, and what they are.
 *
 * Coverage decides the count, not a target number. An assignment that states its learning
 * outcomes has already said what it is assessing, so the rubric's job is to have a row for each
 * of the ones it is responsible for; inventing a quota on top of that would either pad a short
 * assignment or clip a long one. The 4-to-7 range is only the fallback for a description that
 * states nothing to cover.
 *
 * The explicit ban on a single criterion holding the whole total is there because that is what
 * the app actually produced. It is worth stating as its own rule rather than trusting the range
 * to imply it: a rubric with one row cannot tell a student which part of the work cost them the
 * marks, so it fails at the thing a rubric is for while still looking like a rubric.
 */
const CRITERIA_COVERAGE_RULE = `CHOOSING THE CRITERIA — how many, and what they are:
    - Start from what the assignment says it assesses. If the description states learning
      outcomes, objectives, a purpose, or a list of what the work must contain or do, then every
      one of those that this rubric is responsible for must be covered by a criterion. Coverage
      decides how many criteria there are. Do not choose a number first.
    - Cover only what this rubric is for. A rubric for one part of a larger assignment covers
      that part's outcomes, not the whole assignment's.
    - If the description states no outcomes, objectives or required elements, write 4 to 7
      criteria drawn from what the work actually involves.
    - Never return a single criterion holding the entire point total unless the assignment
      genuinely assesses one single thing. A rubric with one row cannot show a student which part
      of the work cost them marks.
    - Each criterion must name something that can be judged separately from the others. If two
      criteria would always be given the same rating, they are one criterion.
    - Weight the points towards what the assignment emphasises.`;

/**
 * How the requested total is divided between the criteria.
 *
 * CRITERIA_COVERAGE_RULE already forbids *one* criterion holding the whole total, and ends by
 * asking for the points to be weighted. Neither covers the failure this rule is for: giving
 * *every* criterion the whole total. In one eight-part run two rubrics came back that way — three
 * criteria of a hundred points each, in a rubric asked to be worth a hundred — and in the run
 * after it, a different one did. Same prompt, same settings, so the instruction was being read
 * as satisfied: each criterion was indeed worth "exactly 100".
 *
 * What was missing was the arithmetic. "Break down the points across criteria" describes an
 * activity; it never says the shares have to add up. The response schema cannot say it either —
 * it can require that these fields are numbers, not that they sum to anything — so this is the
 * only place the constraint can live, and it is why the deterministic check in
 * utils/rubricPoints.ts exists regardless of what this says.
 *
 * The last bullet is the one that targets what actually goes wrong. The rubrics that failed did
 * not write a wrong number in the points column; they wrote rating bands running from the full
 * total down to zero on every row, which is a percentage scale. Saying "a criterion's points are
 * the top of its highest band" connects the share to the thing the model is really choosing.
 *
 * Interpolated rather than a constant because every line needs the actual number in it. A rule
 * about "the total" is exactly the kind of abstraction that got ignored.
 */
function pointsBudgetRule(totalPoints: number): string {
  return `DIVIDING THE POINTS — ${totalPoints} is a budget to share out, not a scale to repeat:
    - The whole rubric is worth ${totalPoints} points. Give each criterion a SHARE of that, and
      make the shares ADD UP to exactly ${totalPoints}.
    - Weight the shares by how much each criterion matters to the assignment. An even split is
      right only when the criteria really are equally important.
    - NEVER give every criterion ${totalPoints} points. That would make the rubric worth
      ${totalPoints} multiplied by the number of criteria. ${totalPoints} is divided between the
      criteria, not repeated on each one.
    - A criterion's points are the HIGHEST NUMBER in its top rating. So a criterion whose share is
      40 has a top rating starting at 40 — never at ${totalPoints}, unless that one criterion is
      genuinely worth the entire rubric.
    - Before answering, add the criteria's points together. If the sum is not exactly
      ${totalPoints}, change the shares until it is.`;
}

/** One separately-submitted piece of work found in an assignment description. */
export interface Deliverable {
  /** The name the description gives it, e.g. "Part 1: Systems Analysis". */
  title: string
  /** One line from the description saying what it covers. Shown so the user can judge the row. */
  focus: string
}

/**
 * Find the separate deliverables in an assignment description.
 *
 * This is the first half of "the model proposes, the user disposes": it only ever produces a
 * list to be confirmed, and nothing is generated from it until someone has ticked a box. That
 * matters because the judgement here is genuinely uncertain — what counts as a deliverable is a
 * teaching decision, not a fact in the text — and a wrong guess acted on silently would produce
 * rubrics for things nobody hands in.
 *
 * The prompt spends most of its length on what is *not* a deliverable. Asked for "the parts of
 * this assignment", a model will happily return the sections of a single essay, or the learning
 * outcomes, or the stages of writing it — all of which read like parts and none of which is
 * separately submitted. The test is submission, and it is stated three times because it is the
 * only thing separating this from a list of topics.
 *
 * An empty list is a real answer, not a failure: most assignments are one piece of work. The
 * caller offers the whole-assignment rubric either way.
 */
export async function discoverDeliverables(
  description: string,
  signal?: AbortSignal,
): Promise<Deliverable[]> {
  await throttle(signal)

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled')
    const ai = getClient()

    const prompt = `List the separate DELIVERABLES in this assignment description.

A deliverable is a distinct piece of work the student hands in, which could reasonably be graded
with a rubric of its own.

Where to look: a table of parts or phases, numbered parts, milestones, or headed sections that
each describe something submitted. Many descriptions contain a table listing the parts — if there
is one, use it, and keep its titles and its wording.

For each deliverable return:
- title: the name exactly as the description gives it, for example "Part 1: Systems Analysis".
  Never invent a name for something the description does not name.
- focus: one short line, taken from the description, saying what that deliverable covers.

Return an EMPTY list when the description is one single piece of work. In particular, these are
NOT deliverables:
- the sections of one document (introduction, body, conclusion, references)
- learning outcomes, objectives, or skills the assignment develops
- stages of doing the work that are not separately handed in (research, drafting, revising)
- topics, themes, or subject matter the work must address

The test is submission: if the student does not hand it in as its own piece of work, it is not a
deliverable. Most assignments have none, and an empty list is the correct answer for those.

ASSIGNMENT DESCRIPTION:
${description}`

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            deliverables: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  focus: { type: Type.STRING },
                },
                required: ['title', 'focus'],
              },
            },
          },
          required: ['deliverables'],
        },
      },
    })

    if (!response.text) return []
    const parsed = JSON.parse(response.text.trim()) as {
      deliverables?: Array<{ title?: string; focus?: string }>
    }
    if (!Array.isArray(parsed.deliverables)) return []
    return parsed.deliverables
      .map((d) => ({ title: (d.title ?? '').trim(), focus: (d.focus ?? '').trim() }))
      .filter((d) => d.title.length > 0)
  }, signal)
}

export async function generateRubricFromDescription(
  assignmentDescription: string,
  settings: GenerationSettings,
  signal?: AbortSignal,
  /**
   * Narrow the rubric to one deliverable of a larger assignment.
   *
   * Omitted, the rubric covers the whole description — which is what it always did. Supplied,
   * the model still gets the entire description, because a rubric for Part 4 needs to know what
   * Parts 1 to 3 established; it is the rubric's *scope* that narrows, not its reading.
   */
  target?: { title: string; focus: string },
): Promise<RubricData> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    /*
     * One rubric per call, always.
     *
     * This used to branch on a "multiple rubrics" setting whose instruction told the model to
     * "generate a SEPARATE rubric for each distinct component" — while the response schema below
     * has room for exactly one. The model resolved that contradiction by picking a component and
     * returning a thin rubric for it, which is how a seven-part assignment came back as one
     * criterion worth a hundred points. Several rubrics now means several calls, each with its
     * own target, decided by the user in the checklist before any of them are made.
     */
    const scopeInstruction = target
      ? `This rubric is for ONE PART of a larger assignment: "${target.title}"${
          target.focus ? ` — ${target.focus}` : ''
        }.
    Grade only that part. The rest of the description is context, and is there so you understand
    where this part sits; do not write criteria for work that belongs to another part.
    Title the rubric exactly: ${target.title}`
      : `Generate a SINGLE rubric covering the assignment description as a whole.`;

    const prompt = `
    Act as an expert in instructional design and assessment.
    Based on the following assignment description, create a professional rubric.

    ${scopeInstruction}

    ASSIGNMENT DESCRIPTION:
    ${assignmentDescription}

    CONSTRAINTS:
    - Point style preference: ${
      settings.pointStyle === PointStyle.RANGE
        ? "Point ranges with overlapping boundaries (e.g., 10-8, 8-4, 4-0, 0-0). The upper bound of each range must equal the lower bound of the range above it. Do NOT use decimal offsets like 10-8.1."
        : "Single point values (e.g., 10 pts)"
    }.
    - Ratings columns MUST BE: Exemplary, Proficient, Developing, and Unsatisfactory.
    - For each category, describe specific observable behaviours or qualities for each of the
      four ratings.

    ${pointsBudgetRule(settings.totalPoints)}

    ${CRITERIA_COVERAGE_RULE}

    ${RATING_BREVITY_RULE}

    Format the output as a JSON object matching the RubricData structure.
  `;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            totalPoints: { type: Type.NUMBER },
            criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  exemplary: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  proficient: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  developing: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  unsatisfactory: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  totalPoints: { type: Type.NUMBER },
                },
                required: ["category", "description", "exemplary", "proficient", "developing", "unsatisfactory", "totalPoints"],
              },
            },
          },
          required: ["title", "totalPoints", "criteria"],
        },
      },
    });

    if (!response.text) throw new Error("Failed to generate rubric content.");
    return JSON.parse(response.text.trim()) as RubricData;
  }, signal);
}

/**
 * Generate a rubric from a screenshot image.
 */
export async function generateRubricFromScreenshot(
  imageData: { data: string; mimeType: string },
  settings: GenerationSettings,
  signal?: AbortSignal,
): Promise<RubricData> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const textPrompt = `
    Act as an expert in instructional design and assessment digitization.

    TASK:
    Analyze the provided screenshot of a Canvas LMS rubric and convert it into a perfectly structured JSON format.

    EXTRACTION RULES:
    1. TITLE: Extract the assignment/rubric title from the top of the image.
    2. CRITERIA: Identify each row. Extract the 'Criteria' name and any supporting description text.
    3. RATINGS: Map the 4-column structure.
       - Column 1: Exemplary (or highest level)
       - Column 2: Proficient
       - Column 3: Developing
       - Column 4: Unsatisfactory (or lowest level)
       *Extract both the descriptor text AND the point value associated with each rating.*
    4. TOTALS: Capture the total points possible for each criterion row.

    OUTPUT REQUIREMENTS:
    - If the point values in the screenshot are ranges, format them as ranges (e.g., "40-36").
    - If they are single values, format as single values.
    - Ensure the 'totalPoints' field in JSON is the sum of all row totals found.

    Format the output as a JSON object matching the RubricData structure.
  `;

    const response = await ai.models.generateContent({
      // The one call that uses the stronger model — see the note on VISION_MODEL. A misread digit
      // here is a valid number, so nothing downstream can catch it.
      model: VISION_MODEL,
      contents: { parts: [{ inlineData: imageData }, { text: textPrompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            totalPoints: { type: Type.NUMBER },
            criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  exemplary: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  proficient: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  developing: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  unsatisfactory: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  totalPoints: { type: Type.NUMBER },
                },
                required: ["category", "description", "exemplary", "proficient", "developing", "unsatisfactory", "totalPoints"],
              },
            },
          },
          required: ["title", "totalPoints", "criteria"],
        },
      },
    });

    if (!response.text) throw new Error("Failed to process rubric screenshot.");
    return JSON.parse(response.text.trim()) as RubricData;
  }, signal);
}

/**
 * Extract an existing rubric from document text (e.g., a .docx the user has edited).
 * Does NOT generate new content — parses and structures what is already in the document.
 */
export async function extractRubricFromDocument(
  documentText: string,
  signal?: AbortSignal,
): Promise<RubricData> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `
    Act as an expert in instructional design and assessment.

    The following document contains an existing rubric. Extract and structure it into the RubricData JSON format.
    Do NOT generate new content, modify criteria, or change any point values.
    Simply read what is already there and return it in the required JSON structure.

    DOCUMENT CONTENT:
    ${documentText}

    IMPORTANT:
    - Preserve all existing category names, descriptions, and rating text exactly as written.
    - Preserve all existing point values exactly as they appear in the document.
    - Map the four rating columns to: exemplary (highest), proficient, developing, unsatisfactory (lowest).
    - The title should be the rubric's title or assignment name found in the document.
    - Calculate totalPoints as the sum of all individual criterion totalPoints.
    `;

    const rubricSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        totalPoints: { type: Type.NUMBER },
        criteria: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              description: { type: Type.STRING },
              exemplary: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              proficient: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              developing: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              unsatisfactory: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              totalPoints: { type: Type.NUMBER },
            },
            required: ["category", "description", "exemplary", "proficient", "developing", "unsatisfactory", "totalPoints"],
          },
        },
      },
      required: ["title", "totalPoints", "criteria"],
    };

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: rubricSchema },
    });

    if (!response.text) throw new Error("Failed to extract rubric from document.");
    return JSON.parse(response.text.trim()) as RubricData;
  }, signal);
}

/**
 * Apply user-requested changes to an existing rubric via Gemini.
 * Returns a new RubricData object with only the requested changes applied.
 */
export async function applyRubricChanges(
  rubric: RubricData,
  changeRequest: string,
  signal?: AbortSignal,
): Promise<RubricData> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `
    Act as an expert in instructional design and assessment.

    You are given an existing rubric in JSON format and a set of requested changes from the user.
    Apply ONLY the requested changes. Preserve all other content exactly as-is.

    CURRENT RUBRIC:
    ${JSON.stringify(rubric, null, 2)}

    REQUESTED CHANGES:
    ${changeRequest}

    Return the modified rubric in the same JSON structure.
    Only change point totals if the user explicitly requests a redistribution of points.

    Anything you write or rewrite follows the house style below. Text the user did not ask you to
    change stays exactly as it is, even where it is longer than this allows — shortening it would
    be an edit they did not request.

    ${RATING_BREVITY_RULE}
    `;

    const rubricSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        totalPoints: { type: Type.NUMBER },
        criteria: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              description: { type: Type.STRING },
              exemplary: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              proficient: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              developing: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              unsatisfactory: {
                type: Type.OBJECT,
                properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                required: ["text", "points"],
              },
              totalPoints: { type: Type.NUMBER },
            },
            required: ["category", "description", "exemplary", "proficient", "developing", "unsatisfactory", "totalPoints"],
          },
        },
      },
      required: ["title", "totalPoints", "criteria"],
    };

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: rubricSchema },
    });

    if (!response.text) throw new Error("Failed to apply rubric changes.");
    return JSON.parse(response.text.trim()) as RubricData;
  }, signal);
}

// ─── Phase 3: CSV pre-upload analysis ───────────────────────────────

export interface CsvAnalysisResult {
  rubricName: string;
  criteriaCount: number;
  totalPoints: number;
  isValid: boolean;
  notes: string;
}

/**
 * Use Gemini to analyse a Canvas rubric CSV before it is uploaded to Canvas.
 * Returns the rubric name, criteria count, total points, validity flag and a
 * one-sentence summary.  Throttled + retried like every other API call.
 */
export async function analyzeCsvForCanvas(
  csvContent: string,
  signal?: AbortSignal,
): Promise<CsvAnalysisResult> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: `Analyze this Canvas rubric CSV file and extract the following:
- rubricName: the rubric title from column A of the first data row
- criteriaCount: total number of criteria rows (data rows only, not the header)
- totalPoints: total points for the rubric
- isValid: true if this matches a properly-formatted Canvas rubric CSV (has the required header row and at least one data row), false if it appears malformed
- notes: one sentence summarising the rubric

CSV content (first 3000 characters):
${csvContent.slice(0, 3000)}`,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubricName:    { type: Type.STRING },
            criteriaCount: { type: Type.NUMBER },
            totalPoints:   { type: Type.NUMBER },
            isValid:       { type: Type.BOOLEAN },
            notes:         { type: Type.STRING },
          },
          required: ['rubricName', 'criteriaCount', 'totalPoints', 'isValid', 'notes'],
        },
      },
    });

    if (!response.text) throw new Error('No analysis response from Gemini');
    return JSON.parse(response.text.trim()) as CsvAnalysisResult;
  }, signal);
}

// ─── CSV repair after a Canvas rejection ────────────────────────────

/** What the model came back with. Both fields are claims until the gates in csvRepair.ts pass. */
export interface CsvRepairProposal {
  repairedCsv: string;
  /** The model's own account of what it changed. Never used to build the diff the user approves. */
  notes: string;
}

/**
 * Ask Gemini to repair a rubric CSV that Canvas has just rejected.
 *
 * The valuable input here is `canvasMessage` — Canvas says precisely what it objected to
 * ("criterion ratings: points cannot be blank"), and without it the model is guessing at which of
 * several plausible problems to fix. `analyzeCsvForCanvas` never receives it, which is why this is
 * a separate call rather than a flag on that one.
 *
 * Nothing here is trusted. The caller runs the result through `checkRepair`, which proves the file
 * parses, refuses one that loses a criterion, and derives the change list by comparing the two
 * files rather than by reading `notes`.
 */
export async function repairRubricCsv(
  csvContent: string,
  canvasMessage: string,
  signal?: AbortSignal,
): Promise<CsvRepairProposal> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `A Canvas rubric CSV was rejected by Canvas. Repair the CSV so Canvas will accept it.

CANVAS REPORTED:
${canvasMessage || '(Canvas gave no message.)'}

REQUIRED HEADER ROW (line 1, verbatim):
Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points

RULES:
1. One row per criterion. Keep EVERY criterion that is in the original, with its name unchanged.
2. "Rubric Name": populate only on the first data row; leave blank on the rest.
3. "Criteria Enable Range" is TRUE or FALSE.
4. "Rating Points" holds a single maximum number per rating — "10", "8", "0". Never a range
   string such as "10-8"; Canvas derives range boundaries from the adjacent rating values.
   Whatever notation the band arrived in, keep its HIGHEST number and nothing else: "4 to >3 pts"
   becomes 4, "4-3.5 points" becomes 4, "40-50 pts" becomes 50, "2.4-0 points" becomes 2.4.
   A cell holding only an open bound — ">90", "<70" — has no maximum in it; use the criterion's
   full point value for a top band and the next rating's value for a bottom one, and say in notes
   that you supplied it.
5. Ratings run HIGHEST points to LOWEST, left to right.
6. Wrap any field containing a comma or a quotation mark in double quotes, doubling internal quotes.
7. Change as little as possible. Do not reword criteria or ratings that are not part of the problem,
   do not add criteria, and do not remove criteria.
8. If a point value is missing and must be supplied, infer it from the surrounding rating values and
   say so explicitly in "notes" — that is a number a human has to check.

Return JSON with:
- repairedCsv: the complete corrected CSV as a single string, header row first, no markdown fences.
- notes: one or two sentences on what you changed and why.

ORIGINAL CSV:
${csvContent}`;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            repairedCsv: { type: Type.STRING },
            notes:       { type: Type.STRING },
          },
          required: ['repairedCsv', 'notes'],
        },
      },
    });

    if (!response.text) throw new Error('No repair response from Gemini');
    const parsed = JSON.parse(response.text.trim()) as CsvRepairProposal;
    // Models still fence occasionally despite the JSON schema, and a stray fence would fail the
    // parse gate for a reason that has nothing to do with the rubric.
    const fenced = parsed.repairedCsv?.match(/```(?:csv)?\n?([\s\S]*?)\n?```/);
    return {
      repairedCsv: (fenced ? fenced[1] : parsed.repairedCsv ?? '').trim(),
      notes: parsed.notes ?? '',
    };
  }, signal);
}

/**
 * Generate a Canvas-compatible CSV for a single named rubric extracted
 * from the given attachment.
 *
 * Uses a standalone generateContent call (not the shared chat session)
 * so multiple rubrics can be dispatched concurrently from Part 2 — the
 * queue-based throttle serialises their API calls at 1 per 4 s.
 */
export async function generateCsvForRubric(
  rubricName: string,
  totalPoints: string,
  scoringMethod: 'ranges' | 'fixed',
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<string> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const pointsRule =
      scoringMethod === 'ranges'
        ? 'This rubric uses point ranges. Give each rating its HIGHEST value only, as a plain number. A cell reading "4 to >3 pts" (the wording Canvas itself uses, where ">3" just restates the rating below) is 4. "4-3.5 points" is 4. "40–50 pts" is 50. "2.4-0 points" is 2.4. Never carry the "to", the ">" or the dash into points.'
        : 'This rubric uses single fixed point values. Give each rating its number, e.g. "10", "8".';

    const prompt = `Extract the rubric named "${rubricName}" from this document.

- Total points: ${totalPoints || 'as detected in the document'}
- Points: ${pointsRule}
- Order the ratings from HIGHEST points to LOWEST.
- Copy each criterion and rating's wording from the document. Do not summarise or rewrite it.
- If a rating's points cannot be determined from the document, return the cell's text as it
  appears rather than guessing a number.`;

    const parts: any[] = [{ text: prompt }];

    parts.push(await documentPart(attachment));

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: { type: Type.OBJECT, properties: { criteria: CRITERIA_SCHEMA }, required: ['criteria'] },
      },
    });

    if (!response.text) throw new Error('No response from Gemini');
    const parsed = JSON.parse(response.text.trim()) as { criteria: ExtractedCriterion[] };
    if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
      throw new Error(`No criteria found for the rubric named “${rubricName}”.`);
    }

    // The CSV is assembled here rather than by the model — see electron/ipc/rubricCsv.ts for why.
    return buildRubricCsv({ title: rubricName, criteria: parsed.criteria }, scoringMethod);
  }, signal);
}

// ─── Phase 2: Rubric discovery (pass 1 of 2) ────────────────────────

export interface RubricDiscovery {
  name: string;
  scoringMethod: 'ranges' | 'fixed';
}

/**
 * Lightweight first-pass: ask Gemini to list all rubric titles (and
 * scoring methods) in the document WITHOUT generating any CSV content.
 * Returns quickly because the output is tiny, regardless of how many
 * rubrics the document contains.  Used by the two-pass generation flow
 * so the UI can render all rubric cards (in pending state) before
 * per-rubric CSV generation begins.
 */
export async function discoverRubricTitles(
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<RubricDiscovery[]> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `List every grading rubric in this document.

For each rubric return:
- name: the exact rubric title as it appears in the document
- scoringMethod: "ranges" if the rubric uses point ranges (e.g. "40–50 pts", "90-100"), "fixed" if it uses single point values (e.g. "10 pts", "8")

Do NOT generate CSV content — titles and scoring methods only.`;

    const parts: any[] = [{ text: prompt }];

    parts.push(await documentPart(attachment));

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name:          { type: Type.STRING },
                  scoringMethod: { type: Type.STRING },
                },
                required: ['name', 'scoringMethod'],
              },
            },
          },
          required: ['rubrics'],
        },
      },
    });

    if (!response.text) throw new Error('No response from rubric discovery call');
    const parsed = JSON.parse(response.text.trim()) as {
      rubrics: Array<{ name: string; scoringMethod: string }>;
    };
    if (!Array.isArray(parsed.rubrics) || parsed.rubrics.length === 0) {
      throw new Error('No rubrics found in document — check that the file contains rubric tables');
    }
    return parsed.rubrics.map((r) => ({
      name: r.name,
      scoringMethod: r.scoringMethod === 'fixed' ? ('fixed' as const) : ('ranges' as const),
    }));
  }, signal);
}

// ─── Phase 2: Batch rubric generation (legacy — kept for reference) ──

export interface BatchRubricResult {
  title: string;
  csv: string;
}

/**
 * Send ALL rubric tables in a single document to Gemini in ONE call and
 * return a structured array of {title, csv} pairs.
 *
 * This "batch-then-split" model avoids the N×throttle cost of calling
 * generateCsvForRubric once per rubric — the 15-second governor fires
 * once for the whole document, not per rubric.
 *
 * Retries use a 60-second initial cooldown (vs 5 s for per-rubric calls)
 * to give the free-tier quota time to fully reset before re-attempting a
 * large, token-heavy request.
 */
/**
 * The points grammar, and the instruction not to rewrite the instructor's words.
 *
 * Shared by both batch prompts so they cannot drift apart. The verbatim rule matters more than it
 * looks: these rubrics are already written and already approved, and an extraction that "improves"
 * a rating description silently changes what a student is graded against.
 */
const EXTRACTION_RULES = `Points rules:
- Give each rating a single value. For a band, that is its HIGHEST number: "4 to >3 pts" (the
  wording Canvas itself uses, where ">3" just restates the rating below) is 4. "4-3.5 points" is
  4. "40–50 pts" is 50. "2.4-0 points" is 2.4. Never carry the "to", the ">" or the dash through.
- If a rating's points cannot be determined from the document, return the cell's text as it
  appears rather than guessing a number.

Copy each criterion and rating's wording from the document. Do not summarise or rewrite it.`;

const BATCH_RUBRICS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rubrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title:      { type: Type.STRING },
          usesRanges: { type: Type.BOOLEAN },
          criteria:   CRITERIA_SCHEMA,
        },
        required: ['title', 'usesRanges', 'criteria'],
      },
    },
  },
  required: ['rubrics'],
} as const;

/**
 * Run one batch extraction and turn the result into CSVs.
 *
 * The body both batch calls share; only the prompt differs. The CSV is assembled here rather than
 * by the model — see electron/ipc/rubricCsv.ts for the data loss that taught us to do it this way.
 */
async function runBatchExtraction(
  prompt: string,
  attachment: Attachment,
  signal: AbortSignal | undefined,
  emptyMessage: string,
): Promise<BatchRubricResult[]> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const parts: any[] = [{ text: prompt }];
    parts.push(await documentPart(attachment));

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: BATCH_RUBRICS_SCHEMA,
      },
    });

    if (!response.text) throw new Error('No response from Gemini batch call');
    const parsed = JSON.parse(response.text.trim()) as {
      rubrics: Array<{ title: string; usesRanges: boolean; criteria: ExtractedCriterion[] }>;
    };
    if (!Array.isArray(parsed.rubrics) || parsed.rubrics.length === 0) {
      throw new Error(emptyMessage);
    }

    return parsed.rubrics.map((r) => ({
      title: r.title,
      csv: buildRubricCsv(
        { title: r.title, criteria: r.criteria ?? [] },
        r.usesRanges ? 'ranges' : 'fixed',
      ),
    }));
  }, signal);
}

/**
 * Extract a named subset of a document's rubrics in one call.
 *
 * This is what makes a large document affordable. Above the batch limit the app used to fall all
 * the way to one call per rubric, and because every call carries the whole document, a 26-rubric
 * document sent that document 27 times and spent 25 six-second pacing gaps doing it. Asking for a
 * named group instead means the same document takes four calls, not twenty-seven.
 *
 * Splitting by name rather than by slicing the document is deliberate: a slice can cut a rubric in
 * half, and the model is being asked to find rubrics by title anyway — discovery has already
 * established that those titles exist.
 *
 * Rubrics it cannot find are omitted rather than returned empty, so the caller can tell exactly
 * which names went unanswered and retry just those.
 */
export async function generateCsvsForRubrics(
  attachment: Attachment,
  rubricNames: string[],
  signal?: AbortSignal,
): Promise<BatchRubricResult[]> {
  if (rubricNames.length === 0) return [];

  const list = rubricNames.map((n, i) => `${i + 1}. "${n}"`).join('\n');

  return runBatchExtraction(
    `Extract ONLY the rubrics named below from this document. Ignore every other rubric in it.

Rubrics to extract:
${list}

For each one return:
- title: the rubric's name exactly as it appears in the document
- usesRanges: true if that rubric's points are written as bands ("40–50 pts", "4 to >3 pts",
  "10-8"), false if they are single fixed values ("10 pts", "8")
- criteria: one entry per row of the rubric, each with its ratings ordered HIGHEST to LOWEST

Return them in the order listed above. If one of the named rubrics is not in the document, leave
it out rather than inventing it.

${EXTRACTION_RULES}`,
    attachment,
    signal,
    `None of the named rubrics could be found in the document (${rubricNames.join(', ')})`,
  );
}

// ─── Phase 1 → Phase 2 direct carry-forward ─────────────────────────

/**
 * Build a Canvas-compatible CSV directly from a Phase 1 RubricData object.
 * No API call required — all data is already structured.
 *
 * @param rubric       The RubricData object produced by Phase 1.
 * @param scoringMethod 'ranges' sets Criteria Enable Range=TRUE; 'fixed' sets FALSE.
 * @returns Raw CSV string ready for Canvas import.
 */
