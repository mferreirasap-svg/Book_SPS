// Mapa da equipe e rota do dia. Política de localização (LGPD) em GEO_MODO:
//   NAO — não registra; OS — só no início e no fim da OS; EXP — também durante o expediente, com o técnico "em serviço".
// O técnico aceita o termo de ciência uma vez (registrado no cadastro). As posições ficam fora do SAP e são apagadas após o prazo.
import { CFG_DEFAULTS } from '../b1/schema.js';
import { badRequest, forbidden, d10, hoje, agora } from '../lib/util.js';
import { distanciaM } from './aftersales.js';

export function createGeoService({ repos, audit, aftersales, posicoes }) {
  const cfg = async () => ({ ...CFG_DEFAULTS, ...(await repos.settings.all()) });
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  async function politica(req) {
    const c0 = await cfg();
    const tec = await aftersales.tecnicoDo(req.user.login);
    return { modo: c0.GEO_MODO, raio: Number(c0.GEO_RAIO_M) || 500, retencao: Number(c0.GEO_RETENCAO_DIAS) || 90, tecnico: tec?.Code || '', aceite: tec?.U_GeoAceite || '' };
  }

  async function aceitar(req) {
    const tec = await aftersales.tecnicoDo(req.user.login);
    if (!tec) throw badRequest('Seu usuário não está ligado a um técnico.');
    await repos.technicians.patch(tec.Code, { U_GeoAceite: agora() });
    audit.record(req, { action: 'aceite_localizacao', entity: 'tecnico', id: tec.Code });
    return politica(req);
  }

  /** Posição enviada pelo celular durante o expediente (só com GEO_MODO = EXP e termo aceito). */
  async function registrar(req, { lat, lon, precisao }) {
    const p = await politica(req);
    if (p.modo !== 'EXP') throw forbidden('A empresa não registra a localização durante o expediente.');
    if (!p.tecnico) throw badRequest('Seu usuário não está ligado a um técnico.');
    if (!p.aceite) throw badRequest('Aceite o termo de localização antes de iniciar o serviço.');
    if (num(lat) == null || num(lon) == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw badRequest('Localização inválida.');
    posicoes.registrar({ login: req.user.login, tecnico: p.tecnico, lat: num(lat), lon: num(lon), precisao: num(precisao), origem: 'EXP' });
    return { ok: true };
  }

  /** Mapa do dia: base, última posição de cada técnico e as OS agendadas com a coordenada da obra. */
  async function mapa({ data } = {}) {
    data = d10(data) || hoje();
    const c0 = await cfg();
    try {
      posicoes.limpar(Number(c0.GEO_RETENCAO_DIAS) || 90);
    } catch {
      /* limpeza é melhor esforço */
    }
    const [tecs, ordens, contratos, ultimas] = await Promise.all([repos.technicians.all(), repos.orders.all({}), repos.contracts.open(), posicoes.ultimas()]);
    const coordPorObra = {};
    const bps = {};
    const coordDoContrato = async (ctrEntry) => {
      if (!ctrEntry) return null;
      if (ctrEntry in coordPorObra) return coordPorObra[ctrEntry];
      const c = contratos.find((x) => Number(x.DocEntry) === Number(ctrEntry)) || (await repos.contracts.get(ctrEntry));
      let r = null;
      if (c?.U_EndEntrega) {
        bps[c.U_CardCode] ||= await repos.partners.get(c.U_CardCode);
        const end = (bps[c.U_CardCode]?.BPAddresses || []).find((a) => a.AddressName === c.U_EndEntrega);
        if (end && num(end.U_SPS_Lat) != null) r = { lat: num(end.U_SPS_Lat), lon: num(end.U_SPS_Lon), endereco: [end.Street, end.City].filter(Boolean).join(' — ') };
      }
      coordPorObra[ctrEntry] = r;
      return r;
    };
    const [blat, blon] = String(c0.GEO_BASE || '').split(',').map(num);
    const base = blat != null && blon != null ? { lat: blat, lon: blon } : null;
    const os = [];
    for (const o of ordens.filter((x) => d10(x.U_DtAgenda) === data && x.U_Status !== 'CAN')) {
      const g = await coordDoContrato(o.U_CtrEntry);
      os.push({ DocEntry: o.DocEntry, DocNum: o.DocNum, tipo: o.U_Tipo, status: o.U_Status, tecnico: o.U_Tecnico, hora: o.U_HrAgenda, cliente: o.U_CardName,
        local: o.U_Local, ativo: o.U_Ativo, prior: o.U_Prior, lat: g?.lat ?? (o.U_Tipo === 'INT' ? base?.lat : null), lon: g?.lon ?? (o.U_Tipo === 'INT' ? base?.lon : null),
        endereco: g?.endereco || o.U_Local, checkIn: o.U_LatIni ? { lat: num(o.U_LatIni), lon: num(o.U_LonIni), dist: o.U_DistObra } : null });
    }
    const raio = Number(c0.GEO_RAIO_M) || 500;
    const tecnicos = tecs.filter((t) => t.U_Ativo !== 'N').map((t) => {
      const u = ultimas.find((x) => x.tecnico === t.Code);
      const minhas = os.filter((o) => o.tecnico === t.Code).sort((a, b) => (a.hora < b.hora ? -1 : 1));
      return { code: t.Code, nome: t.Name, aceite: Boolean(t.U_GeoAceite), ultima: u ? { lat: u.lat, lon: u.lon, at: u.at, origem: u.origem, os: u.os } : null,
        os: minhas.map((o) => o.DocEntry),
        // Ordem sugerida: vizinho mais próximo a partir da última posição (ou da base).
        rota: rotaSugerida(u ? { lat: u.lat, lon: u.lon } : base, minhas.filter((o) => o.lat != null && !['CON'].includes(o.status))) };
    });
    for (const o of os) if (o.checkIn && o.lat != null) o.checkIn.longe = distanciaM(o.checkIn.lat, o.checkIn.lon, o.lat, o.lon) > raio;
    return { data, base, raio, modo: c0.GEO_MODO, tecnicos, os };
  }

  function rotaSugerida(origem, paradas) {
    if (!paradas.length) return [];
    const resto = [...paradas];
    const ordem = [];
    let atual = origem || resto[0];
    while (resto.length) {
      resto.sort((a, b) => distanciaM(atual.lat, atual.lon, a.lat, a.lon) - distanciaM(atual.lat, atual.lon, b.lat, b.lon));
      const p = resto.shift();
      ordem.push({ DocEntry: p.DocEntry, km: Math.round(distanciaM(atual.lat, atual.lon, p.lat, p.lon) / 100) / 10 });
      atual = p;
    }
    return ordem;
  }

  return { politica, aceitar, registrar, mapa };
}
