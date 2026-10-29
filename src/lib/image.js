import { extOf } from './files.js';

// iPhones antigos não desenham canvas acima de ~16 milhões de pixels.
const MAX_PIXELS = 16_000_000;

export function isHeic(file) {
  return /heic|heif/i.test(file.type) || /^(heic|heif)$/.test(extOf(file.name));
}

function isSvg(file) {
  return file.type === 'image/svg+xml' || extOf(file.name) === 'svg';
}

function loadImgElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ source: img, width: img.naturalWidth || 1024, height: img.naturalHeight || 1024, close: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não consegui abrir esta imagem. O formato pode não ser suportado pelo seu navegador.'));
    };
    img.src = url;
  });
}

async function bitmap(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
}

/** Decodifica qualquer imagem que o navegador entenda, mais HEIC (fotos do iPhone). */
export async function decodeImage(file) {
  if (isSvg(file)) return loadImgElement(file);
  try {
    return await bitmap(file);
  } catch {
    if (isHeic(file)) {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/png' });
      return bitmap(Array.isArray(out) ? out[0] : out);
    }
    return loadImgElement(file);
  }
}

export function fitSize(width, height, { maxWidth = Infinity, maxHeight = Infinity } = {}) {
  let scale = Math.min(1, maxWidth / width, maxHeight / height);
  if (width * height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (width * height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Desenha a imagem num canvas, redimensionando se preciso. `background` preenche transparências. */
export function drawToCanvas(img, { maxWidth, maxHeight, background } = {}) {
  const size = fitSize(img.width, img.height, { maxWidth, maxHeight });
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  if (background) {
    g.fillStyle = background;
    g.fillRect(0, 0, size.width, size.height);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(img.source, 0, 0, size.width, size.height);
  return canvas;
}

export function canvasToBlob(canvas, type, quality) {
  if (type === 'image/bmp') return Promise.resolve(encodeBmp(canvas));
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Não foi possível gerar a imagem (talvez seja grande demais).'));
        if (blob.type !== type) {
          return reject(new Error(`Seu navegador não consegue gerar ${type.split('/')[1].toUpperCase()}. Escolha outro formato.`));
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

/** BMP de 24 bits (sem compressão). */
function encodeBmp(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowSize * height, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      // Mistura com branco onde houver transparência.
      bytes[row + x * 3] = Math.round(data[i + 2] * a + 255 * (1 - a));
      bytes[row + x * 3 + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
      bytes[row + x * 3 + 2] = Math.round(data[i] * a + 255 * (1 - a));
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/** ICO com várias resoluções (entradas PNG, aceitas pelo Windows e navegadores). */
export async function encodeIco(img, sizes) {
  const pngs = [];
  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const hgt = img.height * scale;
    g.drawImage(img.source, (size - w) / 2, (size - hgt) / 2, w, hgt);
    const blob = await canvasToBlob(canvas, 'image/png');
    pngs.push({ size, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const headerSize = 6 + 16 * pngs.length;
  const total = headerSize + pngs.reduce((n, p) => n + p.data.length, 0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, pngs.length, true);
  let offset = headerSize;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    buf[e] = p.size >= 256 ? 0 : p.size;
    buf[e + 1] = p.size >= 256 ? 0 : p.size;
    view.setUint16(e + 4, 1, true);
    view.setUint16(e + 6, 32, true);
    view.setUint32(e + 8, p.data.length, true);
    view.setUint32(e + 12, offset, true);
    buf.set(p.data, offset);
    offset += p.data.length;
  });
  return new Blob([buf], { type: 'image/x-icon' });
}
