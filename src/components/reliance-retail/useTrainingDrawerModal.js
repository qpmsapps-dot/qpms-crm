import { useEffect, useRef, useState } from 'react';

// Local to the Training viewer: preserve all prior inert flags and body styles.
export function useTrainingDrawerModal() {
  const ref = useRef(null);
  const [modal, setModal] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const changed = () => setModal(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const drawer = ref.current;
    if (!modal || !drawer) return;
    const previous = new Map();
    for (let node = drawer; node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node) { previous.set(sibling, sibling.inert); sibling.inert = true; }
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => [...drawer.querySelectorAll('button:not(:disabled),a[href],select,input,summary,[tabindex="0"]')].filter(e => e.getClientRects().length && !e.closest('[inert]'));
    const nested = () => drawer.querySelector('[role="dialog"]');
    const contain = e => { if (!nested() && !drawer.contains(e.target)) (controls()[0] || drawer).focus({ preventScroll: true }); };
    const tab = e => {
      if (e.key !== 'Tab' || nested()) return;
      const list = controls(), first = list[0], last = list.at(-1);
      if (!first) { e.preventDefault(); drawer.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('focusin', contain); document.addEventListener('keydown', tab, true);
    if (!drawer.contains(document.activeElement)) (controls()[0] || drawer).focus({ preventScroll: true });
    return () => {
      document.removeEventListener('focusin', contain); document.removeEventListener('keydown', tab, true);
      for (const [element, inert] of previous) element.inert = inert;
      document.body.style.overflow = overflow;
    };
  }, [modal]);
  return { ref, modal };
}
