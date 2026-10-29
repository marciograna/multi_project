const MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  avif: 'image/avif',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  json: 'application/json',
  zip: 'application/zip',
};

export function mimeFor(ext) {
  return MIME[String(ext).toLowerCase()] || 'application/octet-stream';
}

export function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name) {
  const clean = String(name || 'arquivo').split(/[\\/]/).pop();
  const dot = clean.lastIndexOf('.');
  return (dot > 0 ? clean.slice(0, dot) : clean) || 'arquivo';
}

/** "foto.heic" + "jpg" -> "foto.jpg" */
export function rename(name, ext, suffix = '') {
  return `${baseName(name)}${suffix}.${ext}`;
}

export function output(name, data, ext, extra = {}) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeFor(ext) });
  return { name, blob, ...extra };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[i]}`;
}

/** Diferença de tamanho em texto, ex.: "62% menor". */
export function sizeDelta(before, after) {
  if (!before) return '';
  const pct = Math.round((1 - after / before) * 100);
  if (pct > 0) return `${pct}% menor que o original`;
  if (pct < 0) return `${-pct}% maior que o original`;
  return 'mesmo tamanho do original';
}

/** Lê texto tentando UTF-8 e caindo para Windows-1252 (comum em arquivos antigos do Windows). */
export async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

/** Garante nomes únicos dentro de um ZIP ou lista. */
export function uniqueNames(items) {
  const seen = new Map();
  return items.map((item) => {
    let name = item.name;
    const count = seen.get(name.toLowerCase()) || 0;
    if (count) {
      const ext = extOf(name);
      name = ext ? `${baseName(name)} (${count + 1}).${ext}` : `${name} (${count + 1})`;
    }
    seen.set(item.name.toLowerCase(), count + 1);
    return { ...item, name };
  });
}

export async function zipOutputs(outputs, onProgress) {
  const { zip } = await import('fflate');
  const files = {};
  for (const out of uniqueNames(outputs)) {
    files[out.name] = [new Uint8Array(await out.blob.arrayBuffer()), { level: isCompressed(out.name) ? 0 : 6 }];
  }
  onProgress?.(null, 'Compactando…');
  const data = await new Promise((resolve, reject) => zip(files, (err, res) => (err ? reject(err) : resolve(res))));
  return new Blob([data], { type: 'application/zip' });
}

/** Formatos que já são comprimidos não ganham nada com deflate. */
export function isCompressed(name) {
  return /\.(jpe?g|png|webp|gif|mp3|m4a|aac|ogg|opus|mp4|webm|mov|mkv|avi|zip|docx|xlsx|ods|pdf|heic|avif)$/i.test(name);
}

/** Interpreta intervalos de páginas como "1-3, 5, 8-" (base 1). Retorna índices base 0. */
export function parseRanges(input, total) {
  const pages = [];
  const text = String(input || '').trim();
  if (!text) throw new Error('Informe as páginas, por exemplo: 1-3, 5');
  for (const part of text.split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(p);
    let start;
    let end;
    if (m) {
      start = m[1] ? Number(m[1]) : 1;
      end = m[2] ? Number(m[2]) : total;
    } else if (/^\d+$/.test(p)) {
      start = end = Number(p);
    } else {
      throw new Error(`Não entendi "${p}". Use algo como 1-3, 5, 8-10`);
    }
    if (start < 1 || end > total || start > end) {
      throw new Error(`O intervalo "${p}" não existe: o PDF tem ${total} página${total > 1 ? 's' : ''}.`);
    }
    for (let i = start; i <= end; i++) pages.push(i - 1);
  }
  if (!pages.length) throw new Error('Nenhuma página selecionada.');
  return pages;
}

/** Converte "1:30", "01:02:03" ou "90" em segundos. */
export function parseTime(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) throw new Error(`Tempo inválido: "${value}". Use 1:30 ou 90.`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
