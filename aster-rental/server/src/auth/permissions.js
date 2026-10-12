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
  comercial: { name: 'Comercial', perms: [...VER, 'contratos.editar', 'contratos.ativar'] },
  faturamento: { name: 'Faturamento', perms: [...VER, 'faturamento.gerar', 'multas.editar'] },
  patio: { name: 'Pátio / logística', perms: [...VER, 'mov.registrar', 'leituras.registrar'] },
  operacao: { name: 'Operação de campo', perms: ['painel.ver', 'ativos.ver', 'contratos.ver', 'leituras.ver', 'mov.registrar', 'leituras.registrar'] },
};

export const permsOf = (profile) => new Set(PROFILES[profile]?.perms || []);
