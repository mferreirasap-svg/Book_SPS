// Estado compartilhado da tela (usuário logado, parâmetros públicos, filtros lembrados).
export const S = { user: null, b1Mode: '', cfg: {}, view: '', filtros: {} };

/** Lembra o último filtro de cada tela durante a sessão (requisito USA-11). */
export function filtro(view, padrao = {}) {
  S.filtros[view] ||= { ...padrao };
  return S.filtros[view];
}
