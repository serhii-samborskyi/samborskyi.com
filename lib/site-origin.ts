function parseOrigin(value: string, coolify = false) {
  let url: URL;
  try {
    url = new URL(coolify && !/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? `https://${value}` : value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
  } catch {
    throw new Error('The configured site URL must be an HTTP(S) origin without credentials.');
  }
  // Coolify domain ports select the container port; browsers use the proxy's 80/443.
  // An explicit APP_URL retains its port for deployments that expose a public port.
  if (coolify) url.port = '';
  return url.origin;
}

/** Trusted deployment configuration only: never trust request/proxy Host headers. */
export function siteOrigins() {
  const explicit = process.env.APP_URL?.trim();
  const coolify = (process.env.COOLIFY_URL?.trim() || process.env.COOLIFY_FQDN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseOrigin(value, true));
  const configured = [...(explicit ? [parseOrigin(explicit)] : []), ...coolify];
  if (configured.length) return [...new Set(configured)];
  if (process.env.NODE_ENV === 'production')
    throw new Error('Assign a domain in Coolify, or set APP_URL to the public HTTPS URL.');
  return [parseOrigin(`http://localhost:${process.env.PORT || '3000'}`)];
}

/** The first origin is canonical for notification links and social metadata. */
export function siteOrigin() {
  return siteOrigins()[0];
}
