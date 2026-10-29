/**
 * Words a person typed into their Google Doc by hand, passed to the model so a revision keeps them.
 *
 * Mirrors ProtectedEdit in src/utils/manualEdits.ts, which works out the list. Declared here so the
 * main process does not import from the renderer.
 */
export interface ProtectedEdit {
  criterion: string
  where: string
  passages: string[]
}

/**
 * The instruction that goes into the revision prompt, or an empty string when there is nothing to
 * protect.
 *
 * The wording is deliberate about what is NOT asked. The model is not told to freeze the cells —
 * "make the tone more formal throughout" may properly reword a cell the person edited, and the
 * words around their passage are the model's to adjust. It is told to keep the passage itself.
 */
export function protectedEditsPrompt(edits: readonly ProtectedEdit[] | undefined): string {
  const usable = (edits ?? []).filter((e) => e.passages.some((p) => p.trim().length > 0))
  if (usable.length === 0) return ''

  const lines = usable.flatMap((e) =>
    e.passages
      .filter((p) => p.trim().length > 0)
      .map((p) => `- Criterion "${e.criterion}", ${e.where}: "${p}"`),
  )

  return `
    PASSAGES THE USER ADDED OR CORRECTED BY HAND IN THEIR GOOGLE DOC:
    ${lines.join('\n    ')}

    Keep every one of these passages word for word in the rubric you return. Change the wording
    around a passage only as far as the requested changes require, and never remove one or merge it
    away, even where you are rewriting the rest of that cell. If a requested change seems to
    conflict with one of them, still keep it: the user will decide.
  `
}
