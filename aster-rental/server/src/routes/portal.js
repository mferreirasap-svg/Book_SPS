// Portal do cliente. Rotas /portal/* são da locadora (gestão de acessos e etiquetas QR, com login interno).
// Rotas /public/portal/* e /public/qr/* são do cliente: não usam a sessão interna; o portal envia X-Portal-Token.
export default async function portalRoutes(app, { deps }) {
  const { portal } = deps;
  const can = app.can;
  const tokenDe = (req) => req.headers['x-portal-token'];
  const comSessao = (fn) => async (req) => fn(req, await portal.sessao(tokenDe(req)));

  /* ---- gestão (interno) ---- */
  app.get('/portal/accesses', { preHandler: can('portal.gerir') }, async () => portal.listarAcessos());
  app.post('/portal/accesses', { preHandler: can('portal.gerir') }, async (req) => portal.criarAcesso(req, req.body || {}));
  app.post('/portal/accesses/:email/code', { preHandler: can('portal.gerir') }, async (req) => portal.novoCodigo(req, String(req.params.email).toLowerCase()));
  app.post('/portal/accesses/:email/status', { preHandler: can('portal.gerir') }, async (req) =>
    portal.situacaoAcesso(req, String(req.params.email).toLowerCase(), req.body?.ativo !== false));
  app.post('/portal/qr-labels', { preHandler: can('portal.gerir', 'ativos.editar') }, async (req) => {
    const ativos = Array.isArray(req.body?.ativos) ? req.body.ativos.slice(0, 200) : [];
    const out = [];
    for (const a of ativos) out.push({ ativo: a, token: await portal.tokenQR(req, String(a)) });
    return out;
  });

  /* ---- cliente (público, com token do portal) ---- */
  app.post('/public/portal/login', async (req) => portal.entrar(req, req.body || {}));
  app.post('/public/portal/logout', async (req) => portal.sair(tokenDe(req)));
  app.get('/public/portal/me', comSessao(async (_req, a) => ({ nome: a.U_Nome, cliente: a.U_CardName, email: a.U_Email })));
  app.get('/public/portal/equipamentos', comSessao(async (_req, a) => portal.equipamentos(a)));
  app.get('/public/portal/chamados', comSessao(async (_req, a) => portal.chamados(a)));
  app.get('/public/portal/chamados/:id', comSessao(async (req, a) => portal.chamado(a, req.params.id)));
  app.post('/public/portal/chamados', comSessao(async (req, a) => portal.abrirChamado(req, a, req.body || {})));
  app.post('/public/portal/chamados/:id/mensagens', comSessao(async (req, a) => portal.mensagem(req, a, req.params.id, req.body?.texto)));
  app.get('/public/portal/orcamentos', comSessao(async (_req, a) => portal.orcamentos(a)));
  app.get('/public/portal/financeiro', comSessao(async (_req, a) => portal.financeiro(a)));
  app.get('/public/portal/extrato/:ctr/:comp', comSessao(async (req, a) => portal.extrato(a, req.params.ctr, req.params.comp)));
  app.post('/public/portal/orcamentos/:id', comSessao(async (req, a) => portal.decidirOrcamento(req, a, req.params.id, req.body?.acao)));

  /* ---- etiqueta QR no equipamento (público, sem login) ---- */
  app.get('/public/qr/:tk', async (req) => portal.infoQR(req.params.tk));
  app.post('/public/qr/:tk', async (req) => portal.chamadoQR(req, req.params.tk, req.body || {}));
}
