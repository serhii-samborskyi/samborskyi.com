/** Trusted deployment configuration only: never derive links from request/proxy Host headers. */
export function siteOrigin() {
  const explicit = process.env.APP_URL?.trim();
  const coolify = (process.env.COOLIFY_URL || process.env.COOLIFY_FQDN || '')
    .split(',')
    .map((v) => v.trim())
    .find(Boolean);
  const configured =
    explicit || (coolify && (/^https?:\/\//.test(coolify) ? coolify : `https://${coolify}`));
  if (!configured && process.env.NODE_ENV === 'production')
    throw new Error('Assign a domain in Coolify, or set APP_URL to the public HTTPS URL.');
  const url = new URL(configured || `http://localhost:${process.env.PORT || '3000'}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('The configured site URL must be an HTTP(S) origin without credentials.');
  return url.origin;
}
