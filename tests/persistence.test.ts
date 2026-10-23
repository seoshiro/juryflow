import { describe, expect, it } from 'vitest';
import { demoDocument } from '../src/demo';
import { serializeDocument, restoreDraft } from '../src/io';
import { DOCUMENT_KEY, RECOVERY_KEY, loadDocument, persistDocument } from '../src/persistence';
import type { StorageAccess } from '../src/persistence';

class MemoryStorage implements StorageAccess {
  values = new Map<string, string>();
  writes: string[] = [];
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.writes.push(key); this.values.set(key, value); }
}

describe('recovery preserves original data before any replacement decision', () => {
  it('does not overwrite the primary when recovery backup fails at quota', () => {
    const raw = serializeDocument(demoDocument()).slice(0, -1);
    const storage = new MemoryStorage();
    storage.values.set(DOCUMENT_KEY, raw);
    storage.setItem = (key, value) => {
      if (key === RECOVERY_KEY) throw new DOMException('Quota full', 'QuotaExceededError');
      storage.writes.push(key); storage.values.set(key, value);
    };
    const loaded = loadDocument(storage);
    expect(loaded.recovery?.raw).toBe(raw);
    expect(loaded.recovery?.message).toContain('Autosave is paused');
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
    expect(persistDocument(storage, loaded.document, loaded.recovery).status).toBe('blocked');
    loaded.document.project.name = 'A local edit is not permission to discard the original';
    expect(persistDocument(storage, loaded.document, loaded.recovery).status).toBe('blocked');
    expect(storage.getItem(DOCUMENT_KEY)).toBe(raw);
    expect(storage.writes).toEqual([]);
  });
  it('keeps the primary protected even when a separate recovery copy succeeds', () => {
    const storage = new MemoryStorage(); storage.values.set(DOCUMENT_KEY, '{broken');
    const loaded = loadDocument(storage);
    expect(storage.getItem(RECOVERY_KEY)).toBe('{broken');
    expect(persistDocument(storage, loaded.document, loaded.recovery).status).toBe('blocked');
    expect(storage.getItem(DOCUMENT_KEY)).toBe('{broken');
    expect(storage.writes).toEqual([RECOVERY_KEY]);
  });
  it('does not destroy an older, different recovery copy', () => {
    const storage = new MemoryStorage(); storage.values.set(DOCUMENT_KEY, '{new-broken'); storage.values.set(RECOVERY_KEY, '{older-broken');
    const loaded = loadDocument(storage);
    expect(loaded.recovery?.raw).toBe('{new-broken');
    expect(storage.getItem(RECOVERY_KEY)).toBe('{older-broken');
    expect(storage.getItem(DOCUMENT_KEY)).toBe('{new-broken');
    expect(storage.writes).toEqual([]);
  });
  it('blocks autosave if the primary cannot be read, with no invented recovery download', () => {
    let writes = 0;
    const storage: StorageAccess = { getItem() { throw new DOMException('Denied', 'SecurityError'); }, setItem() { writes++; } };
    const loaded = loadDocument(storage);
    expect(loaded.recovery?.raw).toBeNull();
    expect(loaded.recovery?.message).toContain('could not be read');
    expect(persistDocument(storage, loaded.document, loaded.recovery).status).toBe('blocked');
    expect(writes).toBe(0);
    expect(loadDocument(null).recovery?.raw).toBeNull();
  });
  it('treats an empty primary as corrupt rather than a new workspace', () => {
    const storage = new MemoryStorage(); storage.values.set(DOCUMENT_KEY, '');
    const loaded = loadDocument(storage);
    expect(loaded.recovery?.raw).toBe('');
    expect(persistDocument(storage, loaded.document, loaded.recovery).status).toBe('blocked');
    expect(storage.getItem(DOCUMENT_KEY)).toBe('');
  });
  it('allows a validated explicit replacement once the barrier is deliberately released', () => {
    const storage = new MemoryStorage(); storage.values.set(DOCUMENT_KEY, '{broken');
    const loaded = loadDocument(storage); const replacement = demoDocument(); replacement.project.name = 'Explicit replacement';
    expect(persistDocument(storage, replacement, loaded.recovery).status).toBe('blocked');
    expect(persistDocument(storage, replacement, null).status).toBe('saved');
    const restored = restoreDraft(storage.getItem(DOCUMENT_KEY)!);
    expect(restored.ok && restored.value.project.name).toBe('Explicit replacement');
  });
  it('keeps a valid previous primary when an ordinary save fails at quota', () => {
    const storage = new MemoryStorage(); const old = serializeDocument(demoDocument()); storage.values.set(DOCUMENT_KEY, old);
    storage.setItem = () => { throw new DOMException('Quota full', 'QuotaExceededError'); };
    const replacement = demoDocument(); replacement.project.name = 'Still open and exportable';
    expect(persistDocument(storage, replacement, null).status).toBe('error');
    expect(storage.getItem(DOCUMENT_KEY)).toBe(old);
    expect(restoreDraft(serializeDocument(replacement)).ok).toBe(true);
  });
  it('loads absent and valid saved documents without recovery', () => {
    const storage = new MemoryStorage(); expect(loadDocument(storage).recovery).toBeNull();
    const doc = demoDocument(); doc.project.name = 'Preserved'; storage.values.set(DOCUMENT_KEY, serializeDocument(doc));
    const loaded = loadDocument(storage); expect(loaded.recovery).toBeNull(); expect(loaded.document).toEqual(doc);
    expect(storage.writes).toEqual([]);
  });
});
