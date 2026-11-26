// Browser storage of the last project (Requirements 16.7, 16.8). The project text never leaves the browser.
// Write failures (quota, access denied) are caught here only and reported to the caller; the download still works.

/** The one fixed key for the last project (Requirement 16.7). */
export const PROJECT_STORAGE_KEY = "egress.plan-import.last-project";

/** Shown when a write fails (Requirement 16.8). */
export const NOT_STORED_MESSAGE =
  "The project was not stored in the browser. Saving the project as a file (download) still works.";

export type SaveOutcome = { ok: true } | { ok: false; message: string };

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access denied
  }
}

/** Writes the project file text on a change. Never throws. */
export function saveLastProject(text: string, storage: Storage | null = defaultStorage()): SaveOutcome {
  try {
    if (storage === null) return { ok: false, message: NOT_STORED_MESSAGE };
    storage.setItem(PROJECT_STORAGE_KEY, text);
    return { ok: true };
  } catch {
    return { ok: false, message: NOT_STORED_MESSAGE };
  }
}

/** The stored project text to offer for restore on open, or null when there is none or it cannot be read. */
export function readLastProject(storage: Storage | null = defaultStorage()): string | null {
  try {
    return storage === null ? null : storage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Removes the stored project (for example after the user declines the restore). Never throws. */
export function clearLastProject(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(PROJECT_STORAGE_KEY);
  } catch {
    // nothing to do: the stored copy is only a convenience
  }
}
