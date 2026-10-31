export function matchesReportQuery(values, query) {
  const text=String(query||'').trim().toLocaleLowerCase();
  return !text || values.some(value=>String(value??'').toLocaleLowerCase().includes(text));
}
export function reportPage(rows, page, size) {
  const current=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1)));
  return rows.slice(current*size,(current+1)*size);
}
