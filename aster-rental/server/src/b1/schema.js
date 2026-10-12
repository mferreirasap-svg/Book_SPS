// Estruturas do Áster Rental no SAP B1: tabelas (UDT), campos (UDF) e objetos (UDO).
// O instalador cria tudo pela Service Layer. Ao mudar algo aqui, incremente SCHEMA_VERSION.

export const SCHEMA_VERSION = 2;

export const SET = {
  ATV: 'SPSLATV',
  REG: 'SPSLREG',
  CTR: 'SPSLCTR',
  MOV: 'SPSLMOV',
  FAM: 'U_SPS_LFAM',
  MED: 'U_SPS_LMED',
  FORA: 'U_SPS_LFORA',
  FAT: 'U_SPS_LFAT',
  MUL: 'U_SPS_LMUL',
  CFG: 'U_SPS_LCFG',
};
export const LN = 'SPS_LCT1Collection'; // itens do contrato
export const GR = 'SPS_LCT2Collection'; // grupos de cobrança agrupada

export const DOM = {
  tipoAtivo: { EQP: 'Máquina/Equipamento', VEI: 'Veículo' },
  statusAtivo: { DIS: 'Disponível', LOC: 'Locado', MAN: 'Manutenção', RES: 'Reservado', BAI: 'Baixado' },
  tipoContrato: { LOC: 'Locação', COM: 'Comodato', SRV: 'Serviço' },
  statusContrato: { RAS: 'Rascunho', ATV: 'Ativo', SUS: 'Suspenso', ENC: 'Encerrado' },
  statusLinha: { PEN: 'Aguardando entrega', LOC: 'Locado', DEV: 'Devolvido' },
  modoFat: { RAS: 'Rascunho de NF', PRE: 'Pré-fatura (pedido)', FAT: 'Fatura direta (NF)' },
  tipoRegra: { ITEM: 'Por item', AGRUP: 'Agrupada', CONS: 'Por consumo', SEM: 'Sem cobrança' },
  proRata: { LIN: 'Linear (dias ÷ dias do mês)', PCT: 'Tabela em % do mês', DIA: 'Tabela em diárias' },
  tipoMov: { ENT: 'Entrega', DEV: 'Devolução', SUB: 'Substituição', MAN: 'Envio à manutenção', RET: 'Retorno da manutenção' },
  statusFat: { PRO: 'Em processamento', OK: 'Gerada', CAN: 'Cancelada', ERR: 'Com erro' },
  statusMulta: { PEN: 'Pendente', IND: 'Condutor indicado', REP: 'A repassar', FAT: 'Faturada', PAG: 'Paga pela locadora' },
};

const F = (n, t, d, o = {}) => ({ n, t, d, ...o });

export const SCHEMA = {
  tables: [
    { TableName: 'SPS_LATV', TableDescription: 'Locação - Ativos', TableType: 'bott_MasterData' },
    { TableName: 'SPS_LFAM', TableDescription: 'Locação - Famílias', TableType: 'bott_NoObject' },
    { TableName: 'SPS_LREG', TableDescription: 'Locação - Regras cobrança', TableType: 'bott_MasterData' },
    { TableName: 'SPS_LCTR', TableDescription: 'Locação - Contratos', TableType: 'bott_Document' },
    { TableName: 'SPS_LCT1', TableDescription: 'Locação - Itens do contrato', TableType: 'bott_DocumentLines' },
    { TableName: 'SPS_LCT2', TableDescription: 'Locação - Grupos de cobrança', TableType: 'bott_DocumentLines' },
    { TableName: 'SPS_LMOV', TableDescription: 'Locação - Movimentações', TableType: 'bott_Document' },
    { TableName: 'SPS_LMED', TableDescription: 'Locação - Leituras', TableType: 'bott_NoObject' },
    { TableName: 'SPS_LFORA', TableDescription: 'Locação - Dias fora cliente', TableType: 'bott_NoObject' },
    { TableName: 'SPS_LFAT', TableDescription: 'Locação - Parcelas', TableType: 'bott_NoObject' },
    { TableName: 'SPS_LMUL', TableDescription: 'Locação - Multas', TableType: 'bott_NoObject' },
    { TableName: 'SPS_LCFG', TableDescription: 'Locação - Parâmetros', TableType: 'bott_NoObject' },
  ],
  fields: {
    '@SPS_LATV': [
      F('Tipo', 'A', 'Tipo do ativo', { size: 3, vv: DOM.tipoAtivo, def: 'EQP' }), F('Familia', 'A', 'Família', { size: 50 }),
      F('Categoria', 'A', 'Categoria', { size: 50 }), F('ItemCode', 'A', 'Item de faturamento', { size: 50 }),
      F('Serie', 'A', 'Nº série / patrimônio', { size: 50 }), F('Placa', 'A', 'Placa', { size: 10 }), F('Chassi', 'A', 'Chassi', { size: 30 }),
      F('Renavam', 'A', 'Renavam', { size: 20 }), F('Marca', 'A', 'Marca', { size: 50 }), F('Modelo', 'A', 'Modelo', { size: 50 }),
      F('Ano', 'A', 'Ano', { size: 4 }), F('Medidor', 'M', 'Horímetro / hodômetro'),
      F('Status', 'A', 'Status', { size: 3, vv: DOM.statusAtivo, def: 'DIS' }), F('ValorMes', 'P', 'Valor mensal'),
      F('ValorDia', 'P', 'Valor diária'), F('Filial', 'N', 'Filial (BPLId)'), F('CtrAtual', 'N', 'Contrato atual'),
      F('Obs', 'T', 'Observações'), F('Versao', 'N', 'Versão do registro'),
    ],
    '@SPS_LFAM': [F('Tipo', 'A', 'Tipo do ativo', { size: 3, vv: DOM.tipoAtivo }), F('Caract', 'A', 'Características', { size: 254 })],
    '@SPS_LREG': [
      F('Tipo', 'A', 'Tipo de cobrança', { size: 5, vv: DOM.tipoRegra, def: 'ITEM' }),
      F('ProRata', 'A', 'Forma de pró-rata', { size: 3, vv: DOM.proRata, def: 'LIN' }), F('Tabela', 'T', 'Tabela de pró-rata (JSON)'),
      F('FranqProp', 'A', 'Franquia proporcional', { size: 1, vv: { S: 'Sim', N: 'Não' }, def: 'S' }), F('Toler', 'N', 'Tolerância (dias)'),
      F('MesesNF', 'A', 'Meses não faturáveis', { size: 40 }), F('Obs', 'T', 'Observações'),
    ],
    '@SPS_LCTR': [
      F('CardCode', 'A', 'Cliente', { size: 15 }), F('CardName', 'A', 'Nome do cliente', { size: 100 }),
      F('Tipo', 'A', 'Tipo de contrato', { size: 3, vv: DOM.tipoContrato, def: 'LOC' }), F('DtInicio', 'D', 'Início da vigência'),
      F('DtFim', 'D', 'Fim da vigência'), F('DtCorte', 'D', 'Data de corte'), F('DiaFat', 'N', 'Dia de faturamento'),
      F('Status', 'A', 'Status', { size: 3, vv: DOM.statusContrato, def: 'RAS' }), F('Filial', 'N', 'Filial (BPLId)'),
      F('Obra', 'A', 'Obra / local de uso', { size: 100 }), F('Indice', 'A', 'Índice de reajuste', { size: 20 }),
      F('ModoFat', 'A', 'Documento gerado', { size: 3, vv: DOM.modoFat, def: 'RAS' }), F('Email', 'A', 'E-mail de cobrança', { size: 100 }),
      F('Obs', 'T', 'Observações'), F('Versao', 'N', 'Versão do registro'),
    ],
    '@SPS_LCT1': [
      F('Familia', 'A', 'Família contratada', { size: 50 }), F('Ativo', 'A', 'Ativo', { size: 50 }), F('AtvDesc', 'A', 'Descrição', { size: 100 }),
      F('ItemCode', 'A', 'Item de faturamento', { size: 50 }), F('Regra', 'A', 'Regra de cobrança', { size: 50 }),
      F('Grupo', 'A', 'Grupo de cobrança', { size: 20 }), F('Valor', 'P', 'Mensalidade'), F('Diaria', 'P', 'Valor da diária'),
      F('Franquia', 'M', 'Franquia mensal'), F('VlrExced', 'P', 'Valor do excedente'), F('DtSaida', 'D', 'Data de entrega'),
      F('DtDevol', 'D', 'Data de devolução'), F('Condutor', 'A', 'Condutor', { size: 100 }), F('Local', 'A', 'Local de uso', { size: 100 }),
      F('StatusL', 'A', 'Status do item', { size: 3, vv: DOM.statusLinha, def: 'PEN' }),
    ],
    '@SPS_LCT2': [
      F('Grupo', 'A', 'Grupo', { size: 20 }), F('Descr', 'A', 'Descrição', { size: 100 }), F('Regra', 'A', 'Regra de cobrança', { size: 50 }),
      F('ItemCode', 'A', 'Item de faturamento', { size: 50 }), F('Valor', 'P', 'Mensalidade do grupo'), F('Diaria', 'P', 'Diária do grupo'),
      F('Franquia', 'M', 'Franquia do grupo'), F('VlrExced', 'P', 'Valor do excedente'),
    ],
    '@SPS_LMOV': [
      F('Tipo', 'A', 'Tipo de movimento', { size: 3, vv: DOM.tipoMov }), F('CtrEntry', 'N', 'Contrato (DocEntry)'), F('CtrLine', 'N', 'Linha do contrato'),
      F('CardName', 'A', 'Cliente', { size: 100 }), F('Ativo', 'A', 'Ativo', { size: 50 }), F('AtivoNovo', 'A', 'Ativo substituto', { size: 50 }),
      F('Data', 'D', 'Data'), F('Medidor', 'M', 'Leitura do medidor'), F('MedidorN', 'M', 'Leitura do substituto'),
      F('Combust', 'A', 'Combustível', { size: 10 }), F('Checklist', 'T', 'Checklist (JSON)'), F('Avarias', 'T', 'Avarias / observações'),
      F('Respons', 'A', 'Responsável do cliente', { size: 100 }), F('DocResp', 'A', 'Documento do responsável', { size: 30 }),
      F('DestAtivo', 'A', 'Status do ativo após', { size: 3 }), F('Assinatura', 'T', 'Assinatura (PNG base64)'), F('Usuario', 'A', 'Usuário', { size: 50 }),
    ],
    '@SPS_LMED': [
      F('CtrEntry', 'N', 'Contrato (DocEntry)'), F('CtrLine', 'N', 'Linha do contrato'), F('Ativo', 'A', 'Ativo', { size: 50 }),
      F('Comp', 'A', 'Competência AAAAMM', { size: 6 }), F('Data', 'D', 'Data da leitura'), F('LeitIni', 'M', 'Leitura inicial'),
      F('LeitFim', 'M', 'Leitura final'), F('Abat', 'M', 'Abatimento'), F('Origem', 'A', 'Origem', { size: 3 }),
    ],
    '@SPS_LFORA': [
      F('CtrEntry', 'N', 'Contrato (DocEntry)'), F('CtrLine', 'N', 'Linha do contrato'), F('Ativo', 'A', 'Ativo', { size: 50 }),
      F('Ini', 'D', 'Início'), F('Fim', 'D', 'Fim'), F('Motivo', 'A', 'Motivo', { size: 100 }),
    ],
    '@SPS_LFAT': [
      F('CtrEntry', 'N', 'Contrato (DocEntry)'), F('Comp', 'A', 'Competência AAAAMM', { size: 6 }), F('Status', 'A', 'Status', { size: 3, vv: DOM.statusFat }),
      F('DocType', 'A', 'Tipo de documento', { size: 10 }), F('DocEntry', 'N', 'DocEntry do documento'), F('DocNum', 'N', 'Número do documento'),
      F('Valor', 'S', 'Valor'), F('Desc', 'S', 'Desconto'), F('Acres', 'S', 'Acréscimo'), F('Data', 'D', 'Data'),
      F('Detalhe', 'T', 'Memória de cálculo (JSON)'), F('Erro', 'A', 'Erro', { size: 254 }), F('Usuario', 'A', 'Usuário', { size: 50 }),
    ],
    '@SPS_LMUL': [
      F('Ativo', 'A', 'Ativo', { size: 50 }), F('Placa', 'A', 'Placa', { size: 10 }), F('DtInfr', 'D', 'Data da infração'),
      F('HrInfr', 'A', 'Hora da infração', { size: 5 }), F('AIT', 'A', 'Auto de infração', { size: 30 }), F('Descricao', 'A', 'Descrição', { size: 100 }),
      F('Valor', 'S', 'Valor'), F('CtrEntry', 'N', 'Contrato (DocEntry)'), F('CtrLine', 'N', 'Linha do contrato'),
      F('CardName', 'A', 'Cliente', { size: 100 }), F('Condutor', 'A', 'Condutor', { size: 100 }),
      F('Status', 'A', 'Status', { size: 3, vv: DOM.statusMulta, def: 'PEN' }), F('Comp', 'A', 'Competência faturada', { size: 6 }),
    ],
    '@SPS_LCFG': [F('Valor', 'T', 'Valor do parâmetro')],
    OINV: [F('SPS_CtrEntry', 'N', 'Contrato de locação'), F('SPS_Comp', 'A', 'Competência da locação', { size: 6 })],
  },
  udos: [
    { Code: 'SPSLATV', Name: 'Locação - Ativos', TableName: 'SPS_LATV', ObjectType: 'boud_MasterData', CanFind: 'tYES', CanDelete: 'tNO', CanLog: 'tYES',
      UserObjectMD_FindColumns: [{ ColumnAlias: 'Code' }, { ColumnAlias: 'Name' }, { ColumnAlias: 'U_Placa' }, { ColumnAlias: 'U_Serie' }] },
    { Code: 'SPSLREG', Name: 'Locação - Regras cobrança', TableName: 'SPS_LREG', ObjectType: 'boud_MasterData', CanFind: 'tYES', CanDelete: 'tNO', CanLog: 'tYES',
      UserObjectMD_FindColumns: [{ ColumnAlias: 'Code' }, { ColumnAlias: 'Name' }] },
    { Code: 'SPSLCTR', Name: 'Locação - Contratos', TableName: 'SPS_LCTR', ObjectType: 'boud_Document', CanFind: 'tYES', CanCancel: 'tYES', CanClose: 'tYES',
      CanLog: 'tYES', ManageSeries: 'tYES',
      UserObjectMD_ChildTables: [{ TableName: 'SPS_LCT1', ObjectName: 'SPS_LCT1' }, { TableName: 'SPS_LCT2', ObjectName: 'SPS_LCT2' }],
      UserObjectMD_FindColumns: [{ ColumnAlias: 'U_CardCode' }, { ColumnAlias: 'U_CardName' }] },
    { Code: 'SPSLMOV', Name: 'Locação - Movimentações', TableName: 'SPS_LMOV', ObjectType: 'boud_Document', CanFind: 'tYES', CanCancel: 'tYES', CanLog: 'tYES',
      ManageSeries: 'tYES', UserObjectMD_FindColumns: [{ ColumnAlias: 'U_Ativo' }, { ColumnAlias: 'U_CardName' }] },
  ],
};

const FTYPE = { A: ['db_Alpha', 'st_None'], N: ['db_Numeric', 'st_None'], D: ['db_Date', 'st_None'], P: ['db_Float', 'st_Price'],
  Q: ['db_Float', 'st_Quantity'], M: ['db_Float', 'st_Measurement'], S: ['db_Float', 'st_Sum'], T: ['db_Memo', 'st_None'] };

export function fieldMD(table, f) {
  const [Type, SubType] = FTYPE[f.t];
  const md = { Name: f.n, Description: f.d.slice(0, 30), TableName: table, Type, SubType };
  if (f.t === 'A') md.EditSize = f.size;
  if (f.t === 'N') md.EditSize = 11;
  if (f.vv) md.ValidValuesMD = Object.entries(f.vv).map(([Value, Description]) => ({ Value, Description: Description.slice(0, 30) }));
  if (f.def) md.DefaultValue = f.def;
  return md;
}

export const CFG_DEFAULTS = {
  EMPRESA: '',
  ITEM_MULTA: '',
  USAGE: '',
  DIAS_ALERTA_FAT: '7',
  CHK_EQP: ['Limpeza geral', 'Nível de óleo e fluidos', 'Sem vazamentos', 'Pneus / esteiras', 'Implementos e acessórios', 'Funcionamento geral', 'Manual e documentação'].join('\n'),
  CHK_VEI: ['Documento (CRLV)', 'Pneus e estepe', 'Macaco, triângulo e chave de roda', 'Lataria sem avarias', 'Vidros e retrovisores', 'Faróis e lanternas', 'Limpeza interna', 'Tapetes'].join('\n'),
  SCHEMA_VERSION: '0',
};
