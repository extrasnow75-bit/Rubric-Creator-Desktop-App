/**
 * Stop rubric text becoming a live formula when a CSV is converted to a Google Sheet.
 *
 * "Add to Drive" uploads each CSV with `targetMimeType: application/vnd.google-apps.spreadsheet`,
 * so Google parses every cell on import. A criterion description that begins with `=`, or with a
 * `+` or `@`, is then not text: it is evaluated. Mostly that produces a `#NAME?` where a sentence
 * should be — a rubric quietly missing the thing it was meant to say — and at the far end a
 * crafted string can reach other cells or a `HYPERLINK`.
 *
 * The data here is the user's own rubric, so this is a low-severity issue rather than a hole
 * someone attacks through. It is still wrong for a description to disappear because it opened
 * with a dash, and the fix is cheap.
 *
 * **This is applied to the Drive copy only.** The CSV that goes to Canvas, and the CSV written to
 * disk, are untouched — Canvas parses its own import and has no formula evaluation to protect
 * against, and a `.csv` on disk should be the exact bytes that deployed.
 */

/**
 * Leading characters Google Sheets reads as the start of a formula.
 *
 * Tab and carriage return are in the list because Sheets strips leading whitespace before
 * deciding, so `\t=SUM(A1)` is a formula too.
 */
const FORMULA_START = /^[=+@\t\r]/;

/** A plain number, which is what `-5` and `+3` are and must stay. */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * Does this field need neutralising?
 *
 * The `-` case is why this is a function rather than one regex. Rating points are routinely
 * negative — a late penalty is `-5` — and prefixing those would turn a number into text in the
 * Sheet, which is a worse outcome than the problem being solved. A leading `-` only matters when
 * what follows is not simply a number, as in `-1+HYPERLINK(...)`.
 */
export function needsFormulaGuard(field: string): boolean {
  if (PLAIN_NUMBER.test(field.trim())) return false;
  return FORMULA_START.test(field) || field.startsWith('-');
}

/**
 * The apostrophe is Sheets' own "treat this as text" marker, consumed on import rather than
 * stored, so the cell reads as the author wrote it.
 */
export function guardField(field: string): string {
  return needsFormulaGuard(field) ? `'${field}` : field;
}

/**
 * Split CSV text into rows of fields.
 *
 * Deliberately small and local rather than a dependency: the input is CSV this app produced or
 * Gemini returned in the same shape, and the only thing that has to survive the round trip is
 * the field boundaries. Handles quoted fields, `""` escapes, embedded newlines and CRLF.
 */
export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // A CRLF is one break, not two.
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  // Whatever is left is a final row, unless the text ended on a line break and left nothing.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Quote a field only when CSV requires it, so untouched cells come back as they went in. */
function serializeField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * The same CSV, safe to hand to Google Sheets.
 *
 * Row and field structure is preserved exactly; only fields that would otherwise be evaluated
 * gain a leading apostrophe. The trailing newline is kept or omitted to match the input, since a
 * CSV that gained one would import as an extra blank row.
 */
export function toSheetSafeCsv(csv: string): string {
  if (csv === '') return '';
  const endsWithBreak = /\r?\n$/.test(csv);
  const body = parseCsvRows(csv)
    .map((row) => row.map((f) => serializeField(guardField(f))).join(','))
    .join('\n');
  return endsWithBreak ? `${body}\n` : body;
}
