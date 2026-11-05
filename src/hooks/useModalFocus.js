import { useEffect, useRef } from 'react';

// Keep keyboard focus inside an open overlay and return it to its opener.
export function useModalFocus({ open = true, onClose, canDismiss = true, fallbackFocusRef }) {
  const dialogRef = useRef(null);
  const options = useRef({ onClose, canDismiss, fallbackFocusRef });
  useEffect(() => { options.current = { onClose, canDismiss, fallbackFocusRef }; }, [onClose, canDismiss, fallbackFocusRef]);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    const controls = () => [...dialog.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length && !element.closest('[inert]'));
    const focusFirst = () => (controls()[0] || dialog).focus();
    const containFocus = event => { if (!dialog.contains(event.target)) focusFirst(); };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (options.current.canDismiss) options.current.onClose();
      }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0], last = items[items.length - 1];
      if (!items.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    focusFirst();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', containFocus);
      const target = opener?.isConnected ? opener : options.current.fallbackFocusRef?.current;
      if (target?.isConnected) target.focus();
    };
  }, [open]);
  return dialogRef;
}
