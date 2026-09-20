import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import { DriveBrowser, DriveBrowserMode } from '../components/DriveBrowser';

/**
 * A promise-shaped wrapper around the Drive browser.
 *
 * The components that used to call the Google Picker did so as `const result = await openPicker()`
 * and carried on inline. A modal React component does not naturally work that way, so this holds
 * one `<DriveBrowser>` at the top of the tree and hands out promises that settle when the user
 * picks or cancels — which keeps those five call sites reading the way they already did.
 *
 * Resolving with null for a cancel matches the Picker's own contract, so the existing
 * `if (!result) return;` guards at each call site remain correct.
 */

export interface PickedFile {
  fileId: string;
  name: string;
  mimeType: string;
}

export interface PickedFolder {
  /** Absent when the destination is My Drive itself, which is Drive's default parent. */
  folderId?: string;
  folderName: string;
}

interface DrivePickerApi {
  /** Resolves with the chosen file, or null if the user cancelled. */
  pickFile: (options?: { mimeTypes?: string[]; title?: string }) => Promise<PickedFile | null>;
  /** Resolves with the chosen folder, or null if the user cancelled. */
  pickFolder: (options?: { title?: string }) => Promise<PickedFolder | null>;
}

const DrivePickerContext = createContext<DrivePickerApi | undefined>(undefined);

/** The document types the rubric workflow can actually read, used when a caller names none. */
export const DEFAULT_PICKER_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'text/plain',
];

export const DrivePickerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<DriveBrowserMode>('file');
  const [mimeTypes, setMimeTypes] = useState<string[] | undefined>(undefined);
  const [title, setTitle] = useState<string | undefined>(undefined);

  /**
   * The settle function for the currently open dialog.
   *
   * A ref rather than state: it must not be captured by a render, and updating it should never
   * cause one. Cleared on settle so a stray second call cannot resolve an already-closed dialog.
   */
  const resolveRef = useRef<((value: never) => void) | null>(null);

  const settle = useCallback((value: PickedFile | PickedFolder | null) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setIsOpen(false);
    resolve?.(value as never);
  }, []);

  const open = useCallback(
    <T,>(nextMode: DriveBrowserMode, opts?: { mimeTypes?: string[]; title?: string }): Promise<T> => {
      // If something is already open, cancel it rather than stranding its promise unsettled —
      // an await that never returns would leave the caller's spinner running forever.
      resolveRef.current?.(null as never);
      setMode(nextMode);
      setMimeTypes(opts?.mimeTypes ?? (nextMode === 'file' ? DEFAULT_PICKER_MIME_TYPES : undefined));
      setTitle(opts?.title);
      setIsOpen(true);
      return new Promise<T>((resolve) => {
        resolveRef.current = resolve as (value: never) => void;
      });
    },
    [],
  );

  const pickFile = useCallback(
    (options?: { mimeTypes?: string[]; title?: string }) =>
      open<PickedFile | null>('file', options),
    [open],
  );

  const pickFolder = useCallback(
    (options?: { title?: string }) => open<PickedFolder | null>('folder', options),
    [open],
  );

  // Stable identity: the provider re-renders on every open/close and mode change, and a
  // fresh object literal here would re-render every picker consumer with it.
  const api = useMemo(() => ({ pickFile, pickFolder }), [pickFile, pickFolder]);

  return (
    <DrivePickerContext.Provider value={api}>
      {children}
      <DriveBrowser
        isOpen={isOpen}
        mode={mode}
        mimeTypes={mimeTypes}
        title={title}
        onCancel={() => settle(null)}
        onPickFile={(file) => settle(file)}
        onPickFolder={(folder) => settle(folder)}
      />
    </DrivePickerContext.Provider>
  );
};

export const useDrivePicker = (): DrivePickerApi => {
  const ctx = useContext(DrivePickerContext);
  if (!ctx) throw new Error('useDrivePicker must be used inside a DrivePickerProvider');
  return ctx;
};
