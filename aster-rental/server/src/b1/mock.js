// Service Layer simulada em memória: mesmos recursos, filtros OData, paginação e $batch transacional.
// Usada em desenvolvimento, demonstração e testes automatizados. Nunca em produção.
import { B1Error } from './errors.js';

const DOC_SETS = new Set(['SPSLCTR', 'SPSLMOV', 'Drafts', 'Orders', 'Invoices', 'Quotations']);
const KEYS = { UserTablesMD: 'TableName', UserObjectsMD: 'Code', BusinessPartners: 'CardCode', Items: 'ItemCode', BusinessPlaces: 'BPLID' };

const clone = (o) => structuredClone(o);
// Corpo de requisição passa por JSON, como na Service Layer real (campos undefined somem).
const viaJson = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const fail = (status, message, code) => {
  throw new B1Error({ status, code, message });
};

/* ---------------- filtro OData ($filter) ---------------- */
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= s.length) throw new Error('Texto sem fechamento no filtro.');
        if (s[i] === "'" && s[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (s[i] === "'") {
          i++;
          break;
        } else v += s[i++];
      }
      out.push({ t: 'str', v });
    } else if ('(),'.includes(c)) {
      out.push({ t: c });
      i++;
    } else {
      const m = /^-?\d+(\.\d+)?/.exec(s.slice(i));
      if (m) {
        out.push({ t: 'num', v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
      const w = /^[A-Za-z_][A-Za-z0-9_/]*/.exec(s.slice(i));
      if (!w) throw new Error(`Caractere inesperado no filtro: ${c}`);
      out.push({ t: 'id', v: w[0] });
      i += w[0].length;
    }
  }
  return out;
}

function parseFilter(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const take = (t) => {
    const x = tk[p++];
    if (!x || (t && x.t !== t)) throw new Error(`Filtro inválido perto de ${JSON.stringify(x)}`);
    return x;
  };
  const literal = () => {
    const x = take();
    if (x.t === 'str' || x.t === 'num') return x.v;
    if (x.t === 'id' && x.v === 'null') return null;
    if (x.t === 'id' && (x.v === 'true' || x.v === 'false')) return x.v === 'true';
    throw new Error('Valor inválido no filtro.');
  };
  const factor = () => {
    const x = peek();
    if (x?.t === 'id' && x.v === 'not') {
      p++;
      const f = factor();
      return (r) => !f(r);
    }
    if (x?.t === '(') {
      p++;
      const e = expr();
      take(')');
      return e;
    }
    const id = take('id').v;
    if (peek()?.t === '(') {
      take('(');
      const f = take('id').v;
      take(',');
      const v = String(literal()).toLowerCase();
      take(')');
      const get = (r) => String(r[f] ?? '').toLowerCase();
      if (id === 'contains') return (r) => get(r).includes(v);
      if (id === 'startswith') return (r) => get(r).startsWith(v);
      throw new Error(`Função não suportada: ${id}`);
    }
    const op = take('id').v;
    const v = literal();
    const val = (r) => (r[id] === undefined ? null : r[id]);
    const ops = {
      eq: (r) => val(r) === v || (val(r) != null && v != null && String(val(r)).slice(0, 10) === String(v) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))),
      ne: (r) => val(r) !== v,
      gt: (r) => val(r) != null && val(r) > v,
      ge: (r) => val(r) != null && val(r) >= v,
      lt: (r) => val(r) != null && val(r) < v,
      le: (r) => val(r) != null && val(r) <= v,
    };
    if (!ops[op]) throw new Error(`Operador não suportado: ${op}`);
    return ops[op];
  };
  const term = () => {
    let f = factor();
    while (peek()?.t === 'id' && peek().v === 'and') {
      p++;
      const a = f;
      const b = factor();
      f = (r) => a(r) && b(r);
    }
    return f;
  };
  const expr = () => {
    let f = term();
    while (peek()?.t === 'id' && peek().v === 'or') {
      p++;
      const a = f;
      const b = term();
      f = (r) => a(r) || b(r);
    }
    return f;
  };
  const e = expr();
  if (p !== tk.length) throw new Error('Filtro com conteúdo sobrando.');
  return e;
}

/* ---------------- Service Layer simulada ---------------- */
export class MockServiceLayer {
  /** storage: { load(): db | null, save(db) } — arquivo no servidor, localStorage no navegador. */
  constructor({ seed, storage } = {}) {
    this.storage = storage;
    this.seedFn = seed;
    let saved = null;
    try {
      saved = storage?.load() || null;
    } catch {
      saved = null;
    }
    this.db = saved || (seed ? seed() : { sets: {}, seq: {} });
  }

  persist() {
    try {
      this.storage?.save(this.db);
    } catch {
      /* armazenamento cheio ou bloqueado: segue em memória */
    }
  }

  reset() {
    this.db = this.seedFn ? this.seedFn() : { sets: {}, seq: {} };
    this.persist();
  }

  keyOf(set) {
    return KEYS[set] || (DOC_SETS.has(set) ? 'DocEntry' : 'Code');
  }

  apply(db, method, path, body, headers = {}) {
    const [p, q = ''] = String(path).replace(/^\/+/, '').split('?');
    const m = /^([A-Za-z_0-9]+)(?:\((.*)\))?$/.exec(p);
    if (!m) fail(404, `Recurso não encontrado: ${p}`);
    const set = m[1];
    if (set === 'Login') return { SessionId: 'mock' };
    if (set === 'Logout') return null;
    const coll = (db.sets[set] ||= []);
    const kf = this.keyOf(set);
    const rawKey = m[2];
    const key = rawKey == null ? null : /^'.*'$/.test(rawKey) ? rawKey.slice(1, -1).replace(/''/g, "'") : Number(rawKey);
    const idx = key == null ? -1 : coll.findIndex((r) => r[kf] == key);

    if (method === 'GET') {
      if (key != null) {
        if (idx < 0) fail(404, 'No matching records found (ODBC -2028)', -2028);
        return clone(coll[idx]);
      }
      const params = Object.fromEntries(
        q.split('&').filter(Boolean).map((x) => {
          const i = x.indexOf('=');
          return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
        }),
      );
      let rows = coll;
      if (params.$filter) {
        let f;
        try {
          f = parseFilter(params.$filter);
        } catch (e) {
          fail(400, `Filtro inválido: ${e.message}`);
        }
        rows = rows.filter(f);
      }
      if (params.$orderby) {
        const [f, dir] = params.$orderby.split(/\s+/);
        const s = dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => (a[f] > b[f] ? s : a[f] < b[f] ? -s : 0));
      }
      const skip = Number(params.$skip || 0);
      const top = params.$top != null ? Number(params.$top) : Infinity;
      const pageSize = Number(/odata\.maxpagesize=(\d+)/.exec(headers.Prefer || '')?.[1] || 20);
      const wanted = rows.slice(skip, skip + (Number.isFinite(top) ? top : rows.length));
      const value = wanted.slice(0, pageSize);
      const out = { value: clone(value) };
      if (wanted.length > pageSize) {
        const rest = Object.entries(params).filter(([k]) => k !== '$skip' && k !== '$top');
        rest.push(['$skip', String(skip + pageSize)]);
        if (Number.isFinite(top)) rest.push(['$top', String(top - pageSize)]);
        out['odata.nextLink'] = `${set}?${rest.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
      }
      return out;
    }

    if (method === 'POST') {
      const rec = viaJson(body || {});
      if (DOC_SETS.has(set)) {
        db.seq[set] = (db.seq[set] || 0) + 1;
        rec.DocEntry = db.seq[set];
        rec.DocNum = db.seq[set];
        for (const k of Object.keys(rec)) {
          if (Array.isArray(rec[k])) rec[k].forEach((l, i) => (k === 'DocumentLines' ? (l.LineNum = i) : (l.LineId = i + 1)));
        }
      } else {
        if (rec[kf] == null || rec[kf] === '') fail(400, `Chave obrigatória: ${kf}`);
        if (coll.some((r) => r[kf] == rec[kf])) fail(400, 'This entry already exists in the following tables (ODBC -2035)', -2035);
      }
      coll.push(rec);
      return clone(rec);
    }

    if (method === 'PATCH') {
      if (idx < 0) fail(404, 'No matching records found (ODBC -2028)', -2028);
      const cur = coll[idx];
      const replace = String(headers['B1S-ReplaceCollectionsOnPatch']) === 'true';
      for (const [k, v] of Object.entries(viaJson(body || {}))) {
        if (Array.isArray(v)) {
          const old = cur[k] || [];
          let maxId = old.reduce((a, l) => Math.max(a, l.LineId || 0), 0);
          const novo = replace ? [] : old;
          for (const l of v) {
            const o = l.LineId != null ? old.find((x) => x.LineId === l.LineId) : null;
            if (o) {
              Object.assign(o, l);
              if (replace) novo.push(o);
            } else {
              l.LineId = ++maxId;
              novo.push(l);
            }
          }
          cur[k] = novo;
        } else cur[k] = v;
      }
      return null;
    }

    if (method === 'DELETE') {
      if (idx < 0) fail(404, 'No matching records found (ODBC -2028)', -2028);
      coll.splice(idx, 1);
      return null;
    }
    fail(405, 'Método não suportado');
  }

  async request(method, path, body, headers = {}) {
    const r = this.apply(this.db, method, path, body, headers);
    if (method !== 'GET') this.persist();
    return r;
  }

  get(path, headers) {
    return this.request('GET', path, undefined, headers);
  }

  async page(path, pageSize = 50) {
    const j = await this.get(path, { Prefer: `odata.maxpagesize=${pageSize}` });
    return { value: j?.value || [], nextLink: j?.['odata.nextLink'] || null };
  }

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

  /** Transação: aplica numa cópia e só troca o estado se todas as operações derem certo. */
  async batch(ops) {
    const work = clone(this.db);
    const results = [];
    ops.forEach((op, i) => {
      try {
        results.push({ status: op.method === 'POST' ? 201 : 204, body: this.apply(work, op.method, op.path, op.body, op.headers || {}) });
      } catch (e) {
        e.op = i;
        throw e;
      }
    });
    this.db = work;
    this.persist();
    return results;
  }
}
