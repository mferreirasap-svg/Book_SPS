// Permissões e perfis (requisitos SEG-04 e SEG-05). A checagem é sempre feita no backend.

export const PERMISSIONS = {
  'painel.ver': 'Ver o painel',
  'ativos.ver': 'Consultar ativos',
  'ativos.editar': 'Cadastrar e editar ativos',
  'ativos.baixar': 'Baixar ativos',
  'cadastros.editar': 'Editar famílias e regras de cobrança',
  'contratos.ver': 'Consultar contratos',
  'contratos.editar': 'Criar e editar contratos',
  'contratos.ativar': 'Ativar, suspender e encerrar contratos',
  'mov.registrar': 'Registrar entregas, devoluções e substituições',
  'leituras.ver': 'Consultar leituras',
  'leituras.registrar': 'Registrar e importar leituras',
  'faturamento.ver': 'Consultar faturamento',
  'faturamento.gerar': 'Gerar parcelas no SAP B1',
  'faturamento.liberar': 'Liberar refaturamento',
  'multas.ver': 'Consultar multas',
  'multas.editar': 'Registrar e tratar multas',
  'chamados.ver': 'Consultar chamados de pós-venda',
  'chamados.editar': 'Abrir e atender chamados',
  'os.ver': 'Consultar ordens de serviço',
  'os.editar': 'Abrir, agendar e cancelar ordens de serviço',
  'os.executar': 'Executar ordens de serviço (técnico)',
  'os.todas': 'Ver e executar OS de todos os técnicos',
  'planos.editar': 'Editar técnicos e planos preventivos',
  'pesquisa.ver': 'Consultar pesquisas de satisfação',
  'admin.usuarios': 'Administrar usuários',
  'admin.parametros': 'Alterar parâmetros',
  'admin.instalar': 'Instalar estruturas no SAP B1',
  'auditoria.ver': 'Consultar auditoria',
};

const ALL = Object.keys(PERMISSIONS);
const VER = ['painel.ver', 'ativos.ver', 'contratos.ver', 'leituras.ver', 'faturamento.ver', 'multas.ver'];

export const PROFILES = {
  administrador: { name: 'Administrador', perms: ALL },
  gestor: { name: 'Gestor', perms: ALL.filter((p) => !p.startsWith('admin.')) },
  comercial: { name: 'Comercial', perms: [...VER, 'contratos.editar', 'contratos.ativar', 'chamados.ver', 'pesquisa.ver'] },
  faturamento: { name: 'Faturamento', perms: [...VER, 'faturamento.gerar', 'multas.editar', 'chamados.ver', 'os.ver', 'os.todas'] },
  patio: { name: 'Pátio / logística', perms: ['painel.ver', 'ativos.ver', 'contratos.ver', 'leituras.ver', 'multas.ver', 'mov.registrar', 'leituras.registrar',
    'chamados.ver', 'os.ver', 'os.executar', 'os.todas'] },
  operacao: { name: 'Operação de campo', perms: ['painel.ver', 'ativos.ver', 'contratos.ver', 'leituras.ver', 'mov.registrar', 'leituras.registrar'] },
  atendimento: { name: 'Atendimento / pós-venda', perms: ['painel.ver', 'ativos.ver', 'contratos.ver', 'chamados.ver', 'chamados.editar', 'os.ver', 'os.editar',
    'os.todas', 'pesquisa.ver'] },
  tecnico: { name: 'Técnico de campo', perms: ['painel.ver', 'ativos.ver', 'chamados.ver', 'os.ver', 'os.executar', 'leituras.ver'] },
};

export const permsOf = (profile) => new Set(PROFILES[profile]?.perms || []);
