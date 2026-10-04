// Swallow the gesture that finishes a group edit, even if blur closes the editor
// before pointerup/click. A following deliberate click must work normally.
export function consumeRenameGesture(event, document) {
  const view = document.defaultView;
  let timer;
  const capture = {capture: true};
  const cleanup = () => {
    view.clearTimeout(timer);
    document.removeEventListener('click', click, capture);
    document.removeEventListener('pointerup', release, capture);
    document.removeEventListener('pointercancel', release, capture);
    document.removeEventListener('pointerdown', nextGesture, capture);
  };
  const click = (next) => {
    next.preventDefault();
    next.stopImmediatePropagation();
    cleanup();
  };
  const release = (next) => {
    if (next.pointerId !== event.pointerId) return;
    // Click follows pointerup synchronously. Disabled controls may emit no click.
    timer = view.setTimeout(cleanup, 0);
  };
  const nextGesture = (next) => {
    if (next !== event) cleanup();
  };
  event.preventDefault();
  event.stopPropagation();
  document.addEventListener('click', click, capture);
  document.addEventListener('pointerup', release, capture);
  document.addEventListener('pointercancel', release, capture);
  document.addEventListener('pointerdown', nextGesture, capture);
}
