// Campos de valor e quantidade no padrão brasileiro (15.000,00 · 0,80 · 9.000 · 1.320,5) em todo o sistema.
// Vale para todo <input type="number"> com casas decimais (step="0.01" = dinheiro, step="0.1" = medidor/franquia)
// ou com data-num (inteiro com milhar). Códigos e dias (sem step decimal) continuam como estão.
// A tela mostra o texto formatado, mas .value continua devolvendo o número no formato do sistema ("15000.5"),
// então nenhuma tela precisa mudar a forma de ler ou gravar.

const nativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/** Texto digitado pelo usuário → número. Aceita "15.000,50", "15000,5", "0,8" e também "0.8". */
export function lerBR(txt) {
  let s = String(txt ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (!/^-?\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, ''); // "1.320" é milhar; "0.8" é decimal
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function casas(el) {
  if (el.dataset.num != null) return { min: 0, max: Number(el.dataset.num) || 0 };
  const dec = (String(el.getAttribute('step') || '').split('.')[1] || '').length;
  const c = dec >= 2 ? { min: 2, max: dec } : { min: 0, max: dec };
  if (el.dataset.min != null) c.min = Number(el.dataset.min) || 0; // ex.: quantidade mostra "1", mas aceita "2,5"
  return c;
}

const formatar = (n, c) => (n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: c.min, maximumFractionDigits: Math.max(c.max, c.min) }));

function aplicar(el) {
  if (el.dataset.br || el.type !== 'number') return;
  const step = el.getAttribute('step') || '';
  if (!step.includes('.') && el.dataset.num == null) return;
  const c = casas(el);
  const inicial = nativo.get.call(el);
  el.dataset.br = '1';
  el.type = 'text';
  el.inputMode = 'decimal';
  el.autocomplete = 'off';
  el.classList.add('num-br');
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() {
      const n = lerBR(nativo.get.call(this));
      return n == null ? '' : String(n);
    },
    set(v) {
      const n = v === '' || v == null ? null : Number(String(v).replace(',', '.'));
      nativo.set.call(this, formatar(Number.isFinite(n) ? n : null, c));
    },
  });
  nativo.set.call(el, formatar(inicial === '' ? null : Number(inicial), c));
  el.addEventListener('blur', () => {
    const n = lerBR(nativo.get.call(el));
    nativo.set.call(el, formatar(n, c));
  });
}

const varrer = (raiz) => raiz.querySelectorAll?.('input[type="number"]').forEach(aplicar);

export function iniciarNumerosBR() {
  varrer(document);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.('input[type="number"]')) aplicar(n);
        else varrer(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
