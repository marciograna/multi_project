import media from './media.js';
import image from './image.js';
import pdf from './pdf.js';
import docs from './docs.js';
import sheet from './sheet.js';
import archive from './archive.js';

export const CATEGORIES = [
  { id: 'media', label: 'Vídeo e áudio' },
  { id: 'image', label: 'Imagens' },
  { id: 'pdf', label: 'PDF' },
  { id: 'docs', label: 'Documentos' },
  { id: 'sheet', label: 'Planilhas' },
  { id: 'files', label: 'Arquivos' },
];

export const TOOLS = [...media, ...image, ...pdf, ...docs, ...sheet, ...archive];

export const POPULAR = ['video-para-audio', 'pdf-para-word', 'imagens-para-pdf', 'word-para-pdf', 'converter-imagem', 'comprimir-imagem'];

export const getTool = (id) => TOOLS.find((t) => t.id === id);

const normalize = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Busca tolerante: "pdf para word", "heic", "mp3"… */
export function searchTools(query) {
  const terms = normalize(query)
    .split(/\s+/)
    .filter((t) => t && !['para', 'pra', 'em', 'de', 'do', 'da', 'to', 'converter'].includes(t));
  if (!terms.length) return TOOLS;
  return TOOLS.map((tool) => {
    const title = normalize(tool.title);
    const hay = normalize(`${tool.title} ${tool.desc} ${tool.keywords || ''}`);
    let score = 0;
    for (const term of terms) {
      if (!hay.includes(term)) return null;
      score += title.includes(term) ? 3 : 1;
    }
    // "pdf word" deve preferir "PDF para Word" a "Word para PDF".
    if (terms.length > 1 && title.indexOf(terms[0]) > -1 && title.indexOf(terms[0]) < title.indexOf(terms[1])) score += 2;
    return { tool, score };
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.tool);
}
