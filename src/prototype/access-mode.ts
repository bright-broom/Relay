/** Presentation mode only. Every private API independently verifies its session. */
export function publicPreview(): boolean {
  return document.getElementById('app')?.dataset.publicPreview === 'true';
}

export function workspaceStorage(): Storage | null {
  try {
    // Guests must never restore an authenticated user's local draft.
    return publicPreview() ? sessionStorage : localStorage;
  } catch { return null; }
}
