// Leitura dos arquivos anexados: PDF (texto + imagens dos prints) e imagens soltas.
// Tudo acontece no navegador, sem enviar nada para fora.
import * as pdfjsLib from '../lib/pdfjs/pdf.min.mjs';
import { acharMolduras, retangulosDeImagens, acharDivisoria } from './molduras.js?v=0.9.2';
import * as N from './nucleo.js?v=0.9.2';

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
const paraLinhas = (data) => {
  let linhas = data.lines;
  if (!linhas && data.blocks) linhas = data.blocks.flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
  return (linhas || []).map((l) => ({ texto: (l.text || '').trim(), x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1 }));
};
async function ocrCanvas(canvas, psm = '4') {
  return comLeitor(async (w) => {
    const ler = async (modo, sauvola) => {
      await w.setParameters({ tessedit_pageseg_mode: modo, thresholding_method: sauvola ? '2' : '0' });
      const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
      return paraLinhas(data);
    };
    try {
      // tela escura (invertida): limiar adaptativo (Sauvola), que não perde o texto cinza miúdo
      let linhas = await ler(psm, !!canvas.escuro);
      // letra miúda: sem nenhum carimbo de hora lido, tenta de novo com o limiar adaptativo
      // e, se ainda faltar, uma leitura "esparsa" só para aproveitar os carimbos
      if (psm === '4' && N.precisaSegundaLeitura(linhas)) {
        const l2 = canvas.escuro ? [] : await ler('4', true);
        if (l2.length && !N.precisaSegundaLeitura(l2)) linhas = l2;
        else linhas = N.juntarCarimbos(linhas, await ler('11', true));
      }
      return linhas;
    } finally {
      await w.setParameters({ tessedit_pageseg_mode: '4', thresholding_method: '0' });
    }
  });
}

// Recorta a região e amplia (melhora muito o reconhecimento)
function luminanciaMedia(origem, r) {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(origem, r.x, r.y, r.w, r.h, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  let soma = 0;
  for (let i = 0; i < d.length; i += 4) soma += (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
  return soma / (d.length / 4);
}
// Recorta a região e amplia (melhora muito o reconhecimento); tela escura (modo escuro, barra do Windows) é invertida
function recorteAmpliado(origem, r, ampliacao = AMPLIACAO) {
  const c = document.createElement('canvas');
  c.width = Math.round(r.w * ampliacao); c.height = Math.round(r.h * ampliacao);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  c.escuro = luminanciaMedia(origem, r) < 110;
  ctx.filter = c.escuro ? 'grayscale(1) invert(1)' : 'grayscale(1)';
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
  regioes.sort((a, b) => a.y - b.y);
  // Prints livres com painel de contato à direita: a conversa e o painel são lidos separados
  for (const r of [...regioes]) {
    if (r.modo === 'moldura' || r.painel) continue;
    const div = acharDivisoria(img, r);
    if (div) { const pw = r.x + r.w - div - 2; r.w = div - r.x - 1; regioes.push({ x: div + 2, y: r.y, w: pw, h: r.h, modo: 'livre', painel: r }); }
  }
  return regioes;
}

// Relógio da barra de tarefas (canto inferior direito, escuro): data e hora da captura
function cantoDaBarra(canvas, r) {
  const bw = Math.round(r.w * 0.2), bh = Math.max(12, Math.round(r.h * 0.045));
  const fundo = { x: r.x + r.w - bw, y: r.y + r.h - Math.round(bh / 2), w: bw, h: Math.round(bh / 2) };
  if (luminanciaMedia(canvas, fundo) >= 90) return null;
  return { x: r.x + r.w - bw, y: r.y + r.h - bh, w: bw, h: bh };
}

// Fila de OCR com aviso de andamento
function criarFila(aviso) {
  const tarefas = [];
  let feitas = 0;
  return {
    adicionar(canvas, extra = {}, barra = null) {
      const t = Promise.all([ocrCanvas(canvas), barra ? ocrCanvas(barra.canvas, '6') : null]).then(([linhas, linhasBarra]) => {
        feitas++;
        aviso && aviso(`Lendo as telas da conversa: ${feitas} de ${tarefas.length}…`);
        if (linhasBarra) {
          const k = canvas.width / barra.r.w; // posição do canto dentro da tela ampliada
          for (const l of linhasBarra) linhas.push({ texto: l.texto, barra: true,
            x0: (barra.dx + l.x0 / barra.amp) * k, x1: (barra.dx + l.x1 / barra.amp) * k,
            y0: (barra.dy + l.y0 / barra.amp) * k, y1: (barra.dy + l.y1 / barra.amp) * k });
        }
        return { largura: canvas.width, altura: canvas.height, linhas, ...extra };
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

// Lê as regiões de um canvas (página ou imagem) e põe na fila de OCR
function lerRegioes(canvas, regioes, fila, rotuloDe) {
  for (const r of regioes) {
    const extra = { modo: r.modo, fracao: r.fracao, rotulo: rotuloDe ? rotuloDe(r) : '', regiao: r, painelDe: r.painel || null };
    let barra = null;
    // o canto da barra fica na região mais à direita: o painel, se houver, ou a própria região
    if (r.modo !== 'moldura' && !regioes.some((x) => x.painel === r)) {
      const canto = cantoDaBarra(canvas, r);
      if (canto) barra = { canvas: recorteAmpliado(canvas, canto, 3), r, amp: 3, dx: canto.x - r.x, dy: canto.y - r.y };
    }
    // recorte do painel de contato (ou do terço direito do print), guardado para a leitura só de números
    if (r.modo !== 'moldura' && !regioes.some((x) => x.painel === r)) {
      const area = r.painel ? r : { x: r.x + Math.round(r.w * 0.62), y: r.y, w: Math.round(r.w * 0.38), h: r.h };
      extra.recortePainel = recorteAmpliado(canvas, area, 2.5);
    }
    fila.adicionar(recorteAmpliado(canvas, r), extra, barra);
  }
}

// Leitura só de dígitos no painel de contato: acha "+55 64 99222-1164" mesmo quando a leitura normal falha
async function telefoneSoDigitos(recortes) {
  for (const c of recortes) {
    const texto = await comLeitor(async (w) => {
      try {
        await w.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '+0123456789', thresholding_method: '2' });
        const { data } = await w.recognize(c);
        return data.text || '';
      } finally {
        await w.setParameters({ tessedit_pageseg_mode: '4', tessedit_char_whitelist: '', thresholding_method: '0' });
      }
    });
    const tel = N.telefoneDeDigitos(texto);
    if (tel) return tel;
  }
  return '';
}
async function completarTelefones(res, telas) {
  for (const r of res) {
    if (r.f.telefone || r.msgs.buscaSemResultado) continue;
    const recortes = [];
    for (const t of r.telas) {
      if (t.recortePainel) recortes.push(t.recortePainel);
      for (const p of t.paineisRecorte || []) recortes.push(p);
    }
    const tel = await telefoneSoDigitos(recortes);
    if (tel) {
      r.f.telefone = tel;
      r.f.avisos = r.f.avisos.filter((a) => !/telefone não aparece/.test(a));
      r.f.avisos.push(`Telefone lido do painel do contato: ${tel}. Confira.`);
    }
  }
  void telas;
}

// Analisa um arquivo e devolve uma lista: um resultado por número de telefone (ou o e-mail)
export async function analisarArquivo(arquivo, aviso, temOcr) {
  const nome = arquivo.name || 'arquivo';
  const doArquivo = N.lerNomeArquivo(nome);
  if (/\.pdf$/i.test(nome) || arquivo.type === 'application/pdf') {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      paginas.push({ pg, ...(await textoDaPagina(pg)) });
    }
    const textoTotal = paginas.map((x) => x.texto).join('\n');
    const meta0 = N.lerMetaPdf(textoTotal);
    const meta = { ...meta0, nomeArquivo: doArquivo.nome, ato: meta0.ato || doArquivo.ato, status: meta0.status || doArquivo.status, audiencia: doArquivo.audiencia };
    if (meta.ehEmail) return [{ tipo: 'email', meta, f: N.analisarEmail(textoTotal), arquivo: nome }];

    const telasTexto = [];
    const fila = temOcr ? criarFila(aviso) : null;
    if (temOcr) await obterPool(aviso);
    let rotuloAnterior = '';
    for (let p = 0; p < paginas.length; p++) {
      if (/Imagem enviada por|Documento enviado pela parte\s*:/.test(paginas[p].texto)) continue; // páginas só com fotos/documentos enviados pela parte
      const vp = paginas[p].pg.getViewport({ scale: ESCALA_PAGINA });
      const imagens = retangulosDeImagens(await paginas[p].pg.getOperatorList(), pdfjsLib.OPS, vp);
      // Página só com texto (PDF exportado com texto): lê direto, sem OCR
      if (!imagens.length) {
        const util = paginas[p].texto.replace(/PODER JUDICI[ÁA]RIO|Tribunal de Justi[çc]a[^\n]*|Diretoria Judici[áa]ria[^\n]*|PROCESSO N[º°][^\n]*|Capturado e gerado[^\n]*/gi, '').trim();
        if (util.length > 60) { telasTexto.push(telaDoTexto(paginas[p].itens, vp)); continue; }
      }
      if (!temOcr) continue;
      // Números grifados acima de cada print (camada de texto do PDF)
      const rotulos = paginas[p].itens.filter((it) => /^\s*(\+\s?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\s*$/.test(it.str))
        .map((it) => ({ tel: N.formatarTelefone(it.str), y: vp.convertToViewportPoint(it.transform[4], it.transform[5])[1] }));
      aviso && aviso(`Preparando a página ${p + 1} de ${paginas.length}…`);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await paginas[p].pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
      lerRegioes(canvas, regioesDoCanvas(canvas, imagens), fila, (r) => {
        if (r.painel) return '';
        const acima = rotulos.filter((x) => x.y < r.y + 8).sort((a, b) => b.y - a.y)[0];
        if (acima) rotuloAnterior = acima.tel;
        return rotuloAnterior;
      });
      canvas.width = canvas.height = 0; // libera memória
    }
    const telas = N.juntarPaineis(telasTexto.concat(fila ? await fila.todas() : []));
    if (!telas.length) {
      const f = N.analisarConversa([], meta);
      f.nomes = N.escolherNome({ rodape: meta.nomeRodape, arquivo: meta.nomeArquivo });
      return [semOcr({ tipo: 'conversa', meta, f, msgs: [], arquivo: nome }, temOcr, meta)];
    }
    const res = N.analisarTelas(telas, meta);
    if (temOcr) await completarTelefones(res, telas);
    const livre = telas.some((t) => t.modo === 'livre' && t.linhas.length && !telasTexto.includes(t));
    return res.map((r, i) => {
      if (livre) r.f.avisos.push('Este print não segue o modelo da CIRI: confira com atenção as datas e horas, que costumam ser pequenas na tela.');
      return semOcr({ tipo: 'conversa', meta, f: r.f, msgs: r.msgs, painel: r.telas.flatMap((t) => (t.painel || []).map((l) => l.texto)), arquivo: res.length > 1 ? `${nome} · ${r.f.telefone || 'número ' + (i + 1)}` : nome }, temOcr, meta);
    });
  }

  if (/^image\//.test(arquivo.type)) {
    if (!temOcr) throw new Error('Para ler imagens é preciso instalar o reconhecimento de texto (OCR).');
    const bmp = await createImageBitmap(arquivo);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    await obterPool(aviso);
    const fila = criarFila(aviso);
    lerRegioes(canvas, regioesDoCanvas(canvas, null), fila, null);
    const telas = N.juntarPaineis(await fila.todas());
    const meta = { ano: new Date().getFullYear(), nomeArquivo: doArquivo.nome, ato: doArquivo.ato, status: doArquivo.status, audiencia: doArquivo.audiencia };
    const resImg = N.analisarTelas(telas, meta);
    await completarTelefones(resImg, telas);
    return resImg.map((r, i, todos) => {
      r.f.avisos.push('Confira com atenção as datas e horas: em imagens elas costumam ser pequenas.');
      return { tipo: 'conversa', meta, f: r.f, msgs: r.msgs, arquivo: todos.length > 1 ? `${nome} · ${r.f.telefone || 'número ' + (i + 1)}` : nome };
    });
  }
  throw new Error('Formato não suportado: ' + nome);
}

function semOcr(fonte, temOcr, meta) {
  if (temOcr) return fonte;
  const f = fonte.f;
  // Sem OCR, a situação sai do rodapé do PDF (status dado pelo sistema)
  f.situacao = { EFETIVADA: 'INT_EXPRESSA', EXPEDIDA: 'CIT_EXPEDIDA', FRUSTRADA: 'FRUST_SEM_RESPOSTA' }[meta.status] || f.situacao;
  f.avisos = ['O reconhecimento de texto (OCR) não está instalado: li só o cabeçalho e o rodapé do PDF (nome, telefone e status). Escolha a situação e preencha datas e horas.'];
  return fonte;
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
