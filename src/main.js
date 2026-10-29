import './styles.css';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  AudioWaveform,
  CircleAlert,
  CircleCheckBig,
  Copy,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  FolderArchive,
  Image as ImageIcon,
  Info,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Sun,
  Moon,
  SunMoon,
  Upload,
  X,
} from 'lucide';
import { registerSW } from 'virtual:pwa-register';
import { h, icon, toast } from './lib/dom.js';
import { formatBytes, extOf, zipOutputs } from './lib/files.js';
import { TOOLS, CATEGORIES, POPULAR, getTool, searchTools } from './tools/index.js';

const app = document.getElementById('app');
const appIcon = `${import.meta.env.BASE_URL}icons/icon.svg`;

let cleanups = [];
let currentJob = null;
const home = { query: '', cat: 'all' };

/* ---------------- Tema ---------------- */

const THEMES = ['auto', 'light', 'dark'];
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}

let theme = THEMES.includes(storage.get('tema')) ? storage.get('tema') : 'auto';
applyTheme(theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(theme));

function themeButton() {
  const icons = { auto: SunMoon, light: Sun, dark: Moon };
  const labels = { auto: 'Tema automático', light: 'Tema claro', dark: 'Tema escuro' };
  const btn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': labels[theme], title: labels[theme] }, icon(icons[theme]));
  btn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    storage.set('tema', theme);
    applyTheme(theme);
    btn.replaceWith(themeButton());
    toast(labels[theme]);
  });
  return btn;
}

/* ---------------- Roteamento ---------------- */

function route() {
  if (currentJob) cancelJob(currentJob);
  cleanups.forEach((fn) => fn());
  cleanups = [];
  const id = decodeURIComponent((location.hash.match(/^#\/(.+)$/) || [])[1] || '');
  const tool = id && getTool(id);
  app.replaceChildren(tool ? renderTool(tool) : renderHome());
  document.title = tool ? `${tool.title} · Converte Tudo` : 'Converte Tudo · conversor de arquivos';
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

/* ---------------- Página inicial ---------------- */

function toolCard(tool) {
  return h(
    'a',
    { class: 'card-tool', href: `#/${tool.id}` },
    h('div', { class: 'tile-icon' }, icon(tool.icon)),
    h('strong', {}, tool.title),
    h('span', {}, tool.desc),
  );
}

function renderHome() {
  const list = h('div');

  const update = () => {
    const sections = [];
    if (home.query.trim()) {
      const found = searchTools(home.query);
      sections.push(
        found.length
          ? [h('h2', { class: 'section-title' }, `${found.length} resultado${found.length > 1 ? 's' : ''}`), h('div', { class: 'grid' }, found.map(toolCard))]
          : h('p', { class: 'empty' }, 'Nenhuma ferramenta encontrada. Tente "pdf", "mp3" ou "foto".'),
      );
    } else {
      if (home.cat === 'all') {
        sections.push(h('h2', { class: 'section-title' }, 'Mais usados'), h('div', { class: 'grid' }, POPULAR.map((id) => toolCard(getTool(id)))));
      }
      for (const cat of CATEGORIES) {
        if (home.cat !== 'all' && home.cat !== cat.id) continue;
        sections.push(h('h2', { class: 'section-title' }, cat.label), h('div', { class: 'grid' }, TOOLS.filter((t) => t.cat === cat.id).map(toolCard)));
      }
    }
    list.replaceChildren(...sections.flat());
  };

  const chips = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Categorias' });
  const renderChips = () => {
    chips.replaceChildren(
      ...[{ id: 'all', label: 'Todos' }, ...CATEGORIES].map((cat) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(home.cat === cat.id),
            onclick: () => {
              home.cat = cat.id;
              home.query = '';
              input.value = '';
              renderChips();
              update();
            },
          },
          cat.label,
        ),
      ),
    );
  };

  const input = h('input', {
    type: 'search',
    placeholder: 'Buscar: pdf para word, mp3, heic…',
    'aria-label': 'Buscar ferramenta',
    value: home.query,
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  input.addEventListener('input', () => {
    home.query = input.value;
    update();
  });

  renderChips();
  update();

  return h(
    'div',
    { class: 'app' },
    h('header', { class: 'topbar' }, h('div', { class: 'brand' }, h('img', { src: appIcon, alt: '' }), 'Converte Tudo'), themeButton()),
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Converta seus arquivos direto no celular'),
      h('p', {}, 'Vídeo para MP3, PDF para Word, JPG para PDF e muito mais. Grátis e sem cadastro.'),
      h('span', { class: 'privacy-pill' }, icon(ShieldCheck), 'Nada sai do seu aparelho'),
    ),
    h('div', { class: 'search' }, icon(Search), input),
    chips,
    list,
    installCard(),
    h('footer', { class: 'footer' }, `${TOOLS.length} ferramentas · Os arquivos são processados no próprio navegador, sem enviar para servidores.`),
  );
}

/* ---------------- Instalar como app ---------------- */

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (!location.hash || location.hash === '#/') route();
});

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || storage.get('instalar-fechado')) return null;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!installEvent && !isIos) return null;
  const card = h('div', { class: 'install-card' }, icon(Smartphone));
  const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar' }, icon(X));
  close.addEventListener('click', () => {
    storage.set('instalar-fechado', '1');
    card.remove();
  });
  if (installEvent) {
    const btn = h('button', { class: 'btn btn-sm', type: 'button' }, 'Instalar');
    btn.addEventListener('click', async () => {
      installEvent.prompt();
      await installEvent.userChoice.catch(() => {});
      installEvent = null;
      card.remove();
    });
    card.append(h('p', {}, 'Instale o app na tela inicial e use até sem internet.'), btn, close);
  } else {
    card.append(h('p', {}, 'Para instalar: toque em Compartilhar e depois em "Adicionar à Tela de Início".'), close);
  }
  return card;
}

/* ---------------- Página da ferramenta ---------------- */

function fileIcon(type = '', name = '') {
  const ext = extOf(name);
  if (type.startsWith('video/') || /^(mp4|mov|mkv|avi|webm)$/.test(ext)) return Film;
  if (type.startsWith('audio/') || /^(mp3|m4a|wav|ogg|opus|flac)$/.test(ext)) return AudioWaveform;
  if (type.startsWith('image/') || /^(heic|heif|jpg|jpeg|png|webp|ico)$/.test(ext)) return ImageIcon;
  if (/^(pdf|docx|txt|md|html)$/.test(ext)) return FileText;
  if (/^(xlsx|xls|ods|csv|json)$/.test(ext)) return FileSpreadsheet;
  if (ext === 'zip') return FolderArchive;
  return FileIcon;
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  cleanups.push(() => URL.revokeObjectURL(url));
  return url;
}

function thumb(blob, name) {
  const box = h('div', { class: 'file-thumb' });
  const isImage = blob.type?.startsWith('image/') && !/heic|heif|x-icon/.test(blob.type);
  if (isImage && blob.size < 30 * 1024 * 1024) {
    const img = h('img', { src: objectUrl(blob), alt: '', loading: 'lazy', decoding: 'async' });
    img.onerror = () => img.replaceWith(icon(fileIcon(blob.type, name)));
    box.append(img);
  } else box.append(icon(fileIcon(blob.type, name)));
  return box;
}

function matchesAccept(file, accept) {
  if (!accept || accept === '*/*') return true;
  const ext = extOf(file.name);
  if (!ext && !file.type) return true;
  return accept.split(',').some((token) => {
    const t = token.trim().toLowerCase();
    if (t.startsWith('.')) return t.slice(1) === ext;
    if (t.endsWith('/*')) return file.type.startsWith(t.slice(0, -1));
    return file.type === t;
  });
}

function defaults(tool) {
  return Object.fromEntries(tool.options.map((o) => [o.id, o.default]));
}

function renderTool(tool) {
  const state = { files: [], opts: defaults(tool) };

  const fileList = h('ul', { class: 'file-list', 'aria-label': 'Arquivos escolhidos' });
  const dropSlot = h('div');
  const optionsPanel = h('section', { class: 'panel' });
  const status = h('div', { 'aria-live': 'polite' });
  const convertBtn = h('button', { class: 'btn', type: 'button' }, 'Converter');
  convertBtn.addEventListener('click', () => convert());

  const addFiles = (list) => {
    const incoming = [...list];
    const ok = incoming.filter((f) => matchesAccept(f, tool.accept));
    if (ok.length < incoming.length) toast(ok.length ? 'Alguns arquivos não são compatíveis e foram ignorados.' : 'Este arquivo não é compatível com esta ferramenta.');
    if (!ok.length) return;
    state.files = tool.multiple ? [...state.files, ...ok] : [ok[0]];
    status.replaceChildren();
    refreshFiles();
  };

  const makeDropzone = (compact) => {
    const input = h('input', { type: 'file', accept: tool.accept, multiple: tool.multiple, 'aria-label': 'Escolher arquivos' });
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
    const zone = h(
      'label',
      { class: `dropzone${compact ? ' compact' : ''}` },
      h('div', { class: 'tile-icon' }, icon(compact ? Plus : Upload)),
      compact
        ? h('strong', {}, tool.multiple ? 'Adicionar mais arquivos' : 'Trocar arquivo')
        : [h('strong', {}, tool.multiple ? 'Toque para escolher os arquivos' : 'Toque para escolher o arquivo'), h('small', {}, 'ou arraste e solte aqui')],
      input,
    );
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      addFiles(e.dataTransfer.files);
    });
    return zone;
  };

  const refreshFiles = () => {
    const n = state.files.length;
    fileList.replaceChildren(
      ...state.files.map((file, i) => {
        const actions = h('div', { class: 'file-actions' });
        if (tool.ordered && n > 1) {
          const up = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Subir ${file.name}`, disabled: i === 0 }, icon(ArrowUp));
          const down = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Descer ${file.name}`, disabled: i === n - 1 }, icon(ArrowDown));
          up.addEventListener('click', () => move(i, -1));
          down.addEventListener('click', () => move(i, 1));
          actions.append(up, down);
        }
        const remove = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remover ${file.name}` }, icon(X));
        remove.addEventListener('click', () => {
          state.files.splice(i, 1);
          refreshFiles();
        });
        actions.append(remove);
        return h(
          'li',
          { class: 'file-row' },
          thumb(file, file.name),
          h('div', { class: 'file-meta' }, h('span', { class: 'file-name', title: file.name }, file.name), h('span', { class: 'file-size' }, formatBytes(file.size))),
          actions,
        );
      }),
    );
    fileList.hidden = !n;
    dropSlot.replaceChildren(makeDropzone(n > 0));
    const min = tool.minFiles || 1;
    convertBtn.disabled = n < min;
    convertBtn.textContent = n && n < min ? `Escolha pelo menos ${min} arquivos` : tool.id === 'juntar-pdf' ? 'Juntar PDFs' : 'Converter';
  };

  const move = (i, dir) => {
    const [f] = state.files.splice(i, 1);
    state.files.splice(i + dir, 0, f);
    refreshFiles();
  };

  const refreshOptions = () => {
    const fields = tool.options.filter((o) => !o.showIf || o.showIf(state.opts)).map((o) => renderOption(o, state, refreshOptions));
    optionsPanel.replaceChildren(h('h2', {}, 'Opções'), ...fields);
    optionsPanel.hidden = !fields.length;
  };

  /* ----- Conversão ----- */

  const setBusy = (busy) => {
    convertBtn.disabled = busy || state.files.length < (tool.minFiles || 1);
    dropSlot.style.pointerEvents = busy ? 'none' : '';
    dropSlot.style.opacity = busy ? '0.5' : '';
    fileList.querySelectorAll('button').forEach((b) => (b.disabled = busy || b.disabled));
    optionsPanel.querySelectorAll('input').forEach((el) => (el.disabled = busy));
    if (!busy) {
      refreshFiles();
      refreshOptions();
    }
  };

  async function convert() {
    if (currentJob || !state.files.length) return;
    const job = { cancelled: false, cancelFns: [] };
    currentJob = job;
    const ui = progressPanel(() => {
      cancelJob(job);
      setBusy(false);
      status.replaceChildren();
      toast('Conversão cancelada.');
    });
    status.replaceChildren(ui.el);
    setBusy(true);
    ui.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const release = await keepScreenOn();
    try {
      const outputs = await tool.run(state.files, { ...state.opts }, makeCtx(job, ui));
      if (job.cancelled) return;
      if (!outputs?.length) throw new Error('Nada foi gerado.');
      status.replaceChildren(resultsPanel(tool, outputs, () => {
        state.files = [];
        status.replaceChildren();
        refreshFiles();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    } catch (err) {
      if (job.cancelled || err?.cancelled) return;
      console.error(err);
      status.replaceChildren(errorPanel(err));
    } finally {
      release();
      if (currentJob === job) currentJob = null;
      if (!job.cancelled) {
        setBusy(false);
        status.firstChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  const notices = [];
  if (tool.engine === 'ffmpeg') {
    notices.push('Na primeira vez, o app baixa o motor de vídeo (cerca de 32 MB). Depois funciona até sem internet. Vídeos longos podem demorar: mantenha a tela ligada.');
  }
  if (tool.engine === 'ocr') notices.push('Na primeira vez, o app baixa o leitor de texto (cerca de 5 MB). Funciona melhor com fotos nítidas e bem iluminadas.');
  if (tool.notice) notices.push(tool.notice);

  refreshFiles();
  refreshOptions();

  return h(
    'div',
    { class: 'app' },
    h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'icon-btn', href: '#/', 'aria-label': 'Voltar para o início' }, icon(ArrowLeft)),
      h('span', { class: 'topbar-title' }, 'Converte Tudo'),
      themeButton(),
    ),
    h(
      'section',
      { class: 'tool-intro' },
      h('div', { class: 'tile-icon' }, icon(tool.icon)),
      h('div', {}, h('h1', {}, tool.title), h('p', {}, tool.desc)),
    ),
    notices.map((n) => h('p', { class: 'note' }, icon(Info), h('span', {}, n))),
    dropSlot,
    fileList,
    optionsPanel,
    h('div', { class: 'action-bar' }, convertBtn),
    status,
  );
}

function renderOption(opt, state, rerender) {
  const label = h('span', { class: 'field-label', id: `lbl-${opt.id}` }, opt.label);
  const hint = opt.hint ? h('span', { class: 'field-hint' }, opt.hint) : null;
  if (opt.type === 'choice') {
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `lbl-${opt.id}` });
    for (const c of opt.choices) {
      const input = h('input', { type: 'radio', name: `opt-${opt.id}`, value: c.value, checked: state.opts[opt.id] === c.value });
      input.addEventListener('change', () => {
        state.opts[opt.id] = c.value;
        rerender();
      });
      group.append(h('label', {}, input, h('span', {}, c.label)));
    }
    return h('div', { class: 'field' }, label, group, hint);
  }
  if (opt.type === 'range') {
    const out = h('output', {}, `${state.opts[opt.id]}${opt.unit || ''}`);
    const input = h('input', { type: 'range', min: opt.min, max: opt.max, step: opt.step, value: state.opts[opt.id], 'aria-labelledby': `lbl-${opt.id}` });
    input.addEventListener('input', () => {
      state.opts[opt.id] = Number(input.value);
      out.textContent = `${input.value}${opt.unit || ''}`;
    });
    return h('div', { class: 'field' }, label, h('div', { class: 'range-row' }, input, out), hint);
  }
  if (opt.type === 'check') {
    const input = h('input', { type: 'checkbox', checked: Boolean(state.opts[opt.id]) });
    input.addEventListener('change', () => {
      state.opts[opt.id] = input.checked;
      rerender();
    });
    return h('div', { class: 'field' }, h('label', { class: 'check-row' }, input, h('span', {}, opt.label)), hint);
  }
  const input = h('input', {
    class: 'text-input',
    type: 'text',
    value: state.opts[opt.id] ?? '',
    placeholder: opt.placeholder || '',
    inputmode: opt.inputmode || 'text',
    'aria-labelledby': `lbl-${opt.id}`,
    autocomplete: 'off',
  });
  input.addEventListener('input', () => {
    state.opts[opt.id] = input.value;
  });
  return h('div', { class: 'field' }, label, input, hint);
}

/* ---------------- Progresso ---------------- */

function cancelError() {
  return Object.assign(new Error('Conversão cancelada.'), { cancelled: true });
}

function cancelJob(job) {
  if (job.cancelled) return;
  job.cancelled = true;
  job.cancelFns.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
  if (currentJob === job) currentJob = null;
}

function makeCtx(job, ui, offset = 0, span = 1, prefix = '') {
  return {
    progress(p, label) {
      if (!job.cancelled) ui.update(p == null ? null : offset + Math.min(1, Math.max(0, p)) * span, prefix + (label || ''));
    },
    check() {
      if (job.cancelled) throw cancelError();
    },
    onCancel(fn) {
      job.cancelFns.push(fn);
    },
    part(i, n) {
      return makeCtx(job, ui, offset + (span * i) / n, span / n, `Arquivo ${i + 1} de ${n} · `);
    },
  };
}

function progressPanel(onCancel) {
  const label = h('span', {}, 'Preparando…');
  const pct = h('span', {});
  const fill = h('div');
  const bar = h('div', { class: 'progress indeterminate', role: 'progressbar', 'aria-label': 'Progresso da conversão' }, fill);
  const cancel = h('button', { class: 'btn btn-soft', type: 'button' }, 'Cancelar');
  cancel.addEventListener('click', onCancel);
  const el = h('section', { class: 'panel' }, h('div', { class: 'progress-label' }, label, pct), bar, h('div', { class: 'progress-actions' }, cancel));
  return {
    el,
    update(p, text) {
      if (text) label.textContent = text;
      if (p == null) {
        bar.classList.add('indeterminate');
        fill.style.width = '';
        pct.textContent = '';
        bar.removeAttribute('aria-valuenow');
      } else {
        bar.classList.remove('indeterminate');
        const v = Math.round(p * 100);
        fill.style.width = `${v}%`;
        pct.textContent = `${v}%`;
        bar.setAttribute('aria-valuenow', String(v));
      }
    },
  };
}

async function keepScreenOn() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    return () => lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

/* ---------------- Resultados ---------------- */

function canShareFiles(files) {
  try {
    return Boolean(navigator.canShare?.({ files }));
  } catch {
    return false;
  }
}

function asFile(out) {
  return new File([out.blob], out.name, { type: out.blob.type || 'application/octet-stream' });
}

async function shareFiles(files) {
  try {
    await navigator.share({ files });
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Não foi possível compartilhar. Use o botão Baixar.');
  }
}

function downloadBlob(blob, name) {
  const a = h('a', { href: objectUrl(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function resultsPanel(tool, outputs, onReset) {
  const total = outputs.reduce((n, o) => n + o.blob.size, 0);
  const single = outputs.length === 1;
  const items = outputs.map((out) => {
    const file = asFile(out);
    const buttons = h('div', { class: 'btn-row' });
    const dl = h('button', { class: 'btn btn-sm', type: 'button' }, icon(Download), 'Baixar');
    dl.addEventListener('click', () => downloadBlob(out.blob, out.name));
    buttons.append(dl);
    if (canShareFiles([file])) {
      const sh = h('button', { class: 'btn btn-sm btn-soft', type: 'button' }, icon(Share2), 'Compartilhar');
      sh.addEventListener('click', () => shareFiles([file]));
      buttons.append(sh);
    }
    let preview = null;
    if (out.preview === 'audio') preview = h('audio', { controls: true, preload: 'metadata', src: objectUrl(out.blob) });
    else if (out.preview === 'video' && single) preview = h('video', { controls: true, playsinline: true, preload: 'metadata', src: objectUrl(out.blob) });
    else if (out.preview === 'image' && single) preview = h('img', { src: objectUrl(out.blob), alt: `Prévia de ${out.name}` });
    else if (out.preview === 'text') {
      const area = h('textarea', { readOnly: true, 'aria-label': `Texto de ${out.name}` });
      area.value = out.text.length > 20000 ? `${out.text.slice(0, 20000)}\n…` : out.text;
      const copy = h('button', { class: 'btn btn-sm btn-soft', type: 'button' }, icon(Copy), 'Copiar texto');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(out.text);
          toast('Texto copiado!');
        } catch {
          area.select();
          toast('Selecione e copie o texto manualmente.');
        }
      });
      buttons.append(copy);
      preview = area;
    }
    return h(
      'li',
      { class: 'output' },
      h(
        'div',
        { class: 'file-row' },
        thumb(out.blob, out.name),
        h('div', { class: 'file-meta' }, h('span', { class: 'file-name', title: out.name }, out.name), h('span', { class: 'file-size' }, formatBytes(out.blob.size))),
      ),
      preview && h('div', { class: 'output-preview' }, preview),
      out.note && h('p', { class: 'output-note' }, out.note),
      buttons,
    );
  });

  const bulk = [];
  if (!single) {
    const zipBtn = h('button', { class: 'btn', type: 'button' }, icon(Download), 'Baixar tudo em ZIP');
    zipBtn.addEventListener('click', async () => {
      zipBtn.disabled = true;
      try {
        downloadBlob(await zipOutputs(outputs), `${tool.id}.zip`);
      } catch {
        toast('Não foi possível criar o ZIP.');
      } finally {
        zipBtn.disabled = false;
      }
    });
    bulk.push(zipBtn);
    const files = outputs.map(asFile);
    if (canShareFiles(files)) {
      const shareAll = h('button', { class: 'btn btn-soft', type: 'button' }, icon(Share2), 'Compartilhar todos');
      shareAll.addEventListener('click', () => shareFiles(files));
      bulk.push(shareAll);
    }
  }
  const again = h('button', { class: 'btn btn-soft', type: 'button' }, icon(RotateCcw), 'Converter outro arquivo');
  again.addEventListener('click', onReset);

  return h(
    'section',
    { class: 'panel' },
    h(
      'div',
      { class: 'result-head' },
      h('div', { class: 'tile-icon' }, icon(CircleCheckBig)),
      h('div', {}, h('h2', {}, 'Pronto!'), h('p', {}, `${outputs.length} arquivo${single ? '' : 's'} · ${formatBytes(total)}`)),
    ),
    h('ul', { class: 'outputs' }, items),
    h('div', { style: 'display:grid;gap:8px' }, bulk, again),
  );
}

function friendlyError(err) {
  const msg = String(err?.message || '');
  if (/failed to fetch|networkerror|load failed|network/i.test(msg)) {
    return 'Não foi possível baixar os componentes necessários. Verifique a internet e tente de novo.';
  }
  if (/out of memory|allocation|RangeError/i.test(msg)) return 'O aparelho ficou sem memória. Tente um arquivo menor ou menos arquivos de uma vez.';
  if (!msg || /undefined|null|is not a function|Cannot read/i.test(msg)) return 'Algo deu errado durante a conversão. Tente novamente ou use outro arquivo.';
  return msg;
}

function errorPanel(err) {
  const message = friendlyError(err);
  return h(
    'section',
    { class: 'panel error-panel', role: 'alert' },
    h('div', { class: 'result-head' }, h('div', { class: 'tile-icon' }, icon(CircleAlert)), h('h2', {}, 'Não deu certo')),
    h('p', {}, message),
  );
}

/* ---------------- PWA ---------------- */

const updateSW = registerSW({
  onNeedRefresh() {
    const bar = h('div', { class: 'toast', role: 'status', style: 'display:flex;gap:12px;align-items:center' }, 'Nova versão disponível.');
    const btn = h('button', { class: 'btn btn-sm', type: 'button' }, 'Atualizar');
    btn.addEventListener('click', () => {
      if (currentJob) return toast('Espere a conversão terminar.');
      updateSW(true);
    });
    bar.append(btn);
    document.body.append(bar);
  },
  onOfflineReady() {
    toast('Pronto para usar até sem internet.');
  },
});

window.addEventListener('beforeunload', (e) => {
  if (currentJob) e.preventDefault();
});

route();
