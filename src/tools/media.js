import { FileMusic, AudioWaveform, Film, Minimize2, ImagePlay, Clapperboard, Scissors, VolumeX, Camera } from 'lucide';
import { ACCEPT, choice, mapFiles } from './common.js';
import { extOf, mimeFor, output, rename, parseTime, sizeDelta } from '../lib/files.js';

const ffmpeg = () => import('../lib/ffmpeg.js');

async function withMedia(file, ctx, task) {
  const { withInput, cancelFFmpeg } = await ffmpeg();
  ctx.onCancel(cancelFFmpeg);
  return withInput(file, ctx, task);
}

const AUDIO_FORMATS = [
  choice('mp3', 'MP3'),
  choice('m4a', 'M4A (AAC)'),
  choice('wav', 'WAV'),
  choice('ogg', 'OGG'),
  choice('opus', 'OPUS'),
  choice('flac', 'FLAC'),
];

const BITRATES = [choice('128', 'Normal · 128 kbps'), choice('192', 'Alta · 192 kbps'), choice('320', 'Máxima · 320 kbps')];
const lossless = (fmt) => fmt === 'wav' || fmt === 'flac';

function audioArgs(fmt, kbps) {
  switch (fmt) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', `${kbps}k`];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', `${kbps}k`];
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', `${Math.min(Number(kbps), 256)}k`];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-c:a', 'flac'];
    default:
      throw new Error(`Formato desconhecido: ${fmt}`);
  }
}

const audioOptions = [
  { id: 'format', label: 'Formato de saída', type: 'choice', choices: AUDIO_FORMATS, default: 'mp3' },
  { id: 'kbps', label: 'Qualidade', type: 'choice', choices: BITRATES, default: '192', showIf: (o) => !lossless(o.format) },
];

async function toAudio(file, ctx, { format, kbps }, label) {
  return withMedia(file, ctx, async (ff) => {
    if (!ff.probe.audio) throw new Error(`"${file.name}" não tem som para extrair.`);
    const out = `saida.${format}`;
    let ok = false;
    if (format === 'm4a' && ff.probe.audio === 'aac') {
      ok = await ff.run(['-i', ff.input, '-vn', '-c:a', 'copy', out], label, { allowFail: true });
    }
    if (!ok) await ff.run(['-i', ff.input, '-vn', ...audioArgs(format, kbps), out], label);
    return output(rename(file.name, format), await ff.read(out, mimeFor(format)), format, { preview: 'audio' });
  });
}

const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

// Codecs que cada formato aceita sem recodificar.
const CONTAINERS = {
  mp4: {
    copyVideo: ['h264', 'hevc', 'mpeg4', 'av1'],
    copyAudio: ['aac', 'mp3'],
    video: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', EVEN],
    audio: ['-c:a', 'aac', '-b:a', '160k'],
    extra: ['-movflags', '+faststart'],
  },
  mov: {
    copyVideo: ['h264', 'hevc', 'mpeg4', 'prores'],
    copyAudio: ['aac', 'mp3', 'pcm_s16le'],
    video: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', EVEN],
    audio: ['-c:a', 'aac', '-b:a', '160k'],
    extra: ['-movflags', '+faststart'],
  },
  mkv: {
    copyVideo: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'theora'],
    copyAudio: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3', 'pcm_s16le'],
    video: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', EVEN],
    audio: ['-c:a', 'aac', '-b:a', '160k'],
    extra: [],
  },
  webm: {
    copyVideo: ['vp8', 'vp9', 'av1'],
    copyAudio: ['opus', 'vorbis'],
    video: ['-c:v', 'libvpx', '-crf', '10', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8'],
    audio: ['-c:a', 'libvorbis', '-b:a', '160k'],
    extra: [],
  },
  avi: {
    copyVideo: ['mpeg4', 'h264', 'mjpeg'],
    copyAudio: ['mp3', 'ac3', 'pcm_s16le'],
    video: ['-c:v', 'mpeg4', '-q:v', '4', '-vf', EVEN],
    audio: ['-c:a', 'libmp3lame', '-b:a', '192k'],
    extra: [],
  },
};

function videoArgs(target, probe, fast) {
  const c = CONTAINERS[target];
  const v = !probe.video ? ['-vn'] : fast && c.copyVideo.includes(probe.video) ? ['-c:v', 'copy'] : c.video;
  const a = !probe.audio ? ['-an'] : fast && c.copyAudio.includes(probe.audio) ? ['-c:a', 'copy'] : c.audio;
  return [...v, ...a, ...c.extra];
}

function timeOption(id, label, def, hint) {
  return { id, label, type: 'text', default: def, placeholder: '0:00', inputmode: 'decimal', hint };
}

export default [
  {
    id: 'video-para-audio',
    cat: 'media',
    title: 'Vídeo para áudio',
    desc: 'Extraia o som de vídeos em MP3, M4A, WAV e mais.',
    icon: FileMusic,
    keywords: 'mp3 mp4 extrair som musica youtube whatsapp m4a wav',
    accept: ACCEPT.video,
    multiple: true,
    engine: 'ffmpeg',
    options: audioOptions,
    run: (files, opts, ctx) => mapFiles(files, ctx, (f, c) => toAudio(f, c, opts, 'Extraindo o áudio…')),
  },
  {
    id: 'converter-audio',
    cat: 'media',
    title: 'Converter áudio',
    desc: 'MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, áudios do WhatsApp…',
    icon: AudioWaveform,
    keywords: 'mp3 wav ogg opus flac m4a aac amr audio whatsapp voz',
    accept: ACCEPT.audio,
    multiple: true,
    engine: 'ffmpeg',
    options: audioOptions,
    run: (files, opts, ctx) => mapFiles(files, ctx, (f, c) => toAudio(f, c, opts, 'Convertendo o áudio…')),
  },
  {
    id: 'converter-video',
    cat: 'media',
    title: 'Converter vídeo',
    desc: 'MP4, MOV, MKV, WEBM e AVI, de um para outro.',
    icon: Film,
    keywords: 'mp4 mov mkv webm avi 3gp wmv iphone',
    accept: ACCEPT.video,
    multiple: true,
    engine: 'ffmpeg',
    options: [
      {
        id: 'format',
        label: 'Formato de saída',
        type: 'choice',
        choices: [choice('mp4', 'MP4'), choice('mov', 'MOV'), choice('mkv', 'MKV'), choice('webm', 'WEBM'), choice('avi', 'AVI')],
        default: 'mp4',
      },
      {
        id: 'mode',
        label: 'Modo',
        type: 'choice',
        choices: [choice('fast', 'Rápido'), choice('full', 'Recodificar tudo')],
        default: 'fast',
        hint: 'O modo rápido reaproveita o vídeo original sempre que o formato permite.',
      },
    ],
    run: (files, { format, mode }, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          const out = `saida.${format}`;
          await ff.run(['-i', ff.input, ...videoArgs(format, ff.probe, mode === 'fast'), out], 'Convertendo o vídeo…');
          return output(rename(file.name, format), await ff.read(out, mimeFor(format)), format, { preview: 'video' });
        }),
      ),
  },
  {
    id: 'comprimir-video',
    cat: 'media',
    title: 'Comprimir vídeo',
    desc: 'Deixe o vídeo mais leve para enviar no WhatsApp ou e-mail.',
    icon: Minimize2,
    keywords: 'reduzir tamanho diminuir mb whatsapp email mp4 compactar',
    accept: ACCEPT.video,
    multiple: true,
    engine: 'ffmpeg',
    heavy: true,
    options: [
      {
        id: 'level',
        label: 'Compressão',
        type: 'choice',
        choices: [choice('26', 'Leve'), choice('30', 'Média'), choice('34', 'Forte')],
        default: '30',
      },
      {
        id: 'res',
        label: 'Resolução máxima',
        type: 'choice',
        choices: [choice('0', 'Manter'), choice('1080', '1080p'), choice('720', '720p'), choice('480', '480p'), choice('360', '360p')],
        default: '720',
      },
    ],
    run: (files, { level, res }, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          if (!ff.probe.video) throw new Error(`"${file.name}" não tem imagem de vídeo.`);
          const r = Number(res);
          const vf = r
            ? `scale='if(gt(iw,ih),-2,min(${r},iw))':'if(gt(iw,ih),min(${r},ih),-2)',${EVEN}`
            : EVEN;
          const out = 'saida.mp4';
          const audio = ff.probe.audio ? ['-c:a', 'aac', '-b:a', level === '26' ? '128k' : '96k'] : ['-an'];
          await ff.run(
            ['-i', ff.input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', level, '-pix_fmt', 'yuv420p', '-vf', vf, ...audio, '-movflags', '+faststart', out],
            'Comprimindo o vídeo…',
          );
          const blob = await ff.read(out, 'video/mp4');
          return output(rename(file.name, 'mp4', '-comprimido'), blob, 'mp4', { preview: 'video', note: sizeDelta(file.size, blob.size) });
        }),
      ),
  },
  {
    id: 'video-para-gif',
    cat: 'media',
    title: 'Vídeo para GIF',
    desc: 'Transforme um trecho do vídeo em GIF animado.',
    icon: ImagePlay,
    keywords: 'gif animado meme figurinha mp4',
    accept: ACCEPT.video,
    multiple: false,
    engine: 'ffmpeg',
    options: [
      timeOption('start', 'Começar em', '0:00', 'Minutos:segundos, ex.: 0:12'),
      {
        id: 'duration',
        label: 'Duração',
        type: 'choice',
        choices: [choice('3', '3 s'), choice('5', '5 s'), choice('10', '10 s'), choice('15', '15 s'), choice('30', '30 s')],
        default: '5',
      },
      { id: 'width', label: 'Largura', type: 'choice', choices: [choice('320', '320 px'), choice('480', '480 px'), choice('640', '640 px')], default: '480' },
      { id: 'fps', label: 'Quadros por segundo', type: 'choice', choices: [choice('8', '8'), choice('12', '12'), choice('15', '15')], default: '12' },
    ],
    run: (files, { start, duration, width, fps }, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          const ss = parseTime(start) || 0;
          if (ff.probe.duration && ss >= ff.probe.duration) throw new Error('O início escolhido passa do fim do vídeo.');
          const dur = Math.min(Number(duration), ff.probe.duration ? ff.probe.duration - ss : Infinity);
          const vf = `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
          await ff.run(['-ss', String(ss), '-t', String(dur), '-i', ff.input, '-vf', vf, '-loop', '0', 'saida.gif'], 'Criando o GIF…', { outDuration: dur });
          return output(rename(file.name, 'gif'), await ff.read('saida.gif', 'image/gif'), 'gif', { preview: 'image' });
        }),
      ),
  },
  {
    id: 'gif-para-video',
    cat: 'media',
    title: 'GIF para MP4',
    desc: 'Converta GIFs em vídeos MP4 bem mais leves.',
    icon: Clapperboard,
    keywords: 'gif mp4 video animado',
    accept: 'image/gif,.gif',
    multiple: true,
    engine: 'ffmpeg',
    options: [],
    run: (files, opts, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          await ff.run(
            ['-i', ff.input, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-vf', EVEN, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', 'saida.mp4'],
            'Convertendo o GIF…',
          );
          return output(rename(file.name, 'mp4'), await ff.read('saida.mp4', 'video/mp4'), 'mp4', { preview: 'video' });
        }),
      ),
  },
  {
    id: 'cortar-midia',
    cat: 'media',
    title: 'Cortar vídeo ou áudio',
    desc: 'Guarde só o trecho que interessa.',
    icon: Scissors,
    keywords: 'cortar recortar trecho aparar trim mp3 mp4 toque',
    accept: `${ACCEPT.video},${ACCEPT.audio}`,
    multiple: false,
    engine: 'ffmpeg',
    options: [
      timeOption('start', 'Início', '0:00', 'Ex.: 0:15 ou 1:02:30'),
      timeOption('end', 'Fim', '', 'Deixe vazio para ir até o final'),
      {
        id: 'mode',
        label: 'Precisão',
        type: 'choice',
        choices: [choice('fast', 'Rápido'), choice('exact', 'Exato')],
        default: 'fast',
        hint: 'O modo rápido não recodifica, mas em vídeos o corte pode variar alguns segundos.',
      },
    ],
    run: (files, { start, end, mode }, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          const ss = parseTime(start) || 0;
          const to = parseTime(end);
          const total = ff.probe.duration;
          if (total && ss >= total) throw new Error('O início escolhido passa do fim do arquivo.');
          if (to != null && to <= ss) throw new Error('O fim precisa ser depois do início.');
          const dur = (to ?? total ?? Infinity) - ss;
          const ext = extOf(file.name) || 'mp4';
          const isAudio = !ff.probe.video;
          let codec = ['-c', 'copy', '-avoid_negative_ts', 'make_zero'];
          if (mode === 'exact') {
            if (isAudio) codec = [];
            else codec = videoArgs(CONTAINERS[ext] ? ext : 'mp4', ff.probe, false);
          }
          const outExt = mode === 'exact' && !isAudio && !CONTAINERS[ext] ? 'mp4' : ext;
          const out = `saida.${outExt}`;
          const args = ['-ss', String(ss), ...(Number.isFinite(dur) ? ['-t', String(dur)] : []), '-i', ff.input, ...codec, out];
          await ff.run(args, 'Cortando…', { outDuration: Number.isFinite(dur) ? dur : undefined });
          return output(rename(file.name, outExt, '-cortado'), await ff.read(out, mimeFor(outExt)), outExt, { preview: isAudio ? 'audio' : 'video' });
        }),
      ),
  },
  {
    id: 'remover-audio',
    cat: 'media',
    title: 'Tirar o som do vídeo',
    desc: 'Remove o áudio e mantém a imagem intacta.',
    icon: VolumeX,
    keywords: 'mudo sem som remover audio silenciar',
    accept: ACCEPT.video,
    multiple: true,
    engine: 'ffmpeg',
    options: [],
    run: (files, opts, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          const ext = CONTAINERS[extOf(file.name)] ? extOf(file.name) : 'mp4';
          const out = `saida.${ext}`;
          const extra = CONTAINERS[ext].extra;
          const ok = await ff.run(['-i', ff.input, '-c:v', 'copy', '-an', ...extra, out], 'Removendo o som…', { allowFail: true });
          if (!ok) await ff.run(['-i', ff.input, ...CONTAINERS[ext].video, '-an', ...extra, out], 'Removendo o som…');
          return output(rename(file.name, ext, '-sem-som'), await ff.read(out, mimeFor(ext)), ext, { preview: 'video' });
        }),
      ),
  },
  {
    id: 'foto-do-video',
    cat: 'media',
    title: 'Foto do vídeo',
    desc: 'Capture uma ou várias imagens de momentos do vídeo.',
    icon: Camera,
    keywords: 'print frame captura imagem jpg png quadro thumbnail',
    accept: ACCEPT.video,
    multiple: false,
    engine: 'ffmpeg',
    options: [
      timeOption('times', 'Momentos', '0:01', 'Separe por vírgula para várias fotos: 0:05, 0:30, 1:10'),
      { id: 'format', label: 'Formato', type: 'choice', choices: [choice('jpg', 'JPG'), choice('png', 'PNG')], default: 'jpg' },
    ],
    run: (files, { times, format }, ctx) =>
      mapFiles(files, ctx, (file, c) =>
        withMedia(file, c, async (ff) => {
          const list = String(times || '0')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          const outs = [];
          for (const [i, t] of list.entries()) {
            c.check();
            const ss = parseTime(t) || 0;
            if (ff.probe.duration && ss > ff.probe.duration) throw new Error(`O momento ${t} passa do fim do vídeo.`);
            const out = `foto${i}.${format}`;
            const q = format === 'jpg' ? ['-q:v', '2'] : [];
            await ff.run(['-ss', String(ss), '-i', ff.input, '-frames:v', '1', ...q, out], `Capturando ${i + 1} de ${list.length}…`);
            const blob = await ff.read(out, mimeFor(format));
            if (!blob.size) throw new Error(`Não encontrei imagem em ${t}.`);
            const stamp = t.replace(/[:.]/g, '-');
            outs.push(output(rename(file.name, format, `-${stamp}`), blob, format, { preview: 'image' }));
          }
          return outs;
        }),
      ),
  },
];
