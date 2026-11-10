// Botão "Ler conversa" (bookmarklet). Roda na aba da conversa aberta:
// lê as mensagens visíveis (texto, posição, fotos e arquivos), rola até o início para
// carregar o histórico e entrega tudo ao site do gerador, na mesma máquina.
// Não envia nada para a internet: os dados passam de uma aba para outra do navegador.
(async () => {
  const SITE = '__SITE__';
  const ORIGEM = new URL(SITE).origin;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // Aviso flutuante na página da conversa
  const aviso = document.createElement('div');
  aviso.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#1f3a5f;color:#fff;font:14px Segoe UI,Arial,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);border-bottom:3px solid #b8860b;max-width:320px';
  const avisar = (t) => { aviso.textContent = 'Certidões CIRI: ' + t; };
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
  avisar('lendo as mensagens…');
  const passo = Math.max(200, caixa.clientHeight * 0.7);
  for (let y = 0, i = 0; i < 400; i++) {
    caixa.scrollTop = y;
    await espera(120);
    coletar();
    if (caixa.scrollTop + caixa.clientHeight >= caixa.scrollHeight - 2) break;
    y += passo;
  }

  // Arquivos citados no texto (ex.: "documento.pdf") viram marcação de arquivo
  const lista = [...linhas.values()].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const l of lista) if (/\.(pdf|jpe?g|png|heic|webp)\b/i.test(l.texto) && !/compartilhou|shared/i.test(l.texto)) l.texto = '[arquivo] ' + l.texto;

  const textoPagina = (document.body.innerText || '').slice(0, 200000);
  const telefones = [...new Set((textoPagina.match(/\+?55\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g) || []))].slice(0, 5);
  const dados = {
    tipo: 'ciri-conversa', versao: 1,
    origem: location.host, titulo: document.title,
    largura: pagina ? window.innerWidth : caixa.clientWidth,
    linhas: lista, telefones,
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
  const botao = document.createElement('button');
  botao.textContent = 'Abrir a certidão';
  botao.style.cssText = 'margin-top:8px;font:600 14px Segoe UI,Arial,sans-serif;background:#b8860b;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer';
  const fechar = document.createElement('button');
  fechar.textContent = 'Cancelar';
  fechar.style.cssText = 'margin:8px 0 0 8px;font:13px Segoe UI,Arial,sans-serif;background:transparent;color:#fff;border:1px solid #fff8;border-radius:6px;padding:6px 10px;cursor:pointer';
  fechar.onclick = () => aviso.remove();
  aviso.append(titulo, botao, fechar);

  botao.onclick = async () => {
    const janela = window.open(SITE + '#leitor', 'certidoes-ciri');
    if (!janela) { titulo.textContent = 'Certidões CIRI: o navegador bloqueou a nova aba. Permita pop-ups para este site e clique de novo.'; return; }
    botao.disabled = true; botao.textContent = 'Enviando…';
    let entregue = false;
    const ouvir = (e) => {
      if (e.origin !== ORIGEM || !e.data || e.data.tipo !== 'ciri-recebido' || e.data.id !== dados.id) return;
      entregue = true;
      window.removeEventListener('message', ouvir);
      aviso.remove();
    };
    window.addEventListener('message', ouvir);
    for (let i = 0; i < 75 && !entregue; i++) {
      try { janela.postMessage(dados, ORIGEM); } catch (e) { /* aba ainda carregando */ }
      await espera(400);
    }
    if (!entregue) { titulo.textContent = 'Certidões CIRI: o gerador não respondeu. Clique de novo em Abrir a certidão.'; botao.disabled = false; botao.textContent = 'Abrir a certidão'; window.removeEventListener('message', ouvir); }
  };
})();
