import { describe, it, expect } from 'vitest';
import { isHtmlFileName, textFromBase64, scoringMethodOf } from './htmlRubricFile';
import type { RubricData } from '../types';

const rubric = (points: [string, string, string, string]): RubricData => {
  const rating = (text: string, p: string) => ({ text, points: p });
  return {
    title: 'Part 1',
    totalPoints: 10,
    criteria: [
      {
        category: 'Clarity',
        description: '',
        exemplary: rating('a', points[0]),
        proficient: rating('b', points[1]),
        developing: rating('c', points[2]),
        unsatisfactory: rating('d', points[3]),
        totalPoints: 10,
      },
    ],
  } as RubricData;
};

describe('isHtmlFileName', () => {
  it('accepts .html and .htm in any case', () => {
    expect(isHtmlFileName('rubrics.html')).toBe(true);
    expect(isHtmlFileName('RUBRICS.HTM')).toBe(true);
  });

  it('refuses other files', () => {
    expect(isHtmlFileName('rubrics.docx')).toBe(false);
    expect(isHtmlFileName('rubrics.html.txt')).toBe(false);
  });
});

describe('textFromBase64', () => {
  it('reads UTF-8 text, curly quotes included', () => {
    const text = 'It’s “clear” – mostly';
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    expect(textFromBase64(btoa(binary))).toBe(text);
  });
});

describe('scoringMethodOf', () => {
  it('calls point bands ranges', () => {
    expect(scoringMethodOf(rubric(['10-9', '9-7', '7-4', '4-0']))).toBe('ranges');
  });

  it('calls single scores fixed', () => {
    expect(scoringMethodOf(rubric(['10', '8', '6', '0']))).toBe('fixed');
  });
});
