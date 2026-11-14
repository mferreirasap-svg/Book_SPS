// Base de demonstração para o modo simulado (B1_MODE=mock). Datas relativas a hoje.
import { SCHEMA, CFG_DEFAULTS, LN, GR, CH1, OS1, SCHEMA_VERSION, fieldMD } from './schema.js';
import { hoje, addDias, compDe, agora, addHoras } from '../lib/util.js';

export function demoSeed() {
  const h = hoje();
  const m0 = `${h.slice(0, 8)}01`;
  const mPrev = `${addDias(m0, -1).slice(0, 8)}01`;
  const m2 = `${addDias(mPrev, -1).slice(0, 8)}01`;
  const sets = {};

  sets.UserTablesMD = SCHEMA.tables.map((t) => ({ ...t }));
  sets.UserFieldsMD = [];
  for (const [t, fs] of Object.entries(SCHEMA.fields)) fs.forEach((f, i) => sets.UserFieldsMD.push({ ...fieldMD(t, f), FieldID: i }));
  sets.UserObjectsMD = SCHEMA.udos.map((u) => ({ ...u }));

  sets.BusinessPartners = [
    ['C0001', 'Construtora Horizonte Ltda', '12.345.678/0001-90', 'financeiro@horizonte.example'],
    ['C0002', 'Mineração Serra Azul S.A.', '23.456.789/0001-01', 'contas@serraazul.example'],
    ['C0003', 'Transportes Rota Sul Ltda', '34.567.890/0001-12', 'fiscal@rotasul.example'],
    ['C0004', 'Agro Vale Verde Ltda', '45.678.901/0001-23', 'adm@valeverde.example'],
    ['C0005', 'Eventos Prime Montagens ME', '56.789.012/0001-34', 'contato@prime.example'],
  ].map(([CardCode, CardName, FederalTaxID, EmailAddress]) => ({ CardCode, CardName, FederalTaxID, EmailAddress, CardType: 'cCustomer', Valid: 'tYES',
    BPAddresses: [{ AddressName: 'COBRANCA', AddressType: 'bo_BillTo', Street: 'Endereço de cobrança', City: 'Belo Horizonte', State: 'MG' }] }));
  // Endereços de entrega (obras) cadastrados no parceiro de negócio do B1
  sets.BusinessPartners[0].BPAddresses.push({ AddressName: 'OBRA PARQUE DAS AGUAS', AddressType: 'bo_ShipTo', Street: 'Av. das Águas, 1500', City: 'Contagem', State: 'MG' },
    { AddressName: 'OBRA CENTRO', AddressType: 'bo_ShipTo', Street: 'Rua da Bahia, 900', City: 'Belo Horizonte', State: 'MG' });
  sets.BusinessPartners[2].BPAddresses.push({ AddressName: 'BASE BETIM', AddressType: 'bo_ShipTo', Street: 'Rod. Fernão Dias, km 492', City: 'Betim', State: 'MG' });
  sets.BusinessPartners[3].BPAddresses.push({ AddressName: 'FAZENDA BOA VISTA', AddressType: 'bo_ShipTo', Street: 'Estrada Municipal, km 12', City: 'Unaí', State: 'MG' });

  sets.Items = [
    ['SLOC001', 'Locação de máquinas e equipamentos'],
    ['SLOC002', 'Locação de veículos'],
    ['SLOC003', 'Locação de geradores e energia'],
    ['SLOC900', 'Repasse de multa de trânsito'],
    ['SLOC800', 'Serviço de manutenção e reparo'],
    ['PEC-0101', 'Filtro de óleo do motor'],
    ['PEC-0102', 'Óleo lubrificante 15W40 (litro)'],
    ['PEC-0210', 'Mangueira hidráulica 1/2"'],
    ['PEC-0305', 'Bateria 150 Ah'],
  ].map(([ItemCode, ItemName]) => ({ ItemCode, ItemName, SalesItem: 'tYES', Valid: 'tYES' }));

  // Itens dos bens (controlados por nº de série) — cada equipamento da frota é um nº de série no B1
  const BENS = [['BEM-RETRO', 'Retroescavadeira'], ['BEM-ESCAV', 'Escavadeira hidráulica'], ['BEM-MINI', 'Minicarregadeira'], ['BEM-GER', 'Gerador'],
    ['BEM-PLAT', 'Plataforma elevatória'], ['BEM-PICAPE', 'Picape'], ['BEM-CAM', 'Caminhão leve'], ['BEM-UTIL', 'Utilitário leve']];
  sets.Items.push(...BENS.map(([ItemCode, ItemName]) => ({ ItemCode, ItemName, SalesItem: 'tYES', InventoryItem: 'tYES', ManageSerialNumbers: 'tYES', Valid: 'tYES' })));

  sets.BusinessPlaces = [{ BPLID: 1, BPLName: 'Matriz — Contagem/MG', DefaultWarehouseID: '01' }, { BPLID: 2, BPLName: 'Filial — Betim/MG', DefaultWarehouseID: '02' }];
  sets.Warehouses = [['01', 'Pátio Contagem'], ['02', 'Pátio Betim'], ['LOC', 'Equipamentos em clientes'], ['MAN', 'Oficina / manutenção']]
    .map(([WarehouseCode, WarehouseName]) => ({ WarehouseCode, WarehouseName }));
  sets.NotaFiscalUsage = [[9, 'Locação de bens móveis'], [12, 'Remessa de bem em locação'], [13, 'Retorno de bem locado'], [15, 'Serviço e peças de assistência']]
    .map(([ID, Usage]) => ({ ID, Usage, Description: Usage }));
  sets.PaymentTermsTypes = [[-1, 'À vista'], [1, '30 dias'], [2, '28/56 dias']].map(([GroupNumber, PaymentTermsGroupName]) => ({ GroupNumber, PaymentTermsGroupName }));
  sets.WizardPaymentMethods = [['BOLETO-ITAU', 'Boleto Itaú', 'boptIncoming'], ['BOLETO-BB', 'Boleto Banco do Brasil', 'boptIncoming'], ['DEPOSITO', 'Depósito em conta', 'boptIncoming'],
    ['TED-FORN', 'TED fornecedores', 'boptOutgoing']].map(([PaymentMethodCode, Description, Type]) => ({ PaymentMethodCode, Description, Type, Active: 'tYES' }));
  sets.SalesPersons = [[-1, '-Nenhum vendedor-'], [1, 'Ana Paula Rocha'], [2, 'Roberto Dias']].map(([SalesEmployeeCode, SalesEmployeeName]) => ({ SalesEmployeeCode, SalesEmployeeName, Active: 'tYES' }));
  sets.Projects = [['OBRA-PQAGUAS', 'Residencial Parque das Águas'], ['FROTA-ROTASUL', 'Frota Rota Sul']].map(([Code, Name]) => ({ Code, Name, Active: 'tYES' }));
  sets.EmployeesInfo = [[11, 'Rafael', 'Moreira'], [12, 'Juliana', 'Costa'], [13, 'Marcos', 'Tavares'], [14, 'Paulo', 'Lima']]
    .map(([EmployeeID, FirstName, LastName]) => ({ EmployeeID, FirstName, LastName, Active: 'tYES' }));
  sets.ServiceCallStatus = [[-3, 'Aberto'], [-2, 'Pendente'], [-1, 'Fechado']].map(([StatusId, Name]) => ({ StatusId, Name }));
  sets.ServiceCallTypes = [[1, 'Manutenção corretiva'], [2, 'Manutenção preventiva'], [3, 'Reclamação / qualidade']].map(([CallTypeID, Name]) => ({ CallTypeID, Name }));
  sets.ServiceCallOrigins = [[1, 'Telefone'], [2, 'E-mail'], [3, 'WhatsApp'], [4, 'Portal do cliente']].map(([OriginID, Name]) => ({ OriginID, Name }));
  sets.ServiceCallProblemTypes = [[1, 'Mecânico'], [2, 'Elétrico'], [3, 'Hidráulico'], [4, 'Avaria / mau uso']].map(([ProblemTypeID, Name]) => ({ ProblemTypeID, Name }));
  sets.ActivityTypes = [[1, 'Visita técnica'], [2, 'Ligação']].map(([Code, Name]) => ({ Code, Name }));
  sets.ServiceCalls = [];
  sets.Activities = [];
  sets.DeliveryNotes = [];
  sets.Returns = [];
  sets.StockTransfers = [];

  sets.U_SPS_LFAM = [
    ['RETRO', 'Retroescavadeiras', 'EQP', 'linha amarela, diesel'],
    ['ESCAV', 'Escavadeiras hidráulicas', 'EQP', 'linha amarela, diesel, esteira'],
    ['MINICAR', 'Minicarregadeiras', 'EQP', 'linha amarela, diesel'],
    ['GERADOR', 'Geradores', 'EQP', 'energia, diesel'],
    ['PLAT', 'Plataformas elevatórias', 'EQP', 'acesso, elétrica'],
    ['PICAPE', 'Picapes', 'VEI', '4x4, diesel'],
    ['UTIL', 'Utilitários leves', 'VEI', 'flex'],
    ['CAMINHAO', 'Caminhões leves', 'VEI', 'diesel'],
  ].map(([Code, Name, U_Tipo, U_Caract]) => ({ Code, Name, U_Tipo, U_Caract }));

  sets.SPSLREG = [
    { Code: 'MENSAL', Name: 'Mensal por item (pró-rata linear)', U_Tipo: 'ITEM', U_ProRata: 'LIN', U_FranqProp: 'S', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' },
    { Code: 'MENSAL-TAB', Name: 'Mensal por item (tabela em %)', U_Tipo: 'ITEM', U_ProRata: 'PCT', U_FranqProp: 'S', U_Toler: 5, U_MesesNF: '',
      U_Tabela: JSON.stringify([{ ate: 5, valor: 25 }, { ate: 10, valor: 40 }, { ate: 15, valor: 50 }, { ate: 20, valor: 70 }, { ate: 25, valor: 85 }, { ate: 31, valor: 100 }]) },
    { Code: 'DIARIA', Name: 'Diárias com teto mensal', U_Tipo: 'ITEM', U_ProRata: 'DIA', U_FranqProp: 'S', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' },
    { Code: 'FROTA', Name: 'Frota agrupada', U_Tipo: 'AGRUP', U_ProRata: 'LIN', U_FranqProp: 'S', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' },
    { Code: 'CONSUMO', Name: 'Por consumo (sem mensalidade)', U_Tipo: 'CONS', U_ProRata: 'LIN', U_FranqProp: 'N', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' },
    { Code: 'COMODATO', Name: 'Sem cobrança (comodato)', U_Tipo: 'SEM', U_ProRata: 'LIN', U_FranqProp: 'N', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]' },
  ];

  const ITEM_BEM = { RETRO: 'BEM-RETRO', ESCAV: 'BEM-ESCAV', MINICAR: 'BEM-MINI', GERADOR: 'BEM-GER', PLAT: 'BEM-PLAT', PICAPE: 'BEM-PICAPE', CAMINHAO: 'BEM-CAM', UTIL: 'BEM-UTIL' };
  const A = (Code, Name, U_Tipo, U_Familia, U_Categoria, U_ItemCode, o) => ({
    Code, Name, U_Tipo, U_Familia, U_Categoria, U_ItemCode, U_Status: 'DIS', U_CtrAtual: 0, U_Filial: 1, U_Versao: 0, U_ItemBem: ITEM_BEM[U_Familia] || '',
    ...o, U_Serie: o.U_Serie || o.U_Chassi || '', U_VlrBem: (o.U_ValorMes || 0) * 30,
  });
  sets.SPSLATV = [
    A('EQP-0001', 'Retroescavadeira JCB 3CX', 'EQP', 'RETRO', 'Linha amarela', 'SLOC001', { U_Serie: 'JCB3CX-778812', U_Marca: 'JCB', U_Modelo: '3CX', U_Ano: '2021', U_Medidor: 4520, U_ValorMes: 18000, U_ValorDia: 900, U_Status: 'LOC', U_CtrAtual: 1 }),
    A('EQP-0002', 'Escavadeira hidráulica CAT 320', 'EQP', 'ESCAV', 'Linha amarela', 'SLOC001', { U_Serie: 'CAT320-55120', U_Marca: 'Caterpillar', U_Modelo: '320', U_Ano: '2022', U_Medidor: 2210, U_ValorMes: 32000, U_ValorDia: 1600 }),
    A('EQP-0003', 'Minicarregadeira Bobcat S450', 'EQP', 'MINICAR', 'Linha amarela', 'SLOC001', { U_Serie: 'BOB-S450-1192', U_Marca: 'Bobcat', U_Modelo: 'S450', U_Ano: '2020', U_Medidor: 3105, U_ValorMes: 9500, U_ValorDia: 480 }),
    A('EQP-0004', 'Gerador 180 kVA Cummins', 'EQP', 'GERADOR', 'Energia', 'SLOC003', { U_Serie: 'CUM-C180-3341', U_Marca: 'Cummins', U_Modelo: 'C180D6', U_Ano: '2023', U_Medidor: 860, U_ValorMes: 7800, U_ValorDia: 390, U_Status: 'LOC', U_CtrAtual: 1 }),
    A('EQP-0005', 'Plataforma tesoura Genie GS-1932', 'EQP', 'PLAT', 'Acesso e elevação', 'SLOC001', { U_Serie: 'GS1932-88310', U_Marca: 'Genie', U_Modelo: 'GS-1932', U_Ano: '2019', U_Medidor: 1290, U_ValorMes: 4200, U_ValorDia: 210, U_Status: 'MAN' }),
    A('EQP-0006', 'Escavadeira hidráulica CAT 320 (2)', 'EQP', 'ESCAV', 'Linha amarela', 'SLOC001', { U_Serie: 'CAT320-55988', U_Marca: 'Caterpillar', U_Modelo: '320', U_Ano: '2023', U_Medidor: 940, U_ValorMes: 32000, U_ValorDia: 1600 }),
    A('VEI-0001', 'Picape Toyota Hilux CD 4x4', 'VEI', 'PICAPE', 'Picapes', 'SLOC002', { U_Placa: 'ABC1D23', U_Chassi: '9BRBA3HE0P0123456', U_Renavam: '01234567890', U_Marca: 'Toyota', U_Modelo: 'Hilux CD SRV', U_Ano: '2024', U_Medidor: 48210, U_ValorMes: 6500, U_ValorDia: 320, U_Status: 'LOC', U_CtrAtual: 2 }),
    A('VEI-0002', 'Picape Ford Ranger XLS', 'VEI', 'PICAPE', 'Picapes', 'SLOC002', { U_Placa: 'EFG4H56', U_Chassi: '8AFAR22N7PJ654321', U_Renavam: '09876543210', U_Marca: 'Ford', U_Modelo: 'Ranger XLS', U_Ano: '2024', U_Medidor: 31200, U_ValorMes: 6200, U_ValorDia: 300, U_Status: 'LOC', U_CtrAtual: 2 }),
    A('VEI-0003', 'Caminhão VW Delivery 11.180', 'VEI', 'CAMINHAO', 'Caminhões', 'SLOC002', { U_Placa: 'IJK7L89', U_Chassi: '9535N8243PR112233', U_Renavam: '11223344556', U_Marca: 'Volkswagen', U_Modelo: 'Delivery 11.180', U_Ano: '2023', U_Medidor: 81500, U_ValorMes: 9800, U_ValorDia: 490 }),
    A('VEI-0004', 'Fiat Strada Freedom CS', 'VEI', 'UTIL', 'Utilitários leves', 'SLOC002', { U_Placa: 'MNO1P23', U_Chassi: '9BD281A2DRY998877', U_Renavam: '22334455667', U_Marca: 'Fiat', U_Modelo: 'Strada Freedom', U_Ano: '2024', U_Medidor: 22340, U_ValorMes: 3200, U_ValorDia: 160 }),
  ];

  // Números de série no B1: os da frota já cadastrada e dois equipamentos novos que ainda não estão no Áster
  sets.SerialNumberDetails = [
    ...sets.SPSLATV.map((a) => ({ ItemCode: a.U_ItemBem, ItemDescription: a.Name, SerialNumber: a.U_Serie, MfrSerialNo: a.U_Serie, Status: 0 })),
    { ItemCode: 'BEM-GER', ItemDescription: 'Gerador 260 kVA Stemac', SerialNumber: 'STM-260-77801', MfrSerialNo: 'STM-260-77801', Status: 0 },
    { ItemCode: 'BEM-PLAT', ItemDescription: 'Plataforma articulada JLG 450AJ', SerialNumber: 'JLG450-31877', MfrSerialNo: 'JLG450-31877', Status: 0 },
  ].map((x, i) => ({ DocEntry: i + 1, ...x }));

  const L = (o) => ({ U_Familia: '', U_Ativo: '', U_AtvDesc: '', U_ItemCode: '', U_Regra: 'MENSAL', U_Grupo: '', U_Valor: 0, U_Diaria: 0, U_Franquia: 0,
    U_VlrExced: 0, U_DtSaida: null, U_DtDevol: null, U_Condutor: '', U_Local: '', U_StatusL: 'PEN', ...o });
  sets.SPSLCTR = [
    { DocEntry: 1, DocNum: 1, U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda', U_Tipo: 'LOC', U_DtInicio: m2, U_DtFim: addDias(m2, 365), U_DtCorte: null,
      U_DiaFat: 5, U_Status: 'ATV', U_Filial: 1, U_Obra: 'Residencial Parque das Águas — Contagem/MG', U_Indice: 'IGP-M', U_ModoFat: 'RAS',
      U_Email: 'financeiro@horizonte.example', U_Obs: '', U_Versao: 0, U_EndEntrega: 'OBRA PARQUE DAS AGUAS', U_SlpCode: 1, U_CondPgto: 1, U_Projeto: 'OBRA-PQAGUAS',
      [LN]: [
        L({ LineId: 1, U_Familia: 'RETRO', U_Ativo: 'EQP-0001', U_AtvDesc: 'Retroescavadeira JCB 3CX', U_ItemCode: 'SLOC001', U_Valor: 18000, U_Diaria: 900, U_Franquia: 200, U_VlrExced: 95, U_DtSaida: m2, U_StatusL: 'LOC' }),
        L({ LineId: 2, U_Familia: 'GERADOR', U_Ativo: 'EQP-0004', U_AtvDesc: 'Gerador 180 kVA Cummins', U_ItemCode: 'SLOC003', U_Regra: 'MENSAL-TAB', U_Valor: 7800, U_Diaria: 390, U_Franquia: 300, U_VlrExced: 30, U_DtSaida: addDias(mPrev, 9), U_StatusL: 'LOC' }),
      ],
      [GR]: [] },
    { DocEntry: 2, DocNum: 2, U_CardCode: 'C0003', U_CardName: 'Transportes Rota Sul Ltda', U_Tipo: 'LOC', U_DtInicio: addDias(mPrev, 14), U_DtFim: addDias(h, 20), U_DtCorte: null,
      U_DiaFat: 15, U_Status: 'ATV', U_Filial: 1, U_Obra: 'Base operacional — Betim/MG', U_Indice: 'IPCA', U_ModoFat: 'PRE',
      U_Email: 'fiscal@rotasul.example', U_Obs: '', U_Versao: 0, U_EndEntrega: 'BASE BETIM', U_SlpCode: 2, U_CondPgto: 2, U_Projeto: 'FROTA-ROTASUL',
      [LN]: [
        L({ LineId: 1, U_Familia: 'PICAPE', U_Ativo: 'VEI-0001', U_AtvDesc: 'Picape Toyota Hilux CD 4x4', U_ItemCode: 'SLOC002', U_Regra: 'FROTA', U_Grupo: 'G1', U_DtSaida: addDias(mPrev, 14), U_Condutor: 'Carlos A. Souza — CNH 01234567890', U_StatusL: 'LOC' }),
        L({ LineId: 2, U_Familia: 'PICAPE', U_Ativo: 'VEI-0002', U_AtvDesc: 'Picape Ford Ranger XLS', U_ItemCode: 'SLOC002', U_Regra: 'FROTA', U_Grupo: 'G1', U_DtSaida: addDias(mPrev, 14), U_Condutor: 'Paula R. Lima — CNH 98765432100', U_StatusL: 'LOC' }),
        L({ LineId: 3, U_Familia: 'CAMINHAO', U_Ativo: 'VEI-0003', U_AtvDesc: 'Caminhão VW Delivery 11.180', U_ItemCode: 'SLOC002', U_Regra: 'FROTA', U_Grupo: 'G1' }),
      ],
      [GR]: [{ LineId: 1, U_Grupo: 'G1', U_Descr: 'Frota Rota Sul — 3 veículos', U_Regra: 'FROTA', U_ItemCode: 'SLOC002', U_Valor: 15000, U_Diaria: 0, U_Franquia: 9000, U_VlrExced: 0.8 }] },
    { DocEntry: 3, DocNum: 3, U_CardCode: 'C0002', U_CardName: 'Mineração Serra Azul S.A.', U_Tipo: 'LOC', U_DtInicio: addDias(h, 7), U_DtFim: addDias(h, 187), U_DtCorte: null,
      U_DiaFat: 1, U_Status: 'RAS', U_Filial: 1, U_Obra: 'Mina Córrego Fundo — Itabirito/MG', U_Indice: 'IPCA', U_ModoFat: 'FAT',
      U_Email: 'contas@serraazul.example', U_Obs: 'Aguardando aprovação de crédito.', U_Versao: 0,
      [LN]: [L({ LineId: 1, U_Familia: 'ESCAV', U_AtvDesc: 'Escavadeira hidráulica (família)', U_ItemCode: 'SLOC001', U_Regra: 'DIARIA', U_Valor: 32000, U_Diaria: 1600, U_Franquia: 0 })],
      [GR]: [] },
  ];
  sets.SPSLMOV = [];

  const mp = compDe(mPrev);
  const med = (Code, ctr, line, ativo, ini, fim) => ({ Code, Name: Code, U_CtrEntry: ctr, U_CtrLine: line, U_Ativo: ativo, U_Comp: mp, U_Data: addDias(m0, -1),
    U_LeitIni: ini, U_LeitFim: fim, U_Abat: 0, U_Origem: 'MAN' });
  sets.U_SPS_LMED = [
    med('seed-1', 1, 1, 'EQP-0001', 4280, 4520), med('seed-2', 1, 2, 'EQP-0004', 640, 860),
    med('seed-3', 2, 1, 'VEI-0001', 44710, 48210), med('seed-4', 2, 2, 'VEI-0002', 27000, 31200),
  ];
  sets.U_SPS_LFAT = [];
  sets.U_SPS_LMUL = [{
    Code: 'M-seed-1', Name: 'AIT A12345678', U_Ativo: 'VEI-0001', U_Placa: 'ABC1D23', U_DtInfr: addDias(mPrev, 20), U_HrInfr: '14:32', U_AIT: 'A12345678',
    U_Descricao: 'Excesso de velocidade até 20%', U_Valor: 130.16, U_CtrEntry: 2, U_CtrLine: 1, U_CardName: 'Transportes Rota Sul Ltda',
    U_Condutor: 'Carlos A. Souza — CNH 01234567890', U_Status: 'REP', U_Comp: '',
  }];
  sets.U_SPS_LCFG = Object.entries({ ...CFG_DEFAULTS, EMPRESA: 'Locadora Demonstração Ltda', ITEM_MULTA: 'SLOC900', SCHEMA_VERSION: String(SCHEMA_VERSION),
    // de-para da demonstração com os cadastros nativos simulados
    USAGE: '9', B1_FILIAL: '1', B1_USAGE_SRV: '15', B1_USAGE_REM: '12', B1_USAGE_RET: '13', B1_FORMA_PGTO: 'BOLETO-ITAU', B1_COND_PGTO: '1',
    B1_REMESSA: 'NF', B1_DEP_PATIO: '01', B1_DEP_LOCACAO: 'LOC', PV_SERVICECALL: 'S', PV_CALL_TIPO: '1', PV_CALL_ORIGEM: '1', PV_CALL_PROBLEMA: '1',
    PV_ATIVIDADE: 'S', PV_ATV_TIPO: '1' })
    .map(([Code, v]) => ({ Code, Name: Code, U_Valor: v }));

  /* ---- pós-venda ---- */
  const t0 = agora();
  const dt = (dias, hora) => `${addDias(h, dias)}T${hora}`;
  sets.U_SPS_LTEC = [
    ['T01', 'Rafael Moreira', 'tecnico', '(31) 98811-2030', 'Linha amarela e hidráulica'],
    ['T02', 'Juliana Costa', '', '(31) 99702-4411', 'Veículos e elétrica'],
    ['T03', 'Marcos Tavares', '', '(31) 98455-7781', 'Geradores e plataformas'],
  ].map(([Code, Name, U_Login, U_Fone, U_Especial], i) => ({ Code, Name, U_Login, U_Fone, U_Email: '', U_Especial, U_Filial: 1, U_Ativo: 'S', U_EmpID: 11 + i }));

  const P = (Code, Name, U_Familia, U_IntMed, U_IntDias, chk) => ({ Code, Name, U_Familia, U_IntMed, U_IntDias, U_Aviso: 10, U_Checklist: chk.join('\n'), U_Ativo: 'S' });
  const chkDiesel = ['Troca de óleo do motor', 'Troca do filtro de óleo', 'Filtro de ar', 'Filtro de combustível', 'Nível do óleo hidráulico', 'Graxa nos pinos e articulações', 'Teste de funcionamento'];
  const chkVei = ['Troca de óleo e filtro', 'Freios', 'Pneus e alinhamento', 'Suspensão', 'Luzes e parte elétrica', 'Teste de rodagem'];
  sets.U_SPS_LPLN = [
    P('PRE-RETRO-250', 'Retroescavadeira — 250 h', 'RETRO', 250, 180, chkDiesel),
    P('PRE-ESCAV-250', 'Escavadeira — 250 h', 'ESCAV', 250, 180, chkDiesel),
    P('PRE-MINI-250', 'Minicarregadeira — 250 h', 'MINICAR', 250, 180, chkDiesel),
    P('PRE-GER-250', 'Gerador — 250 h ou 90 dias', 'GERADOR', 250, 90, ['Troca de óleo e filtros', 'Bateria e carregador', 'Líquido de arrefecimento', 'Teste com carga']),
    P('PRE-PLAT-180', 'Plataforma — semestral', 'PLAT', 0, 180, ['Baterias', 'Sistema hidráulico', 'Dispositivos de segurança', 'Teste de elevação']),
    P('PRE-PICAPE-10K', 'Picape — 10.000 km', 'PICAPE', 10000, 180, chkVei),
    P('PRE-CAM-10K', 'Caminhão — 10.000 km', 'CAMINHAO', 10000, 180, chkVei),
  ];

  const chk = (itens) => JSON.stringify(Object.fromEntries(itens.map((i) => [i, { r: 'OK' }])));
  const I = (LineId, U_Tipo, U_ItemCode, U_Descr, U_Qtd, U_Preco, U_Cobrar) => ({ LineId, U_Tipo, U_ItemCode, U_Descr, U_Qtd, U_Preco, U_Cobrar });
  const O = (o) => ({ U_Prior: 'MED', U_Email: '', U_CtrLine: 0, U_ChaEntry: 0, U_MovEntry: 0, U_Plano: '', U_HrAgenda: '08:00', U_Duracao: 120, U_Local: '',
    U_Descricao: '', U_Laudo: '', U_CheckIn: '', U_CheckOut: '', U_Medidor: 0, U_Checklist: '{}', U_Fotos: '[]', U_Respons: '', U_DocResp: '', U_Assinatura: '',
    U_Parada: 'N', U_DtParada: null, U_ForaCode: '', U_Orc: '', U_OrcAprov: '', U_Valor: 0, U_DocType: '', U_DocEntry: 0, U_DocNum: 0, U_Filial: 1,
    U_Usuario: 'admin', U_Versao: 0, [OS1]: [], ...o });
  sets.SPSLOS = [
    O({ DocEntry: 1, DocNum: 1, U_Tipo: 'PRE', U_Status: 'CON', U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda', U_CtrEntry: 1, U_CtrLine: 1,
      U_Ativo: 'EQP-0001', U_Plano: 'PRE-RETRO-250', U_Tecnico: 'T01', U_DtAgenda: addDias(h, -40), U_Local: 'Residencial Parque das Águas — Contagem/MG',
      U_Descricao: 'Preventiva de 250 h.', U_Laudo: 'Revisão completa. Sem anomalias.', U_CheckIn: dt(-40, '08:10'), U_CheckOut: dt(-40, '10:05'), U_Medidor: 4300,
      U_Checklist: chk(chkDiesel), U_Respons: 'Eng. Paulo Mendes',
      [OS1]: [I(1, 'PEC', 'PEC-0101', 'Filtro de óleo do motor', 1, 89.9, 'N'), I(2, 'PEC', 'PEC-0102', 'Óleo lubrificante 15W40 (litro)', 18, 32.5, 'N')] }),
    O({ DocEntry: 2, DocNum: 2, U_Tipo: 'PRE', U_Status: 'CON', U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda', U_CtrEntry: 1, U_CtrLine: 2,
      U_Ativo: 'EQP-0004', U_Plano: 'PRE-GER-250', U_Tecnico: 'T03', U_DtAgenda: addDias(h, -60), U_Descricao: 'Preventiva de 250 h.', U_Laudo: 'Troca de óleo e filtros.',
      U_CheckIn: dt(-60, '13:00'), U_CheckOut: dt(-60, '14:20'), U_Medidor: 600, U_Respons: 'Eng. Paulo Mendes' }),
    O({ DocEntry: 3, DocNum: 3, U_Tipo: 'COR', U_Status: 'AGE', U_Prior: 'URG', U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda',
      U_Email: 'financeiro@horizonte.example', U_CtrEntry: 1, U_CtrLine: 2, U_Ativo: 'EQP-0004', U_ChaEntry: 1, U_Tecnico: 'T03', U_DtAgenda: h, U_HrAgenda: '14:00',
      U_Local: 'Residencial Parque das Águas — Contagem/MG', U_Descricao: 'Gerador não parte. Painel indica falha de bateria.', U_Parada: 'S', U_DtParada: h,
      U_ForaCode: 'F-seed-1' }),
    O({ DocEntry: 4, DocNum: 4, U_Tipo: 'VIS', U_Status: 'CON', U_CardCode: 'C0003', U_CardName: 'Transportes Rota Sul Ltda', U_Email: 'fiscal@rotasul.example',
      U_CtrEntry: 2, U_CtrLine: 1, U_Ativo: 'VEI-0001', U_Tecnico: 'T02', U_DtAgenda: addDias(h, -10), U_Descricao: 'Vistoria trimestral da frota.',
      U_Laudo: 'Veículo em bom estado. Pneus com 60% de vida útil.', U_CheckIn: dt(-10, '09:00'), U_CheckOut: dt(-10, '09:40'), U_Medidor: 47800, U_Respons: 'Carlos A. Souza' }),
    O({ DocEntry: 5, DocNum: 5, U_Tipo: 'COR', U_Status: 'CON', U_Prior: 'ALT', U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda',
      U_Email: 'financeiro@horizonte.example', U_CtrEntry: 1, U_CtrLine: 1, U_Ativo: 'EQP-0001', U_ChaEntry: 3, U_Tecnico: 'T01', U_DtAgenda: addDias(h, -5),
      U_Descricao: 'Vazamento de óleo no braço da retro.', U_Laudo: 'Mangueira do cilindro do braço rompida por desgaste. Substituída.', U_CheckIn: dt(-5, '10:00'),
      U_CheckOut: dt(-5, '12:30'), U_Medidor: 4495, U_Respons: 'Eng. Paulo Mendes',
      [OS1]: [I(1, 'PEC', 'PEC-0210', 'Mangueira hidráulica 1/2"', 2, 145, 'N'), I(2, 'SRV', 'SLOC800', 'Mão de obra técnica', 2.5, 180, 'N')] }),
  ];
  sets.U_SPS_LFORA = [{ Code: 'F-seed-1', Name: 'F-seed-1', U_CtrEntry: 1, U_CtrLine: 2, U_Ativo: 'EQP-0004', U_Ini: h, U_Fim: null, U_Motivo: 'Parado — OS 3' }];

  const C = (o) => ({ U_Contato: '', U_Fone: '', U_Email: '', U_CtrEntry: 0, U_Ativo: '', U_Origem: 'TEL', U_Prior: 'MED', U_Parado: 'N', U_DtResp: '', U_DtSol: '',
    U_Respons: '', U_OsEntry: 0, U_Filial: 1, U_Versao: 0, [CH1]: [], ...o });
  const ab1 = addHoras(t0, -3);
  const ab2 = addHoras(t0, -26);
  const ab3 = `${addDias(h, -6)}T16:20`;
  sets.SPSLCHA = [
    C({ DocEntry: 1, DocNum: 1, U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda', U_Contato: 'Eng. Paulo Mendes', U_Fone: '(31) 3333-1020',
      U_Email: 'financeiro@horizonte.example', U_CtrEntry: 1, U_Ativo: 'EQP-0004', U_Tipo: 'PAR', U_Prior: 'URG', U_Status: 'AND', U_Parado: 'S',
      U_Assunto: 'Gerador parado na obra', U_Descricao: 'Gerador não dá partida desde a manhã. Obra sem energia no canteiro.', U_Abertura: ab1,
      U_PrazoResp: addHoras(ab1, 1), U_PrazoSol: addHoras(ab1, 8), U_DtResp: addHoras(ab1, 0.5), U_Respons: 'admin', U_OsEntry: 3,
      [CH1]: [{ LineId: 1, U_Data: addHoras(ab1, 0.5), U_Usuario: 'admin', U_Texto: 'Técnico Marcos agendado para hoje às 14h. Parada registrada para desconto.', U_Publico: 'S' }] }),
    C({ DocEntry: 2, DocNum: 2, U_CardCode: 'C0003', U_CardName: 'Transportes Rota Sul Ltda', U_Contato: 'Carlos A. Souza', U_Fone: '(31) 98100-2233',
      U_Email: 'fiscal@rotasul.example', U_CtrEntry: 2, U_Ativo: 'VEI-0002', U_Tipo: 'MAN', U_Origem: 'WPP', U_Status: 'ABE',
      U_Assunto: 'Luz de injeção acesa na Ranger', U_Descricao: 'Luz da injeção acendeu na estrada. Veículo rodando normalmente.', U_Abertura: ab2,
      U_PrazoResp: addHoras(ab2, 4), U_PrazoSol: addHoras(ab2, 48) }),
    C({ DocEntry: 3, DocNum: 3, U_CardCode: 'C0001', U_CardName: 'Construtora Horizonte Ltda', U_Contato: 'Eng. Paulo Mendes', U_Email: 'financeiro@horizonte.example',
      U_CtrEntry: 1, U_Ativo: 'EQP-0001', U_Tipo: 'MAN', U_Prior: 'ALT', U_Status: 'FEC', U_Assunto: 'Vazamento de óleo na retroescavadeira',
      U_Descricao: 'Operador viu óleo pingando no braço.', U_Abertura: ab3, U_PrazoResp: addHoras(ab3, 2), U_PrazoSol: addHoras(ab3, 24),
      U_DtResp: addHoras(ab3, 1), U_DtSol: dt(-5, '12:30'), U_Respons: 'admin', U_OsEntry: 5,
      [CH1]: [{ LineId: 1, U_Data: addHoras(ab3, 1), U_Usuario: 'admin', U_Texto: 'Técnico agendado para amanhã às 10h.', U_Publico: 'S' },
        { LineId: 2, U_Data: dt(-5, '12:30'), U_Usuario: 'admin', U_Texto: 'OS 5 concluída: mangueira substituída por desgaste, sem custo.', U_Publico: 'S' }] }),
  ];

  const S = (Code, os, cha, card, name, tec, dias, nota, com) => ({ Code, Name: Code, U_OsEntry: os, U_ChaEntry: cha, U_CardCode: card, U_CardName: name, U_Email: '',
    U_Tecnico: tec, U_Enviada: addDias(h, dias), U_Nota: nota, U_Comentario: com, U_Respondida: nota >= 0 ? dt(dias + 1, '09:12') : '' });
  sets.U_SPS_LINT = [];
  sets.U_SPS_LPES = [
    S('pesq-demo-a1', 4, 0, 'C0003', 'Transportes Rota Sul Ltda', 'T02', -10, 9, 'Vistoria rápida e bem explicada.'),
    S('pesq-demo-b2', 5, 3, 'C0001', 'Construtora Horizonte Ltda', 'T01', -5, 6, 'Resolveu, mas demorou para chegar.'),
    S('pesq-demo-c3', 1, 0, 'C0001', 'Construtora Horizonte Ltda', 'T01', -40, 10, ''),
  ];
  sets.Drafts = [];
  sets.Orders = [];
  sets.Invoices = [];

  return { sets, seq: { SPSLCTR: 3, SPSLMOV: 0, SPSLCHA: 3, SPSLOS: 5, Drafts: 0, Orders: 0, Invoices: 0, DeliveryNotes: 0, Returns: 0, StockTransfers: 0, ServiceCalls: 0, Activities: 0 } };
}
