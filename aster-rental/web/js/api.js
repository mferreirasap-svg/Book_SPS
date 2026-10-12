// Cliente da API do Áster Rental. A tela nunca fala com o SAP B1; só com o backend.
// Sem servidor disponível (ex.: link online), usa o backend de demonstração que roda no navegador.
let onUnauthorized = () => {};
export const setUnauthorized = (fn) => {
  onUnauthorized = fn;
};

let modo = null; // 'servidor' | 'demo'
let demo = null;

async function detectar() {
  if (modo) return modo;
  try {
    const r = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    const j = await r.json();
    if (r.ok && j?.ok) modo = 'servidor';
  } catch {
    /* sem servidor */
  }
  if (!modo) {
    const { createDemoBackend } = await import('./demo/backend.js');
    demo = await createDemoBackend();
    modo = 'demo';
  }
  return modo;
}

export const isDemo = () => modo === 'demo';

export async function api(method, path, body, headers = {}) {
  await detectar();
  let status;
  let j = null;
  if (modo === 'demo') {
    ({ status, body: j } = await demo(method, path, body, headers));
  } else {
    const r = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'aster-rental', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = r.status;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
  }
  if (status === 401 && path !== '/auth/login') onUnauthorized();
  if (status >= 400) {
    const e = new Error(j?.error || `Erro ${status}`);
    e.status = status;
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
