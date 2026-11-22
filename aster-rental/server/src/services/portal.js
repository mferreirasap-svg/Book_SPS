// Portal do cliente: o contato da empresa cliente acompanha chamados, conversa com a locadora, aprova orçamentos
// e vê os equipamentos locados. Pelo QR Code colado no equipamento, qualquer pessoa na obra abre um chamado sem login.
// Acesso: e-mail + código gerado pela locadora (só o resumo SHA-256 fica gravado). Sessão com prazo, uma por contato.
import { SET, LN, CH1, OS1, DOM, CFG_DEFAULTS } from '../b1/schema.js';
import { key } from '../b1/odata.js';
import { sha256, aleatorio } from '../lib/sha256.js';
import { HttpError, badRequest, notFound, forbidden, agora, addHoras, d10 } from '../lib/util.js';

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;
const naoAutorizado = () => new HttpError(401, 'Acesso expirado. Entre novamente no portal.');
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const resumoCodigo = (email, codigo) => sha256(`portal|${email}|${String(codigo).toUpperCase().replace(/[^A-Z0-9]/g, '')}`);

export function createPortalService({ repos, audit, aftersales }) {
  const sl = repos.sl;
  const cfg = async () => ({ ...CFG_DEFAULTS, ...(await repos.settings.all()) });
  const getOrNull = async (path) => {
    try {
      return await sl.get(path);
    } catch (e) {
      if (e.statusCode === 404) return null;
      throw e;
    }
  };
  const acessos = {
    all: () => sl.getAll(SET.POR),
    get: (email) => getOrNull(`${SET.POR}${key(email)}`),
    patch: (email, p) => sl.request('PATCH', `${SET.POR}${key(email)}`, p),
  };
  // Requisição em nome do contato: perfil mínimo para os serviços (ex.: aprovar orçamento de OS de qualquer técnico).
  const reqCliente = (a, req) => ({ id: req?.id, ip: req?.ip, user: { login: `portal:${a.Code}`, name: a.U_Nome, perms: ['os.todas'], branches: [], portal: true } });

  /* ---------------- gestão dos acessos (tela interna) ---------------- */

  async function listarAcessos() {
    return (await acessos.all()).map(({ U_Codigo: _c, U_Sessao: _s, ...a }) => a).sort((a, b) => (a.U_CardName + a.U_Nome).localeCompare(b.U_CardName + b.U_Nome));
  }

  /** Cria o acesso e devolve o código uma única vez (só o resumo fica gravado). */
  async function criarAcesso(req, { cardCode, nome, email, fone }, codigoFixo) {
    const bp = await repos.partners.get(str(cardCode, 15));
    if (!bp) throw badRequest('Escolha o cliente.');
    email = str(email, 100).toLowerCase();
    if (!emailOk(email)) throw badRequest('Informe um e-mail válido.');
    if (!str(nome, 100)) throw badRequest('Informe o nome do contato.');
    if (await acessos.get(email)) throw badRequest('Já existe acesso para este e-mail.');
    const codigo = codigoFixo || aleatorio(8);
    await sl.request('POST', SET.POR, { Code: email, Name: str(nome, 100), U_CardCode: bp.CardCode, U_CardName: bp.CardName, U_Nome: str(nome, 100), U_Email: email,
      U_Fone: str(fone, 30), U_Codigo: resumoCodigo(email, codigo), U_Sessao: '', U_SessaoExp: '', U_UltAcesso: '', U_Falhas: 0, U_Bloqueio: '', U_Ativo: 'S' });
    audit.record(req, { action: 'criar', entity: 'portal', id: email, after: { cliente: bp.CardCode, nome } });
    return { email, codigo };
  }

  async function novoCodigo(req, email) {
    const a = await acessos.get(email);
    if (!a) throw notFound('Acesso');
    const codigo = aleatorio(8);
    await acessos.patch(email, { U_Codigo: resumoCodigo(email, codigo), U_Sessao: '', U_SessaoExp: '', U_Falhas: 0, U_Bloqueio: '' });
    audit.record(req, { action: 'novo_codigo', entity: 'portal', id: email });
    return { email, codigo };
  }

  async function situacaoAcesso(req, email, ativo) {
    const a = await acessos.get(email);
    if (!a) throw notFound('Acesso');
    await acessos.patch(email, { U_Ativo: ativo ? 'S' : 'N', ...(ativo ? {} : { U_Sessao: '', U_SessaoExp: '' }) });
    audit.record(req, { action: ativo ? 'ativar' : 'desativar', entity: 'portal', id: email });
    return { ok: true };
  }

  /* ---------------- entrada e sessão ---------------- */

  async function entrar(req, { email, codigo }) {
    email = str(email, 100).toLowerCase();
    const a = emailOk(email) ? await acessos.get(email) : null;
    const agoraDt = agora();
    const recusa = () => new HttpError(401, 'E-mail ou código de acesso inválidos.');
    if (!a || a.U_Ativo === 'N') throw recusa();
    if (a.U_Bloqueio && a.U_Bloqueio > agoraDt) throw new HttpError(429, `Muitas tentativas. Tente de novo depois de ${a.U_Bloqueio.slice(11)}.`);
    if (resumoCodigo(email, codigo) !== a.U_Codigo) {
      const falhas = (Number(a.U_Falhas) || 0) + 1;
      await acessos.patch(email, { U_Falhas: falhas >= MAX_FALHAS ? 0 : falhas, U_Bloqueio: falhas >= MAX_FALHAS ? addHoras(agoraDt, BLOQUEIO_MIN / 60) : '' });
      audit.record({ user: { login: `portal:${email}` }, ip: req?.ip, id: req?.id }, { action: 'login_falha', entity: 'portal', id: email });
      throw recusa();
    }
    const token = aleatorio(40, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const horas = Math.min(Math.max(Number((await cfg()).PORTAL_HORAS) || 12, 1), 72);
    await acessos.patch(email, { U_Sessao: sha256(token), U_SessaoExp: addHoras(agoraDt, horas), U_UltAcesso: agoraDt, U_Falhas: 0, U_Bloqueio: '' });
    audit.record({ user: { login: `portal:${email}` }, ip: req?.ip, id: req?.id }, { action: 'login', entity: 'portal', id: email });
    return { token: `${email}|${token}`, nome: a.U_Nome, cliente: a.U_CardName };
  }

  /** Valida o token enviado no cabeçalho X-Portal-Token e devolve o acesso. */
  async function sessao(tokenCompleto) {
    const [email, token] = String(tokenCompleto || '').split('|');
    if (!email || !token) throw naoAutorizado();
    const a = await acessos.get(email);
    if (!a || a.U_Ativo === 'N' || !a.U_Sessao || a.U_Sessao !== sha256(token) || !a.U_SessaoExp || a.U_SessaoExp < agora()) throw naoAutorizado();
    return a;
  }

  async function sair(tokenCompleto) {
    const a = await sessao(tokenCompleto).catch(() => null);
    if (a) await acessos.patch(a.Code, { U_Sessao: '', U_SessaoExp: '' });
    return { ok: true };
  }

  /* ---------------- dados do cliente ---------------- */

  /** Equipamentos com o cliente agora, com obra e próxima preventiva. */
  async function equipamentos(a) {
    const [ctrs, prev] = await Promise.all([repos.contracts.list({ cardCode: a.U_CardCode }, { size: 200 }), aftersales.preventive({})]);
    const out = [];
    for (const c of ctrs.items.filter((x) => ['ATV', 'SUS'].includes(x.U_Status))) {
      const full = await repos.contracts.get(c.DocEntry);
      for (const l of full[LN].filter((x) => x.U_StatusL === 'LOC' && x.U_Ativo)) {
        const at = await repos.assets.get(l.U_Ativo);
        const p = prev.filter((x) => x.ativo === l.U_Ativo).sort((x, y) => (x.faltaMed ?? 1e9) - (y.faltaMed ?? 1e9))[0];
        out.push({ ativo: l.U_Ativo, nome: at?.Name || l.U_AtvDesc, tipo: at?.U_Tipo, placa: at?.U_Placa || '', serie: at?.U_Serie || '', contrato: c.DocNum, obra: c.U_Obra,
          desde: d10(l.U_DtSaida), medidor: at?.U_Medidor || 0,
          preventiva: p ? { status: p.status, plano: p.planoNome, faltaMed: p.faltaMed, faltaDias: p.faltaDias, proxData: p.proxData, aberta: Boolean(p.aberta) } : null });
      }
    }
    return out;
  }

  const visivel = (t) => ({
    DocEntry: t.DocEntry, DocNum: t.DocNum, assunto: t.U_Assunto, descricao: t.U_Descricao, tipo: DOM.tipoCha[t.U_Tipo], status: t.U_Status,
    statusNome: { ABE: 'Recebido', AND: 'Em atendimento', AGC: 'Aguardando você', RES: 'Resolvido', FEC: 'Encerrado', CAN: 'Cancelado' }[t.U_Status] || t.U_Status,
    ativo: t.U_Ativo, abertura: t.U_Abertura, parado: t.U_Parado === 'S', prazo: t.U_PrazoSol, solucao: t.U_DtSol,
  });

  async function chamados(a) {
    const r = await repos.tickets.list({ cardCode: a.U_CardCode }, { size: 100 });
    return r.items.map(visivel);
  }

  async function chamado(a, id) {
    const t = await repos.tickets.get(id);
    if (!t || t.U_CardCode !== a.U_CardCode) throw notFound('Chamado');
    const os = t.U_OsEntry ? await repos.orders.get(t.U_OsEntry) : null;
    const tec = os?.U_Tecnico ? await repos.technicians.get(os.U_Tecnico) : null;
    let fotos = [];
    try {
      fotos = JSON.parse(t.U_Fotos || '[]');
    } catch {
      fotos = [];
    }
    return {
      ...visivel(t), fotos,
      // Só as mensagens públicas: notas internas da locadora nunca aparecem para o cliente.
      mensagens: (t[CH1] || []).filter((m) => m.U_Publico === 'S').map((m) => ({ data: m.U_Data, texto: m.U_Texto, cliente: String(m.U_Usuario).startsWith('cliente:'),
        autor: String(m.U_Usuario).startsWith('cliente:') ? m.U_Usuario.slice(8).trim() : 'Equipe de atendimento' })),
      visita: os && ['AGE', 'EXE', 'AOR'].includes(os.U_Status) ? { data: d10(os.U_DtAgenda), hora: os.U_HrAgenda, tecnico: tec?.Name?.split(' ')[0] || '' } : null,
      laudo: os?.U_Status === 'CON' ? os.U_Laudo : '',
    };
  }

  async function abrirChamado(req, a, input) {
    const meus = await equipamentos(a);
    if (input.ativo && !meus.some((e) => e.ativo === input.ativo)) throw forbidden('Este equipamento não está locado para a sua empresa.');
    const t = await aftersales.createTicket(reqCliente(a, req), {
      cardCode: a.U_CardCode, ativo: input.ativo || '', tipo: input.tipo, parado: input.parado, origem: 'POR', contato: a.U_Nome, fone: str(input.fone, 30) || a.U_Fone,
      email: a.U_Email, assunto: input.assunto, descricao: input.descricao, fotos: input.fotos,
    });
    return chamado(a, t.DocEntry);
  }

  async function mensagem(req, a, id, texto) {
    await chamado(a, id); // confere que o chamado é do cliente
    await aftersales.mensagemCliente(reqCliente(a, req), id, texto);
    return chamado(a, id);
  }

  async function orcamentos(a) {
    const oss = (await repos.orders.all({ status: 'AOR' })).filter((o) => o.U_CardCode === a.U_CardCode);
    return oss.map((o) => ({
      DocEntry: o.DocEntry, DocNum: o.DocNum, tipo: DOM.tipoOS[o.U_Tipo], ativo: o.U_Ativo, problema: o.U_Descricao, laudo: o.U_Laudo, valor: Number(o.U_Valor) || 0,
      itens: (o[OS1] || []).filter((i) => i.U_Cobrar === 'S').map((i) => ({ descr: i.U_Descr, qtd: i.U_Qtd, preco: i.U_Preco, total: (Number(i.U_Qtd) || 0) * (Number(i.U_Preco) || 0) })),
    }));
  }

  async function decidirOrcamento(req, a, id, acao) {
    if (!['aprovar', 'recusar'].includes(acao)) throw badRequest('Escolha aprovar ou recusar.');
    const os = await repos.orders.get(id);
    if (!os || os.U_CardCode !== a.U_CardCode) throw notFound('Orçamento');
    await aftersales.quoteOrder(reqCliente(a, req), id, { acao, nome: `${a.U_Nome} (portal)` });
    if (os.U_ChaEntry) {
      await repos.tickets.update(os.U_ChaEntry, { [CH1]: [{ U_Data: agora(), U_Usuario: `cliente: ${a.U_Nome}`, U_Publico: 'S',
        U_Texto: `Orçamento da OS ${os.DocNum} ${acao === 'aprovar' ? 'aprovado' : 'recusado'} pelo portal.` }] });
    }
    return { ok: true };
  }

  /* ---------------- QR Code do equipamento (sem login) ---------------- */

  async function tokenQR(req, ativo) {
    const at = await repos.assets.get(ativo);
    if (!at) throw notFound('Ativo');
    if (at.U_QR) return at.U_QR;
    const tk = aleatorio(16, 'abcdefghijkmnpqrstuvwxyz23456789');
    await sl.request('PATCH', `${SET.ATV}${key(at.Code)}`, { U_QR: tk });
    audit.record(req, { action: 'gerar_qr', entity: 'ativo', id: at.Code });
    return tk;
  }

  async function porQR(tk) {
    if (!/^[a-z0-9]{8,40}$/.test(String(tk))) throw notFound('Etiqueta');
    const at = (await repos.assets.all()).find((x) => x.U_QR === tk);
    if (!at) throw notFound('Etiqueta');
    const c = at.U_CtrAtual ? await repos.contracts.get(at.U_CtrAtual) : null;
    return { at, c: c && at.U_Status !== 'BAI' && ['ATV', 'SUS'].includes(c.U_Status) ? c : null };
  }

  /** O que a pessoa na obra vê ao ler a etiqueta: só o necessário para abrir o chamado. */
  async function infoQR(tk) {
    const { at, c } = await porQR(tk);
    const c0 = await cfg();
    return { empresa: c0.EMPRESA || '', equipamento: at.Name, codigo: at.Code, placa: at.U_Placa || '', locado: Boolean(c), cliente: c?.U_CardName || '', obra: c?.U_Obra || '' };
  }

  async function chamadoQR(req, tk, input) {
    const { at, c } = await porQR(tk);
    if (!c) throw badRequest('Este equipamento não está locado no momento. Fale com a locadora pelo telefone.');
    const nome = str(input.nome, 100);
    if (!nome) throw badRequest('Informe o seu nome.');
    if (!str(input.fone, 30)) throw badRequest('Informe um telefone para contato.');
    const tipo = DOM.tipoCha[input.tipo] && ['PAR', 'MAN', 'DUV'].includes(input.tipo) ? input.tipo : 'MAN';
    const r = { id: req?.id, ip: req?.ip, user: { login: 'portal:qr', name: nome, perms: [], branches: [], portal: true } };
    const t = await aftersales.createTicket(r, {
      cardCode: c.U_CardCode, ctr: c.DocEntry, ativo: at.Code, tipo, parado: input.parado, origem: 'POR', contato: nome, fone: input.fone,
      assunto: str(input.assunto, 150) || `${DOM.tipoCha[tipo]} — ${at.Code}`, descricao: input.descricao, fotos: input.fotos,
    });
    return { protocolo: t.DocNum, prazo: t.U_PrazoResp };
  }

  return { listarAcessos, criarAcesso, novoCodigo, situacaoAcesso, entrar, sessao, sair, equipamentos, chamados, chamado, abrirChamado, mensagem, orcamentos,
    decidirOrcamento, tokenQR, infoQR, chamadoQR };
}
