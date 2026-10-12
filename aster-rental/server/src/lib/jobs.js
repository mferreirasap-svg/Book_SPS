// Tarefas em segundo plano (ex.: faturamento em lote, requisito PER-05).
// O progresso fica no banco interno; a tela consulta /api/jobs/:id.
import { uid } from './util.js';

export function createJobs(db, log) {
  const upd = db.prepare("UPDATE jobs SET status = ?, progress = ?, total = ?, result = ?, updated_at = datetime('now') WHERE id = ?");
  return {
    start(type, { createdBy, payload, total = 0 }, worker) {
      const id = uid();
      db.prepare('INSERT INTO jobs (id, type, status, payload, total, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, type, 'running', JSON.stringify(payload || {}), total, createdBy || '');
      const results = [];
      const progress = (item) => {
        results.push(item);
        upd.run('running', results.length, total, JSON.stringify(results), id);
      };
      setImmediate(async () => {
        try {
          await worker(progress);
          upd.run('done', results.length, total, JSON.stringify(results), id);
        } catch (e) {
          log?.error?.(e);
          results.push({ ok: false, message: e.message });
          upd.run('failed', results.length, total, JSON.stringify(results), id);
        }
      });
      return id;
    },
    get(id) {
      const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      if (!j) return null;
      return { ...j, payload: JSON.parse(j.payload || '{}'), result: JSON.parse(j.result || '[]') };
    },
  };
}
