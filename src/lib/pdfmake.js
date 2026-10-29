let ready = null;

async function getPdfMake() {
  if (!ready) {
    ready = Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]).then(([pm, fonts]) => {
      const pdfMake = pm.default || pm;
      pdfMake.addVirtualFileSystem(fonts.default || fonts);
      return pdfMake;
    });
  }
  return ready;
}

// Estilos por tag (o html-to-pdfmake aplica direto nos elementos).
const TAG_STYLES = {
  h1: { fontSize: 22, bold: true, marginBottom: 8, color: '#2c2740' },
  h2: { fontSize: 18, bold: true, marginBottom: 6, color: '#2c2740' },
  h3: { fontSize: 15, bold: true, marginBottom: 5 },
  h4: { fontSize: 13, bold: true, marginBottom: 4 },
  h5: { fontSize: 12, bold: true, marginBottom: 4 },
  h6: { fontSize: 11, bold: true, marginBottom: 4 },
  a: { color: '#5a4b98', decoration: 'underline' },
  p: { margin: [0, 2, 0, 8] },
  th: { bold: true, fillColor: '#efebf8' },
};

// Estilos por classe, para tags sem estilo padrão.
export const baseStyles = {
  'html-code': { background: '#efebf8' },
  'html-pre': { background: '#efebf8', margin: [0, 4, 0, 8] },
  'html-blockquote': { italics: true, color: '#6b6485', margin: [12, 4, 0, 8] },
};

export async function makePdf(definition) {
  const pdfMake = await getPdfMake();
  return pdfMake.createPdf({
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 56],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25 },
    ...definition,
  }).getBlob();
}

/** Converte GIF, BMP, WEBP, SVG… embutidos para PNG (o pdfmake só lê PNG e JPEG). */
function rasterize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 600;
      canvas.height = img.naturalHeight || 400;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** HTML -> conteúdo do pdfmake, com imagens contidas na largura da página. */
export async function htmlToContent(html, maxWidth = 499) {
  const { default: htmlToPdfmake } = await import('html-to-pdfmake');
  const content = htmlToPdfmake(html, { window, tableAutoSize: true, removeExtraBlanks: true, defaultStyles: TAG_STYLES });
  const images = [];
  const collect = (node) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== 'object') return;
    if (node.image) images.push(node);
    for (const key of ['stack', 'columns', 'ul', 'ol', 'text']) if (Array.isArray(node[key])) collect(node[key]);
    if (node.table?.body) node.table.body.forEach((row) => collect(row));
  };
  collect(content);
  for (const node of images) {
    if (!/^data:image\/(png|jpe?g);/i.test(node.image)) {
      try {
        if (!/^data:image\//i.test(node.image)) throw new Error('externa');
        node.image = await rasterize(node.image);
      } catch {
        // Imagens externas (links) ou em formatos que o navegador não lê (EMF, WMF) viram um aviso no texto.
        const alt = node.alt || node.title || 'imagem';
        for (const key of Object.keys(node)) delete node[key];
        Object.assign(node, { text: `[${alt}]`, italics: true, color: '#6b6485' });
        continue;
      }
    }
    if (!(node.width <= maxWidth)) {
      delete node.width;
      delete node.height;
    }
    node.maxWidth = maxWidth;
    node.maxHeight = 680;
  }
  return content;
}
