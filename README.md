# Converte Tudo

App para múltiplas tarefas de conversão de arquivos, feito para o celular: vídeo para MP3, PDF para Word, JPG para PDF, HEIC para JPG e muito mais.

**Site:** https://marciograna.github.io/multi_project/

**Tudo roda no próprio navegador.** Nenhum arquivo é enviado para servidores, não precisa de cadastro e, depois de instalado, funciona até sem internet.

## Ferramentas (28)

| Categoria | Ferramentas |
| --- | --- |
| **Vídeo e áudio** | Vídeo para áudio (MP3, M4A, WAV, OGG, OPUS, FLAC) · Converter áudio · Converter vídeo (MP4, MOV, MKV, WEBM, AVI) · Comprimir vídeo · Vídeo para GIF · GIF para MP4 · Cortar vídeo ou áudio · Tirar o som do vídeo · Foto do vídeo |
| **Imagens** | Converter imagem (HEIC, WEBP, PNG, JPG, GIF, BMP, SVG, AVIF → JPG, PNG, WEBP, BMP) · JPG para PDF · Comprimir/redimensionar imagem · Imagem para ICO · Foto para texto (OCR em português, inglês e espanhol) |
| **PDF** | PDF para Word (texto editável com imagens, ou visual idêntico) · PDF para JPG/PNG · PDF para texto · Juntar PDF · Dividir PDF · Girar PDF · Comprimir PDF |
| **Documentos** | Word para PDF · Word para TXT/HTML/Markdown · TXT para PDF ou Word · Markdown para PDF/HTML |
| **Planilhas** | Converter planilha (XLSX, XLS, ODS, CSV → XLSX, CSV, PDF, ODS, JSON, HTML) |
| **Arquivos** | Compactar em ZIP · Extrair ZIP |

## Como usar no celular

1. Abra o endereço do site no navegador do celular.
2. Instale como app:
   - **Android (Chrome):** toque em **Instalar** no aviso da página inicial, ou no menu ⋮ → *Instalar app*.
   - **iPhone (Safari):** toque em **Compartilhar** → *Adicionar à Tela de Início*.
3. Escolha a ferramenta, selecione os arquivos e toque em **Converter**. O resultado pode ser baixado ou compartilhado direto no WhatsApp, e-mail etc.

> As ferramentas de vídeo e áudio baixam um motor de conversão (~32 MB) na primeira vez. Depois disso ficam em cache e funcionam offline.
> Cada ferramenta passa a funcionar sem internet depois de ser usada uma vez.

## Publicar no GitHub Pages

1. Em **Settings → Pages**, escolha **Source: GitHub Actions**.
2. Faça um push na branch `main`. O workflow `.github/workflows/deploy.yml` compila e publica o site.
3. O endereço fica em https://marciograna.github.io/multi_project/.

## Rodar no computador

Requer Node.js 20 ou mais recente.

```bash
npm install
npm run dev      # servidor de desenvolvimento (abre também na rede local, dá para testar no celular)
npm run build    # gera a versão final em dist/
npm run preview  # serve a pasta dist/
```

## Como funciona

- Interface em JavaScript puro com [Vite](https://vite.dev), pensada para telas pequenas, com tema claro/escuro em tons de lilás.
- PWA com service worker (instalável e com cache offline).
- Bibliotecas usadas, todas rodando no navegador:
  [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (vídeo e áudio),
  [pdf.js](https://github.com/mozilla/pdf.js) e [pdf-lib](https://pdf-lib.js.org) (PDF),
  [docx](https://docx.js.org) e [mammoth](https://github.com/mwilliamson/mammoth.js) (Word),
  [pdfmake](https://pdfmake.github.io) (geração de PDF),
  [SheetJS](https://sheetjs.com) (planilhas),
  [Tesseract.js](https://tesseract.projectnaptha.com) (OCR),
  [heic2any](https://github.com/alexcorvi/heic2any) (fotos HEIC do iPhone),
  [fflate](https://github.com/101arrowz/fflate) (ZIP) e
  [Lucide](https://lucide.dev) (ícones).

## Limitações

- Arquivos de vídeo muito grandes (acima de ~1 GB) podem não caber na memória do celular. Comprimir vídeos longos pode demorar alguns minutos.
- PDF para Word recria textos, títulos, negrito/itálico, listas e imagens; tabelas e layouts em colunas podem precisar de ajustes. Para manter o visual exato, use o modo **Visual idêntico**.
- Word para PDF aceita `.docx` (o formato `.doc` antigo não é suportado).

## Licença

[MIT](LICENSE)
