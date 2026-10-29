import { Image, Images, Minimize2, Sticker, ScanText } from 'lucide';
import { ACCEPT, choice, mapFiles } from './common.js';
import { output, rename, sizeDelta, extOf } from '../lib/files.js';
import { decodeImage, drawToCanvas, canvasToBlob, encodeIco } from '../lib/image.js';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp' };
const opaque = (fmt) => fmt === 'jpg' || fmt === 'bmp';

async function convertOne(file, { format, quality, maxSide }) {
  const img = await decodeImage(file);
  try {
    const side = Number(maxSide) || Infinity;
    const canvas = drawToCanvas(img, { maxWidth: side, maxHeight: side, background: opaque(format) ? '#ffffff' : null });
    return await canvasToBlob(canvas, TYPES[format], quality);
  } finally {
    img.close();
  }
}

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

export default [
  {
    id: 'converter-imagem',
    cat: 'image',
    title: 'Converter imagem',
    desc: 'HEIC, WEBP, PNG, JPG, GIF, BMP, SVG e AVIF para JPG, PNG ou WEBP.',
    icon: Image,
    keywords: 'heic jpg jpeg png webp bmp svg avif foto iphone converter imagem',
    accept: ACCEPT.image,
    multiple: true,
    options: [
      {
        id: 'format',
        label: 'Converter para',
        type: 'choice',
        choices: [choice('jpg', 'JPG'), choice('png', 'PNG'), choice('webp', 'WEBP'), choice('bmp', 'BMP')],
        default: 'jpg',
      },
      { id: 'quality', label: 'Qualidade', type: 'range', min: 50, max: 100, step: 1, default: 92, unit: '%', showIf: (o) => o.format === 'jpg' || o.format === 'webp' },
    ],
    run: (files, { format, quality }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Convertendo…');
        const blob = await convertOne(file, { format, quality: quality / 100 });
        return output(rename(file.name, format), blob, format, { preview: 'image' });
      }),
  },
  {
    id: 'imagens-para-pdf',
    cat: 'image',
    title: 'JPG para PDF',
    desc: 'Junte fotos e imagens em um único PDF, na ordem que quiser.',
    icon: Images,
    keywords: 'jpg png foto imagem pdf documento digitalizar scanner juntar',
    accept: ACCEPT.image,
    multiple: true,
    ordered: true,
    options: [
      { id: 'page', label: 'Tamanho da página', type: 'choice', choices: [choice('a4', 'A4'), choice('letter', 'Carta'), choice('fit', 'Igual à imagem')], default: 'a4' },
      {
        id: 'orientation',
        label: 'Orientação',
        type: 'choice',
        choices: [choice('auto', 'Automática'), choice('portrait', 'Retrato'), choice('landscape', 'Paisagem')],
        default: 'auto',
        showIf: (o) => o.page !== 'fit',
      },
      { id: 'margin', label: 'Margem', type: 'choice', choices: [choice('0', 'Nenhuma'), choice('18', 'Pequena'), choice('36', 'Normal')], default: '18' },
      { id: 'quality', label: 'Qualidade das imagens', type: 'choice', choices: [choice('high', 'Alta'), choice('medium', 'Média (arquivo menor)')], default: 'high' },
    ],
    async run(files, { page, orientation, margin, quality }, ctx) {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const m = Number(margin);
      const maxSide = quality === 'high' ? 3000 : 1600;
      const q = quality === 'high' ? 0.9 : 0.75;
      for (let i = 0; i < files.length; i++) {
        ctx.check();
        ctx.progress(i / files.length, `Adicionando imagem ${i + 1} de ${files.length}…`);
        const img = await decodeImage(files[i]);
        let embedded;
        let w;
        let hgt;
        try {
          const keepPng = /png|gif|webp|svg/.test(files[i].type) || /^(png|gif|webp|svg)$/.test(extOf(files[i].name));
          const canvas = drawToCanvas(img, { maxWidth: maxSide, maxHeight: maxSide, background: keepPng ? null : '#ffffff' });
          w = canvas.width;
          hgt = canvas.height;
          const blob = await canvasToBlob(canvas, keepPng && quality === 'high' ? 'image/png' : 'image/jpeg', q);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          embedded = blob.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        } finally {
          img.close();
        }
        let pw;
        let ph;
        if (page === 'fit') {
          // 1 px = 0,75 pt (96 dpi), limitado a um tamanho razoável.
          const s = Math.min(0.75, 1440 / Math.max(w, hgt));
          pw = w * s + m * 2;
          ph = hgt * s + m * 2;
        } else {
          [pw, ph] = PAGE_SIZES[page];
          const landscape = orientation === 'landscape' || (orientation === 'auto' && w > hgt);
          if (landscape) [pw, ph] = [ph, pw];
        }
        const p = pdf.addPage([pw, ph]);
        const scale = Math.min((pw - m * 2) / w, (ph - m * 2) / hgt);
        const dw = w * scale;
        const dh = hgt * scale;
        p.drawImage(embedded, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      }
      ctx.progress(null, 'Gerando o PDF…');
      const bytes = await pdf.save();
      const name = files.length === 1 ? rename(files[0].name, 'pdf') : 'imagens.pdf';
      return [output(name, bytes, 'pdf', { note: `${files.length} página${files.length > 1 ? 's' : ''}` })];
    },
  },
  {
    id: 'comprimir-imagem',
    cat: 'image',
    title: 'Comprimir imagem',
    desc: 'Reduza o tamanho e a resolução das fotos sem perder muita qualidade.',
    icon: Minimize2,
    keywords: 'reduzir diminuir tamanho kb mb redimensionar foto otimizar compactar',
    accept: ACCEPT.image,
    multiple: true,
    options: [
      { id: 'quality', label: 'Qualidade', type: 'range', min: 30, max: 95, step: 1, default: 75, unit: '%' },
      {
        id: 'maxSide',
        label: 'Lado maior de no máximo',
        type: 'choice',
        choices: [choice('0', 'Manter'), choice('3840', '3840 px'), choice('1920', '1920 px'), choice('1280', '1280 px'), choice('800', '800 px')],
        default: '1920',
      },
      { id: 'format', label: 'Formato', type: 'choice', choices: [choice('jpg', 'JPG'), choice('webp', 'WEBP')], default: 'jpg' },
    ],
    run: (files, { quality, maxSide, format }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Comprimindo…');
        const blob = await convertOne(file, { format, quality: quality / 100, maxSide });
        return output(rename(file.name, format, '-comprimida'), blob, format, { preview: 'image', note: sizeDelta(file.size, blob.size) });
      }),
  },
  {
    id: 'imagem-para-ico',
    cat: 'image',
    title: 'Imagem para ICO',
    desc: 'Crie ícones .ico (favicon) em vários tamanhos.',
    icon: Sticker,
    keywords: 'ico favicon icone windows png',
    accept: ACCEPT.image,
    multiple: true,
    options: [
      {
        id: 'sizes',
        label: 'Tamanhos',
        type: 'choice',
        choices: [choice('site', 'Site (16–48 px)'), choice('full', 'Completo (16–256 px)')],
        default: 'full',
      },
    ],
    run: (files, { sizes }, ctx) =>
      mapFiles(files, ctx, async (file, c) => {
        c.progress(null, 'Criando o ícone…');
        const img = await decodeImage(file);
        try {
          const list = sizes === 'site' ? [16, 32, 48] : [16, 24, 32, 48, 64, 128, 256];
          return output(rename(file.name, 'ico'), await encodeIco(img, list), 'ico');
        } finally {
          img.close();
        }
      }),
  },
  {
    id: 'imagem-para-texto',
    cat: 'image',
    title: 'Foto para texto (OCR)',
    desc: 'Reconheça o texto de fotos e prints e copie com um toque.',
    icon: ScanText,
    keywords: 'ocr texto ler foto print escanear extrair copiar documento',
    accept: ACCEPT.image,
    multiple: true,
    engine: 'ocr',
    options: [
      { id: 'lang', label: 'Idioma do texto', type: 'choice', choices: [choice('por', 'Português'), choice('eng', 'Inglês'), choice('spa', 'Espanhol'), choice('por+eng', 'Português + Inglês')], default: 'por' },
    ],
    async run(files, { lang }, ctx) {
      const { createWorker } = await import('tesseract.js');
      let label = 'Preparando o leitor de texto…';
      let report = () => {};
      ctx.progress(null, label);
      const local = (path) => new URL(path, document.baseURI).href;
      const worker = await createWorker(lang.split('+'), 1, {
        workerPath: local('ocr/worker.min.js'),
        corePath: local('ocr/core/'),
        langPath: local('ocr/lang'),
        logger: (m) => {
          if (m.status === 'recognizing text') report(m.progress);
          else if (/loading|initializ/.test(m.status)) ctx.progress(Number.isFinite(m.progress) ? m.progress : null, 'Preparando o leitor de texto…');
        },
      });
      ctx.onCancel(() => worker.terminate());
      try {
        return await mapFiles(files, ctx, async (file, c) => {
          label = 'Lendo o texto…';
          report = (p) => c.progress(p, label);
          c.progress(0, label);
          // Normaliza a imagem (HEIC, rotação EXIF, tamanho) antes do OCR.
          const img = await decodeImage(file);
          let blob;
          try {
            blob = await canvasToBlob(drawToCanvas(img, { maxWidth: 3000, maxHeight: 3000, background: '#ffffff' }), 'image/png');
          } finally {
            img.close();
          }
          const { data } = await worker.recognize(blob);
          const text = data.text.trim();
          if (!text) throw new Error(`Não encontrei texto em "${file.name}".`);
          return output(rename(file.name, 'txt'), new Blob([text], { type: 'text/plain;charset=utf-8' }), 'txt', { preview: 'text', text });
        });
      } finally {
        await worker.terminate();
      }
    },
  },
];
