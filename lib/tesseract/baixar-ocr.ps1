# Baixa os arquivos do reconhecimento de texto (Tesseract.js) para esta pasta.
# Clique com o botão direito neste arquivo > "Executar com o PowerShell".
$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$arquivos = @{
  'tesseract.min.js'                 = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
  'worker.min.js'                    = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js'
  'tesseract-core-simd-lstm.wasm.js' = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js'
  'tesseract-core-lstm.wasm.js'      = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-lstm.wasm.js'
  'por.traineddata.gz'               = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz'
}
foreach ($nome in $arquivos.Keys) {
  Write-Host "Baixando $nome ..."
  Invoke-WebRequest -Uri $arquivos[$nome] -OutFile (Join-Path $pasta $nome) -UseBasicParsing
}
Write-Host ""
Write-Host "Pronto! Recarregue a extensao no navegador." -ForegroundColor Green
Read-Host "Pressione Enter para fechar"
