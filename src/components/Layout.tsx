import React, { useEffect, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode } from '../types';
import { ZoomControl } from './ZoomControl';
import { HelpCircle, ChevronLeft, Camera, Lightbulb, RotateCcw } from 'lucide-react';
import UpdateBanner from './UpdateBanner';
import { StartOverDialog } from './StartOverDialog';
import { hasUnsavedWork } from '../utils/sessionWork';

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Read once at module scope: the platform cannot change while the app is running.
 * Optional-chained so that loading the renderer without the preload bridge attached — opening the
 * dev server straight in a browser — degrades to the Windows layout instead of throwing before
 * the app can render at all.
 */
const isMac = window.api?.app?.platform === 'darwin';

const IconBox = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <div className={`w-10 h-10 rounded-lg border border-gray-100 shadow-sm flex items-center justify-center bg-white shrink-0 ${className}`}>
    {children}
  </div>
);

const RightArrow = () => (
  <svg className="w-4 h-4 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);


const WordIcon = () => (
  <div className="w-8 h-8 bg-[#2b579a] rounded flex items-center justify-center text-white font-black text-lg shadow-sm">W</div>
);

const CSVIcon = () => (
  <div className="w-8 h-8 bg-[#1d6f42] rounded flex flex-col items-center justify-center text-white font-black shadow-sm leading-none text-[10px]">CSV</div>
);

const CanvasLogo = () => (
  <div className="relative w-10 h-10 flex items-center justify-center bg-white rounded-xl shadow-sm border border-slate-100">
    <svg viewBox="0 0 100 100" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
      <g fill="#E63027">
        {/* 8 outer crescents — dome pointing outward, flat side toward center */}
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(45, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(90, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(135, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(180, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(225, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(270, 50, 50)" />
        <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(315, 50, 50)" />
        {/* 8 inner dots interspersed at 22.5° offset */}
        <circle cx="50" cy="28" r="5" transform="rotate(22.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(67.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(112.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(157.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(202.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(247.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(292.5, 50, 50)" />
        <circle cx="50" cy="28" r="5" transform="rotate(337.5, 50, 50)" />
      </g>
    </svg>
  </div>
);


export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { state, setCurrentStep, setHelpOpen, clearSession } = useSession();
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);

  /**
   * Start Over, and why it is not behind a condition.
   *
   * It used to be, on `state.hasDraftRubric !== null` — and nothing in the app ever set that to
   * anything but null, so the button never rendered once, at any window size or zoom. The flag is
   * gone now. This is the second ribbon control someone has gone looking for and failed to find,
   * so this one is always here: a way out of a half-finished run is exactly what you need when
   * the screen is not behaving, which is when a clever visibility rule is least likely to agree
   * with you.
   *
   * The confirm is only raised when clearing would destroy something — see `hasUnsavedWork`.
   */
  const startOver = () => {
    if (hasUnsavedWork(state)) setConfirmingStartOver(true);
    else clearSession();
  };

  /**
   * Whether a newer version exists on GitHub, checked once at launch.
   *
   * Resolves to null when up to date, offline, or the check itself failed — all three mean "show
   * no bar" here. The Help Center's button is what tells those apart for someone who wants to
   * know, because it reports a failed check as a failure rather than as good news. Nothing here
   * surfaces an error: a failed update check must never interrupt startup.
   */
  const [update, setUpdate] = useState<{ version: string } | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.api.app.checkUpdate().then(setUpdate).catch(() => undefined);
    window.api.app.version().then(setAppVersion).catch(() => undefined);
  }, []);

  const getRibbonContent = () => {
    const baseClasses = 'flex items-center gap-3';

    switch (state.currentStep) {
      case AppMode.DASHBOARD:
        return (
          <div className={baseClasses}>
            <IconBox className="bg-amber-50"><Lightbulb className="w-5 h-5 text-amber-500" /></IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <RightArrow />
            <IconBox><CSVIcon /></IconBox>
            <RightArrow />
            <IconBox><CanvasLogo /></IconBox>
          </div>
        );
      case AppMode.PART_1:
        return (
          <div className={baseClasses}>
            <IconBox className="bg-amber-50"><Lightbulb className="w-5 h-5 text-amber-500" /></IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#2B579A]">Phase 1: </span><span className="text-gray-900">Create Draft Rubric</span>
            </span>
          </div>
        );
      case AppMode.PART_2:
        return (
          <div className={baseClasses}>
            <IconBox><WordIcon /></IconBox>
            <RightArrow />
            <IconBox><CSVIcon /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#1d6f42]">Phase 2: </span><span className="text-gray-900">Convert to CSV</span>
            </span>
          </div>
        );
      case AppMode.PART_3:
        return (
          <div className={baseClasses}>
            <IconBox><CanvasLogo /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#E64C3C]">Phase 3: </span><span className="text-gray-900">Deploy to Canvas</span>
            </span>
          </div>
        );
      case AppMode.SCREENSHOT:
        return (
          <div className={baseClasses}>
            <IconBox className="bg-purple-50">
              <Camera className="w-5 h-5 text-purple-600" />
            </IconBox>
            <RightArrow />
            <IconBox><WordIcon /></IconBox>
            <span className="text-sm font-black uppercase tracking-widest ml-2">
              <span className="text-[#2B579A]">Phase 1: </span><span className="text-gray-900">Convert Screenshot</span>
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const showReturnButton = state.currentStep !== AppMode.DASHBOARD;

  return (
    <div className="flex flex-col h-screen bg-gray-50 relative overflow-hidden">
      {/*
        Blue banner, doubling as the window's title bar.

        The native title bar is hidden (see `titleBarStyle` in electron/main.ts), so this strip is
        what the user drags to move the window — hence `titlebar-drag`. Anything clickable placed
        in here must carry `titlebar-no-drag`, or the drag region swallows the click.

        The side padding leaves room for the window controls, which the two platforms put in
        opposite corners: macOS draws its traffic lights top-left, Windows and Linux draw
        minimise/maximise/close top-right. Reserving space on the correct side only keeps the
        banner text centred rather than nudged off-centre on both.
      */}
      <div
        className={`titlebar-drag bg-brand text-white py-6 px-8 sm:px-12 flex items-center justify-center shadow-lg z-50 relative ${
          isMac ? 'pl-24' : 'pr-40'
        }`}
      >
        <div className="text-center">
          <h1 className="text-xl font-black">The Canvas Rubric Creator App <span className="font-normal opacity-75">V.3</span></h1>
          <p className="text-xs text-blue-100">Streamlined rubric workflow</p>
        </div>
        {/*
          Hidden on Windows and Linux at narrow widths: the caption buttons live in that corner,
          and at a small window size this line would end up underneath them.
        */}
        <p
          className={`text-xs text-blue-200 font-medium absolute ${
            isMac ? 'right-8 sm:right-12' : 'right-40 hidden lg:block'
          }`}
        >
          Part of the IDS TOOLKIT
        </p>
      </div>

      {/*
        The update bar sits below the title bar, not above it.

        Above it, the bar would occupy the strip where Windows draws the minimise, maximise and
        close buttons (titleBarOverlay, 36px tall in the top-right) and where macOS draws its
        traffic lights — so the Download and dismiss buttons would end up underneath the window
        controls. Here it is clear of both.
      */}
      {update && !updateDismissed && (
        <UpdateBanner
          version={update.version}
          currentVersion={appVersion}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}

      {/* A live region that enters the DOM already holding its text is announced unreliably
          across screen readers, so this one is mounted for the life of the app and only its
          contents change. */}
      <div role="status" aria-live="polite" className="sr-only">
        {update && !updateDismissed ? `Version ${update.version} is available.` : ''}
      </div>

      {/*
        White Ribbon Bar.

        `flex-wrap` because this row now always carries four controls — text size, Start Over,
        Help Center and, off the Dashboard, the return button — and it had no overflow handling
        at all: at a narrow window they would have run off the right edge with no scrollbar to
        reach them. Wrapping to a second line costs a few pixels of height and keeps every
        control reachable, which matters more here than elsewhere, since this is the row people
        come to when something has gone wrong.
      */}
      <div className="bg-white border-b border-gray-200 py-3 px-8 sm:px-12 flex flex-wrap items-center justify-between gap-y-3 shadow-sm z-40">
        {/* Left Side: Workflow Sequence */}
        <div className="hidden sm:flex">
          {getRibbonContent()}
        </div>

        {/* Right Side: Text size, Help & Return Button */}
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3 ml-auto">
          {/* First in the group, as in Canvas Extractor Tools. Always present: it is the control
              someone reaches for when they cannot read the screen, so it must not be behind a
              conditional or inside the Help Center. */}
          <ZoomControl />

          <button
            onClick={startOver}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-gray-700 rounded-xl transition-all font-bold text-sm border border-gray-200 active:scale-95"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>Start Over</span>
          </button>
          <button
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-all font-bold text-sm border border-gray-200 active:scale-95"
          >
            <HelpCircle className="w-5 h-5" />
            <span>Help Center & More</span>
          </button>

          {showReturnButton && (
            <button
              onClick={() => setCurrentStep(AppMode.DASHBOARD)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Dashboard
            </button>
          )}
        </div>
      </div>

      {/*
        Main Content Area.

        `min-h-0` is load-bearing, not tidying. A flex item defaults to `min-height: auto`, which
        means it will not shrink below its content — so without it this element grows past the
        window instead of scrolling inside it, its own `overflow-y-auto` never engages, and the
        overflow lands on the shell above, which is `overflow-hidden` and therefore clips it with
        no scrollbar. With `min-h-0` this is a real scroll container, which also means anything
        calling `scrollIntoView` scrolls *this* — a panel the user can scroll back — rather than
        the shell, which they cannot.
      */}
      <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-gray-50/50">
        {children}
      </main>

      <StartOverDialog
        isOpen={confirmingStartOver}
        onCancel={() => setConfirmingStartOver(false)}
        onConfirm={() => {
          setConfirmingStartOver(false);
          clearSession();
        }}
      />
    </div>
  );
};
