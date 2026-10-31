import './retailReport.css';

export function ReportHeader({ title, description, children }) {
  return <header className="retail-report-header"><div><p className="retail-report-eyebrow">Reliance Retail / Operations</p><h1>{title}</h1><p>{description}</p></div><div className="retail-report-actions">{children}</div></header>;
}
export function ReportFilters({ children }) {
  return <div className="retail-report-filters" role="group" aria-label="Report filters">{children}</div>;
}
export function ReportStats({ items }) {
  return <div className="retail-report-stats">{items.map(({label,value,note})=><article key={label}><span>{label}</span><strong>{value == null ? 'N/A' : value}</strong>{note&&<small>{note}</small>}</article>)}</div>;
}
export function ReportNotice({ children, error = false }) {
  return <p className={`retail-report-notice${error?' retail-report-error':''}`} role={error?'alert':'status'}>{children}</p>;
}
export function ReportPager({ count, page, size, onPage, onSize, label }) {
  const pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages-1);
  return <nav className="retail-report-pager" aria-label={`${label} pagination`}><span>{count ? `${current*size+1}–${Math.min((current+1)*size,count)} of ${count}` : '0 records'}</span><label>Rows per page<select aria-label={`${label} rows per page`} value={size} onChange={e=>{onSize(Number(e.target.value));onPage(0);}}>{[25,50,100].map(value=><option key={value}>{value}</option>)}</select></label><div><button disabled={!current} onClick={()=>onPage(current-1)} aria-label={`${label} previous page`}>Previous</button><span>Page {current+1} of {pages}</span><button disabled={current+1>=pages} onClick={()=>onPage(current+1)} aria-label={`${label} next page`}>Next</button></div></nav>;
}
