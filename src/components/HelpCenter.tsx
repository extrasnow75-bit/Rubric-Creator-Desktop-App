
import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useDialogFocus, useInertWhenHidden } from '../hooks/useDialogFocus';

/**
 * The eCampus KB article for this app.
 *
 * TEMPORARY — this points at the Google Doc draft, not the published Confluence page. When the
 * article moves to Confluence, replace it with the short /wiki/x/ form rather than the long
 * /wiki/spaces/…/pages/… one: the short link survives the page being renamed or moved between
 * spaces, which the long form does not. Both hosts are already on the allowlist in
 * electron/ipc/externalLinks.ts, so neither needs a change there.
 *
 * Setting this to null hides the card entirely, which is why the placeholder was null rather than
 * a dead link — an article link that 404s is worse than no link at all.
 */
const HELP_CENTER_ARTICLE_URL: string | null =
  'https://docs.google.com/document/d/1zVFVvstKLI1o2tnLV4Uc5Jykcb_41V5AfhXXwHsbHsI/edit';

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

type ManualCheckResult =
  | { state: 'update-available'; current: string; latest: string }
  | { state: 'up-to-date'; current: string }
  | { state: 'check-failed'; current: string };

const HelpCenter: React.FC<HelpCenterProps> = ({ isOpen, onClose }) => {
  const panelRef = useRef<HTMLElement>(null);
  /**
   * The panel stays mounted so it can slide, which means that while "closed" it is only
   * translated off-screen — every link and button inside stayed focusable and readable by
   * assistive tech. A keyboard user tabbing through the app landed on controls they could not
   * see, with no visible focus ring. `inert` removes the subtree from focus and from the
   * accessibility tree without disturbing the transition.
   */
  useInertWhenHidden(panelRef, !isOpen);
  // trapFocus: false — this is a side drawer rather than a modal; taking focus and closing on
  // Escape is the useful part, and holding Tab captive in a scrolling reference panel is not.
  useDialogFocus(isOpen, onClose, { trapFocus: false, ref: panelRef });
  const [appVersion, setAppVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ManualCheckResult | null>(null);

  useEffect(() => {
    window.api.app.version().then(setAppVersion).catch(() => undefined);
  }, []);

  /**
   * The check the user asked for, as opposed to the silent one at launch.
   *
   * Unlike the launch check this always hits the network and distinguishes a failed check from
   * "up to date" — reporting the former as the latter would turn an unknown into a false
   * reassurance, which is worse than saying nothing.
   */
  async function runUpdateCheck() {
    if (checking) return; // the button is aria-disabled rather than disabled, so guard here
    setChecking(true);
    setCheckResult(null);
    try {
      setCheckResult(await window.api.app.checkUpdateNow());
    } catch {
      // checkNow resolves rather than rejects for ordinary network trouble, so reaching here
      // means something unexpected. Report it the same way — the user's next step is identical.
      setCheckResult({ state: 'check-failed', current: appVersion });
    } finally {
      setChecking(false);
    }
  }

  // Listen for deeplink events from other components (e.g. "How do I get one?" link)
  useEffect(() => {
    const handler = (e: Event) => {
      const sectionId = (e as CustomEvent).detail as string;
      // Wait for the slide-in animation to complete before scrolling
      setTimeout(() => {
        const target = document.getElementById(sectionId);
        if (target && panelRef.current) {
          panelRef.current.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
        }
      }, 350);
    };
    window.addEventListener('openHelpSection', handler);
    return () => window.removeEventListener('openHelpSection', handler);
  }, []);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Side Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Help Center"
        aria-hidden={!isOpen}
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } overflow-y-auto`}
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase">Help Center</h2>
            <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">IDS TOOLKIT</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Help Center"
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600 hover:text-gray-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-8">

          {/* Updates — first, so "am I on the current version?" is answerable without
              reading past anything else. */}
          <section id="updates">
            <h3 className="text-xs font-black text-gray-600 uppercase tracking-[0.2em] mb-3">Updates</h3>
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-3">
              <p className="text-sm text-gray-600">
                The app checks for a newer version each time it starts, and shows a bar across the
                top of the window if one exists. Updates are never installed automatically — you
                download and run them yourself.
              </p>
              {/* The automatic check can come up empty for reasons that are not "you are up to
                  date": offline, a GitHub rate limit, a campus network blocking the request. That
                  silence looks identical to good news, so the button below exists to ask directly,
                  and reports a failed check as a failure. */}
              <p className="text-sm text-gray-600">
                You can also check at any time:
              </p>

              <div className="flex flex-col items-start gap-2">
                {/* aria-disabled rather than disabled: Chromium blurs a focused element the
                    moment it becomes disabled, which throws focus to <body> and means the
                    "Checking…" label is never announced to the person who pressed the button. */}
                <button
                  onClick={runUpdateCheck}
                  aria-disabled={checking}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                    checking
                      ? 'bg-gray-200 text-gray-700 cursor-wait'
                      : 'bg-brand text-white hover:bg-brand-dark'
                  }`}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  {checking ? 'Checking\u2026' : 'Check for updates'}
                </button>

                <button
                  onClick={() => void window.api.app.openReleases()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <ExternalLinkIcon />
                  View all versions on GitHub
                  <span className="sr-only">(opens in your browser)</span>
                </button>
              </div>

              {/* Always mounted, so the result is announced when it arrives rather than the
                  region appearing with its text already in place — which announces unreliably. */}
              <div role="status" aria-live="polite" className={checkResult ? '' : 'sr-only'}>
                {checking && <p className="sr-only">Checking for updates\u2026</p>}
                {checkResult?.state === 'up-to-date' && (
                  <p className="text-sm font-bold text-green-800">
                    You&apos;re up to date — v{checkResult.current} is the latest version.
                  </p>
                )}
                {checkResult?.state === 'update-available' && (
                  <p className="text-sm font-bold text-blue-900">
                    Version {checkResult.latest} is available. You&apos;re running v
                    {checkResult.current} — use{' '}
                    <span className="font-black">View all versions on GitHub</span> above to
                    download it.
                  </p>
                )}
                {checkResult?.state === 'check-failed' && (
                  <p className="text-sm font-bold text-amber-800">
                    Couldn&apos;t reach GitHub, so this could not be checked. You may be on the
                    latest version or you may not — try again, or open the releases page.
                  </p>
                )}
              </div>

              {appVersion && (
                <p className="text-xs text-gray-600 pt-1 border-t border-gray-200">
                  You are running version {appVersion}.
                </p>
              )}
            </div>
          </section>

          {/* AI Setup */}
          <section>
            <h3 className="text-xs font-black text-gray-600 uppercase tracking-[0.2em] mb-3">AI Setup</h3>
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-3">
              <p className="text-sm font-black text-gray-900">How To Get a Gemini API Key</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                <li>Go to <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a>.</li>
                <li>Sign in with your Google or SSO account, such as your Boise State University email.</li>
                <li>
                  Create the key:
                  <ol className="list-[lower-alpha] list-inside space-y-1 mt-1 ml-4">
                    <li>Click <span className="font-bold">"Get API key"</span> on the left.</li>
                    <li>Click the <span className="font-bold">"Create API key"</span> button.</li>
                  </ol>
                </li>
                <li>Copy and paste the key. A string of letters and numbers will appear. Copy it immediately.</li>
                <li>Use it: Go back to your app and paste it into the appropriate place.</li>
              </ol>
              <p className="text-xs text-gray-600">
                Source:{' '}
                <a
                  href="https://docs.google.com/document/d/1Ce1gOTozOD3TGd8ntPz3oEWJjU-Y07K2akuIJHXnzHk/edit?tab=t.0#heading=h.xaazhwt982j4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  What a Gemini API Key Is, and How and Why to Get One
                </a>
              </p>
            </div>
          </section>

          {/* Canvas Access Token — inline steps */}
          <section id="canvas-setup">
            <h3 className="text-xs font-black text-gray-600 uppercase tracking-[0.2em] mb-3">Canvas Setup</h3>
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-3">
              <p className="text-sm font-black text-gray-900">How to Generate a Canvas Access Token</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                <li>Log into Canvas.</li>
                <li>Go to <span className="font-bold">Account → Settings</span>.</li>
                <li>Scroll to <span className="font-bold">Approved Integrations</span>.</li>
                <li>Click <span className="font-bold">+ New Access Token</span>.</li>
                <li>Give it a name and click <span className="font-bold">Generate Token</span>.</li>
                <li>Copy the token and paste it into the app.</li>
              </ol>
              <p className="text-xs text-gray-600">
                Source:{' '}
                <a
                  href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  How do I manage API access tokens in my user account?
                </a>
              </p>
            </div>
          </section>

          {/* Resources & Training */}
          <section>
            <h3 className="text-xs font-black text-gray-600 uppercase tracking-[0.2em] mb-4">Resources & Training</h3>
            <div className="space-y-3">
              {/* The eCampus KB article. Hidden until HELP_CENTER_ARTICLE_URL is set —
                  see the note on that constant for why a placeholder link is not left in. */}
              {HELP_CENTER_ARTICLE_URL ? (
                <a
                  href={HELP_CENTER_ARTICLE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-2xl transition-all group"
                >
                  <span className="text-sm font-bold text-blue-900">
                    Canvas Rubric Creator App — KB Article
                  </span>
                  <span className="text-blue-700 ml-3"><ExternalLinkIcon /></span>
                </a>
              ) : (
                <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl">
                  <p className="text-sm font-bold text-gray-700">
                    KB Article — coming soon
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    The full setup and troubleshooting guide is being written. It will appear here
                    once it is published.
                  </p>
                </div>
              )}

              <a
                href="https://drive.google.com/drive/folders/1JHSAm6uXphyZSx6I3hUT70l-IwW6T4FK?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">Selected Training Documents</span>
                <span className="text-gray-600 group-hover:text-blue-700 ml-3"><ExternalLinkIcon /></span>
              </a>

              <a
                href="https://docs.google.com/document/d/1vPzRVs-qdIwhOR_IkFEjZlKw-pobiRYGZgjQm8eUZCY/edit?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
              >
                <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">How To Manually Upload a Rubric CSV File To Canvas</span>
                <span className="text-gray-600 group-hover:text-blue-700 ml-3"><ExternalLinkIcon /></span>
              </a>
            </div>
          </section>

          {/* App Suggestions */}
          <section className="pt-8 border-t border-gray-100">
            <h3 className="text-xs font-black text-gray-600 uppercase tracking-[0.2em] mb-4">Find bugs? Have improvement requests?</h3>
            <a
              href="https://docs.google.com/document/d/1UALeUcbTKGx6ytt7tY4aCqja28rvRdIR-tW8nGYhFn8/edit?tab=t.0"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl transition-all group"
            >
              <span className="text-sm font-bold text-gray-800 group-hover:text-blue-700">App Suggestions Document</span>
              <span className="text-gray-600 group-hover:text-blue-700 ml-3"><ExternalLinkIcon /></span>
            </a>
          </section>

          {/* AI Models Used */}
          <section className="pt-4">
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
              <p className="text-sm font-black text-gray-900 flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                AI Models Used
              </p>
              <ul className="space-y-1 text-sm text-gray-600 ml-6">
                <li><span className="font-semibold text-gray-700">Rubrics, CSV and repairs:</span> gemini-3.5-flash-lite</li>
                <li><span className="font-semibold text-gray-700">Reading a screenshot:</span> gemini-3.8-flash</li>
              </ul>
            </div>
          </section>

        </div>
      </aside>
    </>
  );
};

export default HelpCenter;
