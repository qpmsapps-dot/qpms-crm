/** Strict, stable MIS attendance bands. Missing rates are not classified. */
export function attendanceTone(value){
 if(value==null||!Number.isFinite(Number(value)))return 'unavailable';
 if(Number(value)>=90)return 'good';
 if(Number(value)>=85)return 'watch';
 return 'critical';
}
export function attendanceTrendMonthLabel(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return 'Selected month';
 return new Date(`${date.slice(0,7)}-01T00:00:00Z`).toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'});
}
