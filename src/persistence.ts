import { demoDocument } from './demo';
import { restoreDraft, serializeDocument } from './io';
import type { SavedDocument } from './types';

export const DOCUMENT_KEY = 'juryflow.document.v1';
export const RECOVERY_KEY = 'juryflow.recovery.v1';
export type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
export interface Recovery { raw: string | null; message: string }
export interface LoadedDocument { document: SavedDocument; recovery: Recovery | null }
export type PersistResult = { status: 'saved' | 'blocked' } | { status: 'error'; message: string };

/** The original primary value is never changed during loading, even when backup creation fails. */
export function loadDocument(storage: StorageAccess | null): LoadedDocument {
  let raw: string | null;
  try {
    if (!storage) throw new Error('Storage unavailable');
    raw = storage.getItem(DOCUMENT_KEY);
  } catch {
    return { document: demoDocument(), recovery: { raw: null, message: 'Browser storage could not be read. Autosave is paused to protect the unread saved event. Retry by reloading, or explicitly start a new event.' } };
  }
  if (raw === null) return { document: demoDocument(), recovery: null };
  const parsed = restoreDraft(raw);
  if (parsed.ok) return { document: parsed.value, recovery: null };

  let backup = false;
  try {
    const existing = storage.getItem(RECOVERY_KEY);
    // Do not destroy a different older recovery copy while protecting this primary value.
    if (existing === null) storage.setItem(RECOVERY_KEY, raw);
    backup = existing === raw || existing === null;
  } catch { /* A full quota must not turn failed recovery into permission to overwrite the original. */ }
  return {
    document: demoDocument(),
    recovery: {
      raw,
      message: `Saved event could not be restored: ${parsed.error} Autosave is paused; the original saved data has not been replaced. ${backup ? 'A recovery copy is also retained in browser storage.' : 'A separate backup could not be created; download the original data before replacing it.'}`,
    },
  };
}

/** Recovery is a write barrier, not just an error message that can be dismissed. */
export function persistDocument(storage: StorageAccess | null, document: SavedDocument, recovery: Recovery | null): PersistResult {
  if (recovery) return { status: 'blocked' };
  try {
    const source = serializeDocument(document);
    if (!storage) throw new Error('Storage unavailable');
    storage.setItem(DOCUMENT_KEY, source);
    return { status: 'saved' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error && error.message.includes('UTF-8 limit') ? error.message : 'Could not save in this browser. Your current event remains open; export JSON to keep your work.' };
  }
}
