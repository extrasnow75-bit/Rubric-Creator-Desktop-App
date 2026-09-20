import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  X,
  Search,
  Folder,
  FileText,
  Table2,
  FileType,
  Image as ImageIcon,
  Loader2,
  ChevronRight,
  Clock,
  HardDrive,
  Users,
  AlertCircle,
  Check,
} from 'lucide-react';

/**
 * Browse and pick a file or folder from the user's Google Drive.
 *
 * This replaces the Google Picker, which cannot run here: the Picker is a browser widget that
 * needs a real http origin for `setOrigin`, and a packaged desktop app is served from file://.
 *
 * Rebuilding it turned out to be an improvement rather than a consolation. The Picker needed its
 * own API key (a missing one produced an unescapable 403 overlay), and the old code had to race
 * it against a ten-second timeout because it could fail without ever calling back. None of that
 * applies to a list drawn from `drive.files.list` in the main process.
 *
 * Every call goes through `window.api.drive`, which holds the Google token in the main process.
 * No credential reaches this component.
 */

export type DriveBrowserMode = 'file' | 'folder';

interface DriveFileRow {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  isFolder: boolean;
}

interface DriveBrowserProps {
  isOpen: boolean;
  mode: DriveBrowserMode;
  /** Restrict the listing. Ignored in folder mode. */
  mimeTypes?: string[];
  title?: string;
  onCancel: () => void;
  onPickFile?: (file: { fileId: string; name: string; mimeType: string }) => void;
  /**
   * `folderId` is absent when the chosen destination is My Drive itself.
   *
   * That is not a missing value to work around: Drive's own default parent for a new file is the
   * user's root, so every call down this path already omits `parents` when no folder id is given.
   * Inventing an id for the root would mean special-casing a sentinel in main instead.
   */
  onPickFolder?: (folder: { folderId?: string; folderName: string }) => void;
}

type Scope = 'recent' | 'myDrive' | 'sharedWithMe';

const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';

const SCOPE_TABS: Array<{ id: Scope; label: string; icon: React.ReactNode }> = [
  { id: 'recent', label: 'Recent', icon: <Clock className="w-4 h-4" /> },
  { id: 'myDrive', label: 'My Drive', icon: <HardDrive className="w-4 h-4" /> },
  { id: 'sharedWithMe', label: 'Shared with me', icon: <Users className="w-4 h-4" /> },
];

/** A recognisable icon per file type, so the list can be scanned without reading every name. */
const FileIcon: React.FC<{ file: DriveFileRow }> = ({ file }) => {
  if (file.isFolder) return <Folder className="w-5 h-5 text-amber-500 flex-shrink-0" />;
  if (file.mimeType === GOOGLE_DOC) return <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />;
  if (file.mimeType === GOOGLE_SHEET) return <Table2 className="w-5 h-5 text-green-700 flex-shrink-0" />;
  if (file.mimeType.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-purple-600 flex-shrink-0" />;
  return <FileType className="w-5 h-5 text-gray-600 flex-shrink-0" />;
};

const formatDate = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const DriveBrowser: React.FC<DriveBrowserProps> = ({
  isOpen,
  mode,
  mimeTypes,
  title,
  onCancel,
  onPickFile,
  onPickFolder,
}) => {
  const [scope, setScope] = useState<Scope>('recent');
  const [files, setFiles] = useState<DriveFileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  /** Folders drilled into, oldest first. Empty means we are at the top of `scope`. */
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<DriveFileRow | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  /** Guards against an earlier, slower request overwriting the results of a later one. */
  const requestSeq = useRef(0);

  const currentFolder = trail.length > 0 ? trail[trail.length - 1] : null;

  /**
   * Sitting at the top of My Drive, which is a real destination and used to be unreachable.
   *
   * Choosing a folder needed either a selected row or a folder drilled into, and My Drive itself
   * is neither — it is never a row in its own listing. So the only way to save anything was into
   * a subfolder, and the Choose button simply sat disabled with nothing explaining why.
   *
   * Not offered on Recent or Shared with me: neither has a root you could write to, and a search
   * is global, so "the top of this list" means nothing there.
   */
  const atMyDriveRoot =
    mode === 'folder' && scope === 'myDrive' && trail.length === 0 && !activeSearch;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.drive.listFiles({
        scope: activeSearch ? 'search' : currentFolder ? 'folder' : scope,
        folderId: currentFolder?.id,
        query: activeSearch || undefined,
        mimeTypes: mode === 'folder' ? undefined : mimeTypes,
        foldersOnly: mode === 'folder',
        pageSize: 100,
      });
      if (seq !== requestSeq.current) return; // a newer request has already landed
      setFiles(result.files);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : 'Could not load your Drive files.');
      setFiles([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [scope, activeSearch, currentFolder, mode, mimeTypes]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  // Reset to a clean state each time the dialog opens, so it never reopens showing the folder
  // someone drilled into last week.
  useEffect(() => {
    if (!isOpen) return;
    setScope('recent');
    setTrail([]);
    setSearchInput('');
    setActiveSearch('');
    setSelected(null);
  }, [isOpen]);

  /**
   * Focus, Tab-trapping, Escape and focus-restore, from the hook every other dialog uses.
   *
   * This component used to hand-roll two of those four: it focused the search box and closed on
   * Escape, but nothing held Tab inside it and nothing gave focus back on close. So Tab from the
   * last row walked out into the page behind a backdrop that says `aria-modal="true"`, and
   * picking a file dropped focus to <body> instead of returning it to the button that opened
   * the picker.
   *
   * `initialFocus` keeps the one behaviour worth keeping: focus lands in the search box rather
   * than on the Close button, because typing a filename is the fastest way to find something.
   */
  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onCancel, { initialFocus: searchRef });

  if (!isOpen) return null;

  const openRow = (file: DriveFileRow) => {
    if (file.isFolder) {
      // Drilling in leaves search: a search is global, so a folder found by one is a new root.
      setSearchInput('');
      setActiveSearch('');
      setTrail((prev) => [...prev, { id: file.id, name: file.name }]);
      setSelected(null);
      return;
    }
    if (mode === 'file') {
      onPickFile?.({ fileId: file.id, name: file.name, mimeType: file.mimeType });
    }
  };

  const goToCrumb = (index: number) => {
    setTrail((prev) => prev.slice(0, index + 1));
    setSelected(null);
  };

  const switchScope = (next: Scope) => {
    setScope(next);
    setTrail([]);
    setSearchInput('');
    setActiveSearch('');
    setSelected(null);
  };

  const heading = title ?? (mode === 'folder' ? 'Choose a Drive folder' : 'Choose a file from Drive');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        {/* Header */}
        <div className="bg-brand text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-bold">{heading}</h2>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs + search */}
        <div className="border-b border-gray-200 px-6 pt-3 flex-shrink-0">
          <div className="flex gap-1">
            {SCOPE_TABS.map((tab) => {
              const active = scope === tab.id && !activeSearch;
              return (
                <button
                  key={tab.id}
                  onClick={() => switchScope(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-bold border-b-2 transition-colors ${
                    active
                      ? 'border-brand text-brand'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>

          <form
            className="relative my-3"
            onSubmit={(e) => {
              e.preventDefault();
              setActiveSearch(searchInput.trim());
              setTrail([]);
              setSelected(null);
            }}
          >
            <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={searchRef}
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                // Emptying the box returns to the current tab rather than leaving stale results.
                if (e.target.value === '') setActiveSearch('');
              }}
              aria-label="Search your Drive by file name"
              placeholder="Search your Drive by file name…"
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </form>

          {/* Breadcrumbs, only once there is somewhere to go back to */}
          {trail.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap pb-3 text-sm">
              <button
                onClick={() => { setTrail([]); setSelected(null); }}
                className="text-brand font-bold hover:underline"
              >
                {SCOPE_TABS.find((t) => t.id === scope)?.label}
              </button>
              {trail.map((crumb, i) => (
                <React.Fragment key={crumb.id}>
                  <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
                  <button
                    onClick={() => goToCrumb(i)}
                    className={
                      i === trail.length - 1
                        ? 'text-gray-900 font-bold'
                        : 'text-brand font-bold hover:underline'
                    }
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Listing */}
        <div className="flex-1 overflow-y-auto min-h-[280px]">
          {loading ? (
            <div className="flex items-center justify-center h-full py-16 text-gray-600">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading your Drive…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
              <p className="text-sm text-gray-700 max-w-md">{error}</p>
              <button
                onClick={() => void load()}
                className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-lg font-bold text-sm"
              >
                Try again
              </button>
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
              <Folder className="w-8 h-8 text-gray-600 mb-3" />
              <p className="text-sm text-gray-700">
                {activeSearch
                  ? `Nothing in your Drive matches “${activeSearch}”.`
                  : mode === 'folder'
                  ? 'No folders here.'
                  : 'No files here.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {files.map((file) => {
                const isSelected = selected?.id === file.id;
                const selectable = mode !== 'folder' || file.isFolder;
                return (
                  <li key={file.id} className="flex items-stretch">
                    {/*
                      Two sibling buttons, not one button with another nested inside it.

                      The row used to be a single <button> containing a <span role="button">Open</span>.
                      Interactive content inside a button is invalid HTML — screen readers commonly
                      strip it from the accessibility tree — and that span was never focusable, so
                      "Open" existed for mouse users only.
                    */}
                    <button
                      onClick={() => (selectable ? setSelected(file) : undefined)}
                      onDoubleClick={() => openRow(file)}
                      onKeyDown={(e) => {
                        // Enter opens a folder, matching double-click. Without this a keyboard
                        // user could only ever reach files at the top level of a tab: Enter
                        // selected the folder, and the footer button then *picked* it rather
                        // than going inside, so anything filed in a subfolder was unreachable.
                        if (e.key === 'Enter' && file.isFolder) {
                          e.preventDefault();
                          openRow(file);
                        }
                      }}
                      aria-pressed={selectable ? isSelected : undefined}
                      className={`flex-1 min-w-0 text-left px-6 py-3 flex items-center gap-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* A marker independent of the background tint: bg-blue-50 against
                          hover:bg-gray-50 is two near-identical pale greys, so selection was
                          conveyed by colour alone. */}
                      <span className="w-4 flex-shrink-0 text-brand" aria-hidden="true">
                        {isSelected ? <Check className="w-4 h-4" /> : null}
                      </span>
                      <FileIcon file={file} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-gray-900 truncate">
                          {file.name}
                        </span>
                        <span className="block text-xs text-gray-600">
                          {file.isFolder ? 'Folder' : 'File'}
                          {file.modifiedTime ? ` · Modified ${formatDate(file.modifiedTime)}` : ''}
                        </span>
                      </span>
                    </button>

                    {file.isFolder && (
                      <button
                        onClick={() => openRow(file)}
                        aria-label={`Open folder ${file.name}`}
                        className="px-4 text-xs font-bold text-brand hover:underline hover:bg-gray-50 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                      >
                        Open
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0 bg-gray-50">
          <p className="text-xs text-gray-600">
            {mode !== 'folder'
              ? 'Select a file and choose it below, or double-click it.'
              : atMyDriveRoot
                ? 'Open a folder to go inside it, select one, or choose My Drive itself.'
                : 'Open a folder to go inside it, or select one and choose it.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl font-bold text-sm text-gray-900 bg-gray-100 hover:bg-gray-200 transition-all"
            >
              Cancel
            </button>
            <button
              disabled={
                mode === 'folder'
                  ? !selected && !currentFolder && !atMyDriveRoot
                  : !selected || selected.isFolder
              }
              onClick={() => {
                if (mode === 'folder') {
                  // Selecting nothing while inside a folder means "this one" — the folder the
                  // user has navigated into and is looking at. Selecting nothing at the top of
                  // My Drive means My Drive, which carries no id (see `onPickFolder` above).
                  if (selected) {
                    onPickFolder?.({ folderId: selected.id, folderName: selected.name });
                  } else if (currentFolder) {
                    onPickFolder?.({
                      folderId: currentFolder.id,
                      folderName: currentFolder.name,
                    });
                  } else if (atMyDriveRoot) {
                    onPickFolder?.({ folderName: 'My Drive' });
                  }
                } else if (selected && !selected.isFolder) {
                  onPickFile?.({
                    fileId: selected.id,
                    name: selected.name,
                    mimeType: selected.mimeType,
                  });
                }
              }}
              className="px-5 py-2 rounded-xl font-bold text-sm bg-brand text-white hover:bg-brand-dark transition-all disabled:bg-gray-300 disabled:text-gray-400"
            >
              {mode !== 'folder'
                ? 'Choose file'
                : selected
                  ? `Choose “${selected.name}”`
                  : currentFolder
                    ? `Choose “${currentFolder.name}”`
                    : atMyDriveRoot
                      ? 'Choose My Drive'
                      : 'Choose folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveBrowser;
