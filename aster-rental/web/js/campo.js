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

/** Foto de exemplo do mostrador (só na demonstração, para quem apresenta sem câmera). */
export function fotoExemploMostrador(valor, unidade = 'h') {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 420;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 420);
  grad.addColorStop(0, '#3a4148');
  grad.addColorStop(1, '#1d2226');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 420);
  g.fillStyle = '#0d0f10';
  g.beginPath();
  g.roundRect(70, 120, 500, 170, 18);
  g.fill();
  const txt = String(Math.round(Number(valor) * 10) / 10).replace('.', ',').padStart(7, '0');
  g.font = 'bold 92px monospace';
  g.textAlign = 'center';
  g.fillStyle = '#f2c14e';
  g.fillText(txt, 320, 240);
  g.font = '28px sans-serif';
  g.fillStyle = '#c9d1d6';
  g.fillText(unidade === 'km' ? 'HODÔMETRO — km' : 'HORÍMETRO — horas', 320, 90);
  g.font = '20px sans-serif';
  g.fillText(new Date().toLocaleString('pt-BR'), 320, 345);
  return cv.toDataURL('image/jpeg', 0.7);
}

/** Posição do celular (com permissão do navegador). Resolve null se não houver ou se o usuário negar. */
export function posicaoAtual(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precisao: Math.round(p.coords.accuracy) }),
      () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}
