/** Device measurements are dynamic layout data, not component style constants. */
export function initViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const style = document.documentElement.style;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Pinch zoom must magnify the existing layout, not shrink/reflow the dialog.
      if (viewport.scale !== 1) {
        style.removeProperty('--viewport-block');
        style.removeProperty('--viewport-offset');
        return;
      }
      if (!Number.isFinite(viewport.height) || viewport.height <= 0) return;
      style.setProperty('--viewport-block', `${viewport.height}px`);
      style.setProperty('--viewport-offset', `${Math.max(0, viewport.offsetTop)}px`);

      // A keyboard can hide a field even when focus has not changed. Only scroll
      // its dialog body; never move the background page or steal focus.
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const body = active.closest<HTMLElement>('.dialog-body');
      if (!body) return;
      const bounds = body.getBoundingClientRect();
      const field = active.getBoundingClientRect();
      if (bounds.height <= 0 || field.height <= 0) return;
      const gap = parseFloat(getComputedStyle(body).scrollPaddingBlockStart) || 0;
      const top = bounds.top + gap, bottom = bounds.bottom - gap;
      if (field.top < top || field.height > bottom - top) {
        body.scrollBy({ top: field.top - top, behavior: 'instant' });
      } else if (field.bottom > bottom) {
        body.scrollBy({ top: field.bottom - bottom, behavior: 'instant' });
      }
    });
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    style.removeProperty('--viewport-block');
    style.removeProperty('--viewport-offset');
  };
}
