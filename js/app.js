import * as N from './nucleo.js?v=0.8';
import { analisarArquivo, ocrInstalado, desenharPrint } from './leitura.js?v=0.8';

const $ = (id) => document.getElementById(id);
const estado = {
  fontes: [], temOcr: false, visivel: 0, zoom: 1, visorAberto: true, recebidos: new Set(),
  adicionando: false, atoConfirmado: false, contatos: [],
};

const CAMPOS = ['situacao', 'tipo', 'qualificacao', 'pj', 'nomes', 'telefone', 'numeroComum', 'textoComum', 'email',
  'data', 'hora', 'tipoAto', 'evento', 'extras', 'identidadeData', 'identidadeHora', 'frase', 'tacita',
  'docTipo', 'audData', 'audHora', 'audLink', 'audFrust', 'encData', 'encHora', 'emailDocs', 'confData', 'confHora', 'confEmail', 'confPor'];
const ehFrustrada = N.ehFrustrada;
const SIT_FRUST = Object.keys(N.SITUACOES).filter(ehFrustrada);

// ---------- Preparação ----------
for (const [k, v] of Object.entries(N.SITUACOES)) $('situacao').add(new Option(v, k));
for (const [k, v] of Object.entries(N.ROTULOS_QUALIFICACAO)) $('qualificacao').add(new Option(v, k));
$('tipo').hidden = true; // o ato é escolhido nos botões do topo da certidão
$('tipo').closest('label').hidden = true;

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
      const lista = await analisarArquivo(a, progresso, estado.temOcr);
      for (const r of lista) estado.fontes.push({ ...r, ativa: true, file: a });
      estado.visivel = estado.fontes.length - lista.length;
    } catch (e) {
      progresso(`Não consegui ler ${a.name}: ${e.message}`, true);
      console.error(e);
      return;
    }
  }
  progresso('');
  estado.adicionando = false;
  aposAnalise();
}

// ---------- Lista de fontes ----------
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
  $('acoesFontes').hidden = !estado.fontes.length;
  $('esperaConversa').hidden = !estado.adicionando;
  $('adicionarConversa').classList.toggle('ativo', estado.adicionando);
}
$('adicionarConversa').onclick = () => { estado.adicionando = true; desenharFontes(); };
$('novaCertidao').onclick = () => {
  estado.fontes = []; estado.adicionando = false; estado.atoConfirmado = false; estado.contatos = [];
  aposAnalise();
};

// Regra: se houver um contato com resposta (não frustrado), só ele entra na certidão.
function escolherFontes() {
  const naoFrust = estado.fontes.filter((x) => !ehFrustrada(x.f.situacao));
  estado.fontes.forEach((x) => { x.ativa = naoFrust.length ? x === naoFrust[0] : true; });
  return naoFrust.length ? [naoFrust[0]] : estado.fontes;
}

// ---------- Preencher o formulário a partir da análise ----------
const T = (t) => ({ d: N.fmtData(t), h: N.fmtHora(t) });
function qualificacaoInicial(f, tipo) {
  if (f.perito) return 'perito';
  return tipo === 'citacao' ? 'parte_requerida' : 'parte';
}
function preencher(fo, usadas) {
  const f = fo.f;
  const v = {};
  v.situacao = f.situacao;
  v.tipo = f.tipo || 'intimacao';
  const nomes = (f.nomes && f.nomes.length ? f.nomes : (f.nome || '').split('\n')).filter(Boolean);
  v.nomes = nomes.join('\n');
  v.qualificacao = qualificacaoInicial(f, v.tipo);
  v.pj = !!f.pj;
  v.telefone = f.telefone || '';
  v.numeroComum = nomes.length > 1;
  v.textoComum = nomes.length > 1 ? 'número comum a ambas as partes' : $('textoComum').value;
  v.email = f.email || '';
  const p = T(f.tempoPrincipal || (f.tentativas && f.tentativas[0]));
  v.data = p.d; v.hora = p.h;
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
  v.audFrust = !!f.audiencia && usadas.every((u) => ehFrustrada(u.f.situacao));
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
  // Contatos da certidão frustrada: um por conversa (número ou e-mail)
  estado.contatos = usadas.map((u) => {
    const t = T(u.f.tempoPrincipal || (u.f.tentativas || [])[0]);
    return { canal: u.f.canal, situacao: u.f.situacao, telefone: u.f.telefone || '', email: u.f.email || '', data: t.d, hora: t.h };
  });
  desenharContatos();
  desenharEscolha(f);

  $('avisos').innerHTML = '';
  const avisos = [...new Set(usadas.flatMap((u) => u.f.avisos || []))];
  for (const a of avisos) { const pp = document.createElement('p'); pp.textContent = a; $('avisos').appendChild(pp); }
  const ul = $('evidencias');
  ul.innerHTML = '';
  for (const u of usadas) for (const ev of u.f.evidencias || []) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> <span></span>';
    const quem = usadas.length > 1 ? `[${u.f.telefone || u.f.email || ''}] ` : '';
    li.querySelector('b').textContent = `${quem}${ev.rotulo}${ev.tempo ? ` (${N.fmtData(ev.tempo)} ${N.fmtHora(ev.tempo)})` : ''}:`;
    li.querySelector('span').textContent = ev.texto;
    ul.appendChild(li);
  }
}

// ---------- Contatos tentados (frustrada) ----------
function desenharContatos() {
  const caixa = $('contatos');
  caixa.innerHTML = '';
  estado.contatos.forEach((k, i) => {
    const linha = document.createElement('div');
    linha.className = 'contato-linha';
    const num = document.createElement('input');
    num.value = k.canal === 'email' ? k.email : k.telefone;
    num.placeholder = k.canal === 'email' ? 'e-mail' : 'telefone';
    num.title = k.canal === 'email' ? 'E-mail' : 'Telefone';
    const data = document.createElement('input'); data.value = k.data; data.placeholder = 'dd/mm/aaaa';
    const hora = document.createElement('input'); hora.value = k.hora; hora.placeholder = '13h29';
    const sit = document.createElement('select');
    for (const s of SIT_FRUST) {
      if ((k.canal === 'email') !== (s === 'EMAIL_FRUSTRADA')) continue;
      sit.add(new Option(N.SITUACOES[s].replace(/^Frustrada – /, '').replace(/^E-mail – frustrada/, 'E-mail sem resposta'), s));
    }
    sit.value = k.situacao;
    const atualizar = () => {
      if (k.canal === 'email') k.email = num.value.trim(); else k.telefone = num.value.trim();
      k.data = data.value.trim(); k.hora = hora.value.trim(); k.situacao = sit.value;
      if (estado.contatos.length === 1) $('situacao').value = k.situacao;
      gerar();
    };
    for (const el of [num, data, hora]) el.addEventListener('input', atualizar);
    sit.addEventListener('change', atualizar);
    linha.append(num, data, hora, sit);
    caixa.appendChild(linha);
  });
}

// ---------- Escolha do ato e da parte (no topo da certidão) ----------
function ladoDaQualificacao(q) {
  for (const [lado, lista] of Object.entries(N.LADO_QUALIFICACAO)) if (lista.includes(q)) return lado;
  return '';
}
function desenharEscolha(f) {
  const tipo = $('tipo').value;
  $('escolhaAto').querySelectorAll('button').forEach((b) => b.classList.toggle('ativo', b.dataset.v === tipo));
  $('linhaParte').hidden = false;
  const lado = ladoDaQualificacao($('qualificacao').value);
  $('escolhaParte').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.v === lado);
    b.hidden = tipo === 'citacao' && b.dataset.v !== 'requerida';
  });
  const dica = $('escolhaDica');
  if (!estado.atoConfirmado) dica.textContent = f && f.atoIndicado ? '(sugerido pelo print — confirme)' : '(o print não diz — escolha)';
  else dica.textContent = '';
  $('escolha').classList.toggle('confirmada', estado.atoConfirmado);
}
$('escolhaAto').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('tipo').value = b.dataset.v;
  if (b.dataset.v === 'citacao' && ladoDaQualificacao($('qualificacao').value) !== 'requerida') $('qualificacao').value = 'parte_requerida';
  estado.atoConfirmado = true;
  // situação coerente com o ato
  const sit = $('situacao').value;
  if (b.dataset.v === 'citacao' && /^INT_/.test(sit)) $('situacao').value = 'CIT_EFETIVADA';
  if (b.dataset.v === 'intimacao' && /^CIT_/.test(sit)) $('situacao').value = 'INT_SEM_MANIF';
  desenharEscolha(); gerar();
});
$('escolhaParte').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('qualificacao').value = N.LADO_QUALIFICACAO[b.dataset.v][0];
  estado.atoConfirmado = true;
  desenharEscolha(); gerar();
});
$('qualificacao').addEventListener('change', () => { desenharEscolha(); });

function lerCampos() {
  const c = {};
  for (const k of CAMPOS) { const el = $(k); c[k] = el.type === 'checkbox' ? el.checked : el.value.trim(); }
  return c;
}

// ---------- Mostrar / esconder campos ----------
function ajustarCampos() {
  const sit = $('situacao').value;
  const frust = ehFrustrada(sit) || (estado.contatos.length > 1 && estado.fontes.filter((x) => x.ativa).every((x) => ehFrustrada(x.f.situacao)));
  const canal = /^EMAIL/.test(sit) ? 'email' : 'whatsapp';
  document.querySelectorAll('[data-sit]').forEach((el) => {
    const lista = el.dataset.sit.split(' ');
    const negado = lista[0].startsWith('-');
    const dentro = lista.map((x) => x.replace('-', '')).includes(sit);
    el.hidden = negado ? dentro : !dentro;
  });
  document.querySelectorAll('[data-canal]').forEach((el) => { el.hidden = el.dataset.canal !== canal; });
  document.querySelectorAll('[data-nao-frust]').forEach((el) => { if (frust) el.hidden = true; });
  document.querySelectorAll('[data-frust]').forEach((el) => { el.hidden = !frust; });
  document.querySelectorAll('[data-comum]').forEach((el) => { el.hidden = canal !== 'whatsapp' || !$('numeroComum').checked; });
  $('situacao').closest('label').hidden = frust && estado.contatos.length > 1;
}

// ---------- Gerar certidões ----------
function gerar() {
  ajustarCampos();
  const c = lerCampos();
  const nomes = c.nomes.split('\n').map((s) => N.limparNome(s)).filter(Boolean);
  if (!nomes.length) nomes.push('');
  const caixa = $('certidoes');
  caixa.innerHTML = '';
  const frust = ehFrustrada(c.situacao) || (estado.contatos.length > 1 && estado.fontes.filter((x) => x.ativa).every((x) => ehFrustrada(x.f.situacao)));
  for (const nome of nomes) {
    let md;
    if (frust) {
      const contatos = estado.contatos.length ? estado.contatos
        : [{ canal: /^EMAIL/.test(c.situacao) ? 'email' : 'whatsapp', situacao: c.situacao, telefone: c.telefone, email: c.email, data: c.data, hora: c.hora }];
      md = N.gerarFrustrada({ ...c, nome }, contatos);
    } else {
      md = N.gerarCertidao({ ...c, nome });
    }
    const div = document.createElement('div');
    div.className = 'certidao';
    div.innerHTML = '<div class="cab"><span></span><div class="botoes"><button class="copiar">Copiar com formatação</button><button class="sec copiarTexto">Copiar só o texto</button></div></div><div class="texto" contenteditable="true" spellcheck="true"></div>';
    div.querySelector('.cab span').textContent = (frust && estado.contatos.length > 1 ? 'Vários contatos · ' : '') + (nome || 'Certidão');
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
  // guarda o ponto central visível para manter o foco depois do zoom
  const cx = destino.scrollWidth ? (destino.scrollLeft + destino.clientWidth / 2) / destino.scrollWidth : 0.5;
  const cy = destino.scrollHeight ? (destino.scrollTop + destino.clientHeight / 2) / destino.scrollHeight : 0;
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
  // recentra: horizontal no meio (ou onde estava), vertical no mesmo ponto
  destino.scrollLeft = Math.max(0, cx * destino.scrollWidth - destino.clientWidth / 2);
  if (cy) destino.scrollTop = Math.max(0, cy * destino.scrollHeight - destino.clientHeight / 2);
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
  preencher(usadas[0], usadas);
  if (estado.fontes.length > 1 && usadas.length === 1) {
    const p = document.createElement('p');
    p.textContent = 'Há mais de um contato: a certidão considera só aquele em que houve resposta. Os demais ficam de fora.';
    $('avisos').prepend(p);
  }
  if (usadas.length > 1) {
    const p = document.createElement('p');
    p.textContent = `Todos os ${usadas.length} contatos foram frustrados: a certidão reúne todos num só texto, cada um com a sua data.`;
    $('avisos').prepend(p);
  }
  gerar();
}

for (const k of CAMPOS) {
  $(k).addEventListener('input', gerar);
  $(k).addEventListener('change', gerar);
}
$('situacao').addEventListener('change', () => {
  if (estado.contatos.length === 1 && ehFrustrada($('situacao').value)) { estado.contatos[0].situacao = $('situacao').value; desenharContatos(); }
  if (estado.contatos.length === 0 || (estado.contatos.length === 1 && !ehFrustrada($('situacao').value))) {
    estado.contatos = ehFrustrada($('situacao').value) ? [{ canal: 'whatsapp', situacao: $('situacao').value, telefone: $('telefone').value, email: $('email').value, data: $('data').value, hora: $('hora').value }] : estado.contatos;
    desenharContatos();
  }
  gerar();
});

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
    let msgs;
    if (Array.isArray(d.mensagens) && d.mensagens.length) {
      // WhatsApp Web: data, hora, autor e lado exatos de cada mensagem
      let ultimo = null;
      msgs = d.mensagens.map((m) => {
        let tempo = m.tempo || null;
        if (tempo && !tempo.soHora) ultimo = tempo;
        else if (tempo && tempo.soHora) tempo = ultimo ? { ...ultimo, hora: tempo.hora, min: tempo.min } : { dia: 0, mes: 0, ano, hora: tempo.hora, min: tempo.min };
        return { lado: m.lado, texto: m.texto, tempo };
      });
      msgs.titulo = d.nome || '';
    } else {
      const telas = [{ largura: d.largura, linhas: d.linhas || [], modo: 'livre' }];
      msgs = N.telasParaMensagens(telas, ano, { dataCaptura });
    }
    const telefone = N.formatarTelefone((d.telefones || [])[0] || '');
    const f = N.analisarConversa(msgs, { telefone });
    f.nomes = N.escolherNome({ titulo: d.nome || msgs.titulo, saudacao: f.nomeSaudacao });
    f.nome = f.nomes.join('\n');
    f.pj = f.pj || f.nomes.some((n) => N.ehPessoaJuridica(n));
    if (d.avisoTelefone) { f.avisos = f.avisos.filter((a) => !/telefone não aparece/.test(a)); f.avisos.unshift(d.avisoTelefone); }
    fonte = { tipo: 'conversa', f, msgs, meta: {} };
  }
  fonte.arquivo = `Conversa lida – ${d.origem}`;
  fonte.lida = d;
  fonte.ativa = true;
  if (estado.adicionando && estado.fontes.length) {
    // "Adicionar outra conversa": entra na mesma certidão
    estado.fontes.push(fonte);
    estado.visivel = estado.fontes.length - 1;
  } else {
    estado.fontes = [fonte];
    estado.visivel = 0;
    estado.atoConfirmado = false;
  }
  estado.adicionando = false;
  aposAnalise();
  progresso('');
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.tipo !== 'ciri-conversa' || !e.source) return;
  // Só aceita da aba que abriu esta (a da conversa) — nunca de páginas embutidas
  if (window.opener && e.source !== window.opener && !estado.adicionando) return;
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
    const cod = await (await fetch('leitor.min.js?v=0.8', { cache: 'no-store' })).text();
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
