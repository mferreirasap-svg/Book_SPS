// Posições do celular dos técnicos (servidor: SQLite do Áster, nunca no SAP). Na demonstração, a mesma interface usa o navegador.
import { agora } from './util.js';

export function createPosicoes(db) {
  const ins = db.prepare('INSERT INTO posicoes (at, login, tecnico, lat, lon, precisao, os, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  return {
    registrar({ login, tecnico = '', lat, lon, precisao = null, os = null, origem = '', at = agora() }) {
      ins.run(at, login, tecnico, Number(lat), Number(lon), precisao == null ? null : Number(precisao), os == null ? null : Number(os), origem);
    },
    /** Última posição de cada técnico. */
    ultimas() {
      return db.prepare(`SELECT p.* FROM posicoes p JOIN (SELECT tecnico, MAX(id) id FROM posicoes WHERE tecnico <> '' GROUP BY tecnico) u ON u.id = p.id`).all();
    },
    doDia(tecnico, data) {
      return db.prepare('SELECT * FROM posicoes WHERE tecnico = ? AND substr(at, 1, 10) = ? ORDER BY id').all(tecnico, data);
    },
    limpar(dias) {
      const lim = new Date(Date.now() - Number(dias) * 864e5).toISOString().slice(0, 10);
      return db.prepare('DELETE FROM posicoes WHERE substr(at, 1, 10) < ?').run(lim).changes;
    },
  };
}
