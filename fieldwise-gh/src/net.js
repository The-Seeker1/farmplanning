export const ALLOWED_HOSTS = new Set([
  'nominatim.openstreetmap.org',
  'sdmdataaccess.sc.egov.usda.gov',
  'rest.isric.org',
  'generativelanguage.googleapis.com',
  'imagery.nationalmap.gov',
]);

export class NetError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'NetError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export function hostAllowed(hostname, extra = []) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  return extra.includes(hostname);
}

export async function fetchJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15000,
    maxBytes = 2_000_000,
    referrerPolicy = 'no-referrer',
    extraHosts = [],
    fetchImpl = globalThis.fetch,
  } = options;
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new NetError('blocked', 'That is not a valid web address.');
  }
  if (u.protocol !== 'https:') throw new NetError('blocked', 'Only secure (https) connections are allowed.');
  if (!hostAllowed(u.hostname, extraHosts)) throw new NetError('blocked', `Connections to ${u.hostname} are not allowed.`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(u.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy,
      redirect: 'follow',
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new NetError('timeout', 'The request took too long and was stopped.');
    throw new NetError('network', 'Could not reach the service (offline, blocked, or the service does not allow browser requests).', { cause: e });
  } finally {
    clearTimeout(timer);
  }

  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new NetError('toolarge', 'The response was too large.');
  let text;
  try {
    text = await response.text();
  } catch (e) {
    throw new NetError('network', 'The connection dropped while reading the response.', { cause: e });
  }
  if (text.length > maxBytes) throw new NetError('toolarge', 'The response was too large.');

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (response.ok) throw new NetError('parse', 'The service sent something that was not valid JSON.');
    }
  }
  if (!response.ok) {
    const status = response.status;
    const detail = json?.error?.message || json?.message || '';
    if (status === 429) throw new NetError('quota', 'Rate limit reached. Wait a minute and try again.', { status, detail, retryAfter: Number(response.headers?.get?.('retry-after')) || null });
    if (status === 401 || status === 403) throw new NetError('auth', 'The service refused the request (check your key and permissions).', { status, detail });
    throw new NetError('http', `The service returned an error (${status}).`, { status, detail });
  }
  return json;
}
