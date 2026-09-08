'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Doc + validate file config.json cua nguoi dung.
 * Cau truc mong doi: [{ "file_name": "img1", "prompt": "..." }, ...]
 */
function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`File config khong phai JSON hop le: ${err.message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('File config phai la mot mang [ ... ]');
  }
  if (data.length === 0) {
    throw new Error('File config rong, khong co item nao');
  }

  const seen = new Map();
  const items = data.map((item, i) => {
    const at = `item #${i + 1}`;
    if (!item || typeof item !== 'object') {
      throw new Error(`${at}: phai la mot object`);
    }

    const fileName = String(item.file_name ?? '').trim();
    const prompt = String(item.prompt ?? '').trim();

    if (!fileName) throw new Error(`${at}: thieu "file_name"`);
    if (!prompt) throw new Error(`${at}: thieu "prompt"`);
    if (/[\\/:*?"<>|]/.test(fileName)) {
      throw new Error(`${at}: "file_name" chua ky tu khong hop le cho ten file Windows`);
    }

    const key = fileName.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${at}: "file_name" trung voi item #${seen.get(key) + 1} ("${fileName}")`);
    }
    seen.set(key, i);

    return { index: i, id: fileName, file_name: fileName, prompt };
  });

  return items;
}

/* ------------------------------------------------------------------ */
/* settings.json - ghi nho lua chon lan truoc                           */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  configPath: '',
  outDir: '',
  model: 'Nano Banana Pro',
  aspectRatio: '16:9',
  count: 1,
  resolution: '1K',
  delayMs: 3000,
  timeoutMs: 180000,
  retries: 2,
  onDuplicate: 'suffix', // 'suffix' | 'overwrite' | 'skip'
};

function loadSettings(settingsPath) {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...data };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settingsPath, settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

/* ------------------------------------------------------------------ */
/* .state.json - trang thai tung item, dung cho resume va retry         */
/* ------------------------------------------------------------------ */

/**
 * Shape:
 * {
 *   updatedAt: "ISO",
 *   configPath: "...",
 *   outDir: "...",
 *   items: {
 *     "img1": { status: "done"|"failed"|"pending", file: "D:\out\img1.png",
 *               error: "...", attempts: 2, at: "ISO" }
 *   }
 * }
 */
function statePathFor(outDir) {
  return path.join(outDir, '.state.json');
}

function loadState(outDir) {
  try {
    const data = JSON.parse(fs.readFileSync(statePathFor(outDir), 'utf8'));
    if (!data || typeof data !== 'object' || typeof data.items !== 'object') {
      throw new Error('bad shape');
    }
    return data;
  } catch {
    return { updatedAt: null, configPath: '', outDir, items: {} };
  }
}

function saveState(outDir, state) {
  state.updatedAt = new Date().toISOString();
  state.outDir = outDir;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(statePathFor(outDir), JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function markItem(outDir, state, id, patch) {
  const prev = state.items[id] || { attempts: 0 };
  state.items[id] = { ...prev, ...patch, at: new Date().toISOString() };
  saveState(outDir, state);
  return state.items[id];
}

/* ------------------------------------------------------------------ */
/* Doi chieu voi file THAT tren dia                                     */
/* ------------------------------------------------------------------ */

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

/**
 * Doc ten cac file anh dang co trong thu muc luu (khong ke phan mo rong).
 *
 * Dua vao FILE THAT chu khong phai .state.json, nen chep thu muc sang may
 * khac hoac xoa .state.json van nhan ra dung nhung anh da co.
 *
 * @returns {Set<string>} ten file viet thuong, vd: "img1"
 */
function scanExisting(outDir) {
  const found = new Set();
  if (!outDir) return found;

  let entries;
  try {
    entries = fs.readdirSync(outDir, { withFileTypes: true });
  } catch {
    return found; // thu muc chua ton tai
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    found.add(path.basename(e.name, path.extname(e.name)).toLowerCase());
  }
  return found;
}

/** Item da co san file tren dia chua? Chi xet file dau tien (<file_name>.*). */
function alreadyOnDisk(item, existing) {
  return existing.has(item.file_name.toLowerCase());
}

/**
 * Danh sach item can chay, tuy theo che do.
 *
 * @param {object[]} items    toan bo item trong config
 * @param {object}   state    noi dung .state.json
 * @param {'resume'|'all'|'failed'} mode
 * @param {Set<string>} existing ten file anh dang co that trong thu muc luu
 */
function selectItems(items, state, mode, existing = new Set()) {
  // 'all' = "Chay lai tu dau": lam lai het, ke ca item da co file san
  if (mode === 'all') return items;

  if (mode === 'failed') {
    return items.filter((it) => {
      const s = state.items[it.id];
      return s && s.status === 'failed' && !alreadyOnDisk(it, existing);
    });
  }

  // 'resume' (mac dinh): bo qua item da xong VA item da co file tren dia
  return items.filter((it) => {
    const s = state.items[it.id];
    if (s && s.status === 'done') return false;
    return !alreadyOnDisk(it, existing);
  });
}

module.exports = {
  loadConfig,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  loadState,
  saveState,
  markItem,
  selectItems,
  scanExisting,
  alreadyOnDisk,
  statePathFor,
};
