import * as N from './nucleo.js?v=0.7';
import { analisarArquivo, ocrInstalado, desenharPrint } from './leitura.js?v=0.7';

const $ = (id) => document.getElementById(id);
const estado = { fontes: [], temOcr: false, visivel: 0, zoom: 1, visorAberto: true, recebidos: new Set() };

const CAMPOS = ['situacao', 'tipo', 'qualificacao', 'genero', 'nomes', 'telefone', 'numeroComum', 'textoComum', 'email',
  'data', 'hora', 'tentativas', 'tipoAto', 'evento', 'extras', 'identidadeData', 'identidadeHora', 'frase', 'tacita',
  'docTipo', 'audData', 'audHora', 'audLink', 'encData', 'encHora', 'emailDocs', 'confData', 'confHora', 'confEmail', 'confPor'];

// ---------- Preparação ----------
for (const [k, v] of Object.entries(N.SITUACOES)) $('situacao').add(new Option(v, k));
for (const [k, v] of Object.entries(N.ROTULOS_QUALIFICACAO)) $('qualificacao').add(new Option(v, k));

(async () => {
  const origem = await ocrInstalado();
  estado.temOcr = !!origem;
  const s = $('statusOcr');
  if (origem === 'local') { s.textContent = 'OCR instalado'; s.className = 'selo ok'; }
  else if (origem === 'internet') { s.textContent = 'OCR pronto'; s.className = 'selo ok'; s.title = 'Arquivos do OCR carregados da internet; a leitura dos prints é feita neste computador.'; }
  else { s.textContent = 'OCR não instalado – veja o LEIA-ME'; s.className = 'selo falta'; }
})();

// ---------- Entrada de arquivos ----------
const zona = $('zona');
zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('sobre'); });
zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('sobre'); receber([...e.dataTransfer.files]); });
zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('arquivos').click(); });
$('arquivos').addEventListener('change', (e) => { receber([...e.target.files]); e.target.value = ''; });

function progresso(msg, erro = false) {
  const p = $('progresso');
  p.hidden = !msg; p.textContent = msg || ''; p.classList.toggle('erro', erro);
}

async function receber(arquivos) {
  for (const a of arquivos) {
    try {
      progresso(`Lendo ${a.name}…`);
      const r = await analisarArquivo(a, progresso, estado.temOcr);
      estado.fontes.push({ ...r, ativa: true, file: a });
      estado.visivel = estado.fontes.length - 1;
    } catch (e) {
      progresso(`Não consegui ler ${a.name}: ${e.message}`, true);
      console.error(e);
      return;
    }
  }
  progresso('');
  aposAnalise();
}

// ---------- Lista de fontes ----------
const ehFrustrada = (s) => /^FRUST|EMAIL_FRUSTRADA/.test(s);
function desenharFontes() {
  const ul = $('fontes');
  ul.innerHTML = '';
  estado.fontes.forEach((fo, i) => {
    const f = fo.f;
    const li = document.createElement('li');
    if (!fo.ativa) li.className = 'inativa';
    const contato = f.canal === 'email' ? f.email : f.telefone;
    const cls = ehFrustrada(f.situacao) ? 'etq frust' : /EXPEDIDA/.test(f.situacao) ? 'etq exp' : 'etq';
    li.innerHTML = `<div><b></b> <span class="meta"></span></div><div class="botoes"><span class="${cls}"></span><button class="mini">remover</button></div>`;
    li.querySelector('b').textContent = fo.arquivo;
    li.querySelector('.meta').textContent = [contato, (f.nomes || []).join(' e ') || f.nome].filter(Boolean).join(' · ');
    li.querySelector('.etq').textContent = N.SITUACOES[f.situacao] + (fo.ativa ? '' : ' (não entra)');
    li.querySelector('button').onclick = () => { estado.fontes.splice(i, 1); aposAnalise(); };
    ul.appendChild(li);
  });
}

// Regra: se houver um contato com resposta (não frustrado), só ele entra na certidão.
function escolherFontes() {
  const naoFrust = estado.fontes.filter((x) => !ehFrustrada(x.f.situacao));
  estado.fontes.forEach((x) => { x.ativa = naoFrust.length ? x === naoFrust[0] : true; });
  return naoFrust.length ? [naoFrust[0]] : estado.fontes;
}

// ---------- Preencher o formulário a partir da análise ----------
const T = (t) => ({ d: N.fmtData(t), h: N.fmtHora(t) });
function preencher(fo) {
  const f = fo.f;
  const v = {};
  v.situacao = f.situacao;
  v.tipo = f.tipo || 'intimacao';
  const nomes = (f.nomes && f.nomes.length ? f.nomes : (f.nome || '').split('\n')).filter(Boolean);
  v.nomes = nomes.join('\n');
  v.genero = 'auto';
  v.qualificacao = f.perito ? 'perito' : 'parte';
  v.telefone = f.telefone || '';
  v.numeroComum = nomes.length > 1;
  v.textoComum = nomes.length > 1 ? 'número comum a ambas as partes' : $('textoComum').value;
  v.email = f.email || '';
  const p = T(f.tempoPrincipal || (f.tentativas && f.tentativas[0]));
  v.data = p.d; v.hora = p.h;
  v.tentativas = (f.tentativas || []).map((t) => `${N.fmtData(t)} ${N.fmtHora(t)}`).join('\n');
  v.tipoAto = f.tipoAto || 'ato ordinatório';
  v.evento = f.evento || '';
  v.extras = f.extras || '';
  const id = T(f.identidadeAnterior);
  v.identidadeData = id.d; v.identidadeHora = id.h;
  v.frase = f.frase || 'Recebi e estou ciente';
  v.tacita = f.tacita || '';
  v.docTipo = f.docTipo || 'documento';
  v.audData = f.audiencia ? f.audiencia.data : '';
  v.audHora = f.audiencia ? f.audiencia.hora : '';
  v.audLink = f.audiencia ? !!f.audiencia.link : false;
  const e = T(f.encerramento);
  v.encData = e.d; v.encHora = e.h;
  v.emailDocs = f.emailDocs || '';
  const c = T(f.confTempo);
  v.confData = c.d; v.confHora = c.h;
  v.confEmail = f.confEmail || '';
  v.confPor = f.confPor || '';
  for (const k of CAMPOS) {
    const el = $(k);
    if (el.type === 'checkbox') el.checked = !!v[k];
    else el.value = v[k] ?? '';
  }

  $('avisos').innerHTML = '';
  for (const a of f.avisos || []) { const pp = document.createElement('p'); pp.textContent = a; $('avisos').appendChild(pp); }
  const ul = $('evidencias');
  ul.innerHTML = '';
  for (const ev of f.evidencias || []) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> <span></span>';
    li.querySelector('b').textContent = `${ev.rotulo}${ev.tempo ? ` (${N.fmtData(ev.tempo)} ${N.fmtHora(ev.tempo)})` : ''}:`;
    li.querySelector('span').textContent = ev.texto;
    ul.appendChild(li);
  }
}

function lerCampos() {
  const c = {};
  for (const k of CAMPOS) { const el = $(k); c[k] = el.type === 'checkbox' ? el.checked : el.value.trim(); }
  c.tentativas = c.tentativas.split('\n').map((l) => {
    const m = l.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:,|às)?\s*(\d{1,2}h\d{2})?/);
    return m ? { data: m[1], hora: m[2] || '' } : null;
  }).filter(Boolean);
  return c;
}

// ---------- Mostrar / esconder campos ----------
function ajustarCampos() {
  const sit = $('situacao').value;
  const canal = /^EMAIL/.test(sit) ? 'email' : 'whatsapp';
  document.querySelectorAll('[data-sit]').forEach((el) => {
    const lista = el.dataset.sit.split(' ');
    const negado = lista[0].startsWith('-');
    const dentro = lista.map((x) => x.replace('-', '')).includes(sit);
    el.hidden = negado ? dentro : !dentro;
  });
  document.querySelectorAll('[data-canal]').forEach((el) => { el.hidden = el.dataset.canal !== canal; });
  document.querySelectorAll('[data-comum]').forEach((el) => { el.hidden = canal !== 'whatsapp' || !$('numeroComum').checked; });
}

// ---------- Gerar certidões ----------
function gerar() {
  ajustarCampos();
  const c = lerCampos();
  const ativas = estado.fontes.filter((x) => x.ativa);
  const nomes = c.nomes.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!nomes.length) nomes.push('');
  const caixa = $('certidoes');
  caixa.innerHTML = '';
  const multipla = ativas.length > 1 && ativas.every((x) => ehFrustrada(x.f.situacao));
  for (const nome of nomes) {
    let md;
    if (multipla) {
      const contatos = ativas.map((x) => {
        const t = T(x.f.tempoPrincipal || (x.f.tentativas || [])[0]);
        const tentativas = x.f.situacao === 'FRUST_SEM_RESPOSTA' ? (x.f.tentativas || []).map((y) => ({ data: N.fmtData(y), hora: N.fmtHora(y) })) : [];
        return { canal: x.f.canal, situacao: x.f.situacao, telefone: x.f.telefone, email: x.f.email, data: t.d, hora: t.h, tentativas };
      });
      md = N.gerarCertidaoMultipla({ ...c, nome, genero: c.genero === 'auto' ? N.adivinharGenero(nome) : c.genero }, contatos);
    } else {
      md = N.gerarCertidao({ ...c, nome, genero: c.genero === 'auto' ? N.adivinharGenero(nome) : c.genero });
    }
    const div = document.createElement('div');
    div.className = 'certidao';
    div.innerHTML = '<div class="cab"><span></span><div class="botoes"><button class="copiar">Copiar com formatação</button><button class="sec copiarTexto">Copiar só o texto</button></div></div><div class="texto" contenteditable="true" spellcheck="true"></div>';
    div.querySelector('.cab span').textContent = (multipla ? 'Vários contatos · ' : '') + (nome || 'Certidão');
    const texto = div.querySelector('.texto');
    texto.innerHTML = N.paraHtml(md);
    div.querySelector('.copiar').onclick = (e) => copiar(texto, true, e.target);
    div.querySelector('.copiarTexto').onclick = (e) => copiar(texto, false, e.target);
    caixa.appendChild(div);
  }

}

async function copiar(el, comFormato, botao) {
  const html = `<p style="text-align:justify">${el.innerHTML}</p>`;
  const texto = el.innerText;
  try {
    if (comFormato && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(texto);
    }
  } catch {
    // Alternativa para navegadores sem acesso à área de transferência
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('copy');
    sel.removeAllRanges();
  }
  const antes = botao.textContent;
  botao.textContent = 'Copiado!';
  setTimeout(() => { botao.textContent = antes; }, 1400);
}

function lembrar(chave, valor) {
  try {
    if (valor === undefined) return localStorage.getItem('ciri.' + chave);
    localStorage.setItem('ciri.' + chave, valor);
  } catch { return null; }
  return null;
}

// ---------- Visor do print ----------
let desenhando = 0;
async function desenharVisor() {
  const tem = estado.fontes.length > 0;
  const aberto = tem && estado.visorAberto;
  $('visor').hidden = !aberto;
  $('visorMostrar').hidden = !tem || estado.visorAberto;
  $('principal').classList.toggle('lado-a-lado', aberto);
  document.body.classList.toggle('com-print', aberto);
  if (!aberto) return;
  if (estado.visivel >= estado.fontes.length) estado.visivel = 0;
  const abas = $('visorAbas');
  abas.innerHTML = '';
  estado.fontes.forEach((fo, i) => {
    const b = document.createElement('button');
    b.textContent = fo.arquivo;
    b.title = fo.arquivo;
    if (i === estado.visivel) b.className = 'ativa';
    b.onclick = () => { estado.visivel = i; desenharVisor(); };
    abas.appendChild(b);
  });
  $('zoomValor').textContent = `${Math.round(estado.zoom * 100)}%`;
  const fo = estado.fontes[estado.visivel];
  const destino = $('visorConteudo');
  const minha = ++desenhando;
  if (fo.lida) {
    desenharConversaLida(fo, destino);
  } else if (fo.file) {
    try { await desenharPrint(fo.file, destino, estado.zoom); } catch (e) { destino.textContent = 'Não foi possível mostrar o print: ' + e.message; }
    if (minha !== desenhando) return;
  } else {
    const pre = document.createElement('pre');
    pre.textContent = fo.texto || '';
    pre.style.fontSize = `${13 * estado.zoom}px`;
    destino.replaceChildren(pre);
  }
}
$('zoomMais').onclick = () => { estado.zoom = Math.min(3, +(estado.zoom + 0.25).toFixed(2)); desenharVisor(); };
$('zoomMenos').onclick = () => { estado.zoom = Math.max(0.5, +(estado.zoom - 0.25).toFixed(2)); desenharVisor(); };
$('visorFechar').onclick = () => { estado.visorAberto = false; desenharVisor(); };
$('visorMostrar').onclick = () => { estado.visorAberto = true; desenharVisor(); };
let tempoRedim;
window.addEventListener('resize', () => { clearTimeout(tempoRedim); tempoRedim = setTimeout(desenharVisor, 250); });

function aposAnalise() {
  desenharVisor();
  desenharFontes();
  const tem = estado.fontes.length > 0;
  $('secDados').hidden = !tem;
  $('secCertidao').hidden = !tem;
  if (!tem) return;
  const usadas = escolherFontes();
  desenharFontes();
  preencher(usadas[0]);
  if (estado.fontes.length > 1 && usadas.length === 1) {
    const p = document.createElement('p');
    p.textContent = 'Há mais de um contato: a certidão considera só aquele em que houve resposta. Os demais ficam de fora.';
    $('avisos').prepend(p);
  }
  if (usadas.length > 1) {
    const p = document.createElement('p');
    p.textContent = 'Todos os contatos foram frustrados: a certidão reúne todos eles num só texto.';
    $('avisos').prepend(p);
  }
  gerar();
}

for (const k of CAMPOS) {
  $(k).addEventListener('input', gerar);
  $(k).addEventListener('change', gerar);
}

// ---------- Conversa lida direto da aba (botão "Ler conversa") ----------
function desenharConversaLida(fo, destino) {
  const box = document.createElement('div');
  box.className = 'conversa-lida';
  box.style.fontSize = `${14 * estado.zoom}px`;
  const cab = document.createElement('p');
  cab.className = 'conversa-cab';
  cab.textContent = `Lida de ${fo.lida.origem} em ${new Date(fo.lida.data).toLocaleString('pt-BR')}`;
  box.appendChild(cab);
  for (const m of fo.msgs || []) {
    const b = document.createElement('div');
    b.className = 'bolha ' + (m.lado === 'parte' ? 'parte' : 'servidor');
    const t = document.createElement('div');
    t.textContent = m.texto;
    const h = document.createElement('small');
    h.textContent = m.tempo ? `${N.fmtData(m.tempo)} ${N.fmtHora(m.tempo)}` : '';
    b.append(t, h);
    box.appendChild(b);
  }
  destino.replaceChildren(box);
}

function receberConversa(d) {
  const quando = new Date(d.data);
  const ano = quando.getFullYear();
  const dataCaptura = { dia: quando.getDate(), mes: quando.getMonth() + 1, ano };
  let fonte;
  if (N.pareceEmail(d.textoCaixa || '')) {
    const f = N.analisarEmail(d.textoCaixa);
    fonte = { tipo: 'email', f, msgs: [], meta: {} };
  } else {
    const telas = [{ largura: d.largura, linhas: d.linhas || [], modo: 'livre' }];
    const msgs = N.telasParaMensagens(telas, ano, { dataCaptura });
    const telefone = N.formatarTelefone((d.telefones || [])[0] || '');
    const f = N.analisarConversa(msgs, { telefone });
    f.nomes = f.nome ? [f.nome] : [];
    fonte = { tipo: 'conversa', f, msgs, meta: {} };
  }
  fonte.arquivo = `Conversa lida – ${d.origem}`;
  fonte.lida = d;
  fonte.ativa = true;
  // Uma conversa lida começa uma certidão nova
  estado.fontes = [fonte];
  estado.visivel = 0;
  aposAnalise();
  progresso('');
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.tipo !== 'ciri-conversa' || !e.source) return;
  // Só aceita da aba que abriu esta (a da conversa) — nunca de páginas embutidas
  if (window.opener && e.source !== window.opener) return;
  try { e.source.postMessage({ tipo: 'ciri-recebido', id: d.id }, e.origin); } catch { /* aba fechada */ }
  if (estado.recebidos.has(d.id)) return;
  estado.recebidos.add(d.id);
  receberConversa(d);
});

// Botão para a barra de favoritos (só no site; a extensão não precisa)
(async () => {
  const el = $('botaoLeitor');
  if (!el || /^(chrome|moz)-extension:/.test(location.protocol)) { const s = $('secLeitor'); if (s) s.hidden = true; return; }
  try {
    const cod = await (await fetch('leitor.min.js?v=0.7', { cache: 'no-store' })).text();
    const site = location.origin + location.pathname.replace(/index\.html$/, '');
    el.href = 'javascript:' + encodeURIComponent(cod.replace('__SITE__', site).trim());
  } catch { const s = $('secLeitor'); if (s) s.hidden = true; }
})();
el_click_guard();
function el_click_guard() {
  const el = $('botaoLeitor');
  if (el) el.addEventListener('click', (e) => { e.preventDefault(); alert('Arraste este botão para a barra de favoritos. Depois, clique nele com a conversa aberta.'); });
}

if (location.hash === '#leitor') progresso('Recebendo a conversa lida…');
