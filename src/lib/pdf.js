import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const BULLETS = /[\uf0b7\uf0a7\uf0d8\uf076\uf0fc\uf0a8\uf06e\uf0a1]/g;

const assetUrl = (path) => new URL(path, document.baseURI).href;

/** Abre um PDF com pdf.js. Pede a senha se o arquivo for protegido. */
export async function openPdf(file) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: assetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
    isEvalSupported: false,
  });
  task.onPassword = (update, reason) => {
    const again = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const pass = window.prompt(again ? 'Senha incorreta. Tente novamente:' : `"${file.name}" é protegido. Digite a senha:`);
    if (pass == null) task.destroy();
    else update(pass);
  };
  try {
    return await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException' || /destroyed|Worker was destroyed/i.test(err?.message)) {
      throw new Error('O PDF é protegido por senha.');
    }
    if (err?.name === 'InvalidPDFException') throw new Error(`"${file.name}" não parece ser um PDF válido.`);
    throw err;
  }
}

/** Renderiza uma página num canvas. `dpi` 72 = tamanho original. */
export async function renderPage(page, { dpi = 150, background = '#ffffff' } = {}) {
  let scale = dpi / 72;
  const base = page.getViewport({ scale: 1 });
  const maxPixels = 16_000_000;
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const g = canvas.getContext('2d');
  g.fillStyle = background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport }).promise;
  return canvas;
}

/**
 * Extrai o texto de uma página reconstruindo linhas e parágrafos.
 * Retorna [{ runs: [{ text, bold, italic }], size, heading }].
 */
export async function extractParagraphs(page, opList = null) {
  const content = await page.getTextContent();
  // Carregar a lista de operações também carrega as fontes (para descobrir negrito/itálico).
  let fontsReady = Boolean(opList);
  if (!opList) {
    try {
      await page.getOperatorList();
      fontsReady = true;
    } catch {}
  }
  const fontInfo = new Map();
  const styleOf = (fontName) => {
    if (!fontInfo.has(fontName)) {
      let bold = false;
      let italic = false;
      if (fontsReady && page.commonObjs.has(fontName)) {
        const font = page.commonObjs.get(fontName);
        const name = font?.name || '';
        bold = Boolean(font?.bold || font?.black) || /bold|black|heavy|semibold|demi/i.test(name);
        italic = Boolean(font?.italic) || /italic|oblique/i.test(name);
      }
      fontInfo.set(fontName, { bold, italic });
    }
    return fontInfo.get(fontName);
  };

  const items = content.items
    .filter((it) => typeof it.str === 'string' && it.transform)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
      eol: it.hasEOL,
      ...styleOf(it.fontName),
    }));

  // Agrupa em linhas (mesma altura, com tolerância).
  const lines = [];
  for (const it of items) {
    if (!it.str.trim() && !it.eol) continue;
    let line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.size, it.size) * 0.45));
    if (!line) {
      line = { y: it.y, size: it.size, items: [] };
      lines.push(line);
    }
    if (it.str.trim()) {
      line.items.push(it);
      line.size = Math.max(line.size, it.size);
    }
  }
  const textLines = lines
    .filter((l) => l.items.length)
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      const runs = [];
      let prevEnd = null;
      let tabular = false;
      for (const it of l.items) {
        // Marcadores de lista da fonte Symbol vêm como caracteres de uso privado.
        let text = it.str.replace(BULLETS, '•');
        const gap = prevEnd == null ? 0 : it.x - prevEnd;
        const lastText = runs.at(-1)?.text || '';
        if (gap > it.size * 1.5 && !/^•\s*$/.test(lastText)) {
          // Espaço grande no meio da linha: colunas de tabela.
          text = `\t${text.trimStart()}`;
          tabular = true;
        } else if (prevEnd != null && gap > it.size * 0.18 && !/\s$/.test(lastText) && !/^\s/.test(text)) {
          text = ` ${text}`;
        }
        const last = runs.at(-1);
        if (last && last.bold === it.bold && last.italic === it.italic) last.text += text;
        else runs.push({ text, bold: it.bold, italic: it.italic });
        prevEnd = it.x + it.w;
      }
      return { y: l.y, size: l.size, runs, x: l.items[0].x, right: prevEnd, tabular };
    });

  if (!textLines.length) return [];

  // Tamanho de fonte "do corpo": o mais frequente por quantidade de caracteres.
  const freq = new Map();
  for (const l of textLines) {
    const k = Math.round(l.size);
    freq.set(k, (freq.get(k) || 0) + l.runs.reduce((n, r) => n + r.text.length, 0));
  }
  const body = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0] || 11;

  // Margem direita típica da página (ignora linhas fora da curva, como números de página).
  const rights = textLines.map((l) => l.right).sort((a, b) => a - b);
  const typicalRight = rights[Math.floor(rights.length * 0.9)] ?? 0;
  const startsItem = (line) => /^\s*(•|[-–*]\s|\d{1,3}[.)]\s|[a-z][.)]\s)/.test(line.runs[0]?.text || '');

  const paragraphs = [];
  let current = null;
  let prev = null;
  for (const line of textLines) {
    const gap = prev ? prev.y - line.y : 0;
    const sameSize = prev && Math.abs(prev.size - line.size) < 1.5;
    const prevShort = prev && prev.right < typicalRight - (typicalRight - prev.x) * 0.25;
    const continues =
      current && sameSize && gap > 0 && gap < Math.max(prev.size, line.size) * 1.65 && !prevShort && !prev.tabular && !line.tabular && !startsItem(line);
    if (continues) {
      const lastRun = current.runs.at(-1);
      const joiner = /-$/.test(lastRun.text) ? '' : ' ';
      const [first, ...rest] = line.runs;
      if (lastRun.bold === first.bold && lastRun.italic === first.italic) lastRun.text += joiner + first.text.trimStart();
      else current.runs.push({ ...first, text: joiner + first.text.trimStart() });
      current.runs.push(...rest);
    } else {
      current = { runs: line.runs.map((r) => ({ ...r })), size: line.size, top: line.y + line.size };
      paragraphs.push(current);
    }
    prev = line;
  }
  for (const p of paragraphs) {
    const length = p.runs.reduce((n, r) => n + r.text.length, 0);
    const ratio = p.size / body;
    if (length < 160 && ratio >= 1.25) p.heading = ratio >= 1.8 ? 1 : ratio >= 1.45 ? 2 : 3;
    p.runs = p.runs.filter((r) => r.text.length);
  }
  return paragraphs.filter((p) => p.runs.some((r) => r.text.trim()));
}

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function getObj(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    store.get(id, (obj) => {
      clearTimeout(timer);
      resolve(obj);
    });
  });
}

function imageToCanvas(img, maxSide = 2400) {
  if (!img?.width || !img?.height) return null;
  const full = document.createElement('canvas');
  full.width = img.width;
  full.height = img.height;
  const g = full.getContext('2d');
  if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const out = g.createImageData(img.width, img.height);
    const src = img.data;
    const dst = out.data;
    if (img.kind === pdfjs.ImageKind.RGBA_32BPP) dst.set(src.subarray(0, dst.length));
    else if (img.kind === pdfjs.ImageKind.RGB_24BPP) {
      for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i + 1];
        dst[j + 2] = src[i + 2];
        dst[j + 3] = 255;
      }
    } else if (img.kind === pdfjs.ImageKind.GRAYSCALE_1BPP) {
      const rowBytes = (img.width + 7) >> 3;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const v = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
          const j = (y * img.width + x) * 4;
          dst[j] = dst[j + 1] = dst[j + 2] = v;
          dst[j + 3] = 255;
        }
      }
    } else return null;
    g.putImageData(out, 0, 0);
  } else return null;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1) return full;
  const small = document.createElement('canvas');
  small.width = Math.round(img.width * scale);
  small.height = Math.round(img.height * scale);
  small.getContext('2d').drawImage(full, 0, 0, small.width, small.height);
  return small;
}

/**
 * Encontra as fotos/figuras da página com posição e tamanho (em pontos).
 * Retorna [{ top, width, height, canvas }], ignorando imagens minúsculas e fundos de página inteira.
 */
export async function extractImages(page, opList) {
  const { OPS } = pdfjs;
  const vp = page.getViewport({ scale: 1 });
  const found = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiply(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const width = Math.hypot(ctm[0], ctm[1]);
      const height = Math.hypot(ctm[2], ctm[3]);
      if (width < 24 || height < 24) continue;
      if (width * height > vp.width * vp.height * 0.8) continue;
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      found.push({ top: Math.max(...ys), width, height, ref: args[0] });
    }
  }
  const images = [];
  for (const item of found.slice(0, 40)) {
    const img = typeof item.ref === 'string' ? await getObj(page, item.ref) : item.ref;
    const canvas = imageToCanvas(img);
    if (canvas) images.push({ top: item.top, width: item.width, height: item.height, canvas });
  }
  return images;
}

export function paragraphsToText(paragraphs) {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join('').trim()).join('\n\n');
}
