// Núcleo da extensão: leitura da conversa, regras de classificação e modelos de certidão.
// Funciona no navegador e no Node (para testes). Nenhum dado sai do computador.

// ---------------------------------------------------------------------------
// Utilidades de data e hora
// ---------------------------------------------------------------------------
const MESES_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MESES_PT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const MESES_PT_EXT = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const pad = (n) => String(n).padStart(2, '0');
export const fmtData = (t) => (t && t.dia ? `${pad(t.dia)}/${pad(t.mes)}/${t.ano}` : '');
export const fmtHora = (t) => (t && Number.isFinite(t.hora) ? `${pad(t.hora)}h${pad(t.min)}` : '');
const chaveTempo = (t) => (t ? t.ano * 1e8 + t.mes * 1e6 + t.dia * 1e4 + (t.hora || 0) * 100 + (t.min || 0) : 0);

// Reconhece uma linha que é só o carimbo de data/hora de uma mensagem.
// dataRef = { dia, mes, ano } usada quando o carimbo traz só a hora ("06:39").
export function lerCarimbo(texto, ano, dataRef) {
  let t = texto.replace(/[«»|✓✔︎]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 34) return null;
  // Confusões comuns da leitura em letra miúda: "Now 3, T33PM" -> "Nov 3, 1:33 PM"
  t = t.replace(/\b(No[wy]|N0v|Nev)\b/gi, 'Nov').replace(/\b(0ct|Oet|Qct)\b/gi, 'Oct')
    .replace(/([,\s])[£€§]\s?(\d{2})\s*([AP])/g, '$11:$2 $3').replace(/(^|[\d\s,])[TlI!](?=\d)/g, '$11').replace(/(\d)[Oo](?=\d|\s?[AP]M)/g, '$10').replace(/([\s,])[Oo](?=\d)/g, '$10');
  let m = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2})\s*[,.]?\s*(\d{1,2})\s*[:.;]?\s*(\d{2})\s*([AP])\.?\s*M\b/i);
  if (m) {
    let h = +m[3];
    const min = +m[4];
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[5].toUpperCase() === 'P' && h !== 12) h += 12;
    if (m[5].toUpperCase() === 'A' && h === 12) h = 0;
    return { dia: +m[2], mes: MESES_EN[m[1].toLowerCase().slice(0, 3)], ano, hora: h, min };
  }
  // Dia legível, hora ilegível ("Nov 3, 55 PM"): fica o dia; a hora vai para preencher
  m = t.match(/^\W{0,3}(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2})\s*[,.]\s*\S{1,5}\s*([AP])\.?\s*M\b.{0,4}$/i);
  if (m && +m[2] >= 1 && +m[2] <= 31) return { dia: +m[2], mes: MESES_EN[m[1].toLowerCase().slice(0, 3)], ano, hora: NaN, min: NaN, semHora: true };
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
  if (/^(hoje|ontem)$/i.test(t) && !hoje) return { dia: 0, mes: 0, ano: 0 };
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
const RE_SISTEMA = /digite uma mensagem|\bdigit\b|visualizada por \d|\bversa visualizada|\batribu(iu|i)?\s*(a si|$)|ctr[li]\s*\+?\s*s\s*agendar|^\W{0,3}(?:[A-Za-z]{1,2}\s)?(a[cç][oõ]es da conversa|macros|informa[cç][aã]o da conversa|atributos do contato|notas do contato|anexos|conversas anteriores|participantes da conversa|etiquetas d[ae] (contato|conversa)|agente atribu|time atribu|prioridade|nenhuma macro)|atribuiu a si mesm|conversa visualizada|mensagem n[aã]o lida|conversa (resolvida|reaberta|marcada)|criado \d+ days|transcri[cç][aã]o autom|^mensagem de [aá]udio$|^\(?\d+\/\d+\)?$|^0?0:\d\d ?\/ ?0?0:\d\d|mensagens mais antigas|obter as mensagens|criptografia de ponta|encriptadas ponto|mensagens tempor[aá]rias|conversa expirada|esta conversa expirou|reenviar template|selecionar template|selecione um template|^mensagem apagada$|^falha ao enviar$|clique para saber mais|^hoje [eé] o dia/i;
// Saudação / primeira abordagem do servidor, reconhecida pelo sentido (cada colaborador escreve de um jeito)
const RE_SAUDACAO = /falo com|falar com|confirmar se (neste|nesse|este|esse)|(neste|nesse) (telefone|n[uú]mero|contato|whats)|dar continuidade ao seu atendimento|template\s*:|meu nome [eé] .{2,60}(tribunal|trabalho|central|n[uú]mero|telefone)|estou entrando em contato|entrando em contato em nome|com quem (eu )?falo/i;
// Respostas automáticas (contas comerciais, ausência)
const RE_AUTOMATICA = /novo (n[uú]mero|contato)|este [eé] o (novo|nosso)|n[aã]o estamos dispon[ií]ve|no momento n[aã]o (estamos|podemos|posso)|hor[aá]rio de (atendimento|funcionamento)|mensagem autom[aá]tica|resposta autom[aá]tica|obrigad[oa] (por|pelo) (entrar em )?contato|agradecemos (o|seu|pelo) contato|em breve (retornaremos|responderemos|entraremos)|seja bem[- ]vind|retornaremos (o|seu) contato|fora do hor[aá]rio|aus[eê]ncia tempor|estou ausente|de f[eé]rias|atendimento (de segunda|das \d)/i;
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
  /falo com (o|a)\s*\(?a?\)?\s*s/i, /gostaria de (falar|confirmar)/i, /meu nome [eé] .{2,40}(gostaria|trabalho|neste|nesse)/i,
  /^template\s*:/i, /pe[cç]o desculpa/i, /teria (um|outro) n[uú]mero/i, /deseja um (excelente|[oó]timo)/i,
  /agradece (pela|a) (aten|gentil)/i, /estou finalizando o atendimento/i, /aus[eê]ncia de comunica/i,
  /seguran[cç]a de nossa comunica/i, /foto do (seu )?documento/i, /complete o n[uú]mero/i, /processo judicial/i,
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
  // Barra de tarefas do Windows (canto inferior direito): data e hora da captura
  const daBarra = new Set();
  let barra = null;
  for (const tela of telas) {
    if (!tela.altura || !tela.largura) continue;
    let bData = null, bHora = null;
    for (const l of tela.linhas) {
      const tx = (l.texto || '').trim();
      if (l.y0 / tela.altura < 0.82 || l.x0 / tela.largura < 0.7 || tx.length > 40) continue;
      const md = tx.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
      const mh = tx.match(/^(?:\D{0,12}\s)?(\d{1,2}):(\d{2})\s*$/);
      if (md) { bData = { dia: +md[1], mes: +md[2], ano: +md[3] }; daBarra.add(l); }
      else if (mh && +mh[1] < 24) { bHora = { hora: +mh[1], min: +mh[2] }; daBarra.add(l); }
    }
    if (bData) { tela.barra = { ...bData, ...(bHora || {}) }; if (!barra) barra = tela.barra; }
  }
  if (!hoje) {
    for (const tela of telas) for (const l of tela.linhas) {
      const m = (l.texto || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
      if (m && (l.texto || '').length < 45 && (!tela.altura || l.y0 / tela.altura > 0.85)) hoje = { dia: +m[1], mes: +m[2], ano: +m[3] };
    }
  }
  let dataIncerta = false;
  if (!hoje) { hoje = null; dataIncerta = true; } // sem data no print: a data fica para preencher
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
    // Moldura da CIRI: a conversa vai até o painel "Contatos" (à direita); o painel fica de fora
    const cab = temPos && tela.modo === 'moldura' && tela.linhas.find((l) => tela.altura && l.y0 / tela.altura < 0.08 && /^(contatos|detalhes do contacto|dados do contato)\b/i.test((l.texto || '').trim()));
    const RE_PAINEL = /^(a[cç][oõ]es da conversa|macros|informa[cç][aã]o da conversa|atributos do contato|notas do contato|anexos|conversas anteriores|participantes da conversa|etiquetas de contato|agente atribu)/i;
    const painel = temPos && tela.modo === 'moldura' ? tela.linhas.filter((l) => RE_PAINEL.test((l.texto || '').trim())).map((l) => l.x0 / tela.largura) : [];
    const corte = cab ? cab.x0 / tela.largura - 0.005 : painel.length >= 2 ? Math.min(...painel) - 0.01 : (tela.fracao || 1);
    const lado = !temPos ? () => null
      : tela.modo === 'moldura' ? (l) => { const x = l.x0 / tela.largura; if (x >= corte) return 'fora'; return x / corte < 0.17 ? 'parte' : 'servidor'; }
      : (() => {
        // cada tela com âncoras suficientes usa o próprio alinhamento (apps diferentes no mesmo PDF)
        const proprias = tela.linhas.filter((l) => (l.texto || '').length > 25 && ehServidor(l.texto));
        const det = proprias.length >= 2 ? detectorDeLado(tela.linhas.map((l) => ({ texto: l.texto, x0: l.x0 / tela.largura, x1: l.x1 / tela.largura })), { largura: 1 }) : detectorGlobal;
        return (l) => det({ ...l, x0: l.x0 / tela.largura, x1: l.x1 / tela.largura });
      })();
    let yAnterior = null;
    let ladoAnterior = null;
    const hojeTela = tela.barra ? { dia: tela.barra.dia, mes: tela.barra.mes, ano: tela.barra.ano } : hoje;
    for (const l of linhas) {
      const texto = (l.texto || '').replace(/\s+/g, ' ').trim();
      if (!texto || daBarra.has(l)) continue;
      // faixa da barra de tarefas do Windows, no pé dos prints de tela inteira
      if (tela.modo === 'livre' && tela.altura && l.y0 / tela.altura > 0.95 && !lerCarimbo(texto, ano, hojeTela)) continue;
      if (temPos && tela.altura && l.y1 / tela.altura < 0.05) { // cabeçalho da conversa (nome do contato)
        if (!titulo && l.x0 / tela.largura < 0.2 && /[a-zà-ú]{3}/i.test(texto)) titulo = texto.replace(/^[^A-Za-zÀ-ú]+/, '');
        continue;
      }
      if (ehCompositor(texto)) break; // fim da área de mensagens
      if (RE_SISTEMA.test(texto)) continue;
      const selo = lerSeloData(texto, hojeTela);
      if (selo) { dataAtual = selo; continue; }
      const ld = temPos ? lado(l) : null;
      if (ld === 'fora') continue; // painel lateral, barra de tarefas etc.
      let carimbo = lerCarimbo(texto, ano, dataAtual || hojeTela);
      // Carimbo colado no fim da linha da mensagem ("... Rocha? Nov 4, 9:09 AM"): separa os dois
      if (!carimbo) {
        const cauda = (' ' + texto).match(/\s((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Now|Dec)[a-z]*\.?\s*\d{1,2}\s*[,.]?\s*\S{1,6}\s*\S{0,3}\s*[AP]\.?\s?M\b.{0,6})$/i);
        if (cauda) {
          const cab = (' ' + texto).slice(0, cauda.index).trim();
          const lad0 = temPos ? ld : (ehServidor(cab) ? 'servidor' : null);
          if (cab) { pendentes.push({ lado: lad0, texto: cab, novaBolha: false }); ladoAnterior = lad0; }
          carimbo = lerCarimbo(cauda[1], ano, dataAtual || hojeTela);
          if (!carimbo) { yAnterior = temPos ? l.y1 : null; continue; }
        }
      }
      // Hora depois do relógio da captura, no mesmo dia, é erro de leitura ("09:35" lido "19:35")
      if (carimbo && tela.barra && tela.barra.hora !== undefined && carimbo.dia === tela.barra.dia && carimbo.mes === tela.barra.mes
        && carimbo.hora * 60 + carimbo.min > tela.barra.hora * 60 + tela.barra.min && carimbo.hora >= 10
        && (carimbo.hora - 10) * 60 + carimbo.min <= tela.barra.hora * 60 + tela.barra.min) carimbo.hora -= 10;
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
  msgs.barra = barra;
  msgs.dataIncerta = dataIncerta;
  // Busca de "Nova conversa" sem resultado: o número não tem WhatsApp
  const tudo = telas.map((t) => t.linhas.map((l) => l.texto).join(' ')).join(' ');
  const busca = tudo.match(/nenhum resultado[\s\S]{0,30}?para\s*["“”'‘’]?\s*([+\d()\s-]{8,24}\d)/i);
  if (busca) msgs.buscaSemResultado = formatarTelefone(busca[1]);
  return msgs;
}

// ---------------------------------------------------------------------------
// 1b. Telefone de cada tela e separação por número (vários números no mesmo PDF)
// ---------------------------------------------------------------------------
const so8 = (t) => (t || '').replace(/\D/g, '').slice(-8);
// Número completo (celular com o 9) vence o incompleto
const digitos = (t) => (t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').length;

// Procura o telefone dentro do que foi lido da tela: busca de nova conversa, painel do contato,
// cabeçalho. Ignora identificadores (@lid) e números citados dentro de mensagens longas.
// Confusões da leitura em números: "+5564 99222-1l64", "+556 4992 22116 4", "+55649922211б4"
function consertarNumero(tx) {
  return tx.replace(/\+[\dOoIl|SsBб\s-]{9,24}/g, (m) => {
    // só pedaços que já têm algum dígito de verdade ("Osvaldo" não vira "05")
    const pedacos = m.slice(1).split(/\s+/).filter((x) => /\d/.test(x))
      .map((x) => x.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/б/g, '6').replace(/\D/g, ''));
    let d = '';
    for (const p of pedacos) {
      if (d.length >= 12 && p.length === 1) break; // ícone lido como dígito no fim ("+5564992221164 0")
      d += p;
    }
    if (!d.startsWith('55')) return m;
    d = d.slice(0, 13);
    return ' +' + d + ' ';
  });
}
export function telefoneDaTela(tela) {
  const textos = tela.linhas.concat(tela.painel || []).map((l) => consertarNumero((l.texto || '').trim()));
  const tudo = textos.join(' ');
  const busca = tudo.match(/nenhum resultado[\s\S]{0,30}?para\s*["“”'‘’]?\s*([+\d()\s-]{8,24}\d)/i);
  if (busca) {
    // a caixa de busca (letra maior) costuma sair mais limpa que a frase do resultado
    const caixa = textos.find((tx) => tx.length < 30 && !/resultado/i.test(tx) && so8(tx.replace(/\D/g, '')).slice(-4) === so8(busca[1]).slice(-4) && /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/.test(tx));
    const m = caixa && caixa.match(/\(?(\d{2})\)?\s?(9?\d{4})-?(\d{4})/);
    return formatarTelefone(m ? m[1] + m[2] + m[3] : busca[1]);
  }
  for (const tx of textos) {
    if (/@lid|\S@\S+\.\w|3018-?6000/.test(tx)) continue;
    const m = tx.match(/\+\s?55\s?\(?(\d{2})\)?\s?(9?\d{4})[-\s]?(\d{4})(?!\d)/) || tx.match(/(?:^|\D)55(\d{2})(9?\d{4})(\d{4})(?!\d)/);
    if (m && (tx.length < 40 || /^\W{0,4}\+/.test(tx))) return formatarTelefone(m[1] + m[2] + m[3]);
  }
  for (const tx of textos) {
    if (tx.length > 30 || /@lid|\S@\S+\.\w|3018-?6000/.test(tx)) continue;
    const m = tx.match(/\((\d{2})\)\s?(9?\d{4})-?(\d{4})(?!\d)/);
    if (m) return formatarTelefone(m[1] + m[2] + m[3]);
  }
  return '';
}

// telas: cada uma pode trazer "rotulo" (número grifado acima do print, na camada de texto do PDF).
// Devolve grupos [{ telefone, telas, avisos }] — um por número de telefone.
export function separarPorNumero(telas) {
  const grupos = [];
  let atual = null;
  for (const t of telas) {
    const daTela = telefoneDaTela(t);
    let tel = t.rotulo || daTela;
    const avisos = [];
    if (t.rotulo && daTela && so8(t.rotulo) === so8(daTela) && digitos(t.rotulo) !== digitos(daTela)) {
      const completo = digitos(daTela) > digitos(t.rotulo) ? daTela : t.rotulo;
      avisos.push(`O número grifado (${t.rotulo}) e o do aplicativo (${daTela}) diferem em um dígito. Usei ${completo}: confira.`);
      tel = completo;
    }
    const g = tel ? grupos.find((x) => so8(x.telefone) === so8(tel)) : atual;
    if (g) {
      g.telas.push(t);
      if (tel && digitos(tel) > digitos(g.telefone)) g.telefone = tel;
      g.avisos.push(...avisos.filter((a) => !g.avisos.includes(a)));
      atual = g;
    } else {
      atual = { telefone: tel || '', telas: [t], avisos };
      grupos.push(atual);
    }
  }
  // Telas sem número que abriram um grupo próprio antes de qualquer número: juntam ao primeiro
  if (grupos.length > 1 && !grupos[0].telefone) { grupos[1].telas.unshift(...grupos[0].telas); grupos.shift(); }
  return grupos;
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
const RE_TERCEIRO = /^n[aã]o\b|\bn[aã]o\s*,?\s*(sou|[eé]\b|conhe[cç]|mora|tem ningu|trabalh|existe|sei quem)|n[uú]mero errado|engano|desconhe[cç]o|faleceu|ningu[eé]m com (esse|este) nome|(telefone|n[uú]mero|whats\w*)\s+[eé]\s+d[aeo]\s|[eé] d[ae] (empresa|loja|firma)|n[aã]o tenho (esse|este) nome/i;
const RE_IDENTIDADE = /^(sim|ss+|sou|sou eu|eu|eu mesm[oa]|el[ea] mesm[oa]|[eé] (el[ea]|eu|sim|o pr[oó]prio|a pr[oó]pria|o mesmo|a mesma)|falando|positivo|correto|exato|isso|pois n[aã]o|confirmo|pode falar|fala|falo sim|perfeitamente|com certeza|certo)\b|\b(sou eu|sou (o|a) |eu mesm[oa]|falo sim|sim,? (sou|[eé]|falo)|[eé] (ele|ela) mesm[oa]|[eé] (o|a) pr[oó]pri[oa]|sim senhor|sim senhora)\b/i;
const RE_CIENCIA = /\breceb(i|ido|emos)\b|\bciente\b|\bconfirmo\b|tomei ci[eê]ncia/i;
const RE_CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b|\b\d{5,}\b/;
const RE_CPF_COMPLETO = /(?<!\d)\d{3}\s?[.\s-]?\s?\d{3}\s?[.\s-]?\s?\d{3}\s?[-.\s/]?\s?\d{2}(?!\d)/;
const RE_PJ = /\b(ltda|s\/a|s\.a\.|eireli|epp|spe|condom[ií]nio|associa[cç][aã]o|cooperativa|com[eé]rcio|ind[uú]stria|servi[cç]os|banco|igreja|instituto|funda[cç][aã]o|madeireira|construtora|incorporadora|empreendimentos?|treinamento|transportes?|distribuidora|holding|me)\b/i;

// Tira cumprimentos e pontuação de uma resposta curta: "Bom dia .não" -> "não"
function nucleoResposta(t) {
  return t.replace(/\b(bom dia|boa tarde|boa noite|oi+|ol[aá]|opa|ei|al[oô]|tudo bem|tudo [oó]timo|blz|beleza|e a[ií])\b/gi, ' ')
    .replace(/[!?.,;:…"'()*\-–]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Resposta que cita a mensagem do servidor ("Você · Olá, tudo bem? ... Nao"): fica só o que a parte escreveu
function semCitacao(t) {
  let s = t.replace(/^\s*(voc[eê]|you)\s*[:·-]?\s*/i, (m) => m);
  if (/^\s*(voc[eê]|you)\b/i.test(s) && ehServidor(s)) {
    const q = s.lastIndexOf('?');
    s = q > 0 ? s.slice(q + 1) : s.replace(/^\s*(voc[eê]|you)\b/i, '');
  } else if (ehServidor(s) && /\?/.test(s) && RE_SAUDACAO.test(s)) {
    s = s.slice(s.lastIndexOf('?') + 1);
  }
  return s.trim();
}

export function ehPessoaJuridica(nome, textoServ = '') {
  return RE_PJ.test(nome || '') || /representante legal|representante da empresa/i.test(textoServ);
}

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
  const falha404 = msgs.find((m) => /\b404\b|identificador whats\s?app|n[aã]o foi poss[ií]vel localizar o identificador/i.test(m.texto));
  const textoServ = msgs.filter((m) => m.lado === 'servidor').map((m) => m.texto).join(' ');

  // Tipo do ato: escolha do rodapé / nome do arquivo; senão, pelo texto do servidor

  // Primeira abordagem (saudação), reconhecida pelo sentido
  const contatos = serv(RE_SAUDACAO).filter((m) => !falha409(m));
  const primeiraServ = msgs.find((m) => m.lado === 'servidor' && m.tempo && !falha409(m));
  const abordagem = contatos.find((c) => c.tempo) || primeiraServ || null;
  f.abordagem = abordagem ? abordagem.tempo : null;
  f.tentativas = [];
  for (const c of contatos) {
    if (c.tempo && !f.tentativas.some((t) => fmtData(t) === fmtData(c.tempo))) f.tentativas.push(c.tempo);
  }
  if (!f.tentativas.length && f.abordagem) f.tentativas.push(f.abordagem);
  if (abordagem) ev('Primeira abordagem', abordagem);

  // Intimação / citação e arquivos
  const candAto = serv(/fica (vossa senhoria|v\.?\s?s)|ficam vossas|(intimad|citad)[oa]s?\s?\(a\)|(intimad|citad)[oa]s?\b/).filter((m) => !falha409(m) && !RE_SAUDACAO.test(m.texto));
  const msgAto = candAto.find((m) => !/nesta oportunidade[^.]*tomar ci[eê]ncia/i.test(m.texto)) || candAto[0];
  const arquivos = serv(/compartilhou um arquivo|c[oó]digo de\s?acesso\.p|\.pdf\b[^.]{0,40}(kb|mb|abrir)/);
  // Tipo do ato: rodapé / nome do arquivo; senão, a própria mensagem do ato ("fica V.S. CITADO/INTIMADO");
  // senão, as mensagens do servidor antes do ato (sem o texto da decisão citada)
  const limiteAto = msgAto ? idx(msgAto) : arquivos[0] ? idx(arquivos[0]) : msgs.length;
  const preAto = msgs.slice(0, limiteAto).filter((m) => m.lado === 'servidor').map((m) => m.texto).join(' ');
  const pelaMsg = msgAto && (/\bcitad[oa]/i.test(msgAto.texto) ? 'citacao' : /\bintimad[oa]/i.test(msgAto.texto) ? 'intimacao' : '');
  const peloTexto = /\bcitad[oa]|\bcita[cç][aã]o\b|ajuizad[oa][^.]{0,120}em seu desfavor/i.test(preAto) ? 'citacao' : /\bintima[cç][aã]o\b|\bintimad[oa]/i.test(preAto) ? 'intimacao' : '';
  f.tipo = meta.ato || pelaMsg || peloTexto || 'intimacao';
  f.atoIndicado = !!(meta.ato || pelaMsg || peloTexto);
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

  // Encerramento (usado só na intimação sem manifestação)
  const fecho = msgs.filter((m) => m.lado === 'servidor' && /atenciosamente|atendimento desta central foi finalizado|central de intima[cç][aã]o remota do interior.*cir|estou finalizando o atendimento|atendimento ser[aá] (encerrado|finalizado)/i.test(m.texto) && m.tempo);
  f.encerramento = fecho.length ? fecho[fecho.length - 1].tempo : null;
  if (fecho.length) ev('Encerramento', fecho[fecho.length - 1]);
  const porAusencia = serv(/aus[eê]ncia de (manifesta|confirma|comunica)/)[0];

  // Respostas da parte: sem ruído de OCR, sem repetições, sem citações e sem respostas automáticas
  const iPedidoCpf = msgs.findIndex((m) => m.lado === 'servidor' && /\bCPF\b/i.test(m.texto));
  const vistasResp = new Set();
  const automaticas = [];
  const respostas = [];
  for (const m of msgs) {
    if (m.lado !== 'parte') continue;
    const texto = semCitacao(m.texto);
    const letras = (texto.match(/[A-Za-zÀ-ú]/g) || []).length;
    const marcador = /\[(imagem enviada|arquivo)\]/i.test(texto);
    // Só números: vale como resposta quando vem depois do pedido de CPF (CPF completo ou só os dígitos que faltavam)
    const soNumero = iPedidoCpf >= 0 && msgs.indexOf(m) > iPedidoCpf && (texto.match(/\d/g) || []).length >= 3 && texto.length < 60;
    if (!marcador && !soNumero && (letras < 2 || !/[A-Za-zÀ-ú]{2,}/.test(texto) || letras / texto.replace(/\s/g, '').length < 0.5)) continue;
    const k = norm(texto).slice(0, 40);
    if (vistasResp.has(k)) continue;
    vistasResp.add(k);
    // automática: frase típica, ou mensagem longa no mesmo minuto da abordagem
    const mesmoMinuto = abordagem && abordagem.tempo && m.tempo && chaveTempo(m.tempo) - chaveTempo(abordagem.tempo) <= 1 && texto.length > 60;
    if (RE_AUTOMATICA.test(texto) || mesmoMinuto) { automaticas.push(m); continue; }
    respostas.push(texto === m.texto ? m : { ...m, texto, original: m });
  }
  const pos = (r) => idx(r.original || r);
  f.respostas = respostas;
  f.automaticas = automaticas.length;
  automaticas.slice(0, 2).forEach((r) => ev('Resposta automática (desconsiderada)', r));
  const iAto = msgAto ? idx(msgAto) : arquivos[0] ? idx(arquivos[0]) : Infinity;
  const iArq = arquivos[0] ? idx(arquivos[0]) : iAto;
  const antes = respostas.filter((r) => pos(r) < iAto);
  const depois = respostas.filter((r) => pos(r) > iArq);
  respostas.slice(0, 6).forEach((r) => ev('Resposta da parte', r));

  // Documentos de identidade (imagens enviadas pela parte, legendas do PDF) ou CPF
  f.imagensParte = meta.imagensParte || respostas.filter((r) => /\[(imagem enviada|arquivo)\]/i.test(r.texto) || /<{5,}|\bI<BRA/.test(r.texto)).length;
  const pedidoCpf = serv(/\bCPF\b/)[0];
  // CPF em qualquer formato: 000.000.000-15, 000 000 000 15, 00000000000, "meu CPF é ...",
  // ou só os dígitos que faltavam no CPF mascarado ("019.96", "01996")
  const cpf = pedidoCpf && respostas.find((r) => {
    if (pos(r) <= idx(pedidoCpf) || pos(r) >= iArq) return false;
    const t = r.texto;
    if (RE_CPF_COMPLETO.test(t)) return true;
    const dig = (t.match(/\d/g) || []).length;
    const resto = t.replace(/[\d\s.\-/]/g, '').replace(/\b(meu|cpf|[eé]|o|n[uú]mero|s[aã]o|os|d[ií]gitos|faltam|que|segue|aqui)\b/gi, '').replace(/[^A-Za-zÀ-ú]/g, '');
    return dig >= 3 && resto.length <= 3;
  });
  const pedidoDoc = serv(/documento|foto|identidade|identifica[cç][aã]o/)[0];
  // Dedução de foto só quando o contexto não a desmente: a parte não disse que estava sem documento
  // e o servidor não precisou pedir o CPF como alternativa depois
  const semDocumento = respostas.some((r) => pedidoDoc && pos(r) > idx(pedidoDoc) && pos(r) < iArq && /n[aã]o (tenho|estou com|consigo|possuo)|perdi|sem (o )?(rg|documento|identidade)|n[aã]o tenho (rg|documento)/i.test(r.texto));
  const cpfComoAlternativa = pedidoDoc && serv(/\bCPF\b/).some((m) => idx(m) > idx(pedidoDoc) && idx(m) < iArq);
  const respDoc = pedidoDoc && arquivos.length && !semDocumento && !cpfComoAlternativa && respostas.find((r) => pos(r) > idx(pedidoDoc) && pos(r) < iArq);
  // Foto e CPF podem vir os dois, em qualquer ordem (CPF antes e foto depois dos arquivos, ou foto com CPF ilegível)
  const fotoMsg = respostas.find((r) => /\[(imagem enviada|arquivo)\]/i.test(r.texto) || /<{5,}|\bI<BRA/.test(r.texto));
  const temFoto = f.imagensParte > 0 || !!respDoc;
  if (temFoto && cpf) {
    const fotoPrimeiro = fotoMsg ? pos(fotoMsg) < pos(cpf) : false; // no PDF a foto fica em página à parte: posição desconhecida
    f.docTipo = fotoPrimeiro ? 'doc_cpf' : 'cpf_doc';
  } else {
    f.docTipo = temFoto ? 'documento' : cpf ? 'cpf' : '';
  }
  if (!f.imagensParte && !cpf && respDoc) f.docInferido = true;

  // Identidade: só vale resposta que confirma ("sim", "sou eu", "falo sim"...), não um simples "bom dia"
  let decisiva = null, negativa = null;
  for (const r of antes) {
    const n = nucleoResposta(r.texto);
    if (!n) continue;
    if (RE_TERCEIRO.test(n)) { negativa = r; break; }
    if (RE_IDENTIDADE.test(n)) { decisiva = r; break; }
  }
  f.identidade = decisiva ? decisiva.tempo : null;
  if (decisiva) ev('Confirmação de identidade', decisiva);

  // Audiência
  const msgAud = serv(/audi[eê]ncia/)[0];
  if (msgAud || meta.audiencia) {
    const ma = msgAud && msgAud.texto.match(/(\d{2}\/\d{2}\/\d{4})[^0-9]{0,25}(\d{1,2})[:h](\d{2})/);
    f.audiencia = { data: ma ? ma[1] : '', hora: ma ? `${pad(+ma[2])}h${ma[3]}` : '', link: /https?:\/\/|link/i.test(textoServ), msg: !!msgAud };
  }

  // Nome pela saudação, quando o print não traz rodapé
  const sauda = msgs.find((m) => /falo com|falar com/i.test(m.texto));
  const mn = sauda && sauda.texto.match(/fal(?:o|ar) com\s*(?:o|a)?\s*(?:\(a\)\s*)?(?:(?:Sr|Sra|Senhor|Senhora)\s*\(?a?\)?\.?|representante (?:legal )?da empresa)\s*([^?]{3,90}?)\s*\?/i);
  f.nomeSaudacao = mn ? limparNome(mn[1]) : '';
  if (!f.nome && f.nomeSaudacao) f.nome = f.nomeSaudacao;
  f.pj = ehPessoaJuridica(f.nome, sauda ? sauda.texto : '');
  if (!f.telefone && !msgs.buscaSemResultado) f.avisos.push('O telefone não aparece no print. Preencha manualmente.');

  // ----- Regras -----
  const tempoAbordagem = f.abordagem || (msgs.barra && msgs.barra.hora !== undefined ? msgs.barra : null);
  if (msgs.buscaSemResultado && !abordagem) {
    f.situacao = 'FRUST_BUSCA';
    f.tempoPrincipal = msgs.barra && msgs.barra.hora !== undefined ? msgs.barra : null;
    if (!f.telefone) f.telefone = msgs.buscaSemResultado;
    if (f.tempoPrincipal) f.avisos.push('Data e hora tiradas do relógio da barra de tarefas do print. Confira.');
    f.evidencias.push({ rotulo: 'Busca sem resultado', texto: `Nenhum resultado encontrado para "${msgs.buscaSemResultado}"`, tempo: f.tempoPrincipal, lado: 'servidor' });
  } else if (falha404 && respostas.length === 0) {
    f.situacao = 'FRUST_SEM_WHATSAPP';
    const anterior404 = msgs.slice(0, idx(falha404) + 1).reverse().find((m) => m.lado === 'servidor' && m.tempo);
    f.tempoPrincipal = (abordagem && abordagem.tempo) || falha404.tempo || (anterior404 && anterior404.tempo);
    ev('Falha de envio (404)', falha404);
  } else if (respostas.length === 0) {
    f.situacao = 'FRUST_SEM_RESPOSTA';
    f.tempoPrincipal = tempoAbordagem;
    if (automaticas.length) f.avisos.push('Só houve resposta automática do aplicativo (desconsiderada): tratei como sem resposta.');
  } else if (negativa && (!arquivos.length || pos(negativa) < iArq)) {
    f.situacao = 'FRUST_TERCEIRO';
    f.tempoPrincipal = tempoAbordagem || negativa.tempo;
    ev('Resposta de terceiro', negativa);
  } else if (!decisiva && !arquivos.length && !f.docTipo) {
    f.situacao = 'FRUST_SEM_IDENT';
    f.tempoPrincipal = tempoAbordagem;
    f.avisos.push('A pessoa respondeu, mas não confirmou ser a parte (só cumprimentou ou perguntou do que se trata). Confira.');
  } else if (f.tipo === 'citacao') {
    f.tempoPrincipal = tempoAbordagem || f.horaAto; // data e hora da abordagem (primeiro contato)
    if (f.docTipo || arquivos.length) {
      f.situacao = 'CIT_EFETIVADA';
      if (!f.docTipo) { f.docTipo = 'documento'; f.avisos.push('Arquivos enviados, mas não identifiquei o documento ou o CPF no print. Confira.'); }
      else if (f.docInferido) f.avisos.push('Deduzi que a parte enviou foto do documento (respondeu ao pedido antes do envio dos arquivos). Confira no print.');
    } else {
      f.situacao = f.audiencia && f.audiencia.msg ? 'CIT_EXPEDIDA_AUD' : 'CIT_EXPEDIDA';
      f.tempoPrincipal = tempoAbordagem;
    }
  } else {
    f.tempoPrincipal = tempoAbordagem || f.horaAto; // data e hora da abordagem (primeira mensagem à parte)
    if (!decisiva) f.avisos.push('Não encontrei a confirmação de identidade antes do envio dos arquivos. Confira no print.');
    const expressa = depois.find((r) => r.texto.length <= 100 && RE_CIENCIA.test(r.texto));
    if (expressa) {
      f.situacao = 'INT_EXPRESSA';
      f.frase = limparFrase(expressa.texto);
      if (f.frase !== expressa.texto.trim().replace(/[.!]+$/, '')) f.avisos.push(`Frase de ciência limpa a partir de "${expressa.texto.slice(0, 60)}". Confira com o print.`);
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
  }

  if (msgs.some(falha409)) f.avisos.push('Há mensagens com falha 409 (sessão do WhatsApp desconectada). Foram desconsideradas como tentativa.');
  if (f.statusPrint) {
    const esperado = f.situacao.startsWith('FRUST') ? 'FRUSTRADA' : f.situacao.startsWith('CIT_EXP') ? 'EXPEDIDA' : 'EFETIVADA';
    if (f.statusPrint !== esperado) f.avisos.push(`O print indica "${f.statusPrint}", mas a análise sugere "${esperado}". Confira.`);
  }
  if (!f.atoIndicado) f.avisos.push('O print não diz se é citação ou intimação: confirme o ato no topo da certidão.');
  if (f.tempoPrincipal && f.tempoPrincipal.hora !== undefined && (f.tempoPrincipal.hora < 6 || f.tempoPrincipal.hora > 21)) f.avisos.push(`A hora ${fmtHora(f.tempoPrincipal)} está fora do expediente: pode ser erro de leitura. Confira.`);
  if (!f.tempoPrincipal) f.avisos.push('Não encontrei a data e a hora no print. Preencha manualmente.');
  else if (!f.tempoPrincipal.dia) f.avisos.push('O print mostra só a hora, sem o dia. Preencha a data.');
  else if (f.tempoPrincipal.semHora) f.avisos.push('Li o dia, mas a hora ficou ilegível no print. Preencha a hora.');
  return f;
}

// Frase de ciência: só as palavras reconhecíveis (sem ruído da leitura colado, como "Ciente LIEBIE")
function limparFrase(t) {
  let s = t.replace(/\s+/g, ' ').trim();
  const m = s.match(/(recebi[^.!]*?ciente)/i) || s.match(/(estou ciente|ciente e de acordo|recebido|recebi|confirmo o recebimento|tomei ci[eê]ncia|ciente|confirmo)/i);
  if (m) s = m[1];
  const todasMaius = s === s.toUpperCase();
  s = s.split(' ').filter((w) => {
    const l = w.replace(/[^A-Za-zÀ-ú]/g, '');
    if (!l) return /^\d/.test(w);
    if (!todasMaius && l.length >= 3 && l === l.toUpperCase() && !/^(OK|CPF|TJGO)$/.test(l)) return false;
    if (!/[aeiouáéíóúâêôãõ]/i.test(l) && !/^(e|é)$/i.test(l)) return false;
    return true;
  }).join(' ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.replace(/[.!\s]+$/, '');
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
  FRUST_BUSCA: 'Frustrada – número não localizado no WhatsApp (busca)',
  FRUST_TERCEIRO: 'Frustrada – terceiro',
  FRUST_SEM_IDENT: 'Frustrada – respondeu sem se identificar',
  FRUST_NAO_COMPROVOU: 'Frustrada – identificou-se sem comprovar (sem arquivos)',
  EMAIL_EFETIVADA: 'E-mail – efetivada',
  EMAIL_FRUSTRADA: 'E-mail – frustrada',
};

// Sem gênero: sempre "da parte" + qualificação (evita erro de concordância)
const Q1 = {
  parte: 'da parte', parte_requerente: 'da parte requerente', parte_requerida: 'da parte requerida',
  promovente: 'da parte promovente', promovido: 'da parte promovida', parte_autora: 'da parte autora', parte_re: 'da parte ré',
  parte_exequente: 'da parte exequente', parte_executada: 'da parte executada', parte_embargante: 'da parte embargante', parte_embargada: 'da parte embargada',
  autor_fato: 'da parte autora do fato', vitima: 'da vítima', testemunha: 'da testemunha', perito: 'do(a) perito(a)',
};
export const QUALIFICACOES = Object.fromEntries(Object.entries(Q1).map(([k, v]) => [k, [v, v]]));
// apelidos antigos
Object.assign(QUALIFICACOES, { requerente: QUALIFICACOES.parte_requerente, requerido: QUALIFICACOES.parte_requerida, exequente: QUALIFICACOES.parte_exequente, executado: QUALIFICACOES.parte_executada, reu: QUALIFICACOES.parte_re });
export const ROTULOS_QUALIFICACAO = {
  parte: 'Parte (sem qualificação)', parte_requerente: 'Parte requerente', parte_requerida: 'Parte requerida',
  promovente: 'Parte promovente', promovido: 'Parte promovida', parte_autora: 'Parte autora', parte_re: 'Parte ré',
  parte_exequente: 'Parte exequente', parte_executada: 'Parte executada', parte_embargante: 'Parte embargante', parte_embargada: 'Parte embargada',
  autor_fato: 'Autor(a) do fato', vitima: 'Vítima', testemunha: 'Testemunha', perito: 'Perito(a)',
};
// Grupos usados na escolha do início: citação -> requerida; intimação -> requerente, requerida ou perito
export const LADO_QUALIFICACAO = {
  requerente: ['parte_requerente', 'promovente', 'parte_autora', 'parte_exequente', 'parte_embargante', 'autor_fato', 'vitima'],
  requerida: ['parte_requerida', 'promovido', 'parte_re', 'parte_executada', 'parte_embargada'],
  perito: ['perito'],
};

const FEMININOS = /^(raquel|isabel|izabel|ruth|rute|beatriz|ines|inês|lourdes|mabel|ester|esther|ely|nely|rachel|miriam|carmen|sueli|suely|nicole|ingrid|liz|luz|cristiane|michele|gisele|daniele|aline|eliane|viviane|simone|ivone|denise|rose|alice|jane|ivete|clarice|cleide|irene|lene|leonice|joice|kelly|keli|shirley|jaqueline|jakeliny|tatiane|cleonice|marli|edileuza|jussara|deise|vaneide|valeide|neide|aparecida|adenir|lucimar|marisol|nivia|ester|abigail|sarah|raissa|ketlen|kethellen|evelyn|jennifer|suelen|karen|keren|dalva|nadir|janete|joelma|rosimeire|rosemeire|rosineide|lucineide|edinalva|zenaide|creusa|socorro|consuelo|mercedes|lurdes|katia|kátia|madalena)$/i;
const MASC_A = /^(luca|joshua|jonatha|nikita|elias|josias|tobias|matias|messias|isaias|jonas|lucas|thomas|marcos|carlos|nicolas|jose|josé|felipe|filipe|henrique|jorge|andre|andré|alexandre|wellington|rene|renê|noe|noé|dione|mike|jefferson|cleiton|kleber|eduardo|guilherme|vitor|victor|wesley|wanderley|valdir|osvaldo|reinaldo|ronaldo|geraldo|moises|moisés|cassio|cássio|iury|yuri|ricardo|manuel|manoel|roger|johny|oscar|donizete|cleidival|elivaldo|cleudimar|deusdelyo|doriel|keven|francisley|davi|david|luiz|luis|paulo|marcelo|pedro|joao|joão|gabriel|daniel|samuel|rafael|miguel|ezequiel|emanuel|natanael|israel|abel|joel|leonel|adriel|uriel|ariel|eraldo)$/i;
export function adivinharGenero(nome) {
  if (RE_PJ.test(nome || '')) return 'm'; // "na pessoa de seu representante legal, o qual..."
  const p = ((nome || '').trim().split(/\s+/)[0] || '').normalize('NFC');
  if (FEMININOS.test(p)) return 'f';
  if (MASC_A.test(p)) return 'm';
  return /a$|nne$|lle$|ette$|ine$|ane$|iane$|eide$|ice$|ise$|ene$|ete$|ilde$|ilda$|lly$|lyn$|yn$|th$/i.test(p) ? 'f' : 'm';
}

const ARTIGO_ATO = { 'decisão': 'da decisão', despacho: 'do despacho', 'sentença': 'da sentença', 'ato ordinatório': 'do ato ordinatório', 'acórdão': 'do acórdão', mandado: 'do mandado', edital: 'do edital', '': 'do ato' };
const deFrase = (s) => s.replace(/^(as|os|a|o)\s/i, (m, a) => ({ a: 'da ', o: 'do ', as: 'das ', os: 'dos ' })[a.toLowerCase()]);

const SIGLAS = new Set(['spe', 'me', 'epp', 'eireli', 's/a', 'sa', 'ss', 'cia', 'ltda.']);
export function nomeProprio(s) {
  const minusc = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'em']);
  return (s || '').toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => {
      if (i > 0 && minusc.has(w)) return w;
      if (SIGLAS.has(w)) return w.toUpperCase();
      return w.replace(/^(\p{L})/u, (l) => l.toUpperCase());
    }).join(' ').replace(/\bLtda\.?\b/gi, 'Ltda');
}

// Nome vindo do sistema, do arquivo ou da leitura: sem asteriscos, símbolos e pedaços soltos
export function limparNome(s) {
  let t = (s || '').replace(/[*_~`#|<>{}\[\]"“”;:+=@\\]+/g, ' ').replace(/(^|\s)[\d.\-\/]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-–.,'\s]+|[-–.,'\s]+$/g, '');
  t = t.replace(/^representante (legal )?da empresa\s+/i, '');
  return nomeProprio(t);
}

// Nome do arquivo: "COLABORADOR - 5801051-86 - NOME DA PARTE - citação frustrada 28.10 - Aud. 14.12.pdf"
export function lerNomeArquivo(arquivo) {
  const bruto = (arquivo || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^[0-9a-f]{8}-(?=\S)/, '');
  const r = {};
  if (/cita(?:ç|c|_)(?:ã|a|_)o|citad[oa]/i.test(bruto)) r.ato = 'citacao';
  else if (/intima/i.test(bruto)) r.ato = 'intimacao';
  if (/frustrad/i.test(bruto)) r.status = 'FRUSTRADA';
  else if (/expedid/i.test(bruto)) r.status = 'EXPEDIDA';
  else if (/efetivad/i.test(bruto)) r.status = 'EFETIVADA';
  const s = bruto.replace(/_{3}/g, ' - ').replace(/_-_/g, ' - ').replace(/_/g, ' ').replace(/\s+/g, ' ');
  if (/\baud\b|audi[eê]ncia/i.test(s)) r.audiencia = true;
  const partes = s.split(/\s+[-–]\s+/).map((x) => x.trim()).filter(Boolean);
  const iProc = partes.findIndex((p) => /^\d{6,7}[-.]\d{2}$/.test(p));
  const ruim = /frustrad|efetivad|expedid|cita|intima|^aud\b|^\d|conversa lida/i;
  const resto = iProc >= 0 ? partes.slice(iProc + 1) : partes;
  if (iProc >= 0) r.processo = partes[iProc];
  const nome = resto.find((p) => !ruim.test(p) && /[A-Za-zÀ-ú]{2,}\s+[A-Za-zÀ-ú]{2,}/.test(p) && !/\d{2}[./]\d{2}/.test(p));
  if (nome && (iProc >= 0 || (resto.length === 1 && nome.split(/\s+/).length >= 3))) r.nome = limparNome(nome);
  return r;
}

// Nomes das partes: rodapé do PDF ou, quando o rodapé vem abreviado ("... E SR(A)"), o título da conversa.
export function nomesDasPartes(nomeRodape, titulo) {
  let base = (nomeRodape || '').replace(/\*/g, '');
  const abreviado = /\bE SR\(?A?\)?\.?$|\bE SRA\.?$/i.test(base);
  if ((abreviado || !base) && titulo) base = titulo;
  base = base.replace(/\s+E SR\(?A?\)?\.?$|\s+E SRA\.?$/i, '').trim();
  return base.split(/\s+(?:e|E)\s+(?=[A-ZÀ-Ú])/).map((n) => limparNome(n.trim())).filter(Boolean);
}

// Escolhe o nome: rodapé > nome do arquivo > título da conversa (limpo pela saudação) > saudação
export function escolherNome({ rodape, arquivo, titulo, saudacao }) {
  if (rodape) {
    const nomes = nomesDasPartes(rodape, titulo);
    // rodapé cortado ("... CHACARAS DE R"): o título completo vence
    if (nomes.length === 1 && titulo) {
      const t = limparNome(titulo), r = nomes[0];
      const ultimo = r.split(' ').pop();
      const cortado = ultimo.length <= 2 && !/^(de|da|do|e)$/i.test(ultimo);
      const corte = norm(r).slice(0, -ultimo.length);
      if (cortado && corte.length > 8 && norm(t).startsWith(corte) && norm(t).length > norm(r).length) return [t];
    }
    return nomes;
  }
  if (arquivo) return [arquivo];
  if (titulo && /nova conversa|whats\s?app|^contatos|conversas|^anterior|^m[ií]dia/i.test(titulo)) titulo = '';
  if (titulo) {
    let tks = limparNome(titulo).split(' ');
    if (saudacao) {
      const primeiro = norm(saudacao.split(' ')[0]);
      const i = tks.findIndex((w) => norm(w) === primeiro);
      if (i > 0) tks = tks.slice(i);
    }
    const t = tks.join(' ');
    if (saudacao && norm(saudacao).length > norm(t).length) return [saudacao];
    if (t.split(' ').length >= 2) return [t];
  }
  return saudacao ? [saudacao] : [];
}

export function formatarTelefone(t) {
  const d = (t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || '';
}

// Recebe os campos (já revisados pelo servidor) e devolve o texto com **negrito** e *itálico*.
const semMarcas = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\*/g, '') : v]));
const FRUSTRADAS = ['FRUST_SEM_RESPOSTA', 'FRUST_SEM_WHATSAPP', 'FRUST_BUSCA', 'FRUST_TERCEIRO', 'FRUST_SEM_IDENT', 'FRUST_NAO_COMPROVOU', 'EMAIL_FRUSTRADA'];
export const ehFrustrada = (s) => FRUSTRADAS.includes(s);

export function gerarCertidao(c0) {
  const c = semMarcas(c0);
  if (ehFrustrada(c.situacao)) {
    const contatos = c.contatos && c.contatos.length ? c.contatos
      : [{ canal: c.situacao === 'EMAIL_FRUSTRADA' ? 'email' : 'whatsapp', situacao: c.situacao, telefone: c.telefone, email: c.email, data: c.data, hora: c.hora }];
    return gerarFrustrada(c, contatos);
  }
  const g = c.genero === 'f' ? 1 : 0;
  const qual = (QUALIFICACOES[c.qualificacao] || QUALIFICACOES.parte)[g];
  const oqual = 'que';
  const ato = c.tipo === 'citacao' ? 'citação' : 'intimação';
  const B = (s) => (s ? `**${s}**` : '**[preencher]**');
  const nome = B(c.nome) + (c.pj ? ', na pessoa de seu representante legal' : '');
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
      const DOC = {
        cpf: 'completou o número de seu CPF',
        documento: 'realizou o envio da imagem de seu documento de identificação',
        cpf_doc: 'completou o número de seu CPF, bem como realizou o envio da imagem de seu documento de identificação',
        doc_cpf: 'realizou o envio da imagem de seu documento de identificação, bem como completou o número de seu CPF',
      };
      const doc = DOC[c.docTipo] || DOC.documento;
      const audE = c.audData ? `, bem como a intimação da audiência designada para ${B(c.audData)}, às ${B(c.audHora)}${c.audLink ? ' e o respectivo link de acesso' : ''}` : '';
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}, procedi à citação ${qual} ${nome}, ${oqual} confirmou sua identidade e ${doc}, tendo-lhe sido encaminhados o inteiro teor do ato e o respectivo código de acesso${audE}, operando-se a regular citação, ${print}`;
    }
    case 'CIT_EXPEDIDA':
    case 'CIT_EXPEDIDA_AUD': {
      const aud = c.situacao === 'CIT_EXPEDIDA_AUD'
        ? ` e recebeu a intimação da audiência designada para ${B(c.audData)}, às ${B(c.audHora)}${c.audLink ? ', bem como o respectivo link de acesso' : ''}`
        : '';
      return `Certifico que, ${dia(c.data, c.hora)}, através do aplicativo WhatsApp, em contato com o número ${tel}${comum}, procedi à citação ${qual} ${nome}, ${oqual} confirmou sua identidade${aud}, porém não enviou imagem de documento de identificação nem completou o número de seu CPF, razão pela qual não lhe foram encaminhados os arquivos do processo nem o respectivo código de acesso, restando a citação expedida, ${print}`;
    }
    case 'EMAIL_EFETIVADA': {
      const pelo = c.confEmail ? ` pelo endereço ${B(c.confEmail)}` : '';
      const por = c.confPor ? `, por meio de ${c.confPor}` : '';
      return `Certifico que, ${dia(c.data, c.hora)}, através de correio eletrônico, encaminhado ao endereço ${B(c.email)}, procedi à ${ato} ${qual} ${nome}, tendo-lhe sido remetidos ${c.emailDocs || 'os arquivos do processo e o respectivo código de acesso'}. Em ${B(c.confData)}, às ${B(c.confHora)}, foi acusado o recebimento da ${ato}${pelo}${por}, operando-se a regular ciência do ato, conforme registrado no *print* do e-mail em anexo.`;
    }
    default:
      return '';
  }
}

// Certidão frustrada: um ou vários contatos (números e/ou e-mail), cada um com a sua data e situação.
// Só a primeira abordagem de cada contato; dias diferentes: "Em seguida, no dia..."; mesmo dia: "Ainda no mesmo dia, às...".
const minutos = (k) => { const d = (k.data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); const h = (k.hora || '').match(/(\d{1,2})h(\d{2})/); return d ? (+d[3] * 1e8 + +d[2] * 1e6 + +d[1] * 1e4 + (h ? +h[1] * 100 + +h[2] : 0)) : Infinity; };
export function gerarFrustrada(base, lista) {
  const c = semMarcas(base);
  const g = c.genero === 'f' ? 1 : 0;
  const qual = (QUALIFICACOES[c.qualificacao] || QUALIFICACOES.parte)[g];
  const ato = c.tipo === 'citacao' ? 'citação' : 'intimação';
  const B = (s) => (s ? `**${String(s).replace(/\*/g, '')}**` : '**[preencher]**');
  const juntar = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0]);
  const ordenados = lista.map((k, i) => ({ ...semMarcas(k), i })).sort((a, b) => minutos(a) - minutos(b) || a.i - b.i);
  // Contatos no mesmo momento e na mesma situação viram um só trecho ("pelos números A e B")
  const grupos = [];
  for (const k of ordenados) {
    const ult = grupos[grupos.length - 1];
    if (ult && ult.data === k.data && ult.hora === k.hora && ult.situacao === k.situacao && ult.canal === k.canal && k.data) ult.itens.push(k);
    else grupos.push({ ...k, itens: [k] });
  }
  const alvo = `${qual} ${B(c.nome)}${c.pj ? ', na pessoa de seu representante legal' : ''}${c.audFrust && c.tipo === 'citacao' ? ', bem como à sua intimação para a audiência designada' : ''}`;
  const numeros = (gr) => {
    const v = gr.itens.map((k) => B(gr.canal === 'email' ? k.email : k.telefone));
    if (gr.canal === 'email') return `${v.length > 1 ? 'aos endereços' : 'ao endereço'} ${juntar(v)}`;
    return `${v.length > 1 ? 'os números' : 'o número'} ${juntar(v)}`;
  };
  const pl = (gr, sing, plur) => (gr.itens.length > 1 ? plur : sing);
  const erro404 = (gr) => `uma vez que o sistema retornou erro informando que não foi possível localizar o identificador WhatsApp do destinatário, o que indica que ${pl(gr, 'o referido número não possui', 'os referidos números não possuem')} conta ativa no aplicativo`;
  const busca = (gr) => `uma vez que, ao pesquisar ${pl(gr, 'o referido número', 'os referidos números')} no aplicativo, não foi localizada conta de WhatsApp vinculada a ${pl(gr, 'ele', 'eles')}`;
  const naoComprovou = 'contudo, solicitado o envio de foto do documento de identificação ou a complementação do número do CPF, não atendeu à solicitação, não sendo possível confirmar sua identidade e encaminhar os arquivos do processo';
  // [meio (na 1ª frase), resultado no gerúndio (1ª frase), resultado com verbo (frases seguintes)]
  const partes = (gr) => {
    const pelo = (gr.itens.length > 1 ? 'pelos ' : 'pelo ') + numeros(gr).replace(/^(os|o) /, '');
    switch (gr.situacao) {
      case 'FRUST_SEM_WHATSAPP': return { pelo, r1: `não tendo sido possível o envio da mensagem, ${erro404(gr)}`, r2: `não foi possível o envio da mensagem, ${erro404(gr)}` };
      case 'FRUST_BUSCA': return { pelo, r1: `não tendo sido possível o envio de mensagem, ${busca(gr)}`, r2: `não foi possível o envio de mensagem, ${busca(gr)}` };
      case 'FRUST_TERCEIRO': return { r1: 'tendo a pessoa que respondeu negado tratar-se da parte quando questionada, tratando-se, portanto, de terceiro', r2: 'a pessoa que respondeu negou tratar-se da parte quando questionada, tratando-se, portanto, de terceiro' };
      case 'FRUST_SEM_IDENT': return { r1: 'tendo a pessoa que respondeu deixado de confirmar tratar-se da parte, embora questionada', r2: 'a pessoa que respondeu não confirmou tratar-se da parte, embora questionada' };
      case 'FRUST_NAO_COMPROVOU': return { r1: `tendo a pessoa que respondeu afirmado tratar-se da parte; ${naoComprovou}`, r2: `a pessoa que respondeu afirmou tratar-se da parte; ${naoComprovou}` };
      case 'EMAIL_FRUSTRADA': return { r1: 'não tendo obtido resposta', r2: 'não foi obtida resposta' };
      default: return { r1: 'não tendo obtido qualquer resposta às mensagens enviadas', r2: 'não foi obtida qualquer resposta às mensagens enviadas' };
    }
  };
  const frases = [];
  grupos.forEach((gr, i) => {
    const p = partes(gr);
    const viaEmail = gr.canal === 'email';
    if (i === 0) {
      const quando = `no dia ${B(gr.data)}, às ${B(gr.hora)}`;
      if (viaEmail) frases.push(`Certifico que, ${quando}, através de correio eletrônico, encaminhado ${numeros(gr)}, tentei proceder à ${ato} ${alvo}, ${p.r1}.`);
      else if (p.pelo) frases.push(`Certifico que, ${quando}, através do aplicativo WhatsApp, tentei proceder à ${ato} ${alvo}${alvo.includes(', ') ? ',' : ''} ${p.pelo}, ${p.r1}.`);
      else frases.push(`Certifico que, ${quando}, através do aplicativo WhatsApp, em contato com ${numeros(gr)}, tentei proceder à ${ato} ${alvo}, ${p.r1}.`);
      return;
    }
    const ant = grupos[i - 1];
    let con;
    if (!gr.data) con = 'Também';
    else if (gr.data === ant.data && gr.hora === ant.hora) con = 'Na mesma oportunidade';
    else if (gr.data === ant.data) con = `Ainda no mesmo dia, às ${B(gr.hora)}`;
    else con = `Em seguida, no dia ${B(gr.data)}, às ${B(gr.hora)}`;
    const trocouCanal = ant.canal !== gr.canal;
    let meio;
    if (viaEmail) meio = `através de correio eletrônico, encaminhado ${numeros(gr)}`;
    else meio = `${trocouCanal ? 'através do aplicativo WhatsApp, ' : ''}${p.pelo || `em contato com ${numeros(gr)}`}`;
    frases.push(`${con}, ${meio}, ${p.r2}.`);
  });
  const varios = lista.length > 1;
  const soEmail = lista.every((k) => k.canal === 'email');
  const soBusca = lista.every((k) => k.situacao === 'FRUST_BUSCA');
  const prova = varios ? (soEmail ? 'nos *prints* dos e-mails em anexo' : soBusca ? 'nos *prints* em anexo' : 'nos *prints* das conversas em anexo')
    : soEmail ? 'no *print* do e-mail em anexo' : soBusca ? 'no *print* em anexo' : 'no *print* da conversa em anexo';
  const abertura = !varios && /FRUST_SEM_RESPOSTA|EMAIL_FRUSTRADA/.test(lista[0].situacao) ? 'Diante da ausência de manifestação' : 'Diante do exposto';
  return `${frases.join(' ')} ${abertura}, restou frustrada a ${ato}, conforme registrado ${prova}.`;
}
export const gerarCertidaoMultipla = gerarFrustrada;

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
  const rod = texto.match(/PROCESSO N[º°o]\s*([\d.]+)\s*[·\-•]\s*(.+?)\s*[·\-•]\s*(EFETIVADA|FRUSTRADA|EXPEDIDA)(?:\s*[·\-•]\s*(CITA[ÇC][ÃA]O|INTIMA[ÇC][ÃA]O))?/i);
  if (rod) {
    meta.processo = rod[1]; meta.nomeRodape = rod[2].replace(/\*/g, '').trim(); meta.status = rod[3].toUpperCase();
    if (rod[4]) meta.ato = /^cita/i.test(rod[4]) ? 'citacao' : 'intimacao';
  }
  const reune = texto.match(/REÚNE\s+(\d+)\s+N[ÚU]MEROS/i);
  if (reune) meta.numerosReunidos = +reune[1];
  const cap = texto.match(/Capturado e gerado em (\d{2})\/(\d{2})\/(\d{4})/);
  meta.ano = cap ? +cap[3] : new Date().getFullYear();
  if (cap) meta.dataCaptura = { dia: +cap[1], mes: +cap[2], ano: +cap[3] };
  const imgs = texto.match(/Imagem enviada por [^\n]*?(\d{1,2}):(\d{2})/g);
  const docs = texto.match(/Documento enviado pela parte\s*:/gi); // arquivo (foto/PDF do documento) anexado pela extensão
  meta.imagensParte = (imgs ? imgs.length : 0) + (docs ? docs.length : 0);
  meta.ehEmail = !rod && /<[^>\s]+@[^>\s]+>/.test(texto) && /\d{1,2} de [a-zç]+ de \d{4},? (?:[àa]s )?\d{1,2}:\d{2}/i.test(texto);
  return meta;
}

// Texto lido de uma página de e-mail (Gmail, Outlook web)?
export function pareceEmail(texto) {
  return /<[^>\s]+@[^>\s]+>/.test(texto) && /\d{1,2} de [a-zç]+\.?(?: de \d{4})?,? (?:[àa]s )?\d{1,2}:\d{2}/i.test(texto) && !/neste telefone falo com/i.test(texto);
}

// ---------------------------------------------------------------------------
// 6. Do PDF lido às análises: separa por número e analisa cada conversa
// ---------------------------------------------------------------------------
// telas: [{ largura, altura, linhas, modo, rotulo? }]; meta: lerMetaPdf + lerNomeArquivo
export function analisarTelas(telas, meta = {}) {
  const grupos = separarPorNumero(telas);
  const resultados = [];
  for (const g of grupos) {
    const msgs = telasParaMensagens(g.telas, meta.ano || new Date().getFullYear());
    const telefone = g.telefone || (grupos.length === 1 ? meta.telefone : '') || '';
    const f = analisarConversa(msgs, { ...meta, telefone });
    const nomes = escolherNome({ rodape: meta.nomeRodape, arquivo: meta.nomeArquivo, titulo: msgs.titulo, saudacao: f.nomeSaudacao });
    f.nomes = nomes;
    f.nome = nomes.join('\n');
    f.pj = f.pj || nomes.some((n) => ehPessoaJuridica(n));
    if (meta.audiencia && !f.audiencia) f.audiencia = { data: '', hora: '', link: false, msg: false };
    f.avisos.unshift(...g.avisos);
    resultados.push({ f, msgs, telas: g.telas });
  }
  if (meta.numerosReunidos && meta.numerosReunidos !== resultados.length) {
    resultados[0].f.avisos.push(`O print informa ${meta.numerosReunidos} números, mas separei ${resultados.length} conversa(s). Confira.`);
  }
  return resultados;
}

// Prints com letra miúda: a leitura por blocos perde os carimbos de hora isolados.
// Se nenhuma linha parece carimbo, faz-se uma segunda leitura "esparsa" e aproveitam-se só os carimbos.
export function precisaSegundaLeitura(linhas) {
  const comTexto = linhas.filter((l) => /[a-zà-ú]{3}/i.test(l.texto || '')).length;
  return comTexto >= 2 && !linhas.some((l) => lerCarimbo(l.texto || '', 2000, { dia: 1, mes: 1, ano: 2000 }));
}
export function juntarCarimbos(linhas, esparsas) {
  const novas = esparsas.filter((e) => lerCarimbo(e.texto || '', 2000, { dia: 1, mes: 1, ano: 2000 })
    && !linhas.some((l) => Math.abs(l.y0 - e.y0) < (e.y1 - e.y0) * 0.6 && l.x0 < e.x1 && e.x0 < l.x1));
  return linhas.concat(novas);
}

// Painel de contato lido à parte: as linhas entram na tela da conversa marcadas como "painel"
// (servem para achar o telefone e o nome, nunca como mensagem).
export function juntarPaineis(telas) {
  const saida = [];
  for (const t of telas) {
    if (!t.painelDe) { saida.push(t); continue; }
    const dono = telas.find((x) => x.regiao === t.painelDe);
    if (!dono) continue;
    dono.painel = (dono.painel || []).concat(t.linhas.filter((l) => !l.barra).map((l) => ({ ...l, painel: true })));
    if (t.recortePainel) dono.paineisRecorte = (dono.paineisRecorte || []).concat(t.recortePainel);
    // relógio da barra de tarefas (lido no canto do painel) vai para o canto da conversa
    for (const l of t.linhas.filter((x) => x.barra)) dono.linhas.push({ ...l, x0: dono.largura * 0.93, x1: dono.largura * 0.99, y0: dono.altura * (0.95 + (l.y0 / t.altura - 0.95)), y1: dono.altura * 0.995 });
  }
  return saida;
}

// Texto da leitura só de dígitos ("+5564992221164 7696715632718 ..."): devolve o telefone, se houver
export function telefoneDeDigitos(texto) {
  const toks = (texto || '').split(/\s+/).map((x) => x.replace(/[^\d+]/g, '')).filter((x) => x.replace(/\D/g, '').length >= 10);
  const ok = (d) => /^55[1-9]\d(9\d{8}|[2-5]\d{7})$/.test(d);
  for (const t of toks) { const d = t.replace(/\D/g, ''); if (t.startsWith('+') && ok(d.slice(0, d[4] === '9' ? 13 : 12))) return formatarTelefone(d.slice(0, d[4] === '9' ? 13 : 12)); }
  for (const t of toks) { const d = t.replace(/\D/g, ''); if (ok(d)) return formatarTelefone(d); }
  return '';
}
