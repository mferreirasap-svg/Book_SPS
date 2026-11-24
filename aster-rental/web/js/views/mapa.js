// Mapa da equipe: onde cada técnico registrou a última posição, as OS do dia com o endereço da obra e a rota sugerida.
// Desenho esquemático (sem serviço de mapas); o botão "Abrir rota" leva ao Google Maps com as paradas na ordem sugerida.
import { esc, fmtDT, DOM, badge, hoje, num } from '../util.js';
import { get, qs } from '../api.js';
import { filtro } from '../state.js';

const CORES = ['#1F6FB2', '#C25113', '#2E7D4F', '#7B3FA0', '#B8860B', '#0E7C86'];
const MODO = { NAO: 'não registra localização', OS: 'registra só no início e no fim de cada OS', EXP: 'registra durante o expediente (técnico em serviço)' };

export async function render(root, _p, c) {
  const f = filtro('mapa', { data: hoje() });
  const m = await get(`/geo/map${qs({ data: f.data })}`);
  const osPor = Object.fromEntries(m.os.map((o) => [o.DocEntry, o]));
  const pts = [...m.os.filter((o) => o.lat != null), ...m.tecnicos.filter((t) => t.ultima).map((t) => t.ultima), ...(m.base ? [m.base] : [])];
  const W = 800;
  const H = 520;
  let svg = '<p class="empty">Sem coordenadas para desenhar. Cadastre a latitude/longitude nos endereços de entrega dos clientes.</p>';
  if (pts.length) {
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const pad = 0.02;
    const [a0, a1] = [Math.min(...lats) - pad, Math.max(...lats) + pad];
    const [o0, o1] = [Math.min(...lons) - pad, Math.max(...lons) + pad];
    const k = Math.min((W - 60) / (o1 - o0), (H - 60) / (a1 - a0));
    const x = (lon) => 30 + (lon - o0) * k;
    const y = (lat) => H - 30 - (lat - a0) * k;
    const rotas = m.tecnicos.map((t, i) => {
      const ini = t.ultima || m.base;
      const seq = t.rota.map((r) => osPor[r.DocEntry]).filter(Boolean);
      if (!ini || !seq.length) return '';
      const d = [ini, ...seq].map((p, n) => `${n ? 'L' : 'M'}${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${CORES[i % CORES.length]}" stroke-width="2.5" stroke-dasharray="7 5" opacity=".8"/>`;
    }).join('');
    // Pontos no mesmo lugar (mesma obra): desloca o rótulo para não sobrepor.
    const vistos = {};
    const desloc = (o) => {
      const k = `${Math.round(x(o.lon) / 14)}:${Math.round(y(o.lat) / 14)}`;
      vistos[k] = (vistos[k] ?? -1) + 1;
      return vistos[k] * 15;
    };
    const corTec = (code) => CORES[Math.max(0, m.tecnicos.findIndex((t) => t.code === code)) % CORES.length];
    svg = `<svg class="mapa-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa esquemático da equipe">
      ${m.base ? `<g><rect x="${x(m.base.lon) - 9}" y="${y(m.base.lat) - 9}" width="18" height="18" fill="#2E3B43" rx="3"/><text x="${x(m.base.lon) + 14}" y="${y(m.base.lat) + 5}" font-size="13" fill="#2E3B43">Base</text></g>` : ''}
      ${rotas}
      ${m.os.filter((o) => o.lat != null).map((o) => {
        const dy = desloc(o);
        return `<g><circle cx="${x(o.lon)}" cy="${y(o.lat) + dy * 1.6}" r="11" fill="${o.status === 'CON' ? '#9AA5AC' : corTec(o.tecnico)}" stroke="#fff" stroke-width="2"/>
        <text x="${x(o.lon)}" y="${y(o.lat) + 4 + dy * 1.6}" font-size="10" text-anchor="middle" fill="#fff" font-weight="700">${o.DocNum}</text>
        <text x="${x(o.lon) + 15}" y="${y(o.lat) + 4 + dy * 1.6}" font-size="12" fill="#2E3B43">${esc((o.cliente || '').split(' ').slice(0, 2).join(' '))} ${esc(o.hora || '')}</text>
        ${o.checkIn ? `<circle cx="${x(o.checkIn.lon)}" cy="${y(o.checkIn.lat)}" r="4" fill="${o.checkIn.longe ? '#B03A2E' : '#2E7D4F'}"/>` : ''}</g>`;
      }).join('')}
      ${m.tecnicos.filter((t) => t.ultima).map((t) => `<g><path d="M${x(t.ultima.lon)},${y(t.ultima.lat) - 16} l9,16 h-18z" fill="${corTec(t.code)}" stroke="#fff" stroke-width="1.5"/>
        <text x="${x(t.ultima.lon)}" y="${y(t.ultima.lat) + 16}" font-size="12" text-anchor="middle" font-weight="600" fill="${corTec(t.code)}">${esc(t.nome.split(' ')[0])}</text></g>`).join('')}
    </svg>`;
  }
  const link = (t) => {
    const ini = t.ultima || m.base;
    const seq = t.rota.map((r) => osPor[r.DocEntry]).filter(Boolean);
    if (!seq.length) return '';
    const ll = (p) => `${p.lat},${p.lon}`;
    const dest = seq.at(-1);
    const way = seq.slice(0, -1).map(ll).join('|');
    return `https://www.google.com/maps/dir/?api=1${ini ? `&origin=${ll(ini)}` : ''}&destination=${ll(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&travelmode=driving`;
  };
  root.innerHTML = `<div class="card"><div class="toolbar"><div><label>Dia</label><input type="date" id="mData" value="${f.data}"></div>
    <div class="sub" style="flex:1">Política de localização: <b>${esc(MODO[m.modo] || m.modo)}</b>. Check-in a mais de ${num(m.raio, 0)} m da obra aparece em vermelho. As posições ficam fora do SAP e são apagadas após o prazo de retenção.</div></div>
  <div class="mapa-wrap"><div>${svg}</div>
  <div>${m.tecnicos.map((t, i) => {
    const l = link(t);
    return `<div class="card" style="border-left:4px solid ${CORES[i % CORES.length]};margin-bottom:10px"><div class="row"><b>${esc(t.nome)}</b><span class="spacer"></span>
      ${l ? `<a class="mini" href="${esc(l)}" target="_blank" rel="noopener">Abrir rota ↗</a>` : ''}</div>
      <div class="sub">${t.ultima ? `Última posição ${fmtDT(t.ultima.at)}${t.ultima.os ? ` (OS ${osPor[t.ultima.os]?.DocNum || t.ultima.os})` : ''}` : 'Sem posição registrada'}${t.aceite ? '' : ' · termo de localização não aceito'}</div>
      <ol style="margin:6px 0 0 18px;padding:0">${t.rota.map((r) => {
        const o = osPor[r.DocEntry];
        return `<li><a href="#" data-os="${o.DocEntry}">OS ${o.DocNum}</a> ${esc(o.hora || '')} · ${esc(o.cliente)} <span class="sub">${num(r.km, 1)} km</span></li>`;
      }).join('') || '<li class="sub" style="list-style:none;margin-left:-18px">Sem OS para visitar.</li>'}</ol></div>`;
  }).join('')}</div></div></div>
  <div class="card"><h2>OS do dia</h2><div class="tbl"><table><thead><tr><th>OS</th><th>Hora</th><th>Técnico</th><th>Cliente / local</th><th>Situação</th><th>Check-in</th></tr></thead><tbody>
  ${m.os.sort((a, b) => (a.hora < b.hora ? -1 : 1)).map((o) => `<tr class="click" data-os="${o.DocEntry}"><td>${o.DocNum}</td><td>${esc(o.hora || '')}</td>
    <td>${esc(m.tecnicos.find((t) => t.code === o.tecnico)?.nome || o.tecnico || '—')}</td><td>${esc(o.cliente)} <span class="sub">${esc(o.endereco || '')}</span></td>
    <td>${badge(o.status, DOM.statusOS)}</td><td>${o.checkIn ? (o.checkIn.longe ? `<span class="badge p-URG">longe da obra (${num((o.checkIn.dist || 0) / 1000, 1)} km)</span>` : '<span class="badge b-DIS">na obra</span>') : '—'}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">Nenhuma OS agendada neste dia.</td></tr>'}</tbody></table></div></div>`;
  root.onchange = (ev) => {
    if (ev.target.id === 'mData' && ev.target.value) {
      f.data = ev.target.value;
      render(root, {}, c);
    }
  };
  root.onclick = (ev) => {
    const o = ev.target.closest('[data-os]');
    if (o) {
      ev.preventDefault();
      c.go('os', { id: o.dataset.os });
    }
  };
}
