// ============================================
// UNIFIED TYPES FOR CONSOLIDATED RUBRIC APP
// ============================================

// =========================
// ENUMS
// =========================

export enum AppMode {
  DASHBOARD = 'DASHBOARD',
  PART_1 = 'PART_1',
  PART_2 = 'PART_2',
  PART_3 = 'PART_3',
  SCREENSHOT = 'SCREENSHOT'
}

export enum PointStyle {
  RANGE = 'RANGE',
  SINGLE = 'SINGLE'
}

export enum ProcessingType {
  SINGLE = 'SINGLE',
  MULTIPLE = 'MULTIPLE'
}

export enum Role {
  USER = 'user',
  MODEL = 'model'
}

export enum BatchItemStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum AppModeForUpload {
  UPLOAD = 'upload',
  SETTINGS = 'settings'
}

export type FileProcessingStatus = 'pending' | 'uploading' | 'success' | 'error';

// =========================
// INTERFACES - PROGRESS TRACKING
// =========================

export interface ProgressState {
  isProcessing: boolean;
  percentage: number;
  currentStep: string;
  timeElapsed: number; // milliseconds
  timeRemaining: number; // milliseconds
  bytesProcessed: number;
  totalBytes: number;
  itemsProcessed: number;
  totalItems: number;
  canCancel: boolean;
}

// =========================
// INTERFACES - RUBRIC DATA
// =========================

export interface RubricRating {
  text: string;
  points: string;
}

export interface RubricCriterion {
  category: string;
  description: string;
  exemplary: RubricRating;
  proficient: RubricRating;
  developing: RubricRating;
  unsatisfactory: RubricRating;
  totalPoints: number;
}

export interface RubricData {
  title: string;
  criteria: RubricCriterion[];
  totalPoints: number;
}

/** A Google Doc this app wrote, and enough about it to write to it again. */
export interface SavedRubricDoc {
  fileId: string;
  webViewLink: string;
  /** What Drive called it, timestamp included. Shown rather than reconstructed. */
  name: string;
  /** Drive's version counter as of our last write. */
  version: string;
}

export interface RubricMeta {
  name: string;
  totalPoints: string;
  scoringMethod: 'ranges' | 'fixed';
}

// =========================
// INTERFACES - CANVAS
// =========================

/**
 * Where a rubric is being uploaded.
 *
 * No token field: the Canvas token lives in the OS keychain and is loaded by the main process
 * when it builds the request. Nothing in the renderer needs to carry it around, so nothing does.
 */
export interface CanvasConfig {
  courseHomeUrl: string;
}

export interface CanvasUser {
  id: number;
  name: string;
}

export interface RubricRatingCanvas {
  description: string;
  long_description: string;
  points: number;
}

export interface RubricCriterionCanvas {
  description: string;
  long_description: string;
  ratings: Record<string, RubricRatingCanvas>;
}

export interface RubricPayload {
  rubric: {
    title: string;
    criteria: Record<string, RubricCriterionCanvas>;
  };
  rubric_association: {
    association_id: string;
    association_type: 'Course' | 'Assignment';
    use_for_grading: boolean;
    purpose: string;
  };
}

// =========================
// INTERFACES - FILE/MESSAGE
// =========================

export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // Base64 string
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  timestamp: number;
  metadata?: {
    filename?: string;
  };
}

// =========================
// INTERFACES - BATCH/UPLOAD
// =========================

export interface BatchItem extends RubricMeta {
  id: string;
  status: BatchItemStatus;
  csvContent?: string;
  error?: string;
}

export interface BatchStatus {
  fileName: string;
  status: FileProcessingStatus;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface UploadHistoryItem {
  id: string;
  timestamp: number;
  rubricName: string;
  totalPoints: number;
  csvFileName?: string;
  canvasUploadStatus?: 'pending' | 'success' | 'failed';
  error?: string;
}

// =========================
// INTERFACES - GOOGLE AUTH
// =========================

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// =========================
// INTERFACES - SESSION STATE
// =========================

export interface SessionState {
  // Current step in workflow
  currentStep: AppMode;

  // Rubric data (persists across steps)

  /**
   * The rubric currently open in the editor.
   *
   * Every screen below Part 1 reads this and nothing else, which is why a run that produces
   * several rubrics still has it: `rubrics` is the set, this is the one being looked at, and
   * `setRubric` keeps the two in step. The editor, the AI revision and the replacement upload
   * therefore needed no changes when multiple rubrics arrived — they still edit "the rubric".
   */
  rubric: RubricData | null;

  /**
   * Every rubric this run produced, in the order they were asked for.
   *
   * A single-rubric run holds one entry rather than none, so saving and deploying never need a
   * separate path for "just the one".
   */
  rubrics: RubricData[];

  /** Which entry of `rubrics` is open. Always a valid index while `rubrics` is non-empty. */
  activeRubricIndex: number;

  rubricMetadata: RubricMeta | null;

  /**
   * How the rubrics in `rubrics` express their rating points, set when they are generated.
   *
   * Part 1 asks the user for this ("Ranges" 10 to >8, or "Single" 10, 8, 6) and it decides the
   * `Criteria Enable Range` column of the Canvas CSV. It has to live here because the screen that
   * asks is not the screen that converts: Part 1 holds the choice, the deploy panel builds the
   * CSV, and nothing carried it between them — so every rubric deployed as TRUE regardless of
   * what was chosen. Recorded at generation time rather than read live, because it describes the
   * rubrics that exist, not what the control happens to say now.
   */
  scoringMethod: 'ranges' | 'fixed';

  /**
   * Whether any rubric has reached Canvas in this session.
   *
   * Editing a rubric here never changes one already in Canvas, and deploying again POSTs a new
   * one rather than updating the old — so a rename followed by a second deploy leaves the course
   * holding two rubrics with similar names. The editing controls say so once this is true. It is
   * a session fact rather than a per-rubric one because the deploy panel reports a batch.
   */
  deployedToCanvas: boolean;

  /**
   * The Google Doc these rubrics were last written to, if any.
   *
   * Held so the app can write back to the same file instead of creating another one. Every
   * "Open in Google Docs" used to create a new document and throw the returned id away, so three
   * revisions left three identically named files in Drive and nothing said which was current.
   *
   * `version` is Drive's own counter as of the app's last write. Comparing it before the next
   * write is how an edit made by hand in Google Docs is noticed, rather than silently overwritten.
   *
   * Cleared when a genuinely new set of rubrics is generated, since the remembered document
   * belongs to the set it was written from.
   */
  savedDoc: SavedRubricDoc | null;

  // CSV output (from Part 2)
  csvOutput: string | null;
  csvFileName: string | null;

  // Canvas config (for Part 3)
  canvasConfig: CanvasConfig | null;

  // Batch operations
  batchItems: BatchItem[];

  // Session history
  uploadHistory: UploadHistoryItem[];

  // UI state
  isLoading: boolean;
  error: string | null;
  helpOpen: boolean;
  taskCompletionOpen: boolean;

  // Progress tracking
  progress: ProgressState;

  /**
   * Whether a Gemini key is saved, and its last four characters — never the key.
   * Same treatment as the Canvas token; see canvasTokenStatus below.
   */
  geminiKeyStatus: CredentialStatus | null;

  /**
   * Whether a Canvas token is saved, and its last four characters — never the token.
   *
   * A Canvas access token reads every student record its owner can see, so it lives in the OS
   * keychain and is loaded by the main process at the moment a request is built. The renderer
   * needs to know only whether setup is complete and which token is saved; it is never given the
   * value, and so has nothing to leak.
   */
  canvasTokenStatus: CredentialStatus | null;

  // V.2 fields
  courseUrl: string | null;

  /**
   * Bumped by `clearSession`, and used as a React key on whichever screen is showing.
   *
   * Clearing the session resets this context, but each screen also keeps its own local state —
   * the Dashboard alone holds the uploaded-file queue, the chosen Phase 1 mode and the answer to
   * the draft-rubric question. None of that is reachable from here, so a clear left the screen
   * looking exactly as it did. Changing the key remounts the screen, which resets all of it at
   * once and cannot fall out of date as screens gain new state.
   */
  sessionKey: number;

  /**
   * Google sign-in.
   *
   * Identity only. The access and refresh tokens live in the main process — the refresh token
   * encrypted in the OS keychain — and every Drive call fetches its own. There is deliberately no
   * googleAccessToken field: the renderer makes no Google requests, so holding one would be an
   * exposure with no purpose.
   */
  isGoogleAuthenticated: boolean;
  googleUser: GoogleUser | null;
  googleAuthError: string | null;
  isAuthenticating: boolean;
}

// =========================
// INTERFACES - GENERATION
// =========================

export interface GenerationSettings {
  totalPoints: number;
  pointStyle: PointStyle;
  processingType: ProcessingType;
}

// =========================
// INTERFACES - CANVAS API
// =========================

export interface RubricConfig {
  canvasUrl: string;
  token: string;
  courseId: string;
  useProxy: boolean;
  proxyService: string;
}
