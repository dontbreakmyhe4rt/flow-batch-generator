'use strict';

/**
 * Quan ly danh sach "viec" (job).
 *
 * Moi viec = mot file config + mot thu muc luu + mot tab Flow rieng + bo tham
 * so rieng. Cac viec chay doc lap va song song voi nhau; thu duy nhat dung
 * chung la danh sach profile Chrome (xem profiles.js).
 */

const fs = require('fs');
const path = require('path');

const { DEFAULT_SETTINGS } = require('./config');

const JOB_DEFAULTS = {
  name: '',
  configPath: '',
  outDir: '',

  // Tab Flow ma viec nay dieu khien
  profileId: null,
  port: null,
  targetId: null,

  ...DEFAULT_SETTINGS,
};
delete JOB_DEFAULTS.configPath; // giu thu tu khoa cho de doc
JOB_DEFAULTS.configPath = '';

function jobsPath(root) {
  return path.join(root, 'jobs.json');
}

/**
 * Ten thu muc qua chung chung thi khong phan biet duoc viec nao voi viec nao -
 * ai cung dat thu muc luu la "out". Gap nhung ten nay thi lay ten thu muc cha.
 */
const GENERIC_DIRS = new Set([
  'out', 'output', 'outputs', 'result', 'results',
  'image', 'images', 'img', 'imgs', 'anh', 'hinh',
  'download', 'downloads', 'tai', 'temp', 'tmp', 'new', 'data',
]);

/** Ten mac dinh cua viec, suy ra tu duong dan thu muc luu. */
function nameFromOutDir(outDir) {
  if (!outDir) return '';

  const parts = outDir
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter((s) => s && s !== '.' && !/^[a-zA-Z]:$/.test(s));

  if (!parts.length) return '';

  const last = parts[parts.length - 1];
  if (GENERIC_DIRS.has(last.toLowerCase()) && parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return last;
}

/** Ten mac dinh: Task 1, Task 2, ... lay so nho nhat con trong. */
function defaultName(list) {
  const taken = new Set(list.map((j) => (j.name || '').toLowerCase()));
  let n = 1;
  while (taken.has(`task ${n}`)) n += 1;
  return `Task ${n}`;
}

/** Ten "tu sinh" (Task 3 / Viec 3 / ten thu muc) thi duoc phep tu doi. */
function isAutoName(name, id, outDirName) {
  const cur = name || '';
  return !cur
    || cur === id
    || /^(Task|Viec) \d+$/i.test(cur)
    || cur === outDirName
    || (outDirName && new RegExp(`^${outDirName}_\\d+$`).test(cur));
}

/** Them hau to _2, _3... neu ten da bi viec khac dung. */
function uniqueName(name, list, exceptId = null) {
  const taken = new Set(
    list.filter((j) => j.id !== exceptId).map((j) => (j.name || '').toLowerCase()),
  );
  if (!taken.has(name.toLowerCase())) return name;

  let n = 2;
  while (taken.has(`${name}_${n}`.toLowerCase())) n += 1;
  return `${name}_${n}`;
}

function normalize(list) {
  const seen = new Set();
  const out = [];

  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;

    const id = String(raw.id || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);

    const job = { ...JOB_DEFAULTS, ...raw, id };
    job.count = Math.min(4, Math.max(1, Number(job.count) || 1));
    job.retries = Math.min(5, Math.max(0, Number(job.retries) ?? 2));
    job.delayMs = Math.max(0, Number(job.delayMs) || 0);
    job.timeoutMs = Math.max(10000, Number(job.timeoutMs) || 180000);
    if (!job.name) job.name = nameFromOutDir(job.outDir) || `Task ${out.length + 1}`;

    out.push(job);
  }

  return out;
}

function nextId(list) {
  const ids = new Set(list.map((j) => j.id));
  let n = list.length + 1;
  while (ids.has(`j${n}`)) n += 1;
  return `j${n}`;
}

/**
 * Doc danh sach viec. Neu chua co jobs.json thi tu chuyen settings.json cu
 * thanh mot viec dau tien, de nguoi dung khong mat cau hinh da nhap.
 */
function load(root) {
  try {
    const list = normalize(JSON.parse(fs.readFileSync(jobsPath(root), 'utf8')));
    if (list.length) return list;
  } catch { /* chua co file hoac file hong -> di tiep */ }

  let migrated = null;
  try {
    const old = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
    migrated = { ...JOB_DEFAULTS, ...old, id: 'j1' };
    migrated.name = nameFromOutDir(migrated.outDir) || 'Task 1';
  } catch { /* khong co settings cu */ }

  return normalize([migrated || { ...JOB_DEFAULTS, id: 'j1', name: 'Task 1' }]);
}

function save(root, list) {
  const clean = normalize(list);
  fs.writeFileSync(jobsPath(root), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

function add(root, patch = {}) {
  const list = load(root);
  const id = nextId(list);
  const job = { ...JOB_DEFAULTS, ...patch, id };
  job.name = uniqueName(job.name || nameFromOutDir(job.outDir) || defaultName(list), list);
  list.push(job);
  return { jobs: save(root, list), id };
}

function update(root, id, patch = {}) {
  const list = load(root);
  const i = list.findIndex((j) => j.id === id);
  if (i < 0) throw new Error(`Khong co Task "${id}".`);

  const next = { ...list[i], ...patch, id };

  // Chon file config -> mac dinh luu vao chinh thu muc chua file do.
  // Chi tu dien khi nguoi dung chua tu chon thu muc rieng, de khong de mat
  // lua chon co y cua ho.
  if (patch.configPath && patch.outDir === undefined) {
    const prevAuto = list[i].configPath ? path.dirname(list[i].configPath) : '';
    if (!list[i].outDir || list[i].outDir === prevAuto) {
      next.outDir = path.dirname(patch.configPath);
    }
  }

  // Doi thu muc luu ma ten van la ten tu sinh -> tu doi theo thu muc moi.
  // Nguoi dung da tu dat ten thi giu nguyen.
  if (next.outDir !== list[i].outDir && patch.name === undefined) {
    const oldAuto = nameFromOutDir(list[i].outDir);
    if (isAutoName(list[i].name, id, oldAuto)) {
      const fresh = nameFromOutDir(next.outDir);
      if (fresh) next.name = uniqueName(fresh, list, id);
    }
  }

  // Mot tab chi thuoc ve mot viec
  if (patch.targetId) {
    const other = list.find((j) => j.id !== id && j.targetId === patch.targetId);
    if (other) throw new Error(`Tab nay da duoc giao cho Task "${other.name}".`);
  }

  if (patch.name !== undefined) next.name = uniqueName(String(patch.name).trim() || id, list, id);

  list[i] = next;
  return save(root, list);
}

function remove(root, id) {
  const list = load(root);
  if (list.length <= 1) throw new Error('Phai giu lai it nhat mot Task.');
  const kept = list.filter((j) => j.id !== id);
  if (kept.length === list.length) throw new Error(`Khong co Task "${id}".`);
  return save(root, kept);
}

/** Dua mot Task ve nguyen trang ban dau (giu nguyen id va vi tri). */
function reset(root, id) {
  const list = load(root);
  const i = list.findIndex((j) => j.id === id);
  if (i < 0) throw new Error(`Khong co Task "${id}".`);

  const others = list.filter((j) => j.id !== id);
  list[i] = { ...JOB_DEFAULTS, id, name: defaultName(others) };
  return save(root, list);
}

/** Xoa toan bo Task, chi giu lai mot Task trong. */
function clearAll(root) {
  return save(root, [{ ...JOB_DEFAULTS, id: 'j1', name: 'Task 1' }]);
}

module.exports = {
  load, save, add, update, remove, reset, clearAll,
  nameFromOutDir, defaultName, JOB_DEFAULTS,
};
