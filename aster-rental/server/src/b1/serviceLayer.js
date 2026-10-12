// Cliente da SAP Business One Service Layer.
// - Pool de sessões (B1SESSION + ROUTEID), renovadas automaticamente ao expirar (INT-07).
// - $batch com changeset: várias gravações numa transação, tudo ou nada (INT-01).
// - Nova tentativa com espera crescente só para leituras (INT-06).
import { readFileSync } from 'node:fs';
import { Agent, fetch } from 'undici';
import { B1Error, parseSlError } from './errors.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ServiceLayerClient {
  constructor(cfg, log = console) {
    this.cfg = cfg;
    this.log = log;
    const u = new URL(cfg.url.replace(/\/+$/, '') + '/');
    this.base = u.href; // .../b1s/v1/
    this.basePath = u.pathname.replace(/\/$/, ''); // /b1s/v1
    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: cfg.rejectUnauthorized, ca: cfg.caFile ? readFileSync(cfg.caFile) : undefined },
      headersTimeout: cfg.timeoutMs,
      bodyTimeout: cfg.timeoutMs,
    });
    this.pool = Array.from({ length: Math.max(1, cfg.poolSize) }, () => ({ cookie: null, busy: false, loggingIn: null }));
    this.waiters = [];
  }

  async acquire() {
    const free = this.pool.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(s) {
    const next = this.waiters.shift();
    if (next) next(s);
    else s.busy = false;
  }

  async login(s) {
    if (s.loggingIn) return s.loggingIn;
    s.loggingIn = (async () => {
      const r = await fetch(this.base + 'Login', {
        method: 'POST',
        dispatcher: this.dispatcher,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ CompanyDB: this.cfg.company, UserName: this.cfg.user, Password: this.cfg.password }),
      });
      const text = await r.text();
      if (!r.ok) throw parseSlError(r.status, text);
      const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]);
      s.cookie = cookies.filter((c) => /^(B1SESSION|ROUTEID)=/.test(c)).join('; ');
      this.log.info?.({ msg: 'Sessão B1 aberta' });
    })();
    try {
      await s.loggingIn;
    } finally {
      s.loggingIn = null;
    }
  }

  async raw(s, method, path, body, headers = {}) {
    if (!s.cookie) await this.login(s);
    const url = /^https?:/i.test(path) ? path : this.base + String(path).replace(/^\/+/, '');
    const init = {
      method,
      dispatcher: this.dispatcher,
      headers: { Cookie: s.cookie, ...headers },
    };
    if (body !== undefined) {
      if (typeof body === 'string') init.body = body;
      else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    return fetch(url, init);
  }

  /** Requisição simples com sessão do pool. Retorna JSON (ou null em 204). */
  async request(method, path, body, headers = {}) {
    const s = await this.acquire();
    try {
      let attempt = 0;
      for (;;) {
        let r;
        try {
          r = await this.raw(s, method, path, body, headers);
        } catch (e) {
          // Falha de rede: só repete leituras, que não têm efeito colateral.
          if (method === 'GET' && attempt < 3) {
            await sleep(500 * 2 ** attempt++);
            continue;
          }
          throw new B1Error({ status: 503, code: 'NET', message: e.message });
        }
        if (r.status === 401 && attempt === 0) {
          s.cookie = null;
          attempt++;
          continue;
        }
        if (r.status === 204) return null;
        const text = await r.text();
        if (!r.ok) throw parseSlError(r.status, text);
        return text ? JSON.parse(text) : null;
      }
    } finally {
      this.release(s);
    }
  }

  get(path, headers) {
    return this.request('GET', path, undefined, headers);
  }

  /** Página de resultados: { value, nextLink }. */
  async page(path, pageSize = 50) {
    const j = await this.get(path, { Prefer: `odata.maxpagesize=${pageSize}` });
    return { value: j?.value || [], nextLink: j?.['odata.nextLink'] || j?.['@odata.nextLink'] || null };
  }

  /** Todas as páginas, com limite de segurança. */
  async getAll(path, { max = 20000, pageSize = 200 } = {}) {
    let out = [];
    let next = path;
    while (next && out.length < max) {
      const p = await this.page(next, pageSize);
      out = out.concat(p.value);
      next = p.nextLink;
    }
    return out;
  }

  /**
   * Executa operações numa única transação ($batch com changeset).
   * ops: [{ method, path, body, headers }]. Se qualquer uma falhar, o B1 desfaz todas.
   */
  async batch(ops) {
    const b = `batch_${Math.random().toString(36).slice(2)}`;
    const c = `changeset_${Math.random().toString(36).slice(2)}`;
    const parts = ops.map((op, i) => {
      const lines = [
        `--${c}`,
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        `Content-ID: ${i + 1}`,
        '',
        `${op.method} ${this.basePath}/${op.path.replace(/^\/+/, '')}`,
      ];
      for (const [k, v] of Object.entries(op.headers || {})) lines.push(`${k}: ${v}`);
      if (op.body !== undefined) lines.push('Content-Type: application/json', '', JSON.stringify(op.body));
      else lines.push('');
      return lines.join('\r\n');
    });
    const payload = [`--${b}`, `Content-Type: multipart/mixed;boundary=${c}`, '', ...parts, `--${c}--`, `--${b}--`, ''].join('\r\n');

    const s = await this.acquire();
    try {
      let r = await this.raw(s, 'POST', '$batch', payload, { 'Content-Type': `multipart/mixed;boundary=${b}` });
      if (r.status === 401) {
        s.cookie = null;
        r = await this.raw(s, 'POST', '$batch', payload, { 'Content-Type': `multipart/mixed;boundary=${b}` });
      }
      const text = await r.text();
      if (!r.ok) throw parseSlError(r.status, text);
      return parseBatchResponse(text);
    } finally {
      this.release(s);
    }
  }
}

/** Lê a resposta multipart do $batch; lança B1Error se alguma operação falhou. */
export function parseBatchResponse(text) {
  const results = [];
  const re = /HTTP\/1\.1 (\d{3})[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n--(?:changeset|batch)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const status = Number(m[1]);
    const bodyStart = m[2].search(/\r?\n\r?\n/);
    const body = bodyStart >= 0 ? m[2].slice(bodyStart).trim() : '';
    if (status >= 400) throw parseSlError(status, body);
    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    results.push({ status, body: json });
  }
  return results;
}
