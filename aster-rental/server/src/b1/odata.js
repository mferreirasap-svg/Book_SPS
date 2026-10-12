// Montagem segura de consultas OData para a Service Layer.
// Filtros nunca recebem texto livre do usuário sem passar por lit(), que escapa aspas (requisito SEG-09).

const FIELD = /^[A-Za-z_][A-Za-z0-9_/]*$/;

function field(f) {
  if (!FIELD.test(f)) throw new Error(`Campo OData inválido: ${f}`);
  return f;
}

export function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Número inválido em filtro OData.');
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const cmp = (op) => (f, v) => `${field(f)} ${op} ${lit(v)}`;
export const eq = cmp('eq');
export const ne = cmp('ne');
export const ge = cmp('ge');
export const le = cmp('le');
export const gt = cmp('gt');
export const lt = cmp('lt');
export const contains = (f, v) => `contains(${field(f)},${lit(v)})`;

const join = (sep) => (...parts) => {
  const p = parts.flat().filter(Boolean);
  if (!p.length) return '';
  return p.length === 1 ? p[0] : p.map((x) => `(${x})`).join(` ${sep} `);
};
export const and = join('and');
export const or = join('or');
export const anyOf = (f, values) => or(values.map((v) => eq(f, v)));

/** Monta "Entidade?$filter=...&$top=..." com cada valor codificado. */
export function query(path, { filter, select, top, skip, orderby } = {}) {
  const params = [];
  if (filter) params.push(['$filter', filter]);
  if (select) params.push(['$select', (Array.isArray(select) ? select : [select]).map(field).join(',')]);
  if (orderby) params.push(['$orderby', orderby]);
  if (top != null) params.push(['$top', String(Number(top))]);
  if (skip) params.push(['$skip', String(Number(skip))]);
  if (!params.length) return path;
  return `${path}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** Chave de entidade: texto entre aspas, número sem aspas. */
export const key = (v) => (typeof v === 'number' ? `(${v})` : `(${lit(v)})`);
