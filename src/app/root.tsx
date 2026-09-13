import { createRoot } from 'react-dom/client';
import { App } from './app';
import type { Workspace } from './store';
import { sessionInvalidated } from '../prototype/session-events';

export function mountWorkspace(container: HTMLElement, workspace: Workspace): () => void {
  // The bundle may finish downloading after the session gate has already closed.
  if (container.dataset.sessionBlocked === 'true') return () => {};
  const root = createRoot(container);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener(sessionInvalidated, dispose);
    // Unmount also clears portal content and aborts feature requests through effect cleanup.
    root.unmount();
  };
  window.addEventListener(sessionInvalidated, dispose);
  root.render(<App workspace={workspace} isAdmin={container.dataset.admin === 'true'} />);
  return dispose;
}
