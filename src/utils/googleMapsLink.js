const GOOGLE_MAPS_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'google.co.in',
  'www.google.co.in',
  'maps.google.co.in',
]);

export function normalizeGoogleMapsLink(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 2048) return null;

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const sharedLink = host === 'maps.app.goo.gl' || (host === 'goo.gl' && path.startsWith('/maps'));
    const googleMapsLink = GOOGLE_MAPS_HOSTS.has(host)
      && (host.startsWith('maps.') || path === '/maps' || path.startsWith('/maps/'));

    return sharedLink || googleMapsLink ? url.href : null;
  } catch {
    return null;
  }
}

export function isGoogleMapsLink(value) {
  return !String(value || '').trim() || Boolean(normalizeGoogleMapsLink(value));
}
