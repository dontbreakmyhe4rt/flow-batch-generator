'use strict';

/**
 * Quan ly nhieu "profile" Chrome doc lap.
 *
 * Moi profile = mot thu muc user-data-dir rieng + mot cong debug rieng
 *             = mot cua so Chrome doc lap
 *             = mot phien dang nhap Google doc lap.
 *
 * Day la cach duy nhat dieu khien duoc nhieu tai khoan cung luc: tu Chrome 136,
 * Google bo qua --remote-debugging-port khi user-data-dir la thu muc mac dinh,
 * nen khong the bam vao Chrome thuong cua nguoi dung.
 */

const fs = require('fs');
const path = require('path');

const PORT_BASE = 9222;
const PORT_MAX = 9229; // trung voi SCAN_PORTS trong chrome-launcher.js

const DEFAULT_PROFILES = [
  { id: 'p1', name: 'Chrome 1', port: 9222 },
  { id: 'p2', name: 'Chrome 2', port: 9223 },
];

function profilesPath(root) {
  return path.join(root, 'profiles.json');
}

/** Thu muc user-data-dir cua mot profile. */
function profileDir(root, id) {
  return path.join(root, 'profiles', id);
}

function normalize(list) {
  const seenId = new Set();
  const seenPort = new Set();
  const out = [];

  for (const p of Array.isArray(list) ? list : []) {
    const id = String(p && p.id ? p.id : '').trim();
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || seenId.has(id)) continue;

    let port = Number(p.port);
    if (!Number.isInteger(port) || port < PORT_BASE || port > PORT_MAX || seenPort.has(port)) {
      port = nextFreePort(seenPort);
      if (!port) continue;
    }

    seenId.add(id);
    seenPort.add(port);
    out.push({ id, name: String(p.name || id).trim() || id, port });
  }

  return out.length ? out : DEFAULT_PROFILES.map((p) => ({ ...p }));
}

function nextFreePort(used) {
  for (let port = PORT_BASE; port <= PORT_MAX; port += 1) {
    if (!used.has(port)) return port;
  }
  return null;
}

function load(root) {
  try {
    return normalize(JSON.parse(fs.readFileSync(profilesPath(root), 'utf8')));
  } catch {
    return DEFAULT_PROFILES.map((p) => ({ ...p }));
  }
}

function save(root, list) {
  const clean = normalize(list);
  fs.writeFileSync(profilesPath(root), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

/** Them mot profile moi, tu cap id va cong con trong. */
function add(root, name) {
  const list = load(root);
  if (list.length >= PORT_MAX - PORT_BASE + 1) {
    throw new Error(`Toi da ${PORT_MAX - PORT_BASE + 1} profile (het cong debug ${PORT_BASE}-${PORT_MAX}).`);
  }

  const usedPorts = new Set(list.map((p) => p.port));
  const port = nextFreePort(usedPorts);

  let n = list.length + 1;
  const ids = new Set(list.map((p) => p.id));
  while (ids.has(`p${n}`)) n += 1;

  list.push({ id: `p${n}`, name: (name || `Chrome ${n}`).trim(), port });
  return save(root, list);
}

function rename(root, id, name) {
  const list = load(root).map((p) => (p.id === id ? { ...p, name: String(name).trim() || p.id } : p));
  return save(root, list);
}

/** Xoa profile khoi danh sach. Thu muc du lieu chi xoa khi removeData = true. */
function remove(root, id, { removeData = false } = {}) {
  const list = load(root);
  if (list.length <= 1) throw new Error('Phai giu lai it nhat mot profile.');

  const kept = list.filter((p) => p.id !== id);
  if (kept.length === list.length) throw new Error(`Khong co profile "${id}".`);

  if (removeData) {
    fs.rmSync(profileDir(root, id), { recursive: true, force: true });
  }
  return save(root, kept);
}

module.exports = {
  load, save, add, rename, remove,
  profileDir, profilesPath,
  PORT_BASE, PORT_MAX, DEFAULT_PROFILES,
};
