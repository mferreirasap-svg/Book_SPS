// Validação das fotos enviadas pelo celular (entrega, devolução, leitura, OS, chamado).
// No protótipo a foto fica no próprio registro; no SAP real vai para os anexos nativos (Attachments2).
import { badRequest } from './util.js';

export function validarFotos(fotos, max = 6) {
  if (fotos == null || fotos === '') return [];
  if (!Array.isArray(fotos) || fotos.length > max) throw badRequest(`Envie no máximo ${max} fotos.`);
  return fotos.map((f) => validarFoto(f?.src, f?.legenda));
}

export function validarFoto(src, legenda = '') {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(src || ''))) throw badRequest('Foto em formato inválido.');
  if (src.length > 400000) throw badRequest('Foto muito grande. Reduza a resolução.');
  return { src, legenda: String(legenda ?? '').trim().slice(0, 100) };
}
