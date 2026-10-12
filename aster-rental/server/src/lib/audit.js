// Trilha de auditoria (requisito SEG-14): quem, quando, de onde, valor antes e depois.
// Campos sensíveis ou volumosos são removidos antes de gravar (SEG-19).
const OMIT = new Set(['U_Assinatura', 'password', 'password_hash', 'Password']);

function clean(v) {
  if (v == null) return null;
  return JSON.stringify(v, (k, val) => (OMIT.has(k) ? '[omitido]' : val));
}

export function createAudit(db) {
  const stmt = db.prepare(
    'INSERT INTO audit (user_login, action, entity, entity_id, before_json, after_json, ip, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  return {
    record(req, { action, entity, id, before, after }) {
      stmt.run(req?.user?.login || 'sistema', action, entity, id == null ? null : String(id), clean(before), clean(after), req?.ip || '', req?.id || '');
    },
    list({ entity, id, user, limit = 200 } = {}) {
      const where = [];
      const args = [];
      if (entity) where.push('entity = ?') && args.push(entity);
      if (id) where.push('entity_id = ?') && args.push(String(id));
      if (user) where.push('user_login = ?') && args.push(user);
      return db
        .prepare(`SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
        .all(...args, Math.min(Number(limit) || 200, 1000));
    },
  };
}
