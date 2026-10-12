// Banco interno do Áster Rental (SQLite embutido no Node). Guarda só o que não pertence ao B1:
// usuários, sessões, auditoria, tarefas em segundo plano e chaves de idempotência.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     login TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     email TEXT,
     password_hash TEXT NOT NULL,
     profile TEXT NOT NULL,
     b1_user TEXT,
     branches TEXT NOT NULL DEFAULT '[]',
     active INTEGER NOT NULL DEFAULT 1,
     failed_attempts INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     last_seen TEXT NOT NULL,
     ip TEXT,
     user_agent TEXT
   );
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
     user_login TEXT,
     action TEXT NOT NULL,
     entity TEXT NOT NULL,
     entity_id TEXT,
     before_json TEXT,
     after_json TEXT,
     ip TEXT,
     request_id TEXT
   );
   CREATE INDEX audit_entity ON audit(entity, entity_id);
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     status TEXT NOT NULL,
     payload TEXT,
     progress INTEGER NOT NULL DEFAULT 0,
     total INTEGER NOT NULL DEFAULT 0,
     result TEXT,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE idempotency (
     key TEXT PRIMARY KEY,
     user_login TEXT NOT NULL,
     status INTEGER NOT NULL,
     response TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
];

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
