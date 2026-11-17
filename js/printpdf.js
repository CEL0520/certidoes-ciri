// PDF do print da conversa (WhatsApp Web): cabeçalho da CIRI, telefone grifado em amarelo,
// as telas capturadas em molduras amarelas e as fotos enviadas pela parte nos espaços livres
// (ou no fim). Tudo montado aqui no navegador, sem bibliotecas e sem internet.

const A4 = { w: 595.28, h: 841.89 };
const M = 34;                    // margem
const AMARELO = [1, 0.9, 0];     // moldura e grifo (o leitor do site reconhece este amarelo)

// ---------- texto em WinAnsi (fontes padrão Helvetica) ----------
const ESPECIAIS = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '…': 0x85, '•': 0x95, '€': 0x80 };
function hexWinAnsi(t) {
  let h = '';
  for (const ch of String(t)) {
    const c = ch.codePointAt(0);
    const b = c < 256 ? c : ESPECIAIS[ch] || 0x3f;
    h += b.toString(16).padStart(2, '0');
  }
  return '<' + h + '>';
}
const medidor = document.createElement('canvas').getContext('2d');
function larguraTexto(t, tam, negrito) {
  medidor.font = `${negrito ? 'bold ' : ''}100px Arial, Helvetica, sans-serif`; // métricas da Arial = Helvetica
  return (medidor.measureText(t).width / 100) * tam;
}

// ---------- imagens ----------
async function carregarImagem(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
// Normaliza qualquer imagem para JPEG (o PDF guarda o JPEG como está)
async function paraJpeg(src, maxLado = 1800) {
  // JPEG já no tamanho certo (telas capturadas): usa os bytes como estão, sem recomprimir
  if (/^blob:/.test(src)) {
    const bl = await (await fetch(src)).blob();
    if (bl.type === 'image/jpeg') {
      const bm = await createImageBitmap(bl);
      const ok = Math.max(bm.width, bm.height) <= maxLado;
      const dims = { w: bm.width, h: bm.height };
      bm.close();
      if (ok) return { ...dims, bytes: new Uint8Array(await bl.arrayBuffer()) };
    }
  }
  const img = await carregarImagem(src);
  const k = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.88);
  const bin = atob(url.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { w: c.width, h: c.height, bytes };
}

// ---------- escritor de PDF mínimo ----------
function escreverPdf(paginas) {
  const enc = new TextEncoder();
  const partes = [];
  let tamanho = 0;
  const offsets = [];
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; partes.push(b); tamanho += b.length; };
  let n = 0;
  const novoId = () => ++n;
  const objetos = []; // [id, conteudo (string | {dict, stream})]
  const idCatalogo = novoId(), idPaginas = novoId(), idF1 = novoId(), idF2 = novoId();
  const idsPagina = [];
  for (const pg of paginas) {
    const xobj = [];
    for (const im of pg.imagens) {
      im.id = novoId();
      objetos.push([im.id, { dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, stream: im.bytes }]);
      xobj.push(`/${im.nome} ${im.id} 0 R`);
    }
    const conteudo = enc.encode(pg.ops.join('\n'));
    const idC = novoId();
    objetos.push([idC, { dict: `<< /Length ${conteudo.length} >>`, stream: conteudo }]);
    const idP = novoId();
    idsPagina.push(idP);
    objetos.push([idP, `<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> /XObject << ${xobj.join(' ')} >> >> /Contents ${idC} 0 R >>`]);
  }
  objetos.unshift(
    [idCatalogo, `<< /Type /Catalog /Pages ${idPaginas} 0 R >>`],
    [idPaginas, `<< /Type /Pages /Kids [${idsPagina.map((i) => i + ' 0 R').join(' ')}] /Count ${idsPagina.length} >>`],
    [idF1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [idF2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],
  );
  add('%PDF-1.4\n');
  add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  objetos.sort((a, b) => a[0] - b[0]);
  for (const [id, c] of objetos) {
    offsets[id] = tamanho;
    if (typeof c === 'string') add(`${id} 0 obj\n${c}\nendobj\n`);
    else { add(`${id} 0 obj\n${c.dict}\nstream\n`); add(c.stream); add('\nendstream\nendobj\n'); }
  }
  const xref = tamanho;
  let tab = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= n; i++) tab += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  add(tab + `trailer\n<< /Size ${n + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(partes, { type: 'application/pdf' });
}

// ---------- montagem das páginas ----------
const dois = (x) => String(x).padStart(2, '0');
function dataHora(iso) {
  const d = new Date(iso || Date.now());
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}, às ${dois(d.getHours())}h${dois(d.getMinutes())}`;
}

// cab: { telefone, nomeWhats, nome, processo, quando }
// telas: [dataURL]; fotos: [{ src, legenda }]
export async function montarPdfPrint({ cab = {}, telas = [], fotos = [] }, aviso) {
  const paginas = [];
  let pg = null, y = 0, nImg = 0;
  const L = A4.w - 2 * M;
  const yPdf = (yy) => A4.h - yy; // layout de cima para baixo
  const texto = (t, x, yy, tam, negrito, cor = [0.11, 0.14, 0.19]) => {
    pg.ops.push(`BT ${cor.join(' ')} rg /${negrito ? 'F2' : 'F1'} ${tam} Tf ${x.toFixed(2)} ${yPdf(yy).toFixed(2)} Td ${hexWinAnsi(t)} Tj ET`);
  };
  const centro = (t, yy, tam, negrito, cor) => texto(t, (A4.w - larguraTexto(t, tam, negrito)) / 2, yy, tam, negrito, cor);
  const retangulo = (x, yy, w, h, { traco, preenche, lw = 1 }) => {
    const ops = ['q'];
    if (preenche) ops.push(`${preenche.join(' ')} rg`);
    if (traco) ops.push(`${traco.join(' ')} RG ${lw} w`);
    ops.push(`${x.toFixed(2)} ${yPdf(yy + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${preenche && traco ? 'B' : preenche ? 'f' : 'S'}`, 'Q');
    pg.ops.push(ops.join(' '));
  };
  const imagem = (im, x, yy, w, h) => {
    const nome = 'Im' + ++nImg;
    pg.imagens.push({ ...im, nome });
    pg.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${yPdf(yy + h).toFixed(2)} cm /${nome} Do Q`);
  };
  const tel = cab.telefone || '';
  const grifo = (yy, tam) => { // telefone grifado em amarelo (como nos prints da CIRI)
    if (!tel) return yy;
    const w = larguraTexto(tel, tam, true) + 16;
    retangulo((A4.w - w) / 2, yy, w, tam + 8, { preenche: AMARELO });
    centro(tel, yy + tam + 2, tam, true, [0, 0, 0]);
    return yy + tam + 8;
  };
  const novaPagina = () => {
    pg = { ops: [], imagens: [] };
    paginas.push(pg);
    y = M;
    centro('PODER JUDICIÁRIO DO ESTADO DE GOIÁS', y + 9, 9.5, true);
    centro('Diretoria Judiciária · Central de Intimação Remota do Interior (CIRI)', y + 21, 8.5, false);
    pg.ops.push(`q 0.6 0.6 0.6 RG 0.6 w ${M + 60} ${yPdf(y + 27)} m ${A4.w - M - 60} ${yPdf(y + 27)} l S Q`);
    y += 33;
    if (paginas.length === 1) {
      centro('Captura de tela de conversa no WhatsApp Web', y + 10, 10, true, [0.12, 0.23, 0.37]);
      y += 14;
      y = grifo(y, 11) + 3;
      const l1 = [cab.nomeWhats || cab.nome ? `Nome exibido no WhatsApp: ${cab.nomeWhats || cab.nome}` : '', cab.processo ? `Processo nº ${cab.processo}` : ''].filter(Boolean).join('  ·  ');
      if (l1) { centro(l1, y + 9, 8, false, [0.25, 0.28, 0.33]); y += 11; }
      centro(`Capturado e gerado em ${dataHora(cab.quando)}`, y + 9, 8, false, [0.25, 0.28, 0.33]);
      y += 15;
    } else {
      y = grifo(y, 10) + 8;
    }
  };
  const fundo = A4.h - M - 14; // reserva o rodapé
  const rodapes = () => paginas.forEach((p, i) => {
    pg = p;
    const t = `Página ${i + 1} de ${paginas.length}`;
    texto(t, A4.w - M - larguraTexto(t, 7.5), A4.h - M + 4, 7.5, false, [0.45, 0.45, 0.45]);
    texto(`Gerado pelo site Certidões CIRI em ${dataHora(cab.quando)}`, M, A4.h - M + 4, 7.5, false, [0.45, 0.45, 0.45]);
  });

  // Fotos: sempre no fim do PDF, depois de todas as telas
  const fila = [];
  for (let i = 0; i < fotos.length; i++) {
    aviso && aviso(`Preparando as fotos (${i + 1} de ${fotos.length})…`);
    try { fila.push({ ...(await paraJpeg(fotos[i].src)), legenda: fotos[i].legenda || '' }); } catch { /* imagem ilegível */ }
  }
  let nFoto = 0;
  const legendaFoto = (f) => `Foto/documento enviado pela parte (${nFoto})${f.legenda ? ' · ' + f.legenda : ''}`;
  const encaixarFotos = (minimo) => {
    while (fila.length) {
      const livre = fundo - y;
      if (livre < minimo) return;
      const f = fila[0];
      const maxH = livre - 22, maxW = L * 0.75;
      const k = Math.min(maxW / f.w, maxH / f.h, 1.2);
      const w = f.w * k, h = f.h * k;
      if (h < 120) return;
      fila.shift(); nFoto++;
      texto(legendaFoto(f), M, y + 10, 8.5, true, [0.12, 0.23, 0.37]);
      const x = (A4.w - w) / 2;
      imagem(f, x, y + 16, w, h);
      retangulo(x, y + 16, w, h, { traco: [0.7, 0.7, 0.7], lw: 0.6 });
      y += h + 30;
    }
  };

  // Sempre duas telas por página, ocupando a altura toda (também na 1ª, que tem cabeçalho maior)
  novaPagina();
  const B = 2.5; // moldura amarela
  const GAP = 8;
  let naPagina = 0, maxH = (fundo - y - GAP) / 2 - 2 * B;
  for (let i = 0; i < telas.length; i++) {
    aviso && aviso(`Montando o PDF: tela ${i + 1} de ${telas.length}…`);
    const im = await paraJpeg(telas[i], 1600);
    if (naPagina === 2) { novaPagina(); naPagina = 0; maxH = (fundo - y - GAP) / 2 - 2 * B; }
    let w = L - 2 * B;
    let h = w * im.h / im.w;
    if (h > maxH) { h = maxH; w = h * im.w / im.h; }
    const x = (A4.w - w) / 2;
    retangulo(x - B / 2, y + B / 2, w + B, h + B, { traco: AMARELO, lw: B });
    imagem(im, x, y + B, w, h);
    pg.temTela = true;
    naPagina++;
    y += h + 2 * B + GAP;
  }
  // Fotos que não couberam: no fim, em páginas próprias (o leitor do site pula estas páginas)
  const paginaDeFotos = () => {
    novaPagina();
    centro('Fotos e documentos enviados pela parte', y + 11, 10.5, true, [0.12, 0.23, 0.37]);
    y += 22;
  };
  if (fila.length) paginaDeFotos(); // fotos sempre no fim, em página própria
  while (fila.length) {
    if (fundo - y < 220) paginaDeFotos();
    const antes = fila.length;
    encaixarFotos(220);
    if (fila.length === antes) paginaDeFotos();
  }
  rodapes();
  return escreverPdf(paginas);
}

// Arquivos arrastados (fotos ou PDFs enviados pela parte): viram imagens para o PDF do print
export async function arquivosParaFotos(arquivos, pdfjsLib) {
  const fotos = [];
  for (const arq of arquivos) {
    if (/^image\//.test(arq.type)) {
      fotos.push({ src: URL.createObjectURL(arq), legenda: arq.name });
    } else if (/pdf$/i.test(arq.type) || /\.pdf$/i.test(arq.name)) {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arq.arrayBuffer()) }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 10); p++) {
        const pag = await pdf.getPage(p);
        const vp = pag.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await pag.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        fotos.push({ src: c.toDataURL('image/jpeg', 0.9), legenda: `${arq.name}${pdf.numPages > 1 ? ` (página ${p})` : ''}` });
      }
    }
  }
  return fotos;
}
