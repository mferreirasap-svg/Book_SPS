// Recursos de campo: assinatura na tela e fotos reduzidas antes do envio.

/** Liga o desenho da assinatura a um canvas. Retorna uma função que devolve o PNG (ou '' se em branco). */
export function padAssinatura(cv, inicial = '') {
  const g = cv.getContext('2d');
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.strokeStyle = '#1d3557';
  if (inicial) {
    const img = new Image();
    img.onload = () => g.drawImage(img, 0, 0);
    img.src = inicial;
    cv.dataset.dirty = '1';
  }
  let desenhando = false;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
  };
  cv.onpointerdown = (e) => {
    desenhando = true;
    cv.setPointerCapture(e.pointerId);
    g.beginPath();
    g.moveTo(...pos(e));
  };
  cv.onpointermove = (e) => {
    if (!desenhando) return;
    g.lineTo(...pos(e));
    g.stroke();
    cv.dataset.dirty = '1';
  };
  cv.onpointerup = cv.onpointercancel = () => (desenhando = false);
  return {
    valor: () => (cv.dataset.dirty === '1' ? cv.toDataURL('image/png') : ''),
    limpar: () => {
      g.clearRect(0, 0, cv.width, cv.height);
      cv.dataset.dirty = '';
    },
  };
}

/** Reduz a foto para no máximo 1024 px e JPEG, para caber no registro (a versão em produção usa anexos do SAP B1). */
export function reduzirFoto(file, max = 1024, qualidade = 0.6) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Escolha um arquivo de imagem.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let q = qualidade;
      let src = cv.toDataURL('image/jpeg', q);
      while (src.length > 380000 && q > 0.25) {
        q -= 0.1;
        src = cv.toDataURL('image/jpeg', q);
      }
      resolve(src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}
