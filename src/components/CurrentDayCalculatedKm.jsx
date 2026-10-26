import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/auth-context.js';
import { authenticatedFetch } from '../services/api.js';

const base = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const cache = new Map();
const queue = [];
let running = 0;
function drain() {
  while (running < 3 && queue.length) {
    running++;
    const {work,resolve,reject} = queue.shift();
    work().then(resolve,reject).finally(() => {running--; drain();});
  }
}
export const currentIndiaDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function requestKm(key, employee, date) {
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.promise;
  const promise = new Promise((resolve,reject) => {
    queue.push({resolve,reject,work:async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(),25000);
      try {
        const query = new URLSearchParams({calculated_employee_code:employee,date});
        const response = await authenticatedFetch(`${base}/api/fo/operations/summary?${query}`,{signal:controller.signal});
        const result = await response.json();
        if (!response.ok || !result.ok) throw Error('Calculation unavailable');
        return result;
      } finally {clearTimeout(timer);}
    }});
    drain();
  });
  if(cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(key,{promise,expires:Date.now()+120000});
  promise.catch(() => cache.delete(key));
  return promise;
}
export default function CurrentDayCalculatedKm({employeeCode,date}) {
  const {user} = useAuth();
  const element = useRef(null);
  const [visible,setVisible] = useState(() => !globalThis.IntersectionObserver);
  const [response,setResponse] = useState(null);
  const requestKey = `${user?.id || user?.auth_user_id}:${employeeCode}:${date}`;
  const result = response?.key === requestKey ? response.value : null;
  const enabled = date === currentIndiaDate() && Boolean(employeeCode && user);
  useEffect(() => {
    if (!enabled || !element.current) return;
    if (!globalThis.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    observer.observe(element.current);
    return () => observer.disconnect();
  },[enabled,employeeCode,date]);
  useEffect(() => {
    if(!enabled || !visible) return;
    let cancelled=false;
    const load=() => requestKm(requestKey,employeeCode,date)
      .then(value => {if(!cancelled)setResponse({key:requestKey,value});})
      .catch(() => {if(!cancelled)setResponse({key:requestKey,value:{status:'unresolved'}});});
    load();
    const timer=setInterval(load,125000);
    return () => {cancelled=true;clearInterval(timer);};
  },[enabled,visible,requestKey,employeeCode,date]);
  if(!enabled)return null;
  const km=result?.calculated_km;
  return <div ref={element} className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-2 text-[11px] dark:border-slate-700 dark:bg-slate-900">
    <div className="font-bold text-blue-800 dark:text-blue-200">Calculated KM — Not Yet Credited</div>
    <div className="mt-1 font-black" data-testid={`calculated-km-${employeeCode}`}>
      {Number.isFinite(km) ? `${km.toFixed(2)} km${result.status==='partial'?' · Partial evidence':''}` : result?.status==='unresolved'?'Unresolved':'Pending'}
    </div>
    <div className="mt-1 text-slate-600 dark:text-slate-300">Saved Payable KM: {Number.isFinite(result?.saved_payable_km)?`${result.saved_payable_km.toFixed(2)} km`:'Pending'}</div>
    <div className="text-slate-600 dark:text-slate-300">Saved Petrol: {Number.isFinite(result?.saved_petrol_amount)?`₹${result.saved_petrol_amount.toFixed(2)}`:'Pending'}</div>
    <div className="mt-1 text-[10px] text-slate-500">Evidence only · updates every 2 minutes · active travel uses closed windows</div>
  </div>;
}
