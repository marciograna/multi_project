import { FileSpreadsheet } from 'lucide';
import { ACCEPT, choice, mapFiles } from './common.js';
import { output, rename, readText, extOf, baseName } from '../lib/files.js';
import { makePdf } from '../lib/pdfmake.js';

const MAX_PDF_ROWS = 3000;

async function readWorkbook(XLSX, file) {
  try {
    if (/^(csv|tsv|txt)$/.test(extOf(file.name))) {
      // CSV: corrige acentos de arquivos salvos no Excel antigo (Windows-1252).
      return XLSX.read(await readText(file), { type: 'string', cellDates: true });
    }
    return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  } catch {
    throw new Error(`Não consegui ler a planilha "${file.name}". Ela pode estar protegida por senha ou corrompida.`);
  }
}

const safe = (name) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'aba';

async function sheetsToPdf(XLSX, wb, title) {
  const content = [];
  let truncated = false;
  let wide = false;
  wb.SheetNames.forEach((name, i) => {
    let rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
    if (!rows.length) return;
    if (rows.length > MAX_PDF_ROWS) {
      rows = rows.slice(0, MAX_PDF_ROWS);
      truncated = true;
    }
    const cols = Math.max(...rows.map((r) => r.length));
    if (cols > 6) wide = true;
    const body = rows.map((r, ri) =>
      Array.from({ length: cols }, (_, ci) => ({ text: String(r[ci] ?? ''), bold: ri === 0, fillColor: ri === 0 ? '#efebf8' : undefined })),
    );
    if (wb.SheetNames.length > 1) content.push({ text: name, fontSize: 13, bold: true, margin: [0, i ? 16 : 0, 0, 8], pageBreak: i && content.length ? 'before' : undefined });
    content.push({
      table: { headerRows: 1, widths: Array(cols).fill(cols > 6 ? '*' : 'auto'), body },
      layout: { hLineColor: () => '#e2dcf0', vLineColor: () => '#e2dcf0', paddingTop: () => 3, paddingBottom: () => 3 },
      fontSize: cols > 10 ? 6.5 : cols > 6 ? 8 : 9.5,
    });
  });
  if (!content.length) throw new Error('A planilha está vazia.');
  const blob = await makePdf({ content, pageOrientation: wide ? 'landscape' : 'portrait', pageMargins: [28, 32, 28, 36], info: { title } });
  return { blob, truncated };
}

export default [
  {
    id: 'converter-planilha',
    cat: 'sheet',
    title: 'Converter planilha',
    desc: 'Excel (XLSX, XLS), ODS e CSV para XLSX, CSV, PDF, JSON e mais.',
    icon: FileSpreadsheet,
    keywords: 'excel xlsx xls csv ods planilha pdf json html tabela libreoffice numbers',
    accept: ACCEPT.sheet,
    multiple: true,
    options: [
      {
        id: 'format',
        label: 'Converter para',
        type: 'choice',
        choices: [choice('xlsx', 'Excel (XLSX)'), choice('csv', 'CSV'), choice('pdf', 'PDF'), choice('ods', 'ODS'), choice('json', 'JSON'), choice('html', 'HTML')],
        default: 'xlsx',
      },
      {
        id: 'sep',
        label: 'Separador do CSV',
        type: 'choice',
        choices: [choice(';', 'Ponto e vírgula (Excel BR)'), choice(',', 'Vírgula')],
        default: ';',
        showIf: (o) => o.format === 'csv',
      },
    ],
    run: (files, { format, sep }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Lendo a planilha…');
        const XLSX = await import('@e965/xlsx');
        const wb = await readWorkbook(XLSX, file);
        const multi = wb.SheetNames.length > 1;
        c.progress(null, 'Convertendo…');
        switch (format) {
          case 'xlsx':
          case 'ods':
            return output(rename(file.name, format), XLSX.write(wb, { bookType: format, type: 'array', compression: true }), format);
          case 'csv':
            return wb.SheetNames.map((name) => {
              // BOM UTF-8 para o Excel abrir acentos corretamente.
              const csv = '﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: sep, blankrows: false });
              return output(rename(file.name, 'csv', multi ? `-${safe(name)}` : ''), new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'csv');
            });
          case 'json': {
            const data = Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null })]));
            const json = JSON.stringify(multi ? data : data[wb.SheetNames[0]], null, 2);
            return output(rename(file.name, 'json'), new Blob([json], { type: 'application/json' }), 'json');
          }
          case 'html': {
            const tables = wb.SheetNames.map((n) => (multi ? `<h2>${n.replace(/</g, '&lt;')}</h2>` : '') + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' }));
            const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${baseName(file.name).replace(/</g, '&lt;')}</title><style>body{font-family:system-ui,sans-serif;padding:16px;color:#2c2740}table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #e2dcf0;padding:4px 8px}</style></head><body>${tables.join('\n')}</body></html>`;
            return output(rename(file.name, 'html'), new Blob([html], { type: 'text/html;charset=utf-8' }), 'html');
          }
          case 'pdf': {
            c.progress(null, 'Gerando o PDF…');
            const { blob, truncated } = await sheetsToPdf(XLSX, wb, baseName(file.name));
            return output(rename(file.name, 'pdf'), blob, 'pdf', { note: truncated ? `Planilha muito longa: o PDF mostra as primeiras ${MAX_PDF_ROWS} linhas de cada aba.` : '' });
          }
          default:
            throw new Error('Formato desconhecido.');
        }
      }),
  },
];
