// Utilitários de data, número e erros usados no backend.

export const pad = (n) => String(n).padStart(2, '0');
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const d10 = (v) => (v ? String(v).slice(0, 10) : '');

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília. */
export function hoje(tz = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export const addDias = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const difDias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const maxD = (...a) => a.filter(Boolean).sort().pop() || '';
export const minD = (...a) => a.filter(Boolean).sort()[0] || '';
export const compDe = (data) => d10(data).slice(0, 7).replace('-', '');
export const compFmt = (c) => (c ? `${c.slice(4, 6)}/${c.slice(0, 4)}` : '');
export const fmtD = (v) => (v ? d10(v).split('-').reverse().join('/') : '');

export function compRange(comp) {
  if (!/^\d{6}$/.test(comp)) throw new HttpError(400, 'Competência inválida (use AAAAMM).');
  const y = Number(comp.slice(0, 4));
  const m = Number(comp.slice(4, 6));
  const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const p = `${comp.slice(0, 4)}-${comp.slice(4, 6)}`;
  return { ini: `${p}-01`, fim: `${p}-${pad(dias)}`, dias, mes: m };
}

/** Quantidade de dias de [a1,b1] que caem dentro de [a2,b2] (datas inclusivas). */
export function sobreposicao(a1, b1, a2, b2) {
  const ini = maxD(a1, a2);
  const fim = minD(b1, b2);
  return ini && fim && ini <= fim ? difDias(ini, fim) + 1 : 0;
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.statusCode = status;
    this.details = details;
  }
}
export const notFound = (what) => new HttpError(404, `${what} não encontrado.`);
export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const conflict = (msg) => new HttpError(409, msg);
export const forbidden = (msg = 'Sem permissão para esta ação.') => new HttpError(403, msg);

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
