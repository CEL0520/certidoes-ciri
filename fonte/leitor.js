// Botão "Ler conversa" (bookmarklet). Roda na aba da conversa aberta:
// lê as mensagens visíveis (texto, posição, fotos e arquivos), rola até o início para
// carregar o histórico e entrega tudo ao site do gerador, na mesma máquina.
// Não envia nada para a internet: os dados passam de uma aba para outra do navegador.
(async () => {
  const SITE = '__SITE__';
  // Na extensão (script injetado pelo botão da extensão) a entrega e as fotos da tela passam pela extensão
  const EXT = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome : null;
  const ORIGEM = EXT ? '' : new URL(SITE).origin;
  if (window.__ciriLendo) return;
  window.__ciriLendo = true;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // Aviso flutuante na página da conversa
  const aviso = document.createElement('div');
  aviso.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#1f3a5f;color:#fff;font:14px Segoe UI,Arial,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);border-bottom:3px solid #b8860b;max-width:320px';
  const avisar = (t) => { aviso.textContent = 'Certidões CIRI: ' + t; };
  const fim = () => { aviso.remove(); window.__ciriLendo = false; };
  document.body.appendChild(aviso);
  avisar('procurando a conversa…');


  // 1. Achar a área rolável das mensagens: a maior área com rolagem vertical e texto
  // (vale também a área que ainda não transbordou: o histórico antigo carrega ao rolar)
  const candidatos = [...document.querySelectorAll('*')].filter((el) => {
    if (el === aviso || aviso.contains(el)) return false;
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 250 && r.height > 200 && (el.innerText || '').trim().length > 20;
  });
  // A conversa aberta fica no centro-direita da tela (WhatsApp Web, painéis de atendimento,
  // e-mail); listas de contatos ficam à esquerda. Vota pelos pontos centrais da janela.
  const ehRolavel = (el) => el && el !== aviso && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.getBoundingClientRect().height > 200 && el.getBoundingClientRect().width > 250;
  const votos = new Map();
  for (const fx of [0.5, 0.6, 0.7]) for (const fy of [0.35, 0.5, 0.65]) {
    let el = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
    while (el && el !== document.body && !ehRolavel(el)) el = el.parentElement;
    if (el && el !== document.body) votos.set(el, (votos.get(el) || 0) + 1);
  }
  let caixa = null, melhor = 0;
  for (const [el, v] of votos) if (v > melhor && (el.innerText || '').trim().length > 20) { melhor = v; caixa = el; }
  let melhorPontos = 0;
  if (!caixa) for (const el of candidatos) {
    const r = el.getBoundingClientRect();
    const texto = (el.innerText || '');
    // prefere a área com mais texto de mensagens e mais larga, que rola
    const pontos = texto.length + r.width * r.height / 200 + (el.scrollHeight > el.clientHeight + 20 ? 2000 : 0)
      + (/(\d{1,2}:\d{2})/.test(texto) ? 1500 : 0);
    if (pontos > melhorPontos) { melhorPontos = pontos; caixa = el; }
  }
  const pagina = !caixa;
  if (!pagina) { const o = caixa.style.outline; caixa.style.outline = '3px solid #b8860b'; setTimeout(() => { caixa.style.outline = o; }, 2500); }
  if (pagina) caixa = document.scrollingElement || document.documentElement;

  // 2. Rolar até o início para carregar o histórico
  avisar('carregando o histórico da conversa…');
  let alturaAnterior = -1, iguais = 0;
  for (let i = 0; i < 60 && iguais < 3; i++) {
    caixa.scrollTop = 0;
    caixa.dispatchEvent(new Event('scroll'));
    await espera(700);
    if (caixa.scrollHeight === alturaAnterior) iguais++; else { iguais = 0; alturaAnterior = caixa.scrollHeight; }
  }

  // 3. Ler de cima para baixo (listas virtuais só mostram parte das mensagens por vez)
  const linhas = new Map();
  const ehVisivel = (el) => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const coletar = () => {
    const cr = pagina ? { left: 0, top: 0 } : caixa.getBoundingClientRect();
    const topo = caixa.scrollTop;
    const walker = document.createTreeWalker(caixa, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t || !n.parentElement || aviso.contains(n) || !ehVisivel(n.parentElement)) continue;
      range.selectNodeContents(n);
      const rs = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rs.length) continue;
      const x0 = Math.min(...rs.map((r) => r.left)) - cr.left;
      const x1 = Math.max(...rs.map((r) => r.right)) - cr.left;
      const y0 = rs[0].top - cr.top + topo;
      const y1 = rs[rs.length - 1].bottom - cr.top + topo;
      const k = Math.round(y0) + '|' + Math.round(x0) + '|' + t.slice(0, 40);
      if (!linhas.has(k)) linhas.set(k, { texto: t, x0, x1, y0, y1 });
    }
    // Fotos e arquivos enviados (não lê o conteúdo: só registra que existem e onde estão)
    for (const img of caixa.querySelectorAll('img, canvas, video')) {
      if (aviso.contains(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 90 || r.height < 70 || !ehVisivel(img)) continue;
      const x0 = r.left - cr.left, y0 = r.top - cr.top + topo;
      const k = Math.round(y0) + '|' + Math.round(x0) + '|img';
      if (!linhas.has(k)) linhas.set(k, { texto: '[imagem enviada]', x0, x1: r.right - cr.left, y0, y1: r.bottom - cr.top + topo });
    }
  };
  // WhatsApp Web: cada mensagem guarda, por dentro, data, hora e autor ("[07:26, 05/11/2026] Fulano: ")
  // e se é recebida (message-in) ou enviada (message-out). Lê isso em vez da posição na tela.
  const ehWhats = /(^|\.)web\.whatsapp\.com$/.test(location.host) || !!document.querySelector('#main .message-in, #main .message-out');
  const mensagensWa = new Map();
  const lerPre = (pre) => {
    const m = (pre || '').match(/\[(\d{1,2}):(\d{2})\s*([AaPp]\.?\s*[Mm]\.?)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/);
    if (!m) return null;
    let h = +m[1];
    if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h !== 12) h += 12; if (!pm && h === 12) h = 0; }
    let dia = +m[4], mes = +m[5];
    if (m[3]) { dia = +m[5]; mes = +m[4]; } // formato americano: [9:35 AM, 7/1/2026]
    let ano = +m[6]; if (ano < 100) ano += 2000;
    return { dia, mes, ano, hora: h, min: +m[2] };
  };
  const coletarWa = () => {
    for (const el of document.querySelectorAll('#main .message-in, #main .message-out')) {
      const linha = el.closest('[data-id]') || el;
      const id = linha.getAttribute('data-id') || (el.innerText || '').slice(0, 60);
      if (mensagensWa.has(id)) continue;
      // a mensagem citada (resposta) fica num bloco clicável com o seu próprio data-pre-plain-text:
      // usa só o bloco da própria mensagem
      const citada = (x) => { const q = x.closest('[role="button"], [aria-label*="itad"], [aria-label*="uot"], .quoted-mention, [data-testid*="quoted"]'); return !!q && q !== el && el.contains(q); };
      const pres = [...el.querySelectorAll('[data-pre-plain-text]')];
      const pre = pres.find((x) => !citada(x)) || null;
      let texto = '';
      const sel = pre && [...pre.querySelectorAll('span.selectable-text')].filter((x) => !citada(x));
      if (sel && sel.length) texto = sel.map((x) => x.innerText).join(' ');
      else if (pre) texto = pre.innerText;
      else { // sem o atributo (mensagens longas, com emojis, encaminhadas): texto visível sem a hora
        const copia = el.cloneNode(true);
        copia.querySelectorAll('[role="button"]').forEach((x) => x.remove());
        texto = (copia.innerText || '').replace(/\n?\s*(Editada\s*)?\d{1,2}:\d{2}\s*$/i, '').replace(/\bLer mais\b/i, '');
      }
      const temImagem = [...el.querySelectorAll('img')].some((im) => im.getBoundingClientRect().width > 90 && /^blob:|^data:image/.test(im.src || ''));
      if (temImagem) texto = ('[imagem enviada] ' + texto).trim();
      if (/\.(pdf|jpe?g|png|docx?)\b/i.test(el.innerText || '') && !texto.includes('[arquivo]')) texto = ('[arquivo] ' + texto).trim();
      texto = texto.replace(/\s+/g, ' ').trim();
      if (!texto) continue;
      let tempo = lerPre(pre && pre.getAttribute('data-pre-plain-text'));
      if (!tempo) { // sem o atributo (fotos, áudios): só a hora visível
        const hm = (el.innerText || '').match(/(\d{1,2}):(\d{2})\s*$/m);
        if (hm) tempo = { hora: +hm[1], min: +hm[2], soHora: true };
      }
      mensagensWa.set(id, { lado: el.classList.contains('message-out') ? 'servidor' : 'parte', texto, tempo, y: linha.getBoundingClientRect().top + caixa.scrollTop });
    }
  };
  avisar('lendo as mensagens…');
  const passo = Math.max(200, caixa.clientHeight * 0.7);
  for (let y = 0, i = 0; i < 400; i++) {
    caixa.scrollTop = y;
    await espera(120);
    coletar();
    if (ehWhats) coletarWa();
    if (caixa.scrollTop + caixa.clientHeight >= caixa.scrollHeight - 2) break;
    y += passo;
  }

  // Arquivos citados no texto (ex.: "documento.pdf") viram marcação de arquivo
  const lista = [...linhas.values()].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const l of lista) if (/\.(pdf|jpe?g|png|heic|webp)\b/i.test(l.texto) && !/compartilhou|shared/i.test(l.texto)) l.texto = '[arquivo] ' + l.texto;

  // Telefone: só da conversa aberta (cabeçalho) ou do painel de dados do contato, à direita.
  // A lista de conversas, à esquerda, é ignorada.
  const RE_TEL = /\+\s?\d{2}\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}|\(\d{2}\)\s?9?\d{4}-?\d{4}/;
  const limiteEsq = pagina ? 0 : caixa.getBoundingClientRect().left - 4;
  const listaContatos = ehWhats ? document.querySelector('#pane-side') : null;
  const cands = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let nt;
  while ((nt = walk.nextNode())) {
    const t = (nt.textContent || '').trim();
    if (t.length > 40 || !RE_TEL.test(t) || !nt.parentElement || aviso.contains(nt.parentElement)) continue;
    if (listaContatos && listaContatos.contains(nt.parentElement)) continue;
    const r = nt.parentElement.getBoundingClientRect();
    if (!r.width || r.right < limiteEsq) continue;           // à esquerda da conversa: lista de contatos
    if (caixa.contains(nt.parentElement) && !pagina) continue; // dentro das mensagens: número citado no texto
    cands.push({ t: t.match(RE_TEL)[0], x: r.left });
  }
  cands.sort((a, b) => b.x - a.x); // painel da direita primeiro, depois o cabeçalho
  const telefones = [...new Set(cands.map((c) => c.t))].slice(0, 3);
  // Nome: cabeçalho da conversa aberta
  let nome = '';
  const cabecalho = ehWhats ? document.querySelector('#main header') : null;
  if (cabecalho) { const sp = cabecalho.querySelector('span[dir="auto"], span[title]'); nome = sp ? (sp.getAttribute('title') || sp.innerText || '').trim() : ''; }
  let avisoTelefone = '';
  if (!telefones.length) avisoTelefone = ehWhats
    ? 'O telefone não aparece: no WhatsApp Web, abra os dados do contato (clique no nome no topo da conversa) e clique de novo em Ler conversa — ou preencha o telefone.'
    : 'O telefone não aparece na tela: abra o painel de dados do contato e leia de novo, ou preencha o telefone.';
  if (ehWhats && RE_TEL.test(nome)) { telefones.unshift(nome.match(RE_TEL)[0]); nome = ''; avisoTelefone = ''; }
  const dados = {
    tipo: 'ciri-conversa', versao: 1, botao: 6,
    origem: location.host, titulo: document.title,
    largura: pagina ? window.innerWidth : caixa.clientWidth,
    linhas: lista, telefones, nome, avisoTelefone,
    mensagens: ehWhats ? [...mensagensWa.values()].sort((a, b) => a.y - b.y).map(({ y, ...m }) => m) : null,
    textoCaixa: (caixa.innerText || '').slice(0, 200000),
    data: new Date().toISOString(),
  };

  // 4. Leitura pronta: o gerador só abre agora, num clique da pessoa (a aba do chat
  //    precisa ficar à frente durante a leitura, senão o navegador a "adormece")
  dados.id = Math.random().toString(36).slice(2);
  const msgsParte = lista.length;
  aviso.textContent = '';
  aviso.style.cursor = 'default';
  const titulo = document.createElement('div');
  titulo.textContent = `Certidões CIRI: conversa lida (${msgsParte} trechos).`;
  const estilo = 'margin:8px 8px 0 0;font:600 14px Segoe UI,Arial,sans-serif;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer';
  const botao = document.createElement('button');
  botao.textContent = 'Abrir a certidão';
  botao.style.cssText = estilo + ';background:#b8860b';
  const botaoPrint = document.createElement('button');
  botaoPrint.textContent = 'Gerar PDF do print';
  botaoPrint.title = 'Fotografa a conversa e os dados do contato, rolando do início ao fim, e monta o PDF no gerador';
  botaoPrint.style.cssText = estilo + ';background:#2f5d8f;border:1px solid #fff6';
  const fechar = document.createElement('button');
  fechar.textContent = 'Cancelar';
  fechar.style.cssText = 'margin:8px 0 0 0;font:13px Segoe UI,Arial,sans-serif;background:transparent;color:#fff;border:1px solid #fff8;border-radius:6px;padding:6px 10px;cursor:pointer';
  fechar.onclick = fim;
  aviso.append(titulo, botao);
  if (ehWhats) aviso.append(botaoPrint);
  aviso.append(fechar);

  // ---------- PDF do print (WhatsApp Web) ----------
  // Fotografa a área da conversa + painel "Dados do contato" (sem a lista de conversas, à esquerda),
  // rolando do início ao fim. Cada tela repete um trecho do fim da anterior.
  const RE_PROC = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;
  const areaDoPrint = () => {
    const main = document.querySelector('#main') || caixa;
    const rm = main.getBoundingClientRect();
    let up = main;
    while (up.parentElement && up.parentElement !== document.body && up.parentElement.getBoundingClientRect().left >= rm.left - 2) up = up.parentElement;
    let direita = Math.max(rm.right, up.getBoundingClientRect().right);
    // painel de dados do contato aberto à direita da conversa
    let painel = null;
    if (rm.right < innerWidth - 60) {
      let el = document.elementFromPoint(Math.min(innerWidth - 5, rm.right + 40), innerHeight * 0.4);
      while (el && el !== document.body && el.getBoundingClientRect().height < innerHeight * 0.7) el = el.parentElement;
      if (el && el !== document.body && el.getBoundingClientRect().left >= rm.right - 4) { painel = el; direita = Math.max(direita, el.getBoundingClientRect().right); }
    }
    const x = Math.max(0, rm.left), y = Math.max(0, Math.min(rm.top, 0));
    return { x, y, w: Math.min(innerWidth, direita) - x, h: innerHeight - y, painel };
  };
  const nomeNoWhats = (painel) => {
    if (!painel) return '';
    const w = document.createTreeWalker(painel, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const t = (n.textContent || '').trim(); if (/^~\s?\S/.test(t) && t.length < 60) return t; }
    return '';
  };
  const telaParaJpeg = (fonte, fw, area) => {
    const s = fw / innerWidth;
    const c = document.createElement('canvas');
    const esc = Math.min(1, 1600 / (area.w * s));
    c.width = Math.round(area.w * s * esc); c.height = Math.round(area.h * s * esc);
    c.getContext('2d').drawImage(fonte, area.x * s, area.y * s, area.w * s, area.h * s, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  };
  const fotosVistas = new Map();
  const coletarFotos = () => {
    for (const im of document.querySelectorAll('#main .message-in img')) {
      const r = im.getBoundingClientRect();
      if (r.width < 110 || r.height < 80 || !im.naturalWidth || im.naturalWidth < 160) continue;
      if (!/^(blob:|data:image)/.test(im.src || '') || fotosVistas.has(im.src)) continue;
      try {
        const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        const msg = im.closest('.message-in');
        const pre = msg && msg.querySelector('[data-pre-plain-text]');
        const hm = ((msg && msg.innerText) || '').match(/(\d{1,2}:\d{2})\s*$/m);
        fotosVistas.set(im.src, { src: c.toDataURL('image/jpeg', 0.9), legenda: hm ? hm[1].replace(':', 'h') : '', pre: pre ? pre.getAttribute('data-pre-plain-text') : '' });
      } catch (e) { fotosVistas.set(im.src, null); /* imagem protegida: fica de fora */ }
    }
  };
  // Fonte das fotos da tela: extensão (sem pedir nada) ou compartilhamento da aba (botão da barra)
  const abrirCamera = async () => {
    if (EXT) {
      let ultima = 0;
      return {
        foto: async () => {
          const falta = 600 - (Date.now() - ultima); if (falta > 0) await espera(falta); // limite do navegador: 2 por segundo
          ultima = Date.now();
          const url = await EXT.runtime.sendMessage({ tipo: 'ciri-foto-tela' });
          if (!url || url.erro) throw new Error((url && url.erro) || 'sem imagem');
          const img = new Image(); img.src = url; await img.decode();
          return { fonte: img, largura: img.naturalWidth };
        },
        fechar: () => {},
      };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('Este navegador não permite capturar a tela pelo botão. Use a extensão.');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: 5 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' });
    const trilha = stream.getVideoTracks()[0];
    const fechar = () => stream.getTracks().forEach((t) => t.stop());
    if (trilha.getSettings().displaySurface && trilha.getSettings().displaySurface !== 'browser') { fechar(); throw new Error('Escolha a opção "Esta aba" (não a tela inteira nem uma janela).'); }
    const video = document.createElement('video');
    video.muted = true; video.srcObject = stream; await video.play();
    await espera(400);
    return { foto: async () => { await new Promise((ok) => { setTimeout(ok, 350); if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => setTimeout(ok, 30)); }); return { fonte: video, largura: video.videoWidth }; }, fechar };
  };
  botaoPrint.onclick = async () => {
    botaoPrint.disabled = true; botao.disabled = true;
    let camera;
    try { camera = await abrirCamera(); } catch (e) {
      titulo.textContent = 'Certidões CIRI: ' + (e && e.name === 'NotAllowedError' ? 'captura cancelada.' : (e.message || 'não foi possível capturar a tela.'));
      botaoPrint.disabled = false; botao.disabled = false; return;
    }
    const area = areaDoPrint();
    const telas = [];
    // durante a captura o aviso some da tela (senão sairia no print); o título da aba mostra o andamento
    const tituloAba = document.title;
    const avisarCaptura = (t) => { document.title = 'Certidões CIRI: ' + t; };
    aviso.style.visibility = 'hidden';
    try {
      caixa.scrollTop = 0; await espera(700);
      for (let i = 0; i < 60; i++) {
        coletarFotos();
        const f = await camera.foto();
        telas.push(await telaParaJpeg(f.fonte, f.largura, area));
        if (caixa.scrollTop + caixa.clientHeight >= caixa.scrollHeight - 2) break;
        caixa.scrollTop += Math.round(caixa.clientHeight * 0.82); // ~18% da tela anterior se repete
        await espera(300);
        avisarCaptura(`fotografando a conversa (${telas.length} telas)…`);
      }
    } catch (e) {
      titulo.textContent = 'Certidões CIRI: a captura parou (' + (e.message || e) + ').';
    } finally { camera.fechar(); aviso.style.visibility = ''; document.title = tituloAba; }
    const servidor = (dados.mensagens || []).filter((m) => m.lado === 'servidor').map((m) => m.texto).join('\n') + '\n' + dados.textoCaixa;
    const proc = servidor.match(RE_PROC);
    dados.print = {
      telas,
      fotos: [...fotosVistas.values()].filter(Boolean),
      cab: { telefone: telefones[0] || '', nomeWhats: nomeNoWhats(area.painel), nome, processo: proc ? proc[0] : '', quando: new Date().toISOString(), painel: !!area.painel },
    };
    titulo.textContent = `Certidões CIRI: print pronto (${telas.length} telas${dados.print.fotos.length ? ', ' + dados.print.fotos.length + ' foto(s) da parte' : ''}).` + (area.painel ? '' : ' Dica: abra os dados do contato antes, para o telefone e a foto de perfil saírem no print.');
    botao.textContent = 'Abrir a certidão e o PDF';
    botao.disabled = false;
    botaoPrint.remove();
  };

  botao.onclick = async () => {
    if (EXT) {
      botao.disabled = true; botao.textContent = 'Enviando…';
      try {
        const paraUrl = (b) => (b instanceof Blob ? new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); }) : b);
        if (dados.print) dados.print.telas = await Promise.all(dados.print.telas.map(paraUrl));
        await EXT.runtime.sendMessage({ tipo: 'ciri-entregar', dados }); fim();
      }
      catch (e) { titulo.textContent = 'Certidões CIRI: não foi possível abrir o gerador (' + (e.message || e) + ').'; botao.disabled = false; botao.textContent = 'Abrir a certidão'; }
      return;
    }
    const janela = window.open(SITE + '#leitor', 'certidoes-ciri');
    if (!janela) { titulo.textContent = 'Certidões CIRI: o navegador bloqueou a nova aba. Permita pop-ups para este site e clique de novo.'; return; }
    const rotulo = botao.textContent;
    botao.disabled = true; botao.textContent = 'Enviando…';
    // 1) espera o gerador abrir (mensagem pequena); 2) envia tudo uma única vez; 3) espera a confirmação
    let pronto = false, entregue = false;
    const ouvir = (e) => {
      if (e.origin !== ORIGEM || !e.data) return;
      if (e.data.tipo === 'ciri-pronto') pronto = true;
      if (e.data.tipo === 'ciri-recebido' && e.data.id === dados.id) entregue = true;
    };
    window.addEventListener('message', ouvir);
    for (let i = 0; i < 150 && !pronto; i++) {
      try { janela.postMessage({ tipo: 'ciri-ola' }, ORIGEM); } catch (e) { /* aba ainda carregando */ }
      await espera(200);
    }
    if (pronto) {
      try { janela.postMessage(dados, ORIGEM); } catch (e) { /* aba fechada */ }
      for (let i = 0; i < 300 && !entregue; i++) await espera(200);
    }
    window.removeEventListener('message', ouvir);
    if (entregue) { fim(); return; }
    titulo.textContent = 'Certidões CIRI: o gerador não respondeu. Veja se a aba do gerador abriu e clique de novo em ' + rotulo + '.';
    botao.disabled = false; botao.textContent = rotulo;
  };
})();
