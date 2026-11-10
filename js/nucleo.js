// Núcleo da extensão: leitura da conversa, regras de classificação e modelos de certidão.
// Funciona no navegador e no Node (para testes). Nenhum dado sai do computador.

// ---------------------------------------------------------------------------
// Utilidades de data e hora
// ---------------------------------------------------------------------------
const MESES_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MESES_PT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const MESES_PT_EXT = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const pad = (n) => String(n).padStart(2, '0');
export const fmtData = (t) => (t ? `${pad(t.dia)}/${pad(t.mes)}/${t.ano}` : '');
export const fmtHora = (t) => (t ? `${pad(t.hora)}h${pad(t.min)}` : '');
const chaveTempo = (t) => (t ? t.ano * 1e8 + t.mes * 1e6 + t.dia * 1e4 + t.hora * 100 + t.min : 0);

// Reconhece uma linha que é só o carimbo de data/hora de uma mensagem.
// dataRef = { dia, mes, ano } usada quando o carimbo traz só a hora ("06:39").
export function lerCarimbo(texto, ano, dataRef) {
  const t = texto.replace(/[«»|✓✔︎]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 34) return null;
  let m = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2})\s*[,.]?\s*(\d{1,2})\s*[:.;]?\s*(\d{2})\s*([AP])\.?\s*M\b/i);
  if (m) {
    let h = +m[3];
    const min = +m[4];
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[5].toUpperCase() === 'P' && h !== 12) h += 12;
    if (m[5].toUpperCase() === 'A' && h === 12) h = 0;
    return { dia: +m[2], mes: MESES_EN[m[1].toLowerCase().slice(0, 3)], ano, hora: h, min };
  }
  m = t.match(/\b(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç.]*,?\s*(?:de\s+(\d{4}),?\s*)?(?:[àa]s\s*)?(\d{1,2})[:h](\d{2})/i);
  if (m) return { dia: +m[1], mes: MESES_PT[m[2].toLowerCase()], ano: m[3] ? +m[3] : ano, hora: +m[4], min: +m[5] };
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?,?\s*(?:[àa]s\s*)?(\d{1,2})[:h](\d{2})\b/);
  if (m) {
    let a = m[3] ? +m[3] : ano;
    if (a < 100) a += 2000;
    return { dia: +m[1], mes: +m[2], ano: a, hora: +m[4], min: +m[5] };
  }
  // Só a hora (WhatsApp e aplicativos parecidos): "06:39", "editado · 06:47", "6:39 PM"
  if (t.length <= 22) {
    m = t.match(/^(?:[^0-9]{0,10}?)(\d{1,2})[:h](\d{2})\s*([AP])?\.?\s*M?\.?\W{0,6}[a-z]{0,2}\W{0,3}$/i);
    if (m && !/\d{3,}/.test(t)) {
      let h = +m[1];
      const min = +m[2];
      if (m[3]) { if (m[3].toUpperCase() === 'P' && h !== 12) h += 12; if (m[3].toUpperCase() === 'A' && h === 12) h = 0; }
      if (h > 23 || min > 59) return null;
      const d = dataRef || {};
      return { dia: d.dia || 0, mes: d.mes || 0, ano: d.ano || ano, hora: h, min, soHora: true };
    }
  }
  return null;
}

// Selo de data entre as mensagens: "Hoje", "Ontem", "05/11/2026", "5 de novembro de 2026"
function lerSeloData(texto, hoje) {
  const t = texto.replace(/[^\wÀ-ú/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 32) return null;
  if (/^hoje$/i.test(t)) return hoje;
  if (/^ontem$/i.test(t) && hoje) {
    const d = new Date(hoje.ano, hoje.mes - 1, hoje.dia - 1);
    return { dia: d.getDate(), mes: d.getMonth() + 1, ano: d.getFullYear() };
  }
  let m = t.match(/^(?:[a-zç-]+,?\s+)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/i);
  if (m) return { dia: +m[1], mes: +m[2], ano: +m[3] < 100 ? +m[3] + 2000 : +m[3] };
  m = t.match(/^(?:[a-zç-]+,?\s+)?(\d{1,2}) de ([a-zç]+)(?: de (\d{4}))?$/i);
  if (m && MESES_PT_EXT[m[2].toLowerCase()]) return { dia: +m[1], mes: MESES_PT_EXT[m[2].toLowerCase()], ano: m[3] ? +m[3] : (hoje ? hoje.ano : new Date().getFullYear()) };
  return null;
}

// ---------------------------------------------------------------------------
// Padrões das mensagens
// ---------------------------------------------------------------------------
const RE_SISTEMA = /atribuiu a si mesm|conversa visualizada|mensagem n[aã]o lida|conversa (resolvida|reaberta|marcada)|criado \d+ days|transcri[cç][aã]o autom|^mensagem de [aá]udio$|^\(?\d+\/\d+\)?$|^0?0:\d\d ?\/ ?0?0:\d\d/i;
const RE_COMPOSITOR_LONGO = /digite uma mensagem|digite sua mensagem|escreva uma mensagem|type a message|ctrl\s*\+\s*s agendar/i;
const ehCompositor = (t) => RE_COMPOSITOR_LONGO.test(t) || (t.length <= 26 && /\bmensagem\b/i.test(t) && !/[aá]udio|imagem|texto|lida/i.test(t));
const RE_SERVIDOR = [
  /neste telefone falo com/i, /^ol[aá],? tudo bem\?/i, /meu nome [eé] .{2,40}\. neste/i,
  /trabalho no tribunal de justi/i, /estou entrando em contato/i, /n[uú]mero do processo [eé]/i,
  /fica vossa senhoria|fica v\.?\s?s\.?[ªa]/i, /\b(intimad|citad)[oa]\s?\(a\)/i, /compartilhou um arquivo/i,
  /^baixar$/i, /solicito,? por gentileza/i, /confirm(e|ar) o recebimento/i, /poderia,? por gentileza/i,
  /aus[eê]ncia de (manifesta|confirma)/i, /atendimento (ser[aá]|foi) finalizado/i, /central de intima/i,
  /^prezad[oa]/i, /^informamos/i, /^atenciosamente/i, /agradecemos/i, /serventia judicial/i, /3018-6000/,
  /nesta oportunidade/i, /para quaisquer informa/i, /desejamos um excelente/i, /\.pdf\b/i, /^c[oó]digo de acesso/i,
];
const ehServidor = (s) => RE_SERVIDOR.some((r) => r.test(s));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------
// 1. Transformar telas (linhas com posição) ou texto colado em mensagens
// ---------------------------------------------------------------------------
// tela = { largura, altura, linhas: [{ texto, x0, x1, y0, y1 }] }  (posição opcional)
export function telasParaMensagens(telas, ano, opcoes = {}) {
  const vistas = new Set();
  const msgs = [];
  let titulo = '';
  let pendentes = []; // linhas aguardando o carimbo de hora

  // Data de referência para carimbos só com hora: data da captura, data na barra do Windows ou hoje
  let hoje = opcoes.dataCaptura || null;
  if (!hoje) {
    for (const tela of telas) for (const l of tela.linhas) {
      const m = (l.texto || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
      if (m && (l.texto || '').length < 45 && (!tela.altura || l.y0 / tela.altura > 0.85)) hoje = { dia: +m[1], mes: +m[2], ano: +m[3] };
    }
  }
  if (!hoje) { const d = new Date(); hoje = { dia: d.getDate(), mes: d.getMonth() + 1, ano: d.getFullYear() }; }
  let dataAtual = null;
  // Detector de lado único para todas as telas "livres" (mesmo aplicativo, mesma geometria)
  const livres = telas.filter((t) => t.modo !== 'moldura' && t.largura && t.linhas.length && t.linhas[0].x0 !== undefined);
  const normalizadas = livres.flatMap((t) => t.linhas
    .filter((l) => !t.altura || l.y1 / t.altura >= 0.05)
    .map((l) => ({ texto: l.texto, x0: l.x0 / t.largura, x1: l.x1 / t.largura })));
  const detectorGlobal = detectorDeLado(normalizadas, { largura: 1 });

  const fecharComHora = (lado, tempo) => {
    const resto = [];
    for (const p of pendentes) {
      if (lado === null || p.lado === lado || p.lado === 'sistema') p.tempo = tempo;
      else resto.push(p);
    }
    const atribuidas = pendentes.filter((p) => p.tempo);
    pendentes = resto;
    for (const p of atribuidas) emitir(p);
  };
  const emitir = (p) => {
    const chave = p.lado + '|' + norm(p.texto) + '|' + chaveTempo(p.tempo);
    if (vistas.has(chave)) return;
    vistas.add(chave);
    const ult = msgs[msgs.length - 1];
    if (ult && ult.lado === p.lado && chaveTempo(ult.tempo) === chaveTempo(p.tempo) && !p.novaBolha) {
      ult.texto += ' ' + p.texto;
    } else {
      msgs.push({ lado: p.lado, texto: p.texto, tempo: p.tempo });
    }
  };

  for (const tela of telas) {
    const temPos = tela.largura && tela.linhas.length && tela.linhas[0].x0 !== undefined;
    let linhas = temPos ? [...tela.linhas].sort((a, b) => a.y0 - b.y0) : tela.linhas;
    // Prints da CIRI (moldura amarela): posição fixa, já validada. Outros modelos: alinhamento.
    const lado = !temPos ? () => null
      : tela.modo === 'moldura' ? (l) => (l.x0 / tela.largura < 0.17 ? 'parte' : 'servidor')
      : (l) => detectorGlobal({ ...l, x0: l.x0 / tela.largura, x1: l.x1 / tela.largura });
    let yAnterior = null;
    let ladoAnterior = null;
    for (const l of linhas) {
      const texto = (l.texto || '').replace(/\s+/g, ' ').trim();
      if (!texto) continue;
      if (temPos && tela.altura && l.y1 / tela.altura < 0.05) { // cabeçalho da conversa (nome do contato)
        if (!titulo && l.x0 / tela.largura < 0.2 && /[a-zà-ú]{3}/i.test(texto)) titulo = texto.replace(/^[^A-Za-zÀ-ú]+/, '');
        continue;
      }
      if (ehCompositor(texto)) break; // fim da área de mensagens
      if (RE_SISTEMA.test(texto)) continue;
      const selo = lerSeloData(texto, hoje);
      if (selo) { dataAtual = selo; continue; }
      const ld = temPos ? lado(l) : null;
      if (ld === 'fora') continue; // painel lateral, barra de tarefas etc.
      const carimbo = lerCarimbo(texto, ano, dataAtual || hoje);
      if (carimbo) {
        if (!carimbo.soHora && carimbo.dia) dataAtual = { dia: carimbo.dia, mes: carimbo.mes, ano: carimbo.ano };
        fecharComHora(ld, carimbo);
        yAnterior = null;
        continue;
      }
      const lad = temPos ? ld : (ehServidor(texto) ? 'servidor' : null);
      const novaBolha = temPos && yAnterior !== null && ladoAnterior === lad && l.y0 - yAnterior > (l.y1 - l.y0) * 1.6;
      pendentes.push({ lado: lad, texto, novaBolha });
      yAnterior = temPos ? l.y1 : null;
      ladoAnterior = lad;
    }
  }
  for (const p of pendentes) { p.tempo = null; emitir(p); }

  // Texto sem posição: o que não é padrão do servidor é resposta da parte.
  for (const m of msgs) {
    if (m.lado === null) m.lado = ehServidor(m.texto) ? 'servidor' : 'parte';
  }
  msgs.titulo = titulo;
  return msgs;
}

// Decide o lado de cada linha pelo alinhamento, sem depender do modelo do print:
// as mensagens do servidor formam um bloco alinhado à direita (borda esquerda em "sx"),
// as da parte começam mais à esquerda. Linhas muito fora da coluna da conversa são ignoradas.
function detectorDeLado(linhas, tela, ano) {
  const W0 = tela.largura;
  const ancoras = linhas.filter((l) => (l.texto || '').length > 25 && ehServidor(l.texto));
  if (ancoras.length < 1) {
    return (l) => (l.x0 / W0 < 0.17 ? 'parte' : 'servidor');
  }
  const xs = ancoras.map((l) => l.x0).sort((a, b) => a - b);
  const sx = xs[Math.floor(xs.length / 2)];
  const R = Math.max(...ancoras.map((l) => l.x1));
  const W = Math.max((R - sx) / 0.72, W0 * 0.2);
  const L = R - W;
  return (l) => {
    if (l.x0 > R + 0.06 * W) return 'fora';
    if (l.x1 < L - 0.3 * W) return 'fora';
    return l.x0 < sx - 0.04 * W ? 'parte' : 'servidor';
  };
}

// ---------------------------------------------------------------------------
// 2. Extrair os fatos e sugerir a situação
// ---------------------------------------------------------------------------
const RE_TERCEIRO = /\bn[aã]o\s+(sou|[eé])\s+(eu|ele|ela|o\b|a\b|esse|essa|este|esta)|n[uú]mero errado|engano|n[aã]o conhe[cç]o|n[aã]o mora|faleceu|n[aã]o (tem|existe) ningu[eé]m/i;
const RE_IDENTIDADE = /\b(sim|sou eu|sou|eu mesm[oa]|el[ea] mesm[oa]|fala|falando|isso|pois n[aã]o|positivo|correto|[eé] el[ea]|[eé] eu)\b/i;
const RE_CIENCIA = /\breceb(i|ido|emos)\b|\bciente\b|\bconfirmo\b|tomei ci[eê]ncia/i;
const RE_CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b|\b\d{5,}\b/;

function tipoDoAto(txt) {
  const m = txt.match(/\b(decis[aã]o|despacho|senten[cç]a|ato ordinat[oó]rio|ac[oó]rd[aã]o|mandado|edital)\b/i);
  if (!m) return '';
  const k = norm(m[1]);
  return { decisao: 'decisão', despacho: 'despacho', sentenca: 'sentença', atoordinatorio: 'ato ordinatório', acordao: 'acórdão', mandado: 'mandado', edital: 'edital' }[k] || '';
}

export function analisarConversa(msgs, meta = {}) {
  const f = {
    canal: 'whatsapp', avisos: [], evidencias: [],
    nome: meta.nome || '', telefone: meta.telefone || '', processo: meta.processo || '', statusPrint: meta.status || '',
  };
  const serv = (re) => { const r = new RegExp(re.source, 'i'); return msgs.filter((m) => m.lado === 'servidor' && r.test(m.texto)); };
  const idx = (m) => msgs.indexOf(m);
  const ev = (rotulo, m) => m && f.evidencias.push({ rotulo, texto: m.texto.slice(0, 160), tempo: m.tempo, lado: m.lado });

  const falha409 = (m) => /\b409\b|sess[aã]o do whatsapp/i.test(m.texto);
  const falha404 = msgs.find((m) => /\b404\b|identificador whats\s?app/i.test(m.texto));
  const textoServ = msgs.filter((m) => m.lado === 'servidor').map((m) => m.texto).join(' ');

  // Tipo do ato (citação ou intimação)
  f.tipo = /\bcitad[oa]|\bcita[cç][aã]o\b/i.test(textoServ) ? 'citacao' : 'intimacao';

  // Contatos iniciais (tentativas)
  const contatos = serv(/neste telefone falo com|confirmar se neste telefone|dar continuidade ao seu atendimento/).filter((m) => !falha409(m));
  f.tentativas = [];
  for (const c of contatos) {
    if (c.tempo && !f.tentativas.some((t) => fmtData(t) === fmtData(c.tempo))) f.tentativas.push(c.tempo);
  }
  contatos.forEach((c) => ev('Contato inicial', c));

  // Intimação / citação e arquivos
  const candAto = serv(/fica (vossa senhoria|v\.?\s?s)|ficam vossas|(intimad|citad)[oa]s?\s?\(a\)|(intimad|citad)[oa]s?\b/).filter((m) => !falha409(m));
  const msgAto = candAto.find((m) => !/nesta oportunidade[^.]*tomar ci[eê]ncia/i.test(m.texto)) || candAto[0];
  const arquivos = serv(/compartilhou um arquivo/);
  const pedidoConfirmacao = serv(/confirm(e|ar) o recebimento/)[0];
  ev('Mensagem do ato', msgAto);
  if (arquivos[0]) ev('Envio de arquivos', arquivos[0]);
  f.horaAto = (msgAto && msgAto.tempo) || (arquivos[0] && arquivos[0].tempo) || null;

  // Evento e tipo do ato: preferir a mensagem final "Nesta oportunidade..." que traz os dois
  const nesta = serv(/nesta oportunidade/)[0];
  const fonteAto = (nesta && nesta.texto) + ' ' + textoServ;
  const mEv = fonteAto.match(/evento\s*(?:n[º°o.]*\s*)?(\d{1,4})/i);
  f.evento = mEv ? mEv[1] : '';
  const mTeor = fonteAto.match(/teor\s+d[oa]\s*\(?a?\)?\s+([A-Za-zÀ-ú ]{4,30}?)\s+(expedid|proferid)/i);
  f.tipoAto = (mTeor && tipoDoAto(mTeor[1])) || tipoDoAto(fonteAto);

  // Arquivos enviados: o do processo e o código de acesso são padrão; os demais viram "extras"
  const nomesArquivos = [];
  for (const a of arquivos) {
    for (const mm of a.texto.matchAll(/compartilhou um arquivo\s+(.+?\.p\s?d\s?[a-z]?f)/gi)) nomesArquivos.push(mm[1].trim());
  }
  f.arquivos = [...new Set(nomesArquivos)];
  const extras = f.arquivos.filter((n) => !/c[oó]digo de acesso|\d{7}-?\d{2}\.\d{4}/i.test(n));
  f.extras = extras.map((n) => n.replace(/\.p\s?d\s?[a-z]?f$/i, '').trim()).join('; ');

  // Encerramento
  const fecho = msgs.filter((m) => m.lado === 'servidor' && /atenciosamente|atendimento desta central foi finalizado|central de intima[cç][aã]o remota do interior.*cir/i.test(m.texto) && m.tempo);
  f.encerramento = fecho.length ? fecho[fecho.length - 1].tempo : null;
  if (fecho.length) ev('Encerramento', fecho[fecho.length - 1]);
  const porAusencia = serv(/aus[eê]ncia de (manifesta|confirma)/)[0];

  // Respostas da parte
  // Respostas da parte: sem ruído de OCR e sem repetir a mesma mensagem lida em outra tela
  const vistasResp = new Set();
  const respostas = msgs.filter((m) => {
    if (m.lado !== 'parte') return false;
    const letras = (m.texto.match(/[A-Za-zÀ-ú]/g) || []).length;
    if (letras < 2 || !/[A-Za-zÀ-ú]{2,}/.test(m.texto) || letras / m.texto.replace(/\s/g, '').length < 0.5) return false;
    const k = norm(m.texto).slice(0, 40);
    if (vistasResp.has(k)) return false;
    vistasResp.add(k);
    return true;
  });
  f.respostas = respostas;
  const iAto = msgAto ? idx(msgAto) : arquivos[0] ? idx(arquivos[0]) : Infinity;
  const iArq = arquivos[0] ? idx(arquivos[0]) : iAto;
  const antes = respostas.filter((r) => idx(r) < iAto);
  const depois = respostas.filter((r) => idx(r) > iArq);
  respostas.slice(0, 6).forEach((r) => ev('Resposta da parte', r));

  // Documentos de identidade (imagens enviadas pela parte, legendas do PDF) ou CPF
  f.imagensParte = meta.imagensParte || respostas.filter((r) => /\[(imagem enviada|arquivo)\]/i.test(r.texto)).length;
  // CPF: só vale resposta curta, depois de o servidor pedir o CPF
  const pedidoCpf = serv(/\bCPF\b/)[0];
  const cpf = pedidoCpf && respostas.find((r) => idx(r) > idx(pedidoCpf) && r.texto.length < 40 && RE_CPF.test(r.texto));
  // Documento: legendas "Imagem enviada" (PDF da CIRI) ou resposta da parte depois do pedido de documento/foto
  const pedidoDoc = serv(/documento|foto|identidade|identifica[cç][aã]o/)[0];
  const respDoc = pedidoDoc && respostas.find((r) => idx(r) > idx(pedidoDoc) && idx(r) < iArq);
  f.docTipo = f.imagensParte > 0 ? 'documento' : cpf ? 'cpf' : respDoc ? 'documento' : '';
  if (!f.imagensParte && !cpf && respDoc) f.docInferido = true;

  // Identidade confirmada antes do ato
  const ident = antes.find((r) => RE_IDENTIDADE.test(r.texto)) || antes[0];
  f.identidade = ident ? ident.tempo : null;

  // Audiência
  const msgAud = serv(/audi[eê]ncia/)[0];
  if (msgAud) {
    const ma = msgAud.texto.match(/(\d{2}\/\d{2}\/\d{4})[^0-9]{0,25}(\d{1,2})[:h](\d{2})/);
    f.audiencia = { data: ma ? ma[1] : '', hora: ma ? `${pad(+ma[2])}h${ma[3]}` : '', link: /https?:\/\/|link/i.test(textoServ) };
  }

  // Nome pela saudação, quando o print não traz rodapé
  if (!f.nome) {
    const sauda = msgs.find((m) => /falo com/i.test(m.texto));
    const mn = sauda && sauda.texto.match(/falo com\s*(?:o|a)?\s*(?:\(a\)\s*)?(?:Sr\s*\(a\)\.?|Sra?\.?)\s*([^?]{3,80}?)\s*\?/i);
    if (mn) f.nome = nomeProprio(mn[1].replace(/[^A-Za-zÀ-ú' -]/g, '').trim());
  }
  if (!f.telefone) f.avisos.push('O telefone não aparece no print. Preencha manualmente.');

  // ----- Regras -----
  const terceiro = respostas.find((r) => RE_TERCEIRO.test(r.texto));
  if (falha404 && respostas.length === 0) {
    f.situacao = 'FRUST_SEM_WHATSAPP';
    const anterior404 = msgs.slice(0, idx(falha404) + 1).reverse().find((m) => m.lado === 'servidor' && m.tempo);
    f.tempoPrincipal = falha404.tempo || (anterior404 && anterior404.tempo) || (contatos[0] && contatos[0].tempo);
    ev('Falha de envio (404)', falha404);
  } else if (respostas.length === 0) {
    f.situacao = 'FRUST_SEM_RESPOSTA';
    if (!f.tentativas.length && f.horaAto) f.tentativas = [f.horaAto];
  } else if (terceiro && (!arquivos.length || idx(terceiro) < iArq)) {
    f.situacao = 'FRUST_TERCEIRO';
    f.tempoPrincipal = (contatos[0] && contatos[0].tempo) || terceiro.tempo;
    ev('Resposta de terceiro', terceiro);
  } else if (f.tipo === 'citacao') {
    f.tempoPrincipal = f.horaAto || (contatos[0] && contatos[0].tempo);
    if (f.docTipo || arquivos.length) {
      f.situacao = 'CIT_EFETIVADA';
      if (!f.docTipo) { f.docTipo = 'documento'; f.avisos.push('Arquivos enviados, mas não identifiquei o documento ou o CPF no print. Confira.'); }
      else if (f.docInferido) f.avisos.push('Deduzi que a parte enviou foto do documento (respondeu ao pedido antes do envio dos arquivos). Confira no print.');
    } else {
      f.situacao = f.audiencia ? 'CIT_EXPEDIDA_AUD' : 'CIT_EXPEDIDA';
    }
  } else {
    f.tempoPrincipal = f.horaAto || (contatos[0] && contatos[0].tempo);
    const expressa = depois.find((r) => r.texto.length <= 100 && RE_CIENCIA.test(r.texto));
    if (expressa) {
      f.situacao = 'INT_EXPRESSA';
      f.frase = limparFrase(expressa.texto);
      ev('Declaração de ciência', expressa);
    } else if (depois.length) {
      f.situacao = 'INT_TACITA';
      f.tacita = 'manifestando-se sobre o conteúdo do ato';
      depois.slice(0, 3).forEach((r) => ev('Resposta depois dos arquivos', r));
      f.avisos.push('A parte respondeu depois do envio dos arquivos, sem declarar ciência. Sugeri ciência tácita: confira se as mensagens demonstram conhecimento do ato.');
    } else {
      f.situacao = 'INT_SEM_MANIF';
      if (!f.encerramento && porAusencia) f.encerramento = porAusencia.tempo;
    }
    if (f.identidade && f.tempoPrincipal && fmtData(f.identidade) !== fmtData(f.tempoPrincipal)) f.identidadeAnterior = f.identidade;
  }

  if (msgs.some(falha409)) f.avisos.push('Há mensagens com falha 409 (sessão do WhatsApp desconectada). Foram desconsideradas como tentativa.');
  if (f.statusPrint) {
    const mapa = { FRUST: 'FRUSTRADA', INT_: 'EFETIVADA', CIT_E: 'EFETIVADA' };
    const esperado = f.situacao.startsWith('FRUST') ? 'FRUSTRADA' : f.situacao.startsWith('CIT_EXP') ? 'EXPEDIDA' : 'EFETIVADA';
    if (f.statusPrint !== esperado) f.avisos.push(`O rodapé do print indica "${f.statusPrint}", mas a análise sugere "${esperado}". Confira.`);
    void mapa;
  }
  if (!f.tempoPrincipal && !f.tentativas.length) f.avisos.push('Não encontrei a data e a hora no print. Preencha manualmente.');
  return f;
}

function limparFrase(t) {
  let s = t.replace(/\s+/g, ' ').trim();
  const m = s.match(/(recebi[^.!]*ciente)/i) || s.match(/(estou ciente|recebido|confirmo o recebimento)/i);
  if (m) s = m[1];
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.replace(/[.!]+$/, '');
}

// ---------------------------------------------------------------------------
// 3. E-mail (PDF impresso do Gmail/Outlook, com texto)
// ---------------------------------------------------------------------------
export function analisarEmail(texto) {
  const f = { canal: 'email', avisos: [], evidencias: [] };
  const cab = [...texto.matchAll(/^(?!\s*Para:)([^<\n]{0,80})<([^>\s]+@[^>\s]+)>[^\n]*$/gim)];
  const datas = [...texto.matchAll(/(\d{1,2}) de ([a-zç]+)\.?(?: de (\d{4}))?,? (?:[àa]s )?(\d{1,2}):(\d{2})/gi)]
    .filter((d) => MESES_PT_EXT[d[2].toLowerCase()] || MESES_PT[d[2].toLowerCase().slice(0, 3)]);
  const anoPadrao = new Date().getFullYear();
  const msgs = [];
  cab.forEach((h, i) => {
    const fim = i + 1 < cab.length ? cab[i + 1].index : Infinity;
    const d = datas.find((x) => x.index > h.index && x.index < fim);
    if (!d) return;
    msgs.push({ nome: h[1].trim(), email: h[2].toLowerCase(), pos: h.index,
      tempo: { dia: +d[1], mes: MESES_PT_EXT[d[2].toLowerCase()] || MESES_PT[d[2].toLowerCase().slice(0, 3)], ano: d[3] ? +d[3] : anoPadrao, hora: +d[4], min: +d[5] } });
  });
  const ehTribunal = (e) => /tjgo\.jus\.br$/.test(e);
  const envio = msgs.find((x) => ehTribunal(x.email));
  const iEnvio = envio ? msgs.indexOf(envio) : -1;
  const resposta = msgs.slice(iEnvio + 1).find((x) => !ehTribunal(x.email));
  const para = texto.slice(envio ? envio.pos : 0).match(/Para:\s*[^<\n]*<([^>\s]+@[^>\s]+)>/i);
  f.email = para ? para[1].toLowerCase() : '';
  if (!f.email) { const p2 = texto.match(/\bpara:?\s+<?([^\s<>]+@[^\s<>]+?)>?(?:\s|$)/i); if (p2 && !/tjgo\.jus\.br$/i.test(p2[1])) f.email = p2[1].toLowerCase(); }
  f.tempoPrincipal = envio ? envio.tempo : null;
  f.tipo = /cita[cç][aã]o|citad[oa]/i.test(texto.slice(0, 600)) ? 'citacao' : 'intimacao';
  const nome = texto.match(/Senhor\s*\(a\)\s*(?:Perito\s*\(a\)\s*)?([A-ZÀ-Ú][^!\n,]{3,60})/);
  f.nome = nome ? nome[1].trim() : '';
  f.perito = /perit[oa]/i.test(texto);
  f.emailDocs = /carta de intima/i.test(texto) && /decis[aã]o/i.test(texto) ? 'a carta de intimação, a decisão judicial e o respectivo código de acesso' : 'os arquivos do processo e o respectivo código de acesso';
  if (resposta) {
    f.situacao = 'EMAIL_EFETIVADA';
    f.confTempo = resposta.tempo;
    f.confEmail = resposta.email !== f.email ? resposta.email : '';
    const assinatura = texto.slice(resposta.pos).match(/\n\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+)+)\s*\(([^)]{3,30})\)/);
    f.confPor = assinatura ? `sua ${assinatura[2].trim()} ${assinatura[1].trim()}` : '';
    f.evidencias.push({ rotulo: 'Resposta', texto: `${resposta.nome} <${resposta.email}>`, tempo: resposta.tempo, lado: 'parte' });
  } else {
    f.situacao = 'EMAIL_FRUSTRADA';
    const ult = msgs[msgs.length - 1];
    f.encerramento = ult && ult !== envio ? ult.tempo : null;
    f.avisos.push('Sem resposta ao e-mail. Informe a data e a hora do encerramento, se houver.');
  }
  if (envio) f.evidencias.unshift({ rotulo: 'Envio', texto: `${envio.nome} <${envio.email}>`, tempo: envio.tempo, lado: 'servidor' });
  return f;
}

// ---------------------------------------------------------------------------
// 4. Modelos de certidão
// ---------------------------------------------------------------------------
export const SITUACOES = {
  INT_EXPRESSA: 'Intimação efetivada – ciência expressa',
  INT_TACITA: 'Intimação efetivada – ciência tácita',
  INT_SEM_MANIF: 'Intimação sem manifestação de ciência',
  CIT_EFETIVADA: 'Citação efetivada',
  CIT_EXPEDIDA: 'Citação expedida – somente citação',
  CIT_EXPEDIDA_AUD: 'Citação expedida – com audiência',
  FRUST_SEM_RESPOSTA: 'Frustrada – sem resposta',
  FRUST_SEM_WHATSAPP: 'Frustrada – número sem WhatsApp',
  FRUST_TERCEIRO: 'Frustrada – terceiro',
  EMAIL_EFETIVADA: 'E-mail – efetivada',
  EMAIL_FRUSTRADA: 'E-mail – frustrada',
};

export const QUALIFICACOES = {
  parte: ['da parte', 'da parte'],
  requerente: ['do requerente', 'da requerente'],
  requerido: ['do requerido', 'da requerida'],
  parte_requerente: ['da parte requerente', 'da parte requerente'],
  parte_requerida: ['da parte requerida', 'da parte requerida'],
  parte_autora: ['da parte autora', 'da parte autora'],
  promovente: ['da parte promovente', 'da parte promovente'],
  promovido: ['da parte promovida', 'da parte promovida'],
  exequente: ['do exequente', 'da exequente'],
  parte_exequente: ['da parte exequente', 'da parte exequente'],
  executado: ['do executado', 'da executada'],
  parte_executada: ['da parte executada', 'da parte executada'],
  autor_fato: ['do autor do fato', 'da autora do fato'],
  reu: ['do réu', 'da ré'],
  vitima: ['da vítima', 'da vítima'],
  perito: ['do perito nomeado', 'da perita nomeada'],
  testemunha: ['da testemunha', 'da testemunha'],
};
export const ROTULOS_QUALIFICACAO = {
  parte: 'Parte (genérico)', requerente: 'Requerente', requerido: 'Requerido(a)', parte_requerente: 'Parte requerente',
  parte_requerida: 'Parte requerida', parte_autora: 'Parte autora', promovente: 'Promovente', promovido: 'Promovido(a)',
  exequente: 'Exequente', parte_exequente: 'Parte exequente', executado: 'Executado(a)', parte_executada: 'Parte executada',
  autor_fato: 'Autor(a) do fato', reu: 'Réu / Ré', vitima: 'Vítima', perito: 'Perito(a) nomeado(a)', testemunha: 'Testemunha',
};

const FEMININOS = /^(raquel|isabel|izabel|ruth|rute|beatriz|ines|inês|lourdes|mabel|ester|esther|ely|nely|rachel|miriam|carmen|sueli|suely|nicole|ingrid|liz|luz|cristiane|michele|gisele|daniele|aline|eliane|viviane|simone|ivone|denise|rose|alice|jane|ivete|clarice|cleide|irene|lene|leonice|joice|kelly|keli|shirley|jaqueline|jakeliny|tatiane|cleonice|marli|edileuza|jussara|deise)$/i;
const MASC_A = /^(luca|joshua|jonatha|nikita|elias|josias|tobias|matias|messias|isaias|jonas|lucas|thomas|marcos|carlos|nicolas)$/i;
export function adivinharGenero(nome) {
  const p = (nome || '').trim().split(/\s+/)[0] || '';
  if (FEMININOS.test(p)) return 'f';
  if (MASC_A.test(p)) return 'm';
  return /a$|nne$|lle$|ette$|ine$|ane$|iane$/i.test(p) ? 'f' : 'm';
}

const ARTIGO_ATO = { 'decisão': 'da decisão', despacho: 'do despacho', 'sentença': 'da sentença', 'ato ordinatório': 'do ato ordinatório', 'acórdão': 'do acórdão', mandado: 'do mandado', edital: 'do edital', '': 'do ato' };
const deFrase = (s) => s.replace(/^(as|os|a|o)\s/i, (m, a) => ({ a: 'da ', o: 'do ', as: 'das ', os: 'dos ' })[a.toLowerCase()]);

export function nomeProprio(s) {
  const minusc = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
  return (s || '').toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => (i > 0 && minusc.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

// Nomes das partes: rodapé do PDF ou, quando o rodapé vem abreviado ("... E SR(A)"), o título da conversa.
export function nomesDasPartes(nomeRodape, titulo) {
  let base = nomeRodape || '';
  const abreviado = /\bE SR\(?A?\)?\.?$|\bE SRA\.?$/i.test(base);
  if ((abreviado || !base) && titulo) base = titulo;
  base = base.replace(/\s+E SR\(?A?\)?\.?$|\s+E SRA\.?$/i, '').trim();
  return base.split(/\s+(?:e|E)\s+(?=[A-ZÀ-Ú])/).map((n) => nomeProprio(n.trim())).filter(Boolean);
}

export function formatarTelefone(t) {
  const d = (t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || '';
}

// Recebe os campos (já revisados pelo servidor) e devolve o texto com **negrito** e *itálico*.
export function gerarCertidao(c) {
  const g = c.genero === 'f' ? 1 : 0;
  const qual = (QUALIFICACOES[c.qualificacao] || QUALIFICACOES.parte)[g];
  const oqual = g ? 'a qual' : 'o qual';
  const ato = c.tipo === 'citacao' ? 'citação' : 'intimação';
  const B = (s) => (s ? `**${s}**` : '**[preencher]**');
  const nome = B(c.nome);
  const tel = B(c.telefone);
  const comum = c.numeroComum ? `, ${c.textoComum || 'número comum a ambas as partes'}` : '';
  const dia = (d, h) => `no dia ${B(d)}, às ${B(h)}`;
  const atoTxt = `${ARTIGO_ATO[c.tipoAto || ''] || 'do ato'}${c.evento ? ` do evento ${c.evento}` : ''}`;
  const extrasItens = (c.extras || '').split(/\s*;\s*|\s*,\s*(?=(?:a|o|as|os)\s)/i).map((x) => x.trim()).filter(Boolean)
    .map((x) => (/^(a|o|as|os)\s/i.test(x) ? x.replace(/^\w/, (l) => l.toLowerCase()) : `o arquivo ${x}`));
  const itens = [`o inteiro teor ${atoTxt}`, 'o respectivo código de acesso', ...extrasItens];
  const juntar = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0]);
  const listaEnviada = juntar(itens);
  const listaRecebida = juntar(itens.map(deFrase));
  const print = 'conforme registrado no *print* da conversa em anexo.';
  const anterior = c.identidadeData ? `, previamente confirmado em ${B(c.identidadeData)}, às ${B(c.identidadeHora)}` : '';
  // "..., o qual confirmou sua identidade e, após ..." ou, se confirmada antes, "..., o qual, após ..."
  const sujeito = c.identidadeData ? `${oqual},` : `${oqual} confirmou sua identidade e,`;
  const recebimento = `após o recebimento ${listaRecebida}`;

  switch (c.situacao) {
    case 'INT_EXPRESSA':
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}${anterior}, procedi à intimação ${qual} ${nome}, ${sujeito} ${recebimento}, declarou expressamente "${c.frase || 'Recebi e estou ciente'}", operando-se a regular e plena ciência do ato, ${print}`;
    case 'INT_TACITA':
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}${anterior}, procedi à intimação ${qual} ${nome}, ${sujeito} ${recebimento}, prosseguiu interagindo na conversa${c.tacita ? `, inclusive ${c.tacita}` : ''}, o que demonstra, de forma tácita, a ciência inequívoca do ato, ${print}`;
    case 'INT_SEM_MANIF':
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}${anterior}, procedi à intimação ${qual} ${nome}${c.identidadeData ? '' : `, ${oqual} confirmou sua identidade`}, tendo-lhe sido encaminhados ${listaEnviada}. Solicitada a confirmação do recebimento dos arquivos, não houve resposta, razão pela qual o atendimento foi encerrado em ${B(c.encData)}, às ${B(c.encHora)}, ${print}`;
    case 'CIT_EFETIVADA': {
      const doc = c.docTipo === 'cpf' ? 'completou o número de seu CPF' : 'realizou o envio da imagem de seu documento de identificação';
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}, procedi à citação ${qual} ${nome}, ${oqual} confirmou sua identidade e ${doc}, tendo-lhe sido encaminhados o inteiro teor do ato e o respectivo código de acesso, operando-se a regular citação, ${print}`;
    }
    case 'CIT_EXPEDIDA':
    case 'CIT_EXPEDIDA_AUD': {
      const aud = c.situacao === 'CIT_EXPEDIDA_AUD'
        ? ` e foi intimad${g ? 'a' : 'o'} da audiência de conciliação designada para ${B(c.audData)}, às ${B(c.audHora)}${c.audLink ? ', tendo recebido o respectivo link de acesso' : ''}`
        : '';
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}, procedi à citação ${qual} ${nome}, ${oqual} confirmou sua identidade${aud}, porém não enviou imagem de documento de identificação nem completou o número de seu CPF, razão pela qual não lhe foram encaminhados os arquivos do processo nem o respectivo código de acesso, restando a citação expedida, ${print}`;
    }
    case 'FRUST_SEM_RESPOSTA': {
      const t = (c.tentativas || []).filter((x) => x.data);
      let quando;
      if (t.length <= 1) quando = dia(t[0] ? t[0].data : c.data, t[0] ? t[0].hora : c.hora);
      else {
        const itens = t.map((x) => `${B(x.data)}, às ${B(x.hora)}`);
        quando = `nos dias ${itens.slice(0, -1).join(', ')}, e ${itens[itens.length - 1]}`;
      }
      const enc = c.encData ? ` Diante da ausência de manifestação, o atendimento foi encerrado em ${B(c.encData)}, às ${B(c.encHora)}, restando frustrada a ${ato},` : ` Diante da ausência de manifestação, restou frustrada a ${ato},`;
      return `Certifico que, ${quando}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}, tentei proceder à ${ato} ${qual} ${nome}, não tendo obtido qualquer resposta às mensagens enviadas.${enc} ${print}`;
    }
    case 'FRUST_SEM_WHATSAPP':
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, tentei proceder à ${ato} ${qual} ${nome} pelo número ${tel}${comum}, não tendo sido possível o envio da mensagem, uma vez que o sistema retornou erro informando que não foi possível localizar o identificador WhatsApp do destinatário, o que indica que o referido número não possui conta ativa no aplicativo, restando frustrada a ${ato}, ${print}`;
    case 'FRUST_TERCEIRO':
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}, tentei proceder à ${ato} ${qual} ${nome}, tendo a pessoa que respondeu à mensagem informado não se tratar d${g ? 'a destinatária' : 'o destinatário'}, sendo terceiro estranho à relação processual, restando frustrada a ${ato}, ${print}`;
    case 'EMAIL_EFETIVADA': {
      const pelo = c.confEmail ? ` pelo endereço ${B(c.confEmail)}` : '';
      const por = c.confPor ? `, por meio de ${c.confPor}` : '';
      return `Certifico que, ${dia(c.data, c.hora)}, através de correio eletrônico, encaminhado ao endereço ${B(c.email)}, procedi à ${ato} ${qual} ${nome}, tendo-lhe sido remetidos ${c.emailDocs || 'os arquivos do processo e o respectivo código de acesso'}. Em ${B(c.confData)}, às ${B(c.confHora)}, foi acusado o recebimento da ${ato}${pelo}${por}, operando-se a regular ciência do ato, conforme registrado no *print* do e-mail em anexo.`;
    }
    case 'EMAIL_FRUSTRADA': {
      const enc = c.encData ? ` até o encerramento do atendimento, em ${B(c.encData)}, às ${B(c.encHora)}` : '';
      return `Certifico que, ${dia(c.data, c.hora)}, através de correio eletrônico, encaminhado ao endereço ${B(c.email)}, tentei proceder à ${ato} ${qual} ${nome}, não tendo sido obtida qualquer resposta${enc}, restando frustrada a ${ato}, conforme registrado no *print* do e-mail em anexo.`;
    }
    default:
      return '';
  }
}

// Vários contatos, todos frustrados: uma única certidão (modelo 6.11).
export function gerarCertidaoMultipla(base, contatos) {
  const g = base.genero === 'f' ? 1 : 0;
  const qual = (QUALIFICACOES[base.qualificacao] || QUALIFICACOES.parte)[g];
  const ato = base.tipo === 'citacao' ? 'citação' : 'intimação';
  const B = (s) => (s ? `**${s}**` : '**[preencher]**');
  const partes = contatos.map((k) => {
    const t = (k.tentativas && k.tentativas.length ? k.tentativas : [{ data: k.data, hora: k.hora }]);
    const quando = t.length > 1
      ? `nos dias ${t.slice(0, -1).map((x) => `${B(x.data)}, às ${B(x.hora)}`).join(', ')}, e ${B(t[t.length - 1].data)}, às ${B(t[t.length - 1].hora)}`
      : `no dia ${B(t[0].data)}, às ${B(t[0].hora)}`;
    if (k.canal === 'email') return `através de correio eletrônico, encaminhado ao endereço ${B(k.email)}, ${quando}, sem obter resposta`;
    if (k.situacao === 'FRUST_SEM_WHATSAPP') return `através do aplicativo WhatsApp, no número ${B(k.telefone)}, ${quando}, não tendo sido possível o envio da mensagem por ausência de conta ativa no aplicativo`;
    if (k.situacao === 'FRUST_TERCEIRO') return `através do aplicativo WhatsApp, no número ${B(k.telefone)}, ${quando}, tendo respondido terceiro estranho à relação processual`;
    return `através do aplicativo WhatsApp, no número ${B(k.telefone)}, ${quando}, sem obter resposta`;
  });
  const lista = partes.length > 1 ? partes.slice(0, -1).join('; ') + '; e ' + partes[partes.length - 1] : partes[0];
  return `Certifico que tentei proceder à ${ato} ${qual} ${B(base.nome)} pelos seguintes meios: ${lista}. Diante do exposto, restou frustrada a ${ato}, conforme registrado nos *prints* em anexo.`;
}

// Converte **negrito** e *itálico* em HTML seguro
export function paraHtml(md) {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}
export const paraTexto = (md) => md.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');

// ---------------------------------------------------------------------------
// 5. Metadados do PDF gerado pela CIRI (camada de texto)
// ---------------------------------------------------------------------------
export function lerMetaPdf(texto) {
  const meta = {};
  const tel = texto.match(/\+55\s?\d{2}\s?\d{4,5}-?\d{4}/g);
  if (tel) meta.telefones = [...new Set(tel.map(formatarTelefone))];
  meta.telefone = meta.telefones ? meta.telefones[0] : '';
  const rod = texto.match(/PROCESSO N[º°o]\s*([\d.]+)\s*[·\-•]\s*(.+?)\s*[·\-•]\s*(EFETIVADA|FRUSTRADA|EXPEDIDA)/i);
  if (rod) { meta.processo = rod[1]; meta.nomeRodape = rod[2].trim(); meta.status = rod[3].toUpperCase(); }
  const cap = texto.match(/Capturado e gerado em (\d{2})\/(\d{2})\/(\d{4})/);
  meta.ano = cap ? +cap[3] : new Date().getFullYear();
  const imgs = texto.match(/Imagem enviada por [^\n]*?(\d{1,2}):(\d{2})/g);
  meta.imagensParte = imgs ? imgs.length : 0;
  meta.ehEmail = !rod && /<[^>\s]+@[^>\s]+>/.test(texto) && /\d{1,2} de [a-zç]+ de \d{4},? (?:[àa]s )?\d{1,2}:\d{2}/i.test(texto);
  return meta;
}

// Texto lido de uma página de e-mail (Gmail, Outlook web)?
export function pareceEmail(texto) {
  return /<[^>\s]+@[^>\s]+>/.test(texto) && /\d{1,2} de [a-zç]+\.?(?: de \d{4})?,? (?:[àa]s )?\d{1,2}:\d{2}/i.test(texto) && !/neste telefone falo com/i.test(texto);
}
