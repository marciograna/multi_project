import { FileOutput, FileCode, FilePen, Type } from 'lucide';
import { ACCEPT, choice, mapFiles } from './common.js';
import { output, rename, readText, baseName } from '../lib/files.js';
import { makePdf, htmlToContent, baseStyles } from '../lib/pdfmake.js';

const STYLE_MAP = [
  "p[style-name='Title'] => h1.titulo:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "br[type='page'] => hr.quebra-pagina",
];

async function docxToHtml(file) {
  const mammoth = await import('mammoth');
  try {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap: STYLE_MAP });
    // Quebras de página e título do Word viram instruções do pdfmake.
    return value
      .replace(/(<p>)?<hr class="quebra-pagina" \/>(<\/p>)?/g, `<div data-pdfmake="{'pageBreak':'after'}">&nbsp;</div>`)
      .replace(/<h1 class="titulo">/g, `<h1 data-pdfmake="{'fontSize':28,'marginBottom':12}">`);
  } catch {
    throw new Error(`Não consegui ler "${file.name}". Somente arquivos .docx são aceitos (o .doc antigo não é suportado).`);
  }
}

function htmlPage(title, body) {
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { max-width: 760px; margin: 0 auto; padding: 24px 16px; font-family: system-ui, sans-serif; line-height: 1.6; color: #2c2740; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #e2dcf0; padding: 6px 8px; }
  pre, code { background: #efebf8; border-radius: 6px; }
  pre { padding: 12px; overflow-x: auto; }
  blockquote { margin: 0; padding-left: 14px; border-left: 3px solid #a99be0; color: #6b6485; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function textBlob(text, type = 'text/plain') {
  return new Blob([text], { type: `${type};charset=utf-8` });
}

export default [
  {
    id: 'word-para-pdf',
    cat: 'docs',
    title: 'Word para PDF',
    desc: 'Converta documentos DOCX em PDF com texto selecionável.',
    icon: FileOutput,
    keywords: 'word docx pdf documento converter curriculo',
    accept: ACCEPT.docx,
    multiple: true,
    options: [],
    notice: 'Mantém textos, títulos, listas, tabelas e imagens. Fontes e espaçamentos especiais podem ficar um pouco diferentes do original.',
    run: (files, opts, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Lendo o documento…');
        const html = await docxToHtml(file);
        c.progress(null, 'Gerando o PDF…');
        const content = await htmlToContent(html);
        const blob = await makePdf({ content, styles: baseStyles, info: { title: baseName(file.name) } });
        return output(rename(file.name, 'pdf'), blob, 'pdf');
      }),
  },
  {
    id: 'word-para-texto',
    cat: 'docs',
    title: 'Word para TXT ou HTML',
    desc: 'Tire o texto de um DOCX em TXT, HTML ou Markdown.',
    icon: FileCode,
    keywords: 'word docx txt html markdown md texto',
    accept: ACCEPT.docx,
    multiple: true,
    options: [
      { id: 'format', label: 'Formato', type: 'choice', choices: [choice('txt', 'TXT'), choice('html', 'HTML'), choice('md', 'Markdown')], default: 'txt' },
    ],
    run: (files, { format }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Lendo o documento…');
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        let result;
        try {
          if (format === 'txt') result = (await mammoth.extractRawText({ arrayBuffer })).value.trim();
          else if (format === 'md') result = (await mammoth.convertToMarkdown({ arrayBuffer })).value;
          else result = htmlPage(baseName(file.name), (await mammoth.convertToHtml({ arrayBuffer })).value);
        } catch {
          throw new Error(`Não consegui ler "${file.name}". Somente arquivos .docx são aceitos.`);
        }
        const type = { txt: 'text/plain', md: 'text/markdown', html: 'text/html' }[format];
        return output(rename(file.name, format), textBlob(result, type), format, format === 'txt' ? { preview: 'text', text: result } : {});
      }),
  },
  {
    id: 'texto-para-pdf',
    cat: 'docs',
    title: 'TXT para PDF ou Word',
    desc: 'Transforme arquivos de texto em PDF ou DOCX.',
    icon: FilePen,
    keywords: 'txt texto pdf word docx bloco de notas',
    accept: ACCEPT.text,
    multiple: true,
    options: [
      { id: 'format', label: 'Converter para', type: 'choice', choices: [choice('pdf', 'PDF'), choice('docx', 'Word (DOCX)')], default: 'pdf' },
      { id: 'size', label: 'Tamanho da letra', type: 'choice', choices: [choice('10', 'Pequena'), choice('12', 'Normal'), choice('14', 'Grande')], default: '12' },
    ],
    run: (files, { format, size }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Lendo o texto…');
        const text = (await readText(file)).replace(/\r\n?/g, '\n');
        const lines = text.split('\n');
        if (format === 'pdf') {
          c.progress(null, 'Gerando o PDF…');
          const blob = await makePdf({
            content: lines.map((line) => ({ text: line || ' ', preserveLeadingSpaces: true })),
            defaultStyle: { font: 'Roboto', fontSize: Number(size), lineHeight: 1.3 },
            info: { title: baseName(file.name) },
          });
          return output(rename(file.name, 'pdf'), blob, 'pdf');
        }
        c.progress(null, 'Gerando o Word…');
        const { Document, Packer, Paragraph, TextRun } = await import('docx');
        const doc = new Document({
          styles: { default: { document: { run: { font: 'Calibri', size: Number(size) * 2 } } } },
          sections: [{ children: lines.map((line) => new Paragraph({ children: [new TextRun(line)] })) }],
        });
        return output(rename(file.name, 'docx'), await Packer.toBlob(doc), 'docx');
      }),
  },
  {
    id: 'markdown-para-pdf',
    cat: 'docs',
    title: 'Markdown para PDF',
    desc: 'Converta arquivos .md em PDF ou página HTML formatada.',
    icon: Type,
    keywords: 'markdown md pdf html readme notas obsidian',
    accept: ACCEPT.markdown,
    multiple: true,
    options: [
      { id: 'format', label: 'Converter para', type: 'choice', choices: [choice('pdf', 'PDF'), choice('html', 'HTML')], default: 'pdf' },
    ],
    run: (files, { format }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Lendo o Markdown…');
        const { marked } = await import('marked');
        const html = await marked.parse(await readText(file));
        if (format === 'html') return output(rename(file.name, 'html'), textBlob(htmlPage(baseName(file.name), html), 'text/html'), 'html');
        c.progress(null, 'Gerando o PDF…');
        const blob = await makePdf({ content: await htmlToContent(html), styles: baseStyles, info: { title: baseName(file.name) } });
        return output(rename(file.name, 'pdf'), blob, 'pdf');
      }),
  },
];
