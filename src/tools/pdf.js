import { FileText, FileImage, FileType, Merge, Split, RotateCw, FileDown } from 'lucide';
import { ACCEPT, choice, mapFiles } from './common.js';
import { output, rename, parseRanges, sizeDelta } from '../lib/files.js';

const pdfjs = () => import('../lib/pdf.js');
const pdfLib = () => import('pdf-lib');

async function loadPdfLib(file) {
  const { PDFDocument } = await pdfLib();
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  } catch {
    throw new Error(`Não consegui abrir "${file.name}". Ele pode estar corrompido ou protegido por senha.`);
  }
}

async function canvasBytes(canvas, type, quality) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error('Página grande demais para converter neste aparelho.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function pdfToDocx(file, { mode, breaks }, ctx) {
  const { openPdf, extractParagraphs, extractImages, renderPage } = await pdfjs();
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, PageBreak, Tab } = docx;
  const pdf = await openPdf(file);
  const HEADINGS = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const sections = [];
  let textChildren = [];
  let scanned = 0;
  let figures = 0;

  const figure = async ({ canvas, width, height }) => {
    // Fundo branco: transparências virariam preto no JPEG.
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const g = flat.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, flat.width, flat.height);
    g.drawImage(canvas, 0, 0);
    const data = await canvasBytes(flat, 'image/jpeg', 0.88);
    const s = Math.min(1, 600 / ((width * 96) / 72));
    return new Paragraph({
      spacing: { after: 120 },
      children: [new ImageRun({ type: 'jpg', data, transformation: { width: Math.round(((width * 96) / 72) * s), height: Math.round(((height * 96) / 72) * s) } })],
    });
  };

  const pageImage = async (page, maxW, maxH) => {
    const canvas = await renderPage(page, { dpi: 150 });
    const data = await canvasBytes(canvas, 'image/jpeg', 0.85);
    const s = Math.min(maxW / canvas.width, maxH / canvas.height);
    return new ImageRun({ type: 'jpg', data, transformation: { width: Math.round(canvas.width * s), height: Math.round(canvas.height * s) } });
  };

  for (let n = 1; n <= pdf.numPages; n++) {
    ctx.check();
    ctx.progress((n - 1) / pdf.numPages, `Lendo a página ${n} de ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    if (mode === 'image') {
      // Uma seção por página, do tamanho exato da página do PDF, sem margens.
      const pxW = (vp.width * 96) / 72;
      const pxH = (vp.height * 96) / 72 - 4;
      sections.push({
        properties: { page: { size: { width: Math.round(vp.width * 20), height: Math.round(vp.height * 20) }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
        children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [await pageImage(page, pxW, pxH)] })],
      });
    } else {
      let opList = null;
      try {
        opList = await page.getOperatorList();
      } catch {}
      const paragraphs = await extractParagraphs(page, opList);
      if (n > 1 && breaks) textChildren.push(new Paragraph({ children: [new PageBreak()] }));
      if (!paragraphs.length) {
        // Página escaneada (sem texto): entra como imagem.
        scanned++;
        textChildren.push(new Paragraph({ children: [await pageImage(page, 600, 860)] }));
      }
      const images = paragraphs.length && opList ? await extractImages(page, opList).catch(() => []) : [];
      figures += images.length;
      // Texto e figuras na ordem em que aparecem na página (de cima para baixo).
      const blocks = [...paragraphs.map((p) => ({ top: p.top, p })), ...images.map((im) => ({ top: im.top, im }))].sort((a, b) => b.top - a.top);
      for (const { p, im } of blocks) {
        if (im) {
          textChildren.push(await figure(im));
          continue;
        }
        const size = Math.round(Math.min(72, Math.max(7, p.size)) * 2);
        textChildren.push(
          new Paragraph({
            heading: p.heading ? HEADINGS[p.heading] : undefined,
            spacing: { after: 120 },
            children: p.runs.map(
              (r) =>
                new TextRun({
                  children: r.text.split('\t').flatMap((part, i) => (i ? [new Tab(), part] : [part])),
                  bold: r.bold || undefined,
                  italics: r.italic || undefined,
                  size,
                }),
            ),
          }),
        );
      }
    }
    page.cleanup();
  }
  if (mode !== 'image') sections.push({ properties: {}, children: textChildren });
  ctx.progress(null, 'Montando o documento Word…');
  const doc = new Document({
    creator: 'Converte Tudo',
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections,
  });
  const blob = await Packer.toBlob(doc);
  await pdf.destroy();
  const note = scanned
    ? scanned > 1
      ? `${scanned} páginas sem texto (escaneadas) entraram como imagem.`
      : '1 página sem texto (escaneada) entrou como imagem.'
    : mode === 'image'
      ? 'Páginas como imagem: visual idêntico, mas o texto não é editável.'
      : `Texto editável${figures ? ` com ${figures} imagem${figures > 1 ? 'ns' : ''}` : ''}. Tabelas e colunas complexas podem precisar de ajustes.`;
  return output(rename(file.name, 'docx'), blob, 'docx', { note });
}

export default [
  {
    id: 'pdf-para-word',
    cat: 'pdf',
    title: 'PDF para Word',
    desc: 'Transforme PDF em DOCX editável no Word ou Google Docs.',
    icon: FileText,
    keywords: 'pdf word docx doc editar editavel converter documento',
    accept: ACCEPT.pdf,
    multiple: true,
    options: [
      {
        id: 'mode',
        label: 'Tipo de conversão',
        type: 'choice',
        choices: [choice('text', 'Texto editável'), choice('image', 'Visual idêntico')],
        default: 'text',
        hint: 'Visual idêntico coloca cada página como imagem (não dá para editar o texto).',
      },
      { id: 'breaks', label: 'Manter uma página do Word por página do PDF', type: 'check', default: true, showIf: (o) => o.mode === 'text' },
    ],
    run: (files, opts, ctx) => mapFiles(files, ctx, (f, c) => pdfToDocx(f, opts, c)),
  },
  {
    id: 'pdf-para-imagem',
    cat: 'pdf',
    title: 'PDF para JPG',
    desc: 'Salve cada página do PDF como imagem JPG ou PNG.',
    icon: FileImage,
    keywords: 'pdf jpg png imagem foto pagina print',
    accept: ACCEPT.pdf,
    multiple: true,
    options: [
      { id: 'format', label: 'Formato', type: 'choice', choices: [choice('jpg', 'JPG'), choice('png', 'PNG')], default: 'jpg' },
      { id: 'dpi', label: 'Resolução', type: 'choice', choices: [choice('96', 'Tela'), choice('150', 'Boa'), choice('300', 'Impressão')], default: '150' },
      { id: 'pages', label: 'Páginas', type: 'text', default: '', placeholder: 'Todas', hint: 'Deixe vazio para todas ou escolha, ex.: 1-3, 5' },
    ],
    run: (files, { format, dpi, pages }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        const { openPdf, renderPage } = await pdfjs();
        const pdf = await openPdf(file);
        const list = pages.trim() ? parseRanges(pages, pdf.numPages) : [...Array(pdf.numPages).keys()];
        const outs = [];
        for (const [i, idx] of list.entries()) {
          c.check();
          c.progress(i / list.length, `Página ${idx + 1} de ${pdf.numPages}…`);
          const page = await pdf.getPage(idx + 1);
          const canvas = await renderPage(page, { dpi: Number(dpi) });
          const type = format === 'png' ? 'image/png' : 'image/jpeg';
          const bytes = await canvasBytes(canvas, type, 0.9);
          const suffix = pdf.numPages > 1 ? `-pagina-${String(idx + 1).padStart(String(pdf.numPages).length, '0')}` : '';
          outs.push(output(rename(file.name, format, suffix), bytes, format, { preview: 'image' }));
          page.cleanup();
        }
        await pdf.destroy();
        return outs;
      }),
  },
  {
    id: 'pdf-para-texto',
    cat: 'pdf',
    title: 'PDF para texto',
    desc: 'Extraia todo o texto do PDF para copiar ou salvar em TXT.',
    icon: FileType,
    keywords: 'pdf txt texto copiar extrair',
    accept: ACCEPT.pdf,
    multiple: true,
    options: [],
    run: (files, opts, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        const { openPdf, extractParagraphs, paragraphsToText } = await pdfjs();
        const pdf = await openPdf(file);
        const pages = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          c.check();
          c.progress((n - 1) / pdf.numPages, `Lendo a página ${n} de ${pdf.numPages}…`);
          const page = await pdf.getPage(n);
          pages.push(paragraphsToText(await extractParagraphs(page)));
          page.cleanup();
        }
        await pdf.destroy();
        const text = pages.join('\n\n').trim();
        if (!text) throw new Error(`"${file.name}" não tem texto selecionável (parece escaneado). Use "PDF para JPG" e depois "Foto para texto".`);
        return output(rename(file.name, 'txt'), new Blob([text], { type: 'text/plain;charset=utf-8' }), 'txt', { preview: 'text', text });
      }),
  },
  {
    id: 'juntar-pdf',
    cat: 'pdf',
    title: 'Juntar PDF',
    desc: 'Una vários PDFs em um só, na ordem que você escolher.',
    icon: Merge,
    keywords: 'juntar unir combinar mesclar pdf',
    accept: ACCEPT.pdf,
    multiple: true,
    ordered: true,
    minFiles: 2,
    options: [],
    async run(files, opts, ctx) {
      const { PDFDocument } = await pdfLib();
      const merged = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        ctx.check();
        ctx.progress(i / files.length, `Juntando ${i + 1} de ${files.length}…`);
        const src = await loadPdfLib(files[i]);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      ctx.progress(null, 'Salvando…');
      const bytes = await merged.save();
      return [output('pdf-unido.pdf', bytes, 'pdf', { note: `${merged.getPageCount()} páginas no total` })];
    },
  },
  {
    id: 'dividir-pdf',
    cat: 'pdf',
    title: 'Dividir PDF',
    desc: 'Separe páginas, extraia um trecho ou remova páginas.',
    icon: Split,
    keywords: 'dividir separar extrair remover excluir apagar paginas pdf',
    accept: ACCEPT.pdf,
    multiple: false,
    options: [
      {
        id: 'mode',
        label: 'O que fazer',
        type: 'choice',
        choices: [choice('extract', 'Extrair páginas'), choice('remove', 'Remover páginas'), choice('each', 'Uma por arquivo')],
        default: 'extract',
      },
      { id: 'pages', label: 'Páginas', type: 'text', default: '', placeholder: '1-3, 5', hint: 'Use vírgulas e traços, ex.: 1-3, 5, 8-', showIf: (o) => o.mode !== 'each' },
    ],
    run: (files, { mode, pages }, ctx) =>
      mapFiles(files, ctx, async (file) => {
        const { PDFDocument } = await pdfLib();
        const src = await loadPdfLib(file);
        const total = src.getPageCount();
        const build = async (indices) => {
          const doc = await PDFDocument.create();
          (await doc.copyPages(src, indices)).forEach((p) => doc.addPage(p));
          return doc.save();
        };
        if (mode === 'each') {
          const outs = [];
          for (let i = 0; i < total; i++) {
            ctx.check();
            ctx.progress(i / total, `Separando a página ${i + 1} de ${total}…`);
            outs.push(output(rename(file.name, 'pdf', `-pagina-${String(i + 1).padStart(String(total).length, '0')}`), await build([i]), 'pdf'));
          }
          return outs;
        }
        const chosen = [...new Set(parseRanges(pages, total))];
        const keep = mode === 'remove' ? [...Array(total).keys()].filter((i) => !chosen.includes(i)) : chosen;
        if (!keep.length) throw new Error('Não sobraria nenhuma página no PDF.');
        ctx.progress(null, 'Montando o PDF…');
        const suffix = mode === 'remove' ? '-editado' : '-trecho';
        return output(rename(file.name, 'pdf', suffix), await build(keep), 'pdf', { note: `${keep.length} de ${total} páginas` });
      }),
  },
  {
    id: 'girar-pdf',
    cat: 'pdf',
    title: 'Girar PDF',
    desc: 'Corrija páginas de lado ou de cabeça para baixo.',
    icon: RotateCw,
    keywords: 'girar rodar rotacionar virar pdf paginas',
    accept: ACCEPT.pdf,
    multiple: true,
    options: [
      { id: 'angle', label: 'Girar', type: 'choice', choices: [choice('90', '90° direita'), choice('270', '90° esquerda'), choice('180', '180°')], default: '90' },
      { id: 'pages', label: 'Páginas', type: 'text', default: '', placeholder: 'Todas', hint: 'Deixe vazio para girar todas.' },
    ],
    run: (files, { angle, pages }, ctx) =>
      mapFiles(files, ctx, async (file) => {
        const { degrees } = await pdfLib();
        const doc = await loadPdfLib(file);
        const total = doc.getPageCount();
        const list = pages.trim() ? parseRanges(pages, total) : [...Array(total).keys()];
        for (const i of new Set(list)) {
          const page = doc.getPage(i);
          page.setRotation(degrees((page.getRotation().angle + Number(angle)) % 360));
        }
        ctx.progress(null, 'Salvando…');
        return output(rename(file.name, 'pdf', '-girado'), await doc.save(), 'pdf');
      }),
  },
  {
    id: 'comprimir-pdf',
    cat: 'pdf',
    title: 'Comprimir PDF',
    desc: 'Deixe PDFs pesados (escaneados, com fotos) bem mais leves.',
    icon: FileDown,
    keywords: 'comprimir reduzir diminuir tamanho pdf mb email whatsapp compactar',
    accept: ACCEPT.pdf,
    multiple: true,
    options: [
      { id: 'level', label: 'Compressão', type: 'choice', choices: [choice('low', 'Leve'), choice('medium', 'Média'), choice('high', 'Forte')], default: 'medium' },
    ],
    notice: 'As páginas são convertidas em imagens otimizadas. Ótimo para PDFs escaneados ou com fotos; o texto deixa de ser selecionável.',
    run: (files, { level }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        const { openPdf, renderPage } = await pdfjs();
        const { PDFDocument } = await pdfLib();
        const { dpi, q } = { low: { dpi: 150, q: 0.8 }, medium: { dpi: 110, q: 0.68 }, high: { dpi: 80, q: 0.55 } }[level];
        const pdf = await openPdf(file);
        const out = await PDFDocument.create();
        for (let n = 1; n <= pdf.numPages; n++) {
          c.check();
          c.progress((n - 1) / pdf.numPages, `Comprimindo a página ${n} de ${pdf.numPages}…`);
          const page = await pdf.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          const canvas = await renderPage(page, { dpi });
          const img = await out.embedJpg(await canvasBytes(canvas, 'image/jpeg', q));
          out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
          page.cleanup();
        }
        await pdf.destroy();
        const bytes = await out.save();
        if (bytes.length >= file.size) {
          return output(file.name, file, 'pdf', { note: 'Este PDF já estava bem otimizado; a versão comprimida ficaria maior, então mantivemos o original.' });
        }
        return output(rename(file.name, 'pdf', '-comprimido'), bytes, 'pdf', { note: sizeDelta(file.size, bytes.length) });
      }),
  },
];
