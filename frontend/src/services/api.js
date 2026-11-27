export function uuid() {
  return crypto.randomUUID();
}

export async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Correlation-Id': uuid(),
      ...(!['GET', 'HEAD'].includes(method) ? { 'Idempotency-Key': uuid() } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `La solicitud falló (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
