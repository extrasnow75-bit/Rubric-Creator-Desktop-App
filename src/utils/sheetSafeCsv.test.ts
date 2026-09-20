import { describe, expect, it } from 'vitest';
import { needsFormulaGuard, parseCsvRows, toSheetSafeCsv } from './sheetSafeCsv';

describe('needsFormulaGuard', () => {
  it('catches the characters Sheets treats as a formula', () => {
    expect(needsFormulaGuard('=SUM(A1:A9)')).toBe(true);
    expect(needsFormulaGuard('@import')).toBe(true);
    expect(needsFormulaGuard('\t=SUM(A1)')).toBe(true);
  });

  /**
   * The case that makes this a function rather than one regex. A late penalty really is worth
   * -5 points, and prefixing it would store a number as text in the Sheet — a worse outcome
   * than the problem being fixed.
   */
  it('leaves plain numbers alone, including negative and signed ones', () => {
    expect(needsFormulaGuard('-5')).toBe(false);
    expect(needsFormulaGuard('+3')).toBe(false);
    expect(needsFormulaGuard('-2.5')).toBe(false);
    expect(needsFormulaGuard(' -5 ')).toBe(false);
    expect(needsFormulaGuard('10')).toBe(false);
  });

  it('catches a leading dash that is not a number', () => {
    expect(needsFormulaGuard('-1+HYPERLINK("http://x","click")')).toBe(true);
    expect(needsFormulaGuard('- uses evidence throughout')).toBe(true);
  });

  it('leaves ordinary rubric prose alone', () => {
    expect(needsFormulaGuard('Exceeds expectations')).toBe(false);
    expect(needsFormulaGuard('4 to >3 pts')).toBe(false);
    expect(needsFormulaGuard('')).toBe(false);
  });
});

describe('parseCsvRows', () => {
  it('splits plain rows', () => {
    expect(parseCsvRows('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps commas and newlines inside quoted fields', () => {
    expect(parseCsvRows('"one, two","line\nbreak"')).toEqual([['one, two', 'line\nbreak']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsvRows('"She said ""go"""')).toEqual([['She said "go"']]);
  });

  it('treats CRLF as one break', () => {
    expect(parseCsvRows('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('does not invent a row from a trailing newline', () => {
    expect(parseCsvRows('a,b\n')).toEqual([['a', 'b']]);
  });
});

describe('toSheetSafeCsv', () => {
  it('guards a formula and leaves the rest of the row untouched', () => {
    expect(toSheetSafeCsv('Criterion,=SUM(A1),10')).toBe("Criterion,'=SUM(A1),10");
  });

  it('keeps negative points numeric', () => {
    expect(toSheetSafeCsv('Late penalty,-5')).toBe('Late penalty,-5');
  });

  it('re-quotes a guarded field that needs it', () => {
    expect(toSheetSafeCsv('"=HYPERLINK(""a"",""b"")"')).toBe('"\'=HYPERLINK(""a"",""b"")"');
  });

  /** The round trip must not change the shape of the file, only the odd cell's first character. */
  it('preserves structure, quoting and the trailing newline', () => {
    const csv = 'Rubric Name,Criteria Name,Rating Points\n"Module 1, Part A",Analysis,10\n';
    expect(toSheetSafeCsv(csv)).toBe(csv);
  });

  it('handles an empty string', () => {
    expect(toSheetSafeCsv('')).toBe('');
  });

  it('guards every affected cell across several rows', () => {
    const csv = '=one,two\nthree,@four';
    expect(toSheetSafeCsv(csv)).toBe("'=one,two\nthree,'@four");
  });
});
