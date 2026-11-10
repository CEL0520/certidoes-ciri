// Leitura dos arquivos anexados: PDF (texto + imagens dos prints) e imagens soltas.
// Tudo acontece no navegador, sem enviar nada para fora.
import * as pdfjsLib from '../lib/pdfjs/pdf.min.mjs';
import { acharMolduras, retangulosDeImagens } from './molduras.js?v=0.7';
import * as N from './nucleo.js?v=0.7';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const BASE_LOCAL = new URL('../lib/tesseract/', import.meta.url).href;
const ESCALA_PAGINA = 3.4; // renderização da página do PDF
const AMPLIACAO = 2;       // ampliação do recorte antes do OCR (testado: 1,5 perde precisão)

// De onde vêm os arquivos do OCR: da própria pasta (extensão ou site com os arquivos)
// ou, no site, da CDN pública do Tesseract.js. Em qualquer caso, a leitura acontece
// no navegador: os prints não são enviados para lugar nenhum.
const CDN = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int',
};
const ehExtensao = /^(chrome|moz|safari-web)-extension:$/.test(location.protocol);
let fonteOcr = null; // { origem: 'local'|'internet', ... }

export async function ocrInstalado() {
  const arquivos = ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'por.traineddata.gz'];
  try {
    const r = await Promise.all(arquivos.map((a) => fetch(BASE_LOCAL + a, { method: 'HEAD', cache: 'no-store' }).then((x) => x.ok).catch(() => false)));
    if (r.every(Boolean)) {
      fonteOcr = { origem: 'local', script: BASE_LOCAL + 'tesseract.min.js', workerPath: BASE_LOCAL + 'worker.min.js', corePath: BASE_LOCAL, langPath: BASE_LOCAL, workerBlobURL: false };
      return 'local';
    }
  } catch { /* segue */ }
  if (!ehExtensao) {
    try {
      const ok = await fetch(CDN.script, { method: 'HEAD' }).then((x) => x.ok).catch(() => false);
      if (ok) { fonteOcr = { origem: 'internet', ...CDN, workerBlobURL: true }; return 'internet'; }
    } catch { /* segue */ }
  }
  return false;
}

function carregarScript(url) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = url; s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar ' + url));
    document.head.appendChild(s);
  });
}

// ----- Vários leitores de OCR trabalhando ao mesmo tempo -----
let pool = null;
async function criarLeitor() {
  const f = fonteOcr;
  const w = await window.Tesseract.createWorker('por', 1, {
    workerPath: f.workerPath, corePath: f.corePath, langPath: f.langPath,
    gzip: true, workerBlobURL: f.workerBlobURL, cacheMethod: f.origem === 'internet' ? 'write' : 'none',
  });
  await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
  return w;
}
async function obterPool(aviso) {
  if (pool) return pool;
  if (!fonteOcr) await ocrInstalado();
  if (!window.Tesseract) await carregarScript(fonteOcr.script);
  const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  aviso && aviso('Preparando o reconhecimento de texto…');
  const leitores = [await criarLeitor()];
  // os demais leitores são criados em paralelo; se a memória não permitir, segue com menos
  const extras = await Promise.allSettled(Array.from({ length: n - 1 }, criarLeitor));
  for (const e of extras) if (e.status === 'fulfilled') leitores.push(e.value);
  pool = { livres: leitores, fila: [], total: leitores.length };
  return pool;
}
async function comLeitor(fn) {
  const p = pool;
  const w = p.livres.length ? p.livres.pop() : await new Promise((ok) => p.fila.push(ok));
  try { return await fn(w); } finally {
    if (p.fila.length) p.fila.shift()(w); else p.livres.push(w);
  }
}
async function ocrCanvas(canvas) {
  const { data } = await comLeitor((w) => w.recognize(canvas, {}, { text: true, blocks: true }));
  let linhas = data.lines;
  if (!linhas && data.blocks) linhas = data.blocks.flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
  return (linhas || []).map((l) => ({ texto: (l.text || '').trim(), x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1 }));
}

// Recorta a região e amplia (melhora muito o reconhecimento)
function recorteAmpliado(origem, r) {
  const c = document.createElement('canvas');
  c.width = Math.round(r.w * AMPLIACAO); c.height = Math.round(r.h * AMPLIACAO);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'grayscale(1)';
  ctx.drawImage(origem, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

// Regiões a ler numa imagem/página: molduras da CIRI; senão, as imagens coladas; senão, tudo
function regioesDoCanvas(canvas, retImagens) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let regioes = acharMolduras(img);
  if (!regioes.length && retImagens && retImagens.length) regioes = retImagens.map((r) => ({ ...r, modo: 'livre' }));
  if (!regioes.length) regioes = [{ x: 0, y: 0, w: canvas.width, h: canvas.height, modo: 'livre' }];
  return regioes;
}

// Fila de OCR com aviso de andamento
function criarFila(aviso) {
  const tarefas = [];
  let feitas = 0;
  return {
    adicionar(canvas, modo) {
      const t = ocrCanvas(canvas).then((linhas) => {
        feitas++;
        aviso && aviso(`Lendo as telas da conversa: ${feitas} de ${tarefas.length}…`);
        return { largura: canvas.width, altura: canvas.height, linhas, modo };
      });
      tarefas.push(t);
      return t;
    },
    pendentes: () => tarefas.length - feitas,
    todas: () => Promise.all(tarefas),
  };
}

async function textoDaPagina(pagina) {
  const tc = await pagina.getTextContent();
  let s = '';
  for (const it of tc.items) s += it.str + (it.hasEOL ? '\n' : ' ');
  return { texto: s, itens: tc.items };
}

// PDF com texto de verdade (sem imagem): monta as linhas com posição a partir da camada de texto
function telaDoTexto(itens, vp) {
  const linhas = [];
  for (const it of itens) {
    if (!it.str || !it.str.trim()) continue;
    const [, , , , tx, ty] = it.transform;
    const v = vp.transform;
    const x0 = v[0] * tx + v[2] * ty + v[4];
    const y = v[1] * tx + v[3] * ty + v[5];
    const x1 = x0 + it.width * vp.scale;
    const h = Math.abs(it.height || 10) * vp.scale;
    const l = linhas.find((q) => Math.abs(q.yb - y) < h * 0.5);
    if (l) { l.partes.push({ x0, s: it.str }); l.x0 = Math.min(l.x0, x0); l.x1 = Math.max(l.x1, x1); }
    else linhas.push({ yb: y, y0: y - h, y1: y, x0, x1, partes: [{ x0, s: it.str }] });
  }
  return {
    largura: vp.width, altura: vp.height, modo: 'livre',
    linhas: linhas.map((l) => ({ texto: l.partes.sort((a, b) => a.x0 - b.x0).map((p) => p.s).join(' '), x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 })),
  };
}

// Analisa um arquivo e devolve { tipo:'conversa'|'email', meta, f, msgs }
export async function analisarArquivo(arquivo, aviso, temOcr) {
  const nome = arquivo.name || 'arquivo';
  if (/\.pdf$/i.test(nome) || arquivo.type === 'application/pdf') {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      paginas.push({ pg, ...(await textoDaPagina(pg)) });
    }
    const textoTotal = paginas.map((x) => x.texto).join('\n');
    const meta = N.lerMetaPdf(textoTotal);
    if (meta.ehEmail) return { tipo: 'email', meta, f: N.analisarEmail(textoTotal), arquivo: nome };

    const telasTexto = [];
    const fila = temOcr ? criarFila(aviso) : null;
    if (temOcr) await obterPool(aviso);
    for (let p = 0; p < paginas.length; p++) {
      if (/Imagem enviada por/.test(paginas[p].texto)) continue; // páginas só com fotos enviadas pela parte
      const vp = paginas[p].pg.getViewport({ scale: ESCALA_PAGINA });
      const imagens = retangulosDeImagens(await paginas[p].pg.getOperatorList(), pdfjsLib.OPS, vp);
      // Página só com texto (PDF exportado com texto): lê direto, sem OCR
      if (!imagens.length) {
        const util = paginas[p].texto.replace(/PODER JUDICI[ÁA]RIO|Tribunal de Justi[çc]a[^\n]*|Diretoria Judici[áa]ria[^\n]*|PROCESSO N[º°][^\n]*|Capturado e gerado[^\n]*/gi, '').trim();
        if (util.length > 60) { telasTexto.push(telaDoTexto(paginas[p].itens, vp)); continue; }
      }
      if (!temOcr) continue;
      aviso && aviso(`Preparando a página ${p + 1} de ${paginas.length}…`);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await paginas[p].pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
      for (const r of regioesDoCanvas(canvas, imagens)) fila.adicionar(recorteAmpliado(canvas, r), r.modo);
      canvas.width = canvas.height = 0; // libera memória
    }
    const telas = telasTexto.concat(fila ? await fila.todas() : []);
    const msgs = N.telasParaMensagens(telas, meta.ano);
    const nomes = N.nomesDasPartes(meta.nomeRodape, msgs.titulo);
    const f = N.analisarConversa(msgs, { ...meta, nome: nomes.join('\n') });
    f.nomes = nomes.length ? nomes : (f.nome ? [f.nome] : []);
    if (telas.some((t) => t.modo === 'livre' && t.linhas.length && !telasTexto.includes(t))) {
      f.avisos.push('Este print não segue o modelo da CIRI: confira com atenção as datas e horas, que costumam ser pequenas na tela.');
    }
    if (!temOcr) {
      // Sem OCR, a situação sai do rodapé do PDF (status dado pelo sistema)
      f.situacao = { EFETIVADA: 'INT_EXPRESSA', EXPEDIDA: 'CIT_EXPEDIDA', FRUSTRADA: 'FRUST_SEM_RESPOSTA' }[meta.status] || f.situacao;
      f.avisos = ['O reconhecimento de texto (OCR) não está instalado: li só o cabeçalho e o rodapé do PDF (nome, telefone e status). Escolha a situação e preencha datas e horas.'];
    }
    return { tipo: 'conversa', meta, f, msgs, arquivo: nome };
  }

  if (/^image\//.test(arquivo.type)) {
    if (!temOcr) throw new Error('Para ler imagens é preciso instalar o reconhecimento de texto (OCR).');
    const bmp = await createImageBitmap(arquivo);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    await obterPool(aviso);
    const fila = criarFila(aviso);
    for (const r of regioesDoCanvas(canvas, null)) fila.adicionar(recorteAmpliado(canvas, r), r.modo);
    const telas = await fila.todas();
    const ano = new Date().getFullYear();
    const msgs = N.telasParaMensagens(telas, ano);
    const nomes = N.nomesDasPartes('', msgs.titulo);
    const f = N.analisarConversa(msgs, { nome: nomes.join('\n') });
    f.nomes = nomes.length ? nomes : (f.nome ? [f.nome] : []);
    f.avisos.push('Confira com atenção as datas e horas: em imagens elas costumam ser pequenas.');
    return { tipo: 'conversa', meta: { ano }, f, msgs, arquivo: nome };
  }
  throw new Error('Formato não suportado: ' + nome);
}

// Mostra o print (PDF ou imagem) no visor, ajustado à largura disponível × zoom
const cachePdf = new WeakMap();
export async function desenharPrint(arquivo, destino, zoom = 1) {
  destino.innerHTML = '<p class="carregando">Abrindo o print…</p>';
  const largura = Math.max(200, destino.clientWidth - 28);
  // Renderiza com folga (2x a densidade da tela) para o print ficar nítido
  const dpr = Math.min(4, (window.devicePixelRatio || 1) * 2);
  if (/\.pdf$/i.test(arquivo.name || '') || arquivo.type === 'application/pdf') {
    let pdf = cachePdf.get(arquivo);
    if (!pdf) {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
      cachePdf.set(arquivo, pdf);
    }
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const escala = (largura / pg.getViewport({ scale: 1 }).width) * zoom;
      const vp = pg.getViewport({ scale: escala * dpr });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      c.style.width = `${Math.round(vp.width / dpr)}px`;
      c.style.height = `${Math.round(vp.height / dpr)}px`;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
      paginas.push(c);
    }
    destino.replaceChildren(...paginas);
    return;
  }
  if (/^image\//.test(arquivo.type)) {
    const img = new Image();
    img.src = URL.createObjectURL(arquivo);
    await img.decode();
    img.style.width = `${Math.round(Math.min(largura, img.naturalWidth) * zoom)}px`;
    destino.replaceChildren(img);
  }
}
