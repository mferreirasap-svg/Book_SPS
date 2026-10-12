// Tradução das mensagens da Service Layer para o usuário (requisito INT-05).
// O código e o texto originais seguem no erro para o log.
import { HttpError } from '../lib/util.js';

const MESSAGES = {
  '-2028': 'Registro não encontrado no SAP B1.',
  '-2035': 'Este registro já existe no SAP B1.',
  '-5002': 'O SAP B1 recusou os dados enviados.',
  '-10': 'O SAP B1 recusou a operação.',
  '301': 'Sessão do SAP B1 expirada.',
};

export class B1Error extends HttpError {
  constructor({ status, code, message, op }) {
    const known = MESSAGES[String(code)];
    const userMsg = known ? `${known} (${message})` : `Erro do SAP B1: ${message}`;
    super(status >= 500 ? 502 : status === 404 ? 404 : status === 409 ? 409 : 400, userMsg);
    this.b1Status = status;
    this.b1Code = code;
    this.b1Message = message;
    this.op = op;
  }
}

export function parseSlError(status, text) {
  let code;
  let message = text || `HTTP ${status}`;
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message;
    code = j?.error?.code;
    message = (typeof m === 'string' ? m : m?.value) || message;
  } catch {
    /* corpo não é JSON */
  }
  return new B1Error({ status, code, message });
}
