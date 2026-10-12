// Cliente da API do Áster Rental. A tela nunca fala com o SAP B1; só com este backend.
let onUnauthorized = () => {};
export const setUnauthorized = (fn) => {
  onUnauthorized = fn;
};

export async function api(method, path, body, headers = {}) {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'aster-rental', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  if (r.status === 401 && path !== '/auth/login') onUnauthorized();
  if (!r.ok) {
    const e = new Error(j?.error || `Erro ${r.status}`);
    e.status = r.status;
    e.requestId = j?.requestId;
    throw e;
  }
  return j;
}

export const get = (p) => api('GET', p);
export const post = (p, b, h) => api('POST', p, b ?? {}, h);
export const put = (p, b) => api('PUT', p, b ?? {});
export const qs = (o) => {
  const e = Object.entries(o).filter(([, v]) => v !== '' && v != null);
  return e.length ? `?${new URLSearchParams(e).toString()}` : '';
};
