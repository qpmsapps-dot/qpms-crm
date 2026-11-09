import { Component, createElement, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { number } from '../../utils/retailExecutiveReport.js';
import { retailNavigationState } from '../../utils/retailNavigation.js';

export function Reveal({ children, className = '', delay = 0, onVisible }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reveal = () => { element.classList.add('er-visible'); onVisible?.(); };
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { reveal(); return; }
    element.classList.add('er-observed');
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { reveal(); observer.disconnect(); }
    }, { rootMargin: '40px', threshold: 0.04 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);
  return <div ref={ref} className={'er-reveal ' + className} style={{ '--er-delay': delay + 'ms' }}>{children}</div>;
}
export function ReportSection({ number: index, title, subtitle, children, action, className = '' }) {
  return <section className={'er-card ' + className} aria-label={title}>
    <div className="er-section-heading"><div><h2><span className="er-index">{index}</span>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}
  </section>;
}
export function Count({ value, suffix = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !Number.isFinite(value)) return;
    let frame, observer;
    const render = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const start = performance.now();
      const tick = now => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { element.textContent = number(value) + suffix; return; }
        const t = Math.min(1, (now - start) / 650);
        element.textContent = number(value * (1 - (1 - t) ** 3)) + suffix;
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { render(); observer.disconnect(); } });
      observer.observe(element);
    }
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [value, suffix]);
  return <strong aria-label={number(value) + (Number.isFinite(value) ? suffix : '')}><span aria-hidden="true" ref={ref}>{number(value) + (Number.isFinite(value) ? suffix : '')}</span></strong>;
}
export function ModuleLink({ module, allowed, scope, children = 'View report' }) {
  if (!allowed) return <span className="er-muted">Not available for your role</span>;
  return <Link to={module.route} state={retailNavigationState(module, scope)} title="Transfers supported report filters; destination business rules still apply.">{children}<ArrowUpRight size={13} /></Link>;
}
export function Empty({ children }) { return <p className="er-empty">{children}</p>; }
export function MetricFacts({ counts }) {
  return <dl className="er-facts">{Object.entries(counts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{number(value)}</dd></div>)}</dl>;
}
export function SmallIcon({ icon, ...props }) { return createElement(icon, props); }
export class ReportBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert" className="er-empty">This report section could not be displayed. Refresh the report to try again.</p> : this.props.children; }
}
export function Deferred({ children }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { queueMicrotask(() => setVisible(true)); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '300px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{visible ? children : <div className="er-skeleton" role="status">Report section loads as you approach.</div>}</div>;
}
