// Testes do motor de cobrança com os exemplos numéricos do documento de arquitetura (casos A a F).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularParcela, valorPeriodo, parseRule } from '../src/domain/billing/engine.js';
import { LN, GR } from '../src/b1/schema.js';

const regra = (Code, o = {}) => ({ Code, U_Tipo: 'ITEM', U_ProRata: 'LIN', U_FranqProp: 'S', U_Toler: 0, U_MesesNF: '', U_Tabela: '[]', ...o });
const linha = (o) => ({ LineId: 1, U_Ativo: 'EQP-1', U_ItemCode: 'SLOC', U_Regra: 'R', U_Grupo: '', U_Valor: 0, U_Diaria: 0, U_Franquia: 0, U_VlrExced: 0,
  U_DtSaida: '2026-09-01', U_DtDevol: null, ...o });
const contrato = (linhas, grupos = [], o = {}) => ({ DocEntry: 9, U_Tipo: 'LOC', U_DtInicio: '2026-01-01', U_DtFim: '2027-12-31', [LN]: linhas, [GR]: grupos, ...o });
const leitura = (line, ini, fim, comp = '202609') => ({ U_CtrLine: line, U_Comp: comp, U_LeitIni: ini, U_LeitFim: fim, U_Abat: 0 });
const total = (r, tipo) => r.linhas.filter((l) => !tipo || l.tipo === tipo).reduce((s, l) => s + l.total, 0);

test('A. por item: mensalidade + excedente da franquia', () => {
  const r = calcularParcela({
    contrato: contrato([linha({ U_Valor: 5000, U_Franquia: 200, U_VlrExced: 40 })]),
    regras: { R: regra('R') }, leituras: [leitura(1, 1000, 1230)], comp: '202609',
  });
  assert.equal(total(r, 'LOC'), 5000);
  assert.equal(total(r, 'EXC'), 1200);
  assert.equal(r.total, 6200);
});

test('B. agrupada: franquia conjunta, excedente e rateio por uso', () => {
  const ls = [
    linha({ LineId: 1, U_Ativo: 'ABC1D23', U_Grupo: 'G1' }),
    linha({ LineId: 2, U_Ativo: 'EFG4H56', U_Grupo: 'G1' }),
    linha({ LineId: 3, U_Ativo: 'IJK7L89', U_Grupo: 'G1' }),
  ];
  const g = [{ U_Grupo: 'G1', U_Descr: 'Frota', U_Regra: 'F', U_ItemCode: 'SLOC', U_Valor: 15000, U_Franquia: 9000, U_VlrExced: 0.8 }];
  const r = calcularParcela({
    contrato: contrato(ls, g), regras: { F: regra('F', { U_Tipo: 'AGRUP' }) },
    leituras: [leitura(1, 0, 3500), leitura(2, 0, 4200), leitura(3, 0, 2100)], comp: '202609',
  });
  assert.equal(r.total, 15640);
  const exc = r.linhas.find((l) => l.tipo === 'EXC');
  assert.equal(exc.qtd, 800);
  assert.deepEqual(exc.rateio.map((x) => x.valor), [228.57, 274.29, 137.14]);
});

test('C. por consumo: sem mensalidade', () => {
  const r = calcularParcela({
    contrato: contrato([linha({ U_VlrExced: 0.12 })]), regras: { R: regra('R', { U_Tipo: 'CONS', U_FranqProp: 'N' }) },
    leituras: [leitura(1, 10000, 18300)], comp: '202609',
  });
  assert.equal(r.total, 996);
});

test('D. pró-rata: linear, tabela em % e diárias (entrega dia 20, mês de 30 dias)', () => {
  const base = { U_Valor: 6000, U_Diaria: 300, U_DtSaida: '2026-09-20' };
  const tabela = JSON.stringify([{ ate: 10, valor: 40 }, { ate: 15, valor: 50 }, { ate: 31, valor: 100 }]);
  const calc = (o) => calcularParcela({ contrato: contrato([linha(base)]), regras: { R: regra('R', o) }, comp: '202609' }).total;
  assert.equal(calc({ U_ProRata: 'LIN' }), 2200);
  assert.equal(calc({ U_ProRata: 'PCT', U_Tabela: tabela }), 3000);
  assert.equal(calc({ U_ProRata: 'DIA' }), 3300);
  const r = calcularParcela({ contrato: contrato([linha({ ...base, U_Franquia: 200, U_VlrExced: 1 })]), regras: { R: regra('R') },
    leituras: [leitura(1, 0, 100)], comp: '202609' });
  assert.equal(r.linhas.find((l) => l.tipo === 'EXC').qtd, round(100 - 73.33));
});
const round = (n) => Math.round(n * 100) / 100;

test('E. tolerância: 8 dias em manutenção com tolerância de 5', () => {
  const r = calcularParcela({
    contrato: contrato([linha({ U_Valor: 6000 })]), regras: { R: regra('R', { U_Toler: 5 }) },
    foras: [{ U_CtrLine: 1, U_Ini: '2026-09-10', U_Fim: '2026-09-17' }], comp: '202609',
  });
  assert.equal(r.total, 5400);
});

test('F. meses não faturáveis e comodato', () => {
  const nf = calcularParcela({ contrato: contrato([linha({ U_Valor: 6000 })]), regras: { R: regra('R', { U_MesesNF: '1,9' }) }, comp: '202609' });
  assert.equal(nf.faturavel, false);
  assert.equal(nf.total, 0);
  const com = calcularParcela({ contrato: contrato([linha({ U_Valor: 6000 })], [], { U_Tipo: 'COM' }), regras: { R: regra('R') }, comp: '202609' });
  assert.equal(com.faturavel, false);
});

test('devolução: cobra até a véspera; substituição não cobra o dia duas vezes', () => {
  const r = calcularParcela({
    contrato: contrato([linha({ U_Valor: 3100, U_Franquia: 100, U_VlrExced: 10, U_DtSaida: '2026-01-10', U_DtDevol: '2026-01-21' })]),
    regras: { R: regra('R') }, leituras: [leitura(1, 0, 50, '202601')], comp: '202601',
  });
  assert.equal(total(r, 'LOC'), 1100); // 11 de 31 dias
  assert.equal(r.linhas.find((l) => l.tipo === 'EXC').qtd, 14.52); // 50 − 35,48
});

test('data de corte e vigência limitam o período', () => {
  const r = calcularParcela({ contrato: contrato([linha({ U_Valor: 3000 })], [], { U_DtCorte: '2026-09-16' }), regras: { R: regra('R') }, comp: '202609' });
  assert.equal(r.total, 1500); // 15 de 30 dias
});

test('multas a repassar entram como linha', () => {
  const r = calcularParcela({ contrato: contrato([linha({ U_Valor: 1000 })]), regras: { R: regra('R') }, comp: '202609', itemMulta: 'MULTA',
    multas: [{ Code: 'M1', U_Status: 'REP', U_CtrEntry: 9, U_Valor: 130.16, U_AIT: 'A1' }, { Code: 'M2', U_Status: 'PEN', U_CtrEntry: 9, U_Valor: 99 }] });
  assert.equal(r.total, 1130.16);
});

test('valorPeriodo: diárias limitadas à mensalidade', () => {
  const v = valorPeriodo(parseRule(regra('R', { U_ProRata: 'DIA' })), 3000, 400, 20, 30);
  assert.equal(v.valor, 3000);
});
