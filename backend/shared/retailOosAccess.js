const key=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function canOperateOos(profile){
 const roles=[profile?.role,profile?.rawRole,profile?.designation,profile?.department].map(key);
 if(profile?.is_active===false||profile?.isActive===false||['INACTIVE','DISABLED'].includes(key(profile?.status)))return false;
 if(roles.some(r=>['ADMIN','SUPERADMIN','QPMSADMIN'].includes(r)))return true;
 return ['RELIANCE','RELIANCERETAIL'].includes(key(profile?.business))&&roles.some(r=>['OOSMIS','OUTOFSCOPEMIS'].includes(r));
}
