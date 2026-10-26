import { loadKmEvidence } from './foKmEvidenceService.js';
import { recalculateAttendanceTravelLegs } from '../foKmRecalculationService.js';

// Shared across viewers, bounded in size and concurrency. Errors expire quickly.
const cache = new Map();
let active = 0;
const waiting = [];
async function bounded(work) {
  if (active >= 3) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await work(); } finally {
    if (waiting.length) waiting.shift()();
    else active--;
  }
}
const methods = new Set(['select','eq','neq','gt','gte','lt','lte','in','is','or','order','limit','range','single','maybeSingle']);
export function readOnlyKmClient(client) {
  const wrap = value => new Proxy(value, {get(target,key) {
    if (['then','catch','finally'].includes(key)) return target[key]?.bind(target);
    if (typeof target[key] !== 'function') return target[key];
    if (!methods.has(key)) throw new Error('Current-day KM cannot mutate evidence.');
    return (...args) => wrap(target[key](...args));
  }});
  return {from: table => wrap(client.from(table)), rpc() {throw new Error('Current-day KM cannot invoke RPCs.');}};
}
const round = n => Math.round(n * 100) / 100;
export function summarizeCalculatedEvidence(calculation) {
  const legs = calculation.travel_legs || [];
  const supported = legs.filter(l => l.status === 'calculated' && l.payable === true && Number(l.payable_km) > 0);
  const km = round(supported.reduce((sum,l) => sum + Number(l.payable_km),0));
  const unresolved = legs.filter(l => l.source === 'UNRESOLVED' || l.status !== 'calculated');
  return {calculated_km:km > 0 ? km : null, status:km > 0 ? (unresolved.length ? 'partial' : 'calculated') : (legs.length ? 'unresolved' : 'pending'), unresolved_windows:unresolved.length};
}
export async function calculateCurrentDayEvidenceKm(client, attendances, today, {load=loadKmEvidence, calculate=recalculateAttendanceTravelLegs, now=Date.now, useCache=true}={}) {
  if (attendances.some(a => a.attendance_date !== today)) throw new Error('Current-day calculation cannot change historical reports.');
  const results = [];
  for (const attendance of attendances) {
    const key = `${attendance.id}:${attendance.updated_at}:${today}`;
    let entry = useCache && cache.get(key);
    if (!entry || entry.expires <= now()) {
      const promise = bounded(async () => {
        const db = readOnlyKmClient(client);
        const evidence = await load(db, attendance.id);
        const calculation = await calculate(db, attendance.id, {
          evidenceSnapshot:evidence, evidenceRows:evidence.rows, evidenceOnly:true,
          sharedRecovery:true, auditDelayedCheckout:false, maxGoogleDirectionsCalls:0,
          enableGoogleDirections:false, deadlineAt:now()+15000,
        });
        return {...summarizeCalculatedEvidence(calculation), attendance_id:attendance.id, active:!evidence.attendance.logout_time, calculated_at:new Date(now()).toISOString()};
      });
      entry = {promise, expires:now()+120000};
      if (useCache) {
        if (cache.size >= 500) cache.delete(cache.keys().next().value);
        cache.set(key,entry);
        promise.catch(() => cache.delete(key));
      }
    }
    try { results.push(await entry.promise); }
    catch { results.push({attendance_id:attendance.id, calculated_km:null,status:'unresolved'}); }
  }
  const supported = results.filter(r => r.calculated_km !== null);
  return {
    calculated_km:supported.length ? round(supported.reduce((n,r) => n+r.calculated_km,0)) : null,
    status:supported.length ? (results.some(r => r.status !== 'calculated') ? 'partial' : 'calculated') : (results.some(r => r.status === 'unresolved') ? 'unresolved' : 'pending'),
    saved_payable_km:attendances.every(a => a.total_approved_km != null && Number.isFinite(Number(a.total_approved_km))) ? round(attendances.reduce((n,a) => n+Number(a.total_approved_km),0)) : null,
    saved_petrol_amount:attendances.every(a => a.petrol_amount != null && Number.isFinite(Number(a.petrol_amount))) ? round(attendances.reduce((n,a) => n+Number(a.petrol_amount),0)) : null,
    financial_posted:false, results,
  };
}
