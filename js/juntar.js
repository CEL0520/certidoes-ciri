// Juntar e dividir PDFs e prints (e-mail, WhatsApp, outros sistemas), sem sair deste computador.
// Usa a biblioteca pdf-lib (lib/pdflib, licença MIT): as páginas dos PDFs entram como estão (texto continua selecionável).

const A4 = [595.28, 841.89];
let carregando = null;
export function pdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!carregando) {
    carregando = new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = new URL('../lib/pdflib/pdf-lib.min.js', import.meta.url).href;
      s.onload = () => (window.PDFLib ? ok(window.PDFLib) : erro(new Error('pdf-lib não carregou')));
      s.onerror = () => { carregando = null; erro(new Error('não foi possível carregar lib/pdflib/pdf-lib.min.js')); };
      document.head.appendChild(s);
    });
  }
  return carregando;
}

export const ehPdf = (arq) => /pdf$/i.test(arq.type) || /\.pdf$/i.test(arq.name);
export const ehImagem = (arq) => /^image\//.test(arq.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(arq.name);

async function bytesJpeg(arq) {
  if (/jpe?g$/i.test(arq.type) || /\.jpe?g$/i.test(arq.name)) return { tipo: 'jpg', bytes: new Uint8Array(await arq.arrayBuffer()) };
  if (/png$/i.test(arq.type) || /\.png$/i.test(arq.name)) return { tipo: 'png', bytes: new Uint8Array(await arq.arrayBuffer()) };
  const bm = await createImageBitmap(arq); // webp, gif, bmp: vira JPEG
  const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bm, 0, 0);
  const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
  return { tipo: 'jpg', bytes: new Uint8Array(await b.arrayBuffer()) };
}

// Conta as páginas (para a lista)
export async function contarPaginas(arq) {
  if (!ehPdf(arq)) return 1;
  const { PDFDocument } = await pdfLib();
  const d = await PDFDocument.load(await arq.arrayBuffer(), { ignoreEncryption: true });
  return d.getPageCount();
}

// itens: [File | Blob com nome]; imagens viram uma página A4 cada
export async function juntar(itens, aviso) {
  const { PDFDocument } = await pdfLib();
  const saida = await PDFDocument.create();
  for (let i = 0; i < itens.length; i++) {
    const arq = itens[i];
    aviso && aviso(`Juntando ${arq.name || 'arquivo'} (${i + 1} de ${itens.length})…`);
    if (ehPdf(arq)) {
      const d = await PDFDocument.load(await arq.arrayBuffer(), { ignoreEncryption: true });
      const pags = await saida.copyPages(d, d.getPageIndices());
      pags.forEach((p) => saida.addPage(p));
    } else if (ehImagem(arq)) {
      const { tipo, bytes } = await bytesJpeg(arq);
      const img = tipo === 'png' ? await saida.embedPng(bytes) : await saida.embedJpg(bytes);
      const pag = saida.addPage(img.width > img.height * 1.15 ? [A4[1], A4[0]] : A4);
      const m = 28, W = pag.getWidth() - 2 * m, H = pag.getHeight() - 2 * m;
      const k = Math.min(W / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      pag.drawImage(img, { x: (pag.getWidth() - w) / 2, y: (pag.getHeight() - h) / 2, width: w, height: h });
    }
  }
  return saida.save();
}

// partes: [[inicio, fim], ...] (páginas contadas de 1)
export async function dividir(bytes, partes) {
  const { PDFDocument } = await pdfLib();
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const n = d.getPageCount();
  const saidas = [];
  for (const [a, b] of partes) {
    const ini = Math.max(1, a), fim = Math.min(n, b);
    if (ini > fim) continue;
    const novo = await PDFDocument.create();
    const pags = await novo.copyPages(d, Array.from({ length: fim - ini + 1 }, (_, i) => ini - 1 + i));
    pags.forEach((p) => novo.addPage(p));
    saidas.push({ ini, fim, bytes: await novo.save() });
  }
  return saidas;
}

// "1-3; 4; 5-8" ou "1-3, 4, 5-8" → [[1,3],[4,4],[5,8]]
export function lerIntervalos(t, total) {
  const partes = [];
  for (const pedaco of String(t || '').split(/[;,\n]+/)) {
    const m = pedaco.trim().match(/^(\d+)\s*(?:[-–a]\s*(\d+|fim))?$/i);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] ? (/fim/i.test(m[2]) ? total : +m[2]) : a;
    partes.push([Math.min(a, b), Math.max(a, b)]);
  }
  return partes;
}

// Divide em partes que caibam no limite (ex.: 2 MB do Projudi)
export async function dividirPorTamanho(bytes, limite, aviso) {
  const { PDFDocument } = await pdfLib();
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const n = d.getPageCount();
  const partes = [];
  let ini = 1;
  while (ini <= n) {
    let fim = ini, melhor = null;
    while (fim <= n) {
      aviso && aviso(`Dividindo: páginas ${ini} a ${fim}…`);
      const [p] = await dividir(bytes, [[ini, fim]]);
      if (p.bytes.length > limite && melhor) break;
      melhor = p;
      if (p.bytes.length > limite) break; // uma página sozinha já passa do limite: vai assim mesmo
      fim++;
    }
    partes.push(melhor);
    ini = melhor.fim + 1;
  }
  return partes;
}

// Versão mais leve: cada página vira imagem JPEG (o texto deixa de ser selecionável)
export async function reduzir(bytes, pdfjsLib, limite, aviso) {
  const { PDFDocument } = await pdfLib();
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  for (const [escala, q] of [[1.6, 0.75], [1.3, 0.65], [1.1, 0.55], [0.9, 0.5]]) {
    const saida = await PDFDocument.create();
    for (let p = 1; p <= doc.numPages; p++) {
      aviso && aviso(`Reduzindo: página ${p} de ${doc.numPages}…`);
      const pag = await doc.getPage(p);
      const vp1 = pag.getViewport({ scale: 1 });
      const vp = pag.getViewport({ scale: escala });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pag.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
      const img = await saida.embedJpg(new Uint8Array(await b.arrayBuffer()));
      const np = saida.addPage([vp1.width, vp1.height]);
      np.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }
    const out = await saida.save();
    if (out.length <= limite) return out;
    bytes = out;
  }
  return bytes;
}

// PDF do print + PDFs de outros sistemas (no início ou no fim), páginas originais
export async function juntarComAnexos(blobPrint, anexos) {
  const { PDFDocument } = await pdfLib();
  const saida = await PDFDocument.create();
  const add = async (bytes) => {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
    (await saida.copyPages(d, d.getPageIndices())).forEach((p) => saida.addPage(p));
  };
  for (const a of anexos.filter((x) => x.posicao === 'inicio')) await add(a.bytes);
  if (blobPrint) await add(new Uint8Array(await blobPrint.arrayBuffer()));
  for (const a of anexos.filter((x) => x.posicao !== 'inicio')) await add(a.bytes);
  return new Blob([await saida.save()], { type: 'application/pdf' });
}
