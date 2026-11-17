// Serviço da extensão: tira a foto da aba da conversa (para o PDF do print) e entrega
// a conversa lida ao gerador. Nada sai do computador.
const api = typeof browser !== 'undefined' ? browser : chrome;
let pendente = null;

api.runtime.onMessage.addListener((msg, sender, responder) => {
  if (!msg || !msg.tipo) return false;
  if (msg.tipo === 'ciri-foto-tela') {
    api.tabs.captureVisibleTab(sender.tab ? sender.tab.windowId : undefined, { format: 'jpeg', quality: 90 })
      .then((url) => responder(url), (e) => responder({ erro: String(e && e.message || e) }));
    return true;
  }
  if (msg.tipo === 'ciri-entregar') {
    pendente = msg.dados;
    api.tabs.create({ url: api.runtime.getURL('gerador.html#leitor') }).then(() => responder(true), (e) => responder({ erro: String(e) }));
    return true;
  }
  if (msg.tipo === 'ciri-pegar') {
    responder(pendente);
    pendente = null;
    return false;
  }
  return false;
});
