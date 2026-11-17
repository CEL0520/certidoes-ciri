const api = typeof browser !== 'undefined' ? browser : chrome;
document.getElementById('abrir').addEventListener('click', () => {
  api.tabs.create({ url: api.runtime.getURL('gerador.html') });
  window.close();
});
document.getElementById('ler').addEventListener('click', async () => {
  const [aba] = await api.tabs.query({ active: true, currentWindow: true });
  const erro = document.getElementById('erro');
  if (!aba || !/^https?:/.test(aba.url || '')) { erro.textContent = 'Abra antes a conversa (WhatsApp Web, chat ou e-mail) nesta aba.'; return; }
  try {
    await api.scripting.executeScript({ target: { tabId: aba.id }, files: ['leitor.js'] });
    window.close();
  } catch (e) { erro.textContent = 'Não foi possível ler esta página: ' + (e.message || e); }
});
