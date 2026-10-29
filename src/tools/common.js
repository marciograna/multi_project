/** Processa os arquivos um a um, com progresso "Arquivo 2 de 5". */
export async function mapFiles(files, ctx, fn) {
  const outputs = [];
  for (let i = 0; i < files.length; i++) {
    ctx.check();
    const sub = files.length > 1 ? ctx.part(i, files.length) : ctx;
    const result = await fn(files[i], sub, i);
    if (result) outputs.push(...[].concat(result));
  }
  return outputs;
}

export const ACCEPT = {
  video: 'video/*,.mp4,.mov,.mkv,.avi,.webm,.wmv,.flv,.3gp,.m4v,.mts,.ts',
  audio: 'audio/*,.mp3,.m4a,.wav,.ogg,.opus,.flac,.aac,.wma,.amr,.aiff,.caf',
  image: 'image/*,.heic,.heif,.webp,.avif,.svg,.bmp,.gif,.ico,.tif,.tiff',
  pdf: 'application/pdf,.pdf',
  docx: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  text: '.txt,text/plain',
  markdown: '.md,.markdown,.txt,text/markdown,text/plain',
  sheet: '.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.numbers,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
  zip: '.zip,application/zip,application/x-zip-compressed',
};

export const choice = (value, label) => ({ value, label });
