// Cadastros: ativos, famílias, regras de cobrança e consultas ao B1 (clientes e itens).
import { DOM } from '../b1/schema.js';
import { badRequest, conflict, notFound } from '../lib/util.js';

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 0) throw badRequest('Valor numérico inválido.');
  return n;
};

function assetFields(b) {
  const o = {
    Name: str(b.Name, 100), U_Tipo: b.U_Tipo, U_Familia: str(b.U_Familia, 50), U_Categoria: str(b.U_Categoria, 50), U_ItemCode: str(b.U_ItemCode, 50),
    U_Serie: str(b.U_Serie, 50), U_Placa: str(b.U_Placa, 10).toUpperCase(), U_Chassi: str(b.U_Chassi, 30), U_Renavam: str(b.U_Renavam, 20),
    U_Marca: str(b.U_Marca, 50), U_Modelo: str(b.U_Modelo, 50), U_Ano: str(b.U_Ano, 4), U_Medidor: num(b.U_Medidor), U_ValorMes: num(b.U_ValorMes),
    U_ValorDia: num(b.U_ValorDia), U_Filial: Number(b.U_Filial) || 0, U_Obs: str(b.U_Obs, 4000),
  };
  if (!o.Name) throw badRequest('Informe a descrição do ativo.');
  if (!DOM.tipoAtivo[o.U_Tipo]) throw badRequest('Tipo de ativo inválido.');
  if (o.U_Placa && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(o.U_Placa)) throw badRequest('Placa inválida (use AAA0A00 ou AAA0000).');
  return o;
}

function ruleFields(b) {
  const o = { Name: str(b.Name, 100), U_Tipo: b.U_Tipo, U_ProRata: b.U_ProRata || 'LIN', U_FranqProp: b.U_FranqProp === 'N' ? 'N' : 'S',
    U_Toler: Number(b.U_Toler) || 0, U_MesesNF: str(b.U_MesesNF, 40), U_Obs: str(b.U_Obs, 4000) };
  if (!o.Name) throw badRequest('Informe o nome da regra.');
  if (!DOM.tipoRegra[o.U_Tipo]) throw badRequest('Tipo de cobrança inválido.');
  if (!DOM.proRata[o.U_ProRata]) throw badRequest('Forma de pró-rata inválida.');
  if (o.U_Toler < 0 || o.U_Toler > 31) throw badRequest('Tolerância deve ser de 0 a 31 dias.');
  const meses = o.U_MesesNF ? o.U_MesesNF.split(/[,;\s]+/).filter(Boolean).map(Number) : [];
  if (meses.some((m) => !(m >= 1 && m <= 12))) throw badRequest('Meses não faturáveis: use números de 1 a 12 separados por vírgula.');
  o.U_MesesNF = meses.join(',');
  let tabela = b.U_Tabela ?? [];
  if (typeof tabela === 'string') {
    try {
      tabela = JSON.parse(tabela || '[]');
    } catch {
      throw badRequest('Tabela de pró-rata inválida.');
    }
  }
  if (!Array.isArray(tabela) || tabela.some((f) => !(Number(f.ate) >= 1 && Number(f.ate) <= 31) || !(Number(f.valor) >= 0))) {
    throw badRequest('Tabela de pró-rata: cada faixa precisa de "até" (1 a 31 dias) e valor maior ou igual a zero.');
  }
  if (o.U_ProRata !== 'LIN' && o.U_ProRata === 'PCT' && !tabela.length) throw badRequest('A tabela em % precisa de ao menos uma faixa.');
  o.U_Tabela = JSON.stringify(tabela.map((f) => ({ ate: Number(f.ate), valor: Number(f.valor) })).sort((a, z) => a.ate - z.ate));
  return o;
}

const CODE = /^[A-Za-z0-9._-]{1,50}$/;

export default async function cadastroRoutes(app, { deps }) {
  const { repos, audit, contracts } = deps;
  const can = app.can;

  /* ---- ativos ---- */
  app.get('/assets', { preHandler: can('ativos.ver') }, async (req) =>
    repos.assets.list({ ...req.query, branches: req.user.branches }, req.query));

  app.get('/assets/availability', { preHandler: can('ativos.ver', 'contratos.ver') }, async (req) =>
    deps.operations.availability({ ...req.query, branches: req.user.branches }));

  app.get('/assets/:code', { preHandler: can('ativos.ver') }, async (req) => {
    const a = await repos.assets.get(req.params.code);
    if (!a) throw notFound('Ativo');
    return a;
  });

  app.post('/assets', { preHandler: can('ativos.editar') }, async (req) => {
    const code = str(req.body.Code, 50).toUpperCase();
    if (!CODE.test(code)) throw badRequest('Código inválido (letras, números, ponto, hífen).');
    if (await repos.assets.get(code)) throw conflict('Já existe um ativo com este código.');
    const rec = { Code: code, ...assetFields(req.body), U_Status: 'DIS', U_CtrAtual: 0 };
    await repos.assets.create(rec);
    audit.record(req, { action: 'criar', entity: 'ativo', id: code, after: rec });
    return repos.assets.get(code);
  });

  app.put('/assets/:code', { preHandler: can('ativos.editar') }, async (req) => {
    const { before, after } = await repos.assets.update(req.params.code, assetFields(req.body), req.body.U_Versao);
    audit.record(req, { action: 'alterar', entity: 'ativo', id: req.params.code, before, after });
    return after;
  });

  app.post('/assets/:code/status', { preHandler: can('ativos.editar', 'ativos.baixar') }, async (req) => {
    const a = await repos.assets.get(req.params.code);
    if (!a) throw notFound('Ativo');
    const status = req.body.status;
    const ok = { DIS: ['MAN', 'BAI'], MAN: ['DIS', 'BAI'], BAI: ['DIS'] }[a.U_Status] || [];
    if (!ok.includes(status)) throw badRequest(`Não é possível mudar de ${DOM.statusAtivo[a.U_Status]} para ${DOM.statusAtivo[status] || status} por aqui.`);
    if ((status === 'BAI' || a.U_Status === 'BAI') && !req.user.perms.includes('ativos.baixar')) throw badRequest('Baixar ou reativar um ativo exige permissão específica.');
    if (status === 'BAI' && (await contracts.allocations()).has(a.Code)) throw badRequest('O ativo está num contrato aberto e não pode ser baixado.');
    const { before, after } = await repos.assets.update(a.Code, { U_Status: status }, req.body.U_Versao);
    audit.record(req, { action: `status:${status}`, entity: 'ativo', id: a.Code, before: { U_Status: before.U_Status }, after: { U_Status: after.U_Status } });
    return after;
  });

  /* ---- famílias ---- */
  app.get('/families', async () => repos.families.all());
  app.post('/families', { preHandler: can('cadastros.editar') }, async (req) => {
    const Code = str(req.body.Code, 30).toUpperCase();
    if (!CODE.test(Code)) throw badRequest('Código da família inválido.');
    const rec = { Code, Name: str(req.body.Name, 100), U_Tipo: req.body.U_Tipo, U_Caract: str(req.body.U_Caract, 254) };
    if (!rec.Name || !DOM.tipoAtivo[rec.U_Tipo]) throw badRequest('Informe nome e tipo da família.');
    if (await repos.families.get(Code)) throw conflict('Já existe uma família com este código.');
    await repos.families.create(rec);
    audit.record(req, { action: 'criar', entity: 'familia', id: Code, after: rec });
    return rec;
  });
  app.put('/families/:code', { preHandler: can('cadastros.editar') }, async (req) => {
    const before = await repos.families.get(req.params.code);
    if (!before) throw notFound('Família');
    const patch = { Name: str(req.body.Name, 100) || before.Name, U_Tipo: DOM.tipoAtivo[req.body.U_Tipo] ? req.body.U_Tipo : before.U_Tipo, U_Caract: str(req.body.U_Caract, 254) };
    await repos.families.update(req.params.code, patch);
    audit.record(req, { action: 'alterar', entity: 'familia', id: req.params.code, before, after: patch });
    return repos.families.get(req.params.code);
  });

  /* ---- regras de cobrança ---- */
  app.get('/rules', async () => repos.rules.all());
  app.post('/rules', { preHandler: can('cadastros.editar') }, async (req) => {
    const Code = str(req.body.Code, 50).toUpperCase();
    if (!CODE.test(Code)) throw badRequest('Código da regra inválido.');
    if (await repos.rules.get(Code)) throw conflict('Já existe uma regra com este código.');
    const rec = { Code, ...ruleFields(req.body) };
    await repos.rules.create(rec);
    audit.record(req, { action: 'criar', entity: 'regra', id: Code, after: rec });
    return repos.rules.get(Code);
  });
  app.put('/rules/:code', { preHandler: can('cadastros.editar') }, async (req) => {
    const before = await repos.rules.get(req.params.code);
    if (!before) throw notFound('Regra');
    const patch = ruleFields(req.body);
    await repos.rules.update(req.params.code, patch);
    audit.record(req, { action: 'alterar', entity: 'regra', id: req.params.code, before, after: patch });
    return repos.rules.get(req.params.code);
  });

  /* ---- consultas ao B1 ---- */
  app.get('/lookup/partners', async (req) => repos.partners.search(str(req.query.q, 60)));
  app.get('/lookup/items', async (req) => repos.items.search(str(req.query.q, 60)));
  app.get('/settings/public', async () => {
    const c = await repos.settings.all();
    return { EMPRESA: c.EMPRESA || '', CHK_EQP: c.CHK_EQP || '', CHK_VEI: c.CHK_VEI || '', DIAS_ALERTA_FAT: c.DIAS_ALERTA_FAT || '7' };
  });
}
