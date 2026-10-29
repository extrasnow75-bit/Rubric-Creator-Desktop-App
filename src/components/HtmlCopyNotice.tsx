import React from 'react';

interface HtmlCopyNoticeProps {
  /** Spacing, since the two screens that show this sit it in different places. */
  className?: string;
}

/**
 * Shown on the deploy card once the rubric has been saved to the computer as an .html file.
 *
 * Deploying from this screen sends the rubrics as the app holds them, not whatever has since been
 * done to the saved file. Someone who edits that file by hand and then deploys would send the
 * unedited version, and nothing on the screen would say so. The way to send the edited file is
 * the upload route on the start screen, which is also the only way for someone with no Google
 * account, so this says how to get there.
 *
 * It appears only after a successful save, so a person who never saved a file is not shown it.
 */
export const HtmlCopyNotice: React.FC<HtmlCopyNoticeProps> = ({ className = 'mb-6' }) => (
  <div role="status" className={`p-4 bg-amber-50 border border-amber-200 rounded-2xl ${className}`}>
    <p className="text-sm font-bold text-amber-900">
      You downloaded the HTML file version of the rubric doc.
    </p>
    <p className="text-sm text-amber-900 mt-1">
      If you edited the file yourself instead of asking Gemini, click Start Over at the top right,
      choose the <em>Upload your existing draft rubrics to Canvas</em> button, and pick your edited
      file.
    </p>
  </div>
);

export default HtmlCopyNotice;
