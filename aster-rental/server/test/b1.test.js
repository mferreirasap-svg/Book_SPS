// Testes da camada B1: filtros OData seguros, B1 simulado e leitura da resposta do $batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, eq, contains, and, or, lit } from '../src/b1/odata.js';
import { MockServiceLayer } from '../src/b1/mock.js';
import { parseBatchResponse } from '../src/b1/serviceLayer.js';

test('odata: aspas são escapadas e campos são validados', () => {
  assert.equal(lit("D'Ávila"), "'D''Ávila'");
  assert.equal(eq('CardName', "x' or 1 eq 1 or 'a"), "CardName eq 'x'' or 1 eq 1 or ''a'");
  assert.throws(() => eq('Card Name', 'x'));
  const q = query('Items', { filter: and(eq('A', 1), or(contains('B', 'x'), contains('C', 'y'))), top: 5 });
  assert.match(q, /^Items\?\$filter=/);
  assert.ok(!q.includes(' '));
});

test('mock: filtro, ordenação e paginação com nextLink', async () => {
  const sl = new MockServiceLayer({ seed: () => ({ sets: { X: Array.from({ length: 45 }, (_, i) => ({ Code: `C${String(i).padStart(2, '0')}`, U_N: i, Name: i % 2 ? "D'Ávila" : 'Outro' })) }, seq: {} }) });
  const all = await sl.getAll(query('X', { filter: and(eq('Name', "D'Ávila"), contains('Code', 'C')), orderby: 'U_N desc' }), { pageSize: 10 });
  assert.equal(all.length, 22);
  assert.equal(all[0].U_N, 43);
  const p = await sl.page(query('X', { top: 11, skip: 40 }), 10);
  assert.equal(p.value.length, 5);
});

test('mock: $batch desfaz tudo quando uma operação falha', async () => {
  const sl = new MockServiceLayer({ seed: () => ({ sets: { X: [{ Code: 'A', U_V: 1 }] }, seq: {} }) });
  await assert.rejects(sl.batch([
    { method: 'PATCH', path: "X('A')", body: { U_V: 2 } },
    { method: 'PATCH', path: "X('NAO-EXISTE')", body: { U_V: 3 } },
  ]));
  assert.equal((await sl.get("X('A')")).U_V, 1);
});

test('$batch real: sucesso e erro dentro do changeset', () => {
  const ok = ['--batchresponse_1', 'Content-Type: multipart/mixed;boundary=changesetresponse_1', '', '--changesetresponse_1',
    'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', 'HTTP/1.1 201 Created', 'Content-Type: application/json', '',
    '{"DocEntry":7}', '--changesetresponse_1', 'Content-Type: application/http', '', 'HTTP/1.1 204 No Content', '', '', '--changesetresponse_1--', '--batchresponse_1--'].join('\r\n');
  const r = parseBatchResponse(ok);
  assert.equal(r[0].body.DocEntry, 7);
  assert.equal(r[1].status, 204);
  const err = ['--batchresponse_1', 'Content-Type: application/http', '', 'HTTP/1.1 400 Bad Request', 'Content-Type: application/json', '',
    '{"error":{"code":-2028,"message":{"lang":"en-us","value":"No matching records found"}}}', '--batchresponse_1--'].join('\r\n');
  assert.throws(() => parseBatchResponse(err), /Registro não encontrado no SAP B1/);
});
