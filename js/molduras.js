// Localiza as molduras amarelas dos prints da CIRI numa página renderizada.
// Recebe { data: RGBA, width, height } e devolve retângulos da área de conversa
// (sem a barra lateral de contatos), em pixels.

// Retângulos (em pixels do viewport) das imagens desenhadas numa página de PDF.
// Serve para achar os prints colados em qualquer documento (Word, outros sistemas).
export function retangulosDeImagens(opList, OPS, viewport, larguraMinima = 0.25) {
  const mult = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha = [];
  const rets = [];
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) pilha.push(ctm);
    else if (fn === OPS.restore) ctm = pilha.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mult(ctm, argsArray[i]);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const cantos = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = cantos.map((c) => c[0]), ys = cantos.map((c) => c[1]);
      const v = viewport.transform;
      const ponto = (x, y) => [v[0] * x + v[2] * y + v[4], v[1] * x + v[3] * y + v[5]];
      const [x0, y0] = ponto(Math.min(...xs), Math.min(...ys));
      const [x1, y1] = ponto(Math.max(...xs), Math.max(...ys));
      const r = { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) };
      if (r.w >= viewport.width * larguraMinima && r.h >= 40) rets.push(r);
    }
  }
  // limita à página
  return rets.map((r) => {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, w: Math.min(r.w, Math.floor(viewport.width) - x), h: Math.min(r.h, Math.floor(viewport.height) - y) };
  }).filter((r) => r.w > 0 && r.h > 0);
}

const amarelo =(r, g, b) => r > 200 && g > 160 && b < 110 && r - b > 120;

export function acharMolduras(img, fracaoConversa = 0.695) {
  const { data, width: W, height: H } = img;
  const linhasAmarelas = [];
  for (let y = 0; y < H; y++) {
    let c = 0;
    const base = y * W * 4;
    for (let x = 0; x < W; x += 2) {
      const i = base + x * 4;
      if (amarelo(data[i], data[i + 1], data[i + 2])) c += 2;
    }
    if (c > 0.4 * W) linhasAmarelas.push(y);
  }
  // Agrupa linhas consecutivas em faixas (bordas horizontais)
  const faixas = [];
  for (const y of linhasAmarelas) {
    const f = faixas[faixas.length - 1];
    if (f && y - f.fim <= 2) f.fim = y;
    else faixas.push({ ini: y, fim: y });
  }
  const molduras = [];
  for (let k = 0; k + 1 < faixas.length; k += 2) {
    const topo = faixas[k];
    const base = faixas[k + 1];
    if (base.ini - topo.fim < 60) { k -= 1; continue; } // faixa espúria: tenta parear com a próxima
    const y = topo.ini;
    let x0 = -1, x1 = -1;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (amarelo(data[i], data[i + 1], data[i + 2])) { if (x0 < 0) x0 = x; x1 = x; }
    }
    const esp = topo.fim - topo.ini + 2;
    const largura = x1 - x0;
    const r = { modo: 'moldura', x: x0 + esp, y: topo.fim + 1, w: largura - 2 * esp, h: base.ini - topo.fim - 1 };
    // Só a conversa: corta na divisória do painel de contato (cada colaborador tem uma largura de tela)
    const div = acharDivisoria(img, r);
    if (div) { r.w = div - r.x - 2; r.fracao = 1; }
    else { r.w = Math.round(largura * fracaoConversa) - esp; r.fracao = 1; }
    molduras.push(r);
  }
  return molduras;
}

// Divisória vertical entre a conversa e o painel de contato, dentro de uma moldura.
// Procura a coluna com uma linha fina mais escura que os dois lados (ou mudança de fundo) em quase toda a altura.
// Devolve o x (em pixels da página) ou null.
export function acharDivisoria(img, r) {
  const { data, width: W } = img;
  const lum0 = (i) => (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
  const y0 = r.y + Math.round(r.h * 0.12), y1 = r.y + Math.round(r.h * 0.88);
  // modo escuro: inverte a luminância, para a divisória (mais clara que o fundo) virar "mais escura"
  let soma = 0, n0 = 0;
  for (let y = y0; y < y1; y += 17) for (let x = r.x; x < r.x + r.w; x += 17) { soma += lum0((y * W + x) * 4); n0++; }
  const escuro = n0 && soma / n0 < 110;
  const lum = escuro ? (i) => 255 - lum0(i) : lum0;
  let melhor = null, best = 0, melhorF = null, bestF = 0;
  for (let x = r.x + Math.round(r.w * 0.55); x < r.x + Math.round(r.w * 0.93); x++) {
    let c = 0, n = 0, claro = 0;
    for (let y = y0; y < y1; y += 3) {
      const i = (y * W + x) * 4;
      const L = lum(i), Le = lum(i - 12), Ld = lum(i + 12);
      n++;
      if (L > 120 && L < Le - 3 && L < Ld - 3) c++;
      // mudança de fundo: à direita (painel) mais claro e liso que à esquerda (conversa)
      const Ld2 = lum(i + 24), Le2 = lum(i - 24);
      if (Ld > 225 && Math.abs(Ld - Ld2) < 4 && Ld - Le > 6 && Ld - Le2 > 6) claro++;
    }
    if (c / n > best) { best = c / n; melhor = x; }
    if (claro / n > bestF) { bestF = claro / n; melhorF = x; }
  }
  if (best > 0.55) return melhor;
  return bestF > 0.6 ? melhorF : null;
}
