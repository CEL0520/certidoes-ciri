# Certidões CIRI

Gerador de certidões de citação e intimação a partir do print da conversa
(PDF ou imagem, de qualquer sistema de chat) ou do PDF de um e-mail.

**Para usar, basta abrir o link do site.** Não é preciso instalar nada.

## Ler a conversa sem print

O botão **Ler conversa** (instalado arrastando-o para a barra de favoritos, pela
própria página) lê a conversa aberta no painel do chat, no WhatsApp Web ou no
e-mail e abre o gerador já com a certidão. O código do botão está em
`fonte/leitor.js` (versão compactada: `leitor.min.js`).

## Privacidade

A página roda inteiramente no navegador de quem a usa. Os prints anexados
são lidos no próprio computador (PDF.js e Tesseract.js) e **não são enviados
para este site nem para nenhum servidor**. Nada é guardado depois que a
página é fechada.

Os únicos arquivos baixados da internet são as bibliotecas de leitura de
texto (OCR), quando não estão nesta pasta `lib/tesseract`.

## Situações reconhecidas

- Intimação: ciência expressa, ciência tácita, sem manifestação de ciência
- Citação: efetivada, expedida (somente citação ou com audiência)
- Frustrada: sem resposta, número sem WhatsApp (erro 404), terceiro
- E-mail: efetivada, frustrada
- Vários contatos frustrados da mesma parte: uma certidão única

A análise é uma sugestão. A certidão é sempre revisada por quem assina.

## Bibliotecas

- [PDF.js](https://mozilla.github.io/pdf.js/) (Mozilla, licença Apache 2.0), em `lib/pdfjs`
- [Tesseract.js](https://tesseract.projectnaptha.com/) (licença Apache 2.0), carregado da CDN
  jsDelivr ou de `lib/tesseract`

© 2026 Osvaldo Oliveira Té.
