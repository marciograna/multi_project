// Copia arquivos de bibliotecas para public/, para o app funcionar sem depender de CDNs:
// - pdf.js: cmaps e fontes padrão (PDFs com fontes asiáticas ou não incorporadas)
// - tesseract.js: worker, núcleo wasm e idiomas do OCR
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));
const pub = new URL('../public/', import.meta.url).pathname;

const copies = [
  [join(pkg('pdfjs-dist'), 'cmaps'), 'pdfjs/cmaps'],
  [join(pkg('pdfjs-dist'), 'standard_fonts'), 'pdfjs/standard_fonts'],
  [join(pkg('tesseract.js'), 'dist/worker.min.js'), 'ocr/worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [
    join(pkg('tesseract.js-core'), f),
    `ocr/core/${f}`,
  ]),
  ...['por', 'eng', 'spa'].map((lang) => [
    join(pkg(`@tesseract.js-data/${lang}`), `4.0.0_best_int/${lang}.traineddata.gz`),
    `ocr/lang/${lang}.traineddata.gz`,
  ]),
];

for (const [from, to] of copies) {
  mkdirSync(dirname(join(pub, to)), { recursive: true });
  cpSync(from, join(pub, to), { recursive: true });
}
console.log(`Arquivos de bibliotecas copiados para public/ (${copies.length} itens).`);
