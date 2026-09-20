import React, { useState } from 'react';
import { CheckCircle, Download, Loader2 } from 'lucide-react';
import JSZip from 'jszip';
import { useSession } from '../contexts/SessionContext';
import { useDrivePicker } from '../contexts/DrivePickerContext';

/**
 * "Keep a copy of the CSVs" — the same offer wherever CSVs exist.
 *
 * It lived inside the deploy panel, which put it after the upload to Canvas and nowhere else.
 * That is the wrong place for the one case it matters most: a deploy that fails. The CSVs are
 * built before anything is sent, from rubrics already in memory and with no AI call involved
 * (see utils/rubricCsv.ts), so they can be handed over at any point — including before the
 * user commits to a deploy at all. Part 1 now offers them under its deploy button for exactly
 * that reason, and this component is what both places render so the two cannot drift.
 */

export interface CsvFile {
  name: string;
  csvContent: string;
}

interface Props {
  csvs: CsvFile[];
  /** The question above the buttons, before anything has been saved. */
  prompt?: string;
  /** Called when the user waves the offer away. Omitted leaves the dismiss button off. */
  onDismiss?: () => void;
  /** Name for the zip, used when there is more than one CSV to save to disk. */
  zipName?: string;
}

/** Filesystem-safe, and stable between the disk and Drive paths so the names match. */
const safeName = (name: string) => name.replace(/[^a-z0-9]/gi, '_');

export const CsvSaveOptions: React.FC<Props> = ({
  csvs,
  prompt = 'Would you like CSV versions of each rubric?',
  onDismiss,
  zipName = 'rubric_csvs.zip',
}) => {
  const { state: session } = useSession();
  const { pickFolder } = useDrivePicker();

  /**
   * Where the CSVs went, so the confirmation can say which of the two things happened.
   *
   * One flag would not do: "downloaded" under a Drive save is wrong, and someone who did both
   * should see both.
   */
  const [savedToDisk, setSavedToDisk] = useState(false);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveSaveSuccess, setDriveSaveSuccess] = useState<string | null>(null);
  const [driveSaveError, setDriveSaveError] = useState<string | null>(null);

  const savedSomething = savedToDisk || !!driveSaveSuccess;

  /** True only if a file actually landed on disk. Cancelling the dialog is not a save. */
  const saveToDisk = async (): Promise<boolean> => {
    if (csvs.length === 0) return false;
    // Saved through the native dialog: an anchor-click download does not work from a file://
    // page, and used to fail silently.
    if (csvs.length === 1) {
      const res = await window.api.file.saveText({
        defaultName: `${safeName(csvs[0].name)}.csv`,
        ext: 'csv',
        label: 'CSV file',
        content: csvs[0].csvContent,
      });
      return res.ok;
    }
    const zip = new JSZip();
    csvs.forEach((r) => zip.file(`${safeName(r.name)}.csv`, r.csvContent));
    // uint8array rather than blob: the bytes have to cross IPC, and a Blob does not.
    const bytes = (await zip.generateAsync({ type: 'uint8array' })) as Uint8Array;
    const res = await window.api.file.saveText({
      defaultName: zipName,
      ext: 'zip',
      label: 'Zip archive',
      content: bytes,
    });
    return res.ok;
  };

  const handleSaveToDisk = async () => {
    // Only claimed once it is true. The receipt used to appear the moment the button was
    // pressed, so backing out of the save dialog still left "CSVs downloaded" on the screen.
    if (await saveToDisk()) setSavedToDisk(true);
  };

  /**
   * The same CSVs, into a Google Drive folder the user picks.
   *
   * One file per rubric rather than the zip the disk path uses. A zip in Drive has to be
   * downloaded and unpacked before anyone can see what is in it, which gives up the only thing
   * putting it in Drive was for.
   *
   * Uploaded as Google Sheets, matching what Part 2's "Add All to Drive" already does — the two
   * screens produce the same kind of file and should not put two different things in someone's
   * Drive. A Sheet opens in a click, and File → Download → CSV gives back the file that deployed.
   */
  const handleAddToDrive = async () => {
    if (csvs.length === 0 || !session.isGoogleAuthenticated) return;
    setDriveSaveError(null);
    setSavingToDrive(true);
    try {
      const folder = await pickFolder();
      if (!folder) return;

      for (const item of csvs) {
        await window.api.drive.upload({
          content: item.csvContent,
          name: item.name,
          sourceMimeType: 'text/csv',
          targetMimeType: 'application/vnd.google-apps.spreadsheet',
          folderId: folder.folderId,
        });
      }
      setDriveSaveSuccess(
        `${csvs.length} file${csvs.length !== 1 ? 's' : ''} added to "${folder.folderName}"`,
      );
    } catch (err: any) {
      // Named here rather than through the page's error banner: this panel is what the user is
      // looking at, and a Drive failure costs nothing that was already deployed.
      setDriveSaveError(`Could not add to Drive: ${err?.message ?? 'unknown error'}`);
    } finally {
      setSavingToDrive(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-gray-700">
          {savedSomething ? 'Would you like another copy somewhere else?' : prompt}
        </span>
        <button
          onClick={() => void handleSaveToDisk()}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all active:scale-95"
        >
          <Download className="w-4 h-4" /> Save to my computer
        </button>
        <button
          onClick={() => void handleAddToDrive()}
          disabled={savingToDrive || !session.isGoogleAuthenticated}
          title={
            session.isGoogleAuthenticated
              ? undefined
              : 'Sign in with Google to add files to your Drive.'
          }
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          {savingToDrive ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            /* Drive's own mark, the same one Part 2 uses on its Add to Drive button. */
            <svg
              className="w-4 h-4 flex-shrink-0"
              viewBox="0 -960 960 960"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z" />
            </svg>
          )}
          {savingToDrive ? 'Adding…' : 'Add to Drive'}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all"
          >
            {savedSomething ? 'Done' : 'No thanks'}
          </button>
        )}
      </div>

      {!session.isGoogleAuthenticated && (
        <p className="text-xs text-gray-600 mt-2">
          Sign in with Google to add them to your Drive. Saving to this computer needs no account.
        </p>
      )}
      {driveSaveError && <p className="text-xs text-red-700 font-bold mt-2">{driveSaveError}</p>}

      {savedSomething && (
        <div className="mt-2 space-y-1">
          {savedToDisk && (
            <p className="text-sm text-green-700 font-bold flex items-center gap-2">
              <Download className="w-4 h-4" />
              CSV{csvs.length !== 1 ? 's' : ''} saved to your computer.
            </p>
          )}
          {driveSaveSuccess && (
            <p className="text-sm text-green-700 font-bold flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              {driveSaveSuccess}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
