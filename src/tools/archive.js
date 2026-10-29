import { FolderArchive, PackageOpen } from 'lucide';
import { ACCEPT } from './common.js';
import { output, mimeFor, extOf, uniqueNames, zipOutputs } from '../lib/files.js';

export default [
  {
    id: 'criar-zip',
    cat: 'files',
    title: 'Compactar em ZIP',
    desc: 'Junte vários arquivos em um único .zip para enviar.',
    icon: FolderArchive,
    keywords: 'zip compactar zipar juntar arquivos rar',
    accept: '*/*',
    multiple: true,
    options: [],
    async run(files, opts, ctx) {
      ctx.progress(null, 'Compactando…');
      const blob = await zipOutputs(files.map((f) => ({ name: f.name, blob: f })), ctx.progress);
      return [output(files.length === 1 ? `${files[0].name}.zip` : 'arquivos.zip', blob, 'zip', { note: `${files.length} arquivo${files.length > 1 ? 's' : ''}` })];
    },
  },
  {
    id: 'extrair-zip',
    cat: 'files',
    title: 'Extrair ZIP',
    desc: 'Abra arquivos .zip e salve o que tem dentro.',
    icon: PackageOpen,
    keywords: 'zip descompactar extrair abrir unzip',
    accept: ACCEPT.zip,
    multiple: false,
    options: [],
    async run(files, opts, ctx) {
      const { unzip } = await import('fflate');
      ctx.progress(null, 'Abrindo o ZIP…');
      const data = new Uint8Array(await files[0].arrayBuffer());
      const entries = await new Promise((resolve, reject) =>
        unzip(data, { filter: (f) => !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(f.name) }, (err, res) =>
          err ? reject(new Error('Não consegui abrir este ZIP. Ele pode estar corrompido ou protegido por senha.')) : resolve(res),
        ),
      );
      const list = Object.entries(entries).map(([path, bytes]) => {
        const name = path.split('/').pop();
        return { name, blob: new Blob([bytes], { type: mimeFor(extOf(name)) }), note: path.includes('/') ? path : '' };
      });
      if (!list.length) throw new Error('O ZIP está vazio.');
      return uniqueNames(list).map((o) => output(o.name, o.blob, extOf(o.name), { note: o.note }));
    },
  },
];
