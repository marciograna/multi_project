import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { formatBytes, extOf } from './files.js';

let instance = null;
let loading = null;
let urls = null;
let jobId = 0;
// O ffmpeg.wasm não devolve toda a memória entre execuções; depois de alguns
// trabalhos o motor é reiniciado para o navegador não travar (principalmente no celular).
const RECYCLE_AFTER_JOBS = 6;
const RECYCLE_AFTER_BYTES = 150 * 1024 ** 2;
const usage = { jobs: 0, bytes: 0 };

/** Carrega o ffmpeg.wasm sob demanda (~32 MB, fica em cache depois da 1ª vez). */
async function getFFmpeg(ctx) {
  if (instance && (usage.jobs >= RECYCLE_AFTER_JOBS || usage.bytes >= RECYCLE_AFTER_BYTES)) cancelFFmpeg();
  if (instance) return instance;
  if (!loading) {
    loading = (async () => {
      const ff = new FFmpeg();
      if (!urls) {
        ctx.progress(null, 'Preparando o motor de vídeo…');
        const [core, wasm] = await Promise.all([
          toBlobURL(coreURL, 'text/javascript'),
          toBlobURL(wasmURL, 'application/wasm', true, ({ total, received }) => {
            if (total > 0) ctx.progress(received / total, 'Baixando o motor de vídeo (só na 1ª vez)…');
            else ctx.progress(null, `Baixando o motor de vídeo… ${formatBytes(received)}`);
          }),
        ]);
        urls = { coreURL: core, wasmURL: wasm };
      }
      ctx.progress(null, 'Iniciando o motor de vídeo…');
      await ff.load(urls);
      instance = ff;
      usage.jobs = 0;
      usage.bytes = 0;
      return ff;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/** Interrompe a conversão em andamento (o motor é recarregado na próxima vez). */
export function cancelFFmpeg() {
  if (instance) {
    instance.terminate();
    instance = null;
  }
}

function parseProbe(logs) {
  const text = logs.join('\n');
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const video = /Stream #\S+.*?: Video: (\w+)/.exec(text);
  const audio = /Stream #\S+.*?: Audio: (\w+)/.exec(text);
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    video: video && !/mjpeg|png|bmp/.test(video[1]) ? video[1] : null,
    cover: video && /mjpeg|png|bmp/.test(video[1]) ? video[1] : null,
    audio: audio ? audio[1] : null,
  };
}

/**
 * Executa uma tarefa com um arquivo de entrada montado (sem copiar o vídeo inteiro para a memória).
 * `task` recebe { input, probe, run(args, label), read(name) }.
 */
export async function withInput(file, ctx, task) {
  if (file.size > 1.9 * 1024 ** 3) {
    throw new Error('Arquivo grande demais para converter no navegador (limite de ~1,9 GB).');
  }
  const ff = await getFFmpeg(ctx);
  usage.jobs++;
  usage.bytes += file.size;
  const dir = `/job${++jobId}`;
  const ext = extOf(file.name) || 'bin';
  const input = `${dir}/entrada.${ext}`;
  const logs = [];
  const written = [];
  const onLog = ({ message }) => {
    logs.push(message);
    if (logs.length > 400) logs.splice(0, logs.length - 400);
  };
  let currentLabel = 'Convertendo…';
  let duration = null;
  const onProgress = ({ progress, time }) => {
    let p = progress;
    if (duration && time > 0) p = time / 1e6 / duration;
    if (Number.isFinite(p) && p >= 0 && p <= 1) ctx.progress(p, currentLabel);
  };
  ff.on('log', onLog);
  ff.on('progress', onProgress);
  try {
    await ff.createDir(dir);
    await ff.mount('WORKERFS', { files: [new File([file], `entrada.${ext}`, { type: file.type })] }, dir);
    logs.length = 0;
    await ff.exec(['-hide_banner', '-i', input]);
    const probe = parseProbe(logs);
    duration = probe.duration;

    const api = {
      input,
      probe,
      /** Roda o ffmpeg; lança erro legível se falhar. */
      async run(args, label = 'Convertendo…', { allowFail = false, outDuration } = {}) {
        currentLabel = label;
        duration = outDuration ?? probe.duration;
        ctx.progress(0, label);
        logs.length = 0;
        const out = args[args.length - 1];
        written.push(out);
        const code = await ff.exec(args);
        if (code !== 0) {
          try {
            await ff.deleteFile(out);
          } catch {}
          if (allowFail) return false;
          throw new Error(explain(logs));
        }
        return true;
      },
      async read(name, type) {
        const data = await ff.readFile(name);
        return new Blob([data], { type });
      },
    };
    return await task(api);
  } catch (err) {
    if (!instance) throw Object.assign(new Error('Conversão cancelada.'), { cancelled: true });
    throw err;
  } finally {
    if (instance === ff) {
      ff.off('log', onLog);
      ff.off('progress', onProgress);
      for (const name of written) {
        try {
          await ff.deleteFile(name);
        } catch {}
      }
      try {
        await ff.unmount(dir);
        await ff.deleteDir(dir);
      } catch {}
    }
  }
}

function explain(logs) {
  const text = logs.join('\n');
  if (/Output file #0 does not contain any stream|does not contain any stream/i.test(text)) {
    return 'O arquivo não tem a faixa necessária (por exemplo, um vídeo sem som).';
  }
  if (/Invalid data found|could not find codec|Unknown format|moov atom not found/i.test(text)) {
    return 'Não consegui ler este arquivo. Ele pode estar corrompido ou em um formato não suportado.';
  }
  if (/memory|OOM|Cannot allocate/i.test(text)) {
    return 'O aparelho ficou sem memória. Tente um arquivo menor ou uma qualidade mais baixa.';
  }
  const last = logs.filter((l) => /error|invalid|failed/i.test(l)).slice(-2).join(' ');
  return `A conversão falhou.${last ? ` Detalhe técnico: ${last}` : ''}`;
}
