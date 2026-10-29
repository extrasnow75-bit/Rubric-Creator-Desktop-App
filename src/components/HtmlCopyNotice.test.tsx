import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HtmlCopyNotice } from './HtmlCopyNotice';

describe('HtmlCopyNotice', () => {
  const html = renderToStaticMarkup(<HtmlCopyNotice />);

  it('says the HTML file was downloaded', () => {
    expect(html).toContain('You downloaded the HTML file version of the rubric doc.');
  });

  it('tells the person how to send an edited file, with the route name in italics', () => {
    expect(html).toContain('click Start Over at the top right');
    expect(html).toContain('<em>Upload your existing draft rubrics to Canvas</em>');
    expect(html).toContain('pick your edited file');
  });

  it('is announced when it appears', () => {
    expect(html).toContain('role="status"');
  });
});
