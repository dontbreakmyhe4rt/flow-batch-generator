'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const DEFAULT_PORT = 9222;

/**
 * Cac cho Chrome hay duoc cai. Dung dau '/' cho moi duong dan - Node tren
 * Windows chap nhan het, va tranh duoc loi escape cua dau '\' trong chuoi JS.
 *
 * `PROGRAMFILES` / `PROGRAMFILES(X86)` doc tu bien moi truong chu khong go
 * cung "C:", vi may khac co the cai Windows o o dia khac.
 */
function chromeCandidates() {
  const env = process.env;
  const dirs = [
    env['PROGRAMFILES'],
    env['PROGRAMFILES(X86)'],
    env.LOCALAPPDATA,
    'C:/Program Files',
    'C:/Program Files (x86)',
  ];

  const out = [];
  for (const d of dirs) {
    if (d) out.push(path.join(d, 'Google/Chrome/Application/chrome.exe'));
  }
  return [...new Set(out)];
}

/** Hoi Windows Registry xem Chrome duoc cai o dau. */
function chromeFromRegistry() {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  ];

  for (const key of keys) {
    try {
      const out = execFileSync('reg', ['query', key, '/ve'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      });
      const m = out.match(/REG_SZ\s+(.+?chrome\.exe)/i);
      if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch { /* khong co key nay */ }
  }
  return null;
}

function findChrome() {
  for (const p of chromeCandidates()) {
    if (fs.existsSync(p)) return p;
  }

  const fromReg = chromeFromRegistry();
  if (fromReg) return fromReg;

  throw new Error(
    'Khong tim thay Google Chrome tren may nay.\n'
    + 'Tool dieu khien Chrome that nen bat buoc phai co Chrome.\n'
    + 'Hay cai tai https://www.google.com/chrome/ roi mo lai tool.'
  );
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(600);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

function fetchJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bat chrome.exe voi profile rieng + cong remote debugging.
 * Neu da co Chrome dang lang nghe o cong do thi tai su dung luon.
 */
async function launchChrome({ profileDir, port = DEFAULT_PORT, startUrl, log = () => {} }) {
  if (await isPortOpen(port)) {
    log(`Da co Chrome lang nghe o cong ${port}, dung lai phien do.`);
    return { port, spawned: null };
  }

  const exe = findChrome();
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--restore-last-session',
  ];
  if (startUrl) args.push(startUrl);

  log(`Khoi chay Chrome: ${exe}`);
  log(`Profile: ${profileDir}`);

  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      log(`Chrome da san sang o cong ${port}.`);
      return { port, spawned: child };
    }
    await sleep(300);
  }
  throw new Error(`Chrome khong mo duoc cong debug ${port} sau 30s.`);
}

/** Ket noi Playwright vao Chrome dang chay. */
async function connect(port = DEFAULT_PORT) {
  await fetchJson(`http://127.0.0.1:${port}/json/version`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return browser;
}

/* ------------------------------------------------------------------ */
/* Ket noi dung chung theo cong                                        */
/* ------------------------------------------------------------------ */

/**
 * MOI cong chi duoc mo DUNG MOT ket noi CDP, dung chung cho moi viec.
 *
 * Vi sao: Playwright dieu khien download bang Browser.setDownloadBehavior,
 * ma lenh do co pham vi toan trinh duyet. Neu hai viec cung mo hai ket noi
 * rieng toi cung mot Chrome, ket noi sau de len ket noi truoc va mot trong
 * hai viec se nhan duoc file rong 0 byte. Dung chung mot ket noi thi khong
 * con xung dot, cac trang van hoan toan doc lap voi nhau.
 *
 * Pool luu PROMISE chu khong luu ket qua: hai viec bam Bat dau gan nhu cung
 * luc se cung cho chung mot promise. Neu luu ket qua thi ca hai deu thay pool
 * rong (vi connect() con dang await) va van tao hai ket noi - dung lai chinh
 * loi ma pool sinh ra de tranh.
 *
 * @type {Map<number, {promise: Promise<import('playwright-core').Browser>, refs: number}>}
 */
const pool = new Map();

async function acquire(port = DEFAULT_PORT) {
  const entry = pool.get(port);
  if (entry) {
    entry.refs += 1;
    try {
      const browser = await entry.promise;
      if (browser.isConnected()) return browser;
    } catch { /* ket noi cu hong -> tao lai ben duoi */ }

    entry.refs -= 1;
    if (pool.get(port) === entry) pool.delete(port);
  }

  const created = { refs: 1, promise: null };
  created.promise = connect(port).then((browser) => {
    browser.on('disconnected', () => {
      if (pool.get(port) === created) pool.delete(port);
    });
    return browser;
  });

  pool.set(port, created);

  try {
    return await created.promise;
  } catch (err) {
    if (pool.get(port) === created) pool.delete(port);
    throw err;
  }
}

/** Tra lai ket noi. Chi thuc su ngat khi khong con ai dung. */
async function release(port = DEFAULT_PORT) {
  const entry = pool.get(port);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  pool.delete(port);
  const browser = await entry.promise.catch(() => null);
  if (browser) await browser.close().catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Liet ke tab de nguoi dung tu chon                                    */
/* ------------------------------------------------------------------ */

/** Cac cong debug se do tim (Chrome cua tool + Chrome ban tu mo bang co --remote-debugging-port). */
const SCAN_PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229];

function isUsableTab(t) {
  if (t.type !== 'page') return false;
  return !/^(devtools|chrome-extension|chrome):\/\//.test(t.url || '');
}

/** Tieu de tu CDP doi khi con nguyen entity HTML - giai ma lai cho de doc. */
function decodeEntities(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
  }[e]));
}

/** Doc danh sach tab cua mot cong debug. Tra ve [] neu cong khong mo. */
async function tabsOnPort(port) {
  if (!(await isPortOpen(port))) return null;
  let targets;
  try {
    targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, 2500);
  } catch {
    return null;
  }
  if (!Array.isArray(targets)) return null;

  return targets.filter(isUsableTab).map((t) => {
    const url = t.url || '';
    return {
      id: t.id,
      port,
      title: decodeEntities((t.title || '').trim()) || '(khong tieu de)',
      url,
      isFlow: /^https:\/\/flow\.google\.com\//.test(url),
      inProject: /^https:\/\/flow\.google\.com\/project\//.test(url),
    };
  });
}

/** Dua mot tab len truoc (kich hoat tab va nang cua so Chrome len). */
async function focusTab(port, targetId) {
  const browser = await acquire(port);
  try {
    const page = await findPageByTargetId(browser, targetId);
    await page.bringToFront();
    return page.url();
  } finally {
    await release(port);
  }
}

/**
 * Liet ke tab, nhom theo tung profile (moi profile = mot cua so Chrome rieng).
 *
 * `id` cua tab chinh la CDP targetId - on dinh suot doi cua tab, KHONG doi khi
 * tab dieu huong sang trang khac. Nho vay nguoi dung co the chon tab truoc roi
 * moi dang nhap / vao Flow trong chinh tab do.
 *
 * @param {{profiles?: Array<{id:string,name:string,port:number}>, ports?: number[]}} opts
 * @returns {Promise<{groups: Array<{profileId:string, name:string, port:number, running:boolean, tabs:object[]}>, tabs: object[]}>}
 */
async function listTabs({ profiles, ports = SCAN_PORTS } = {}) {
  const groups = [];
  const claimed = new Set();

  // 1. Cac profile do tool quan ly
  for (const p of profiles || []) {
    const tabs = await tabsOnPort(p.port);
    claimed.add(p.port);
    groups.push({
      profileId: p.id,
      name: p.name,
      port: p.port,
      running: tabs !== null,
      tabs: (tabs || []).map((t) => ({ ...t, profileId: p.id, profileName: p.name })),
    });
  }

  // 2. Chrome nao khac ma nguoi dung tu mo kem --remote-debugging-port
  for (const port of ports) {
    if (claimed.has(port)) continue;
    const tabs = await tabsOnPort(port);
    if (!tabs) continue;
    groups.push({
      profileId: null,
      name: `Chrome ngoai (cong ${port})`,
      port,
      running: true,
      tabs: tabs.map((t) => ({ ...t, profileId: null, profileName: `Chrome ngoai (cong ${port})` })),
    });
  }

  // Trong moi nhom, tab Flow (nhat la tab da vao project) day len dau
  for (const g of groups) {
    g.tabs.sort((a, b) => (b.inProject - a.inProject) || (b.isFlow - a.isFlow));
  }

  return { groups, tabs: groups.flatMap((g) => g.tabs) };
}

/** Doc targetId cua mot Page cua Playwright. */
async function targetIdOf(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    return targetInfo.targetId;
  } finally {
    await session.detach().catch(() => {});
  }
}

/** Tim lai dung tab nguoi dung da chon, theo targetId. */
async function findPageByTargetId(browser, targetId) {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      let id = null;
      try { id = await targetIdOf(ctx, page); } catch { /* tab da dong */ }
      if (id === targetId) return page;
    }
  }
  throw new Error(
    'Khong tim thay tab ban da chon (co the tab da bi dong).\n' +
    'Hay bam "Lam moi" o muc Trinh duyet va chon lai tab.'
  );
}

/**
 * Tim tab Flow ma nguoi dung dang mo.
 * KHONG tu dieu huong project - tool lam viec tren project nguoi dung da chon.
 */
async function findFlowPage(browser, { requireProject = true } = {}) {
  const pages = [];
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) pages.push(p);
  }

  const onFlow = pages.filter((p) => {
    try { return /(^|\.)flow\.google\.com$/.test(new URL(p.url()).hostname); }
    catch { return false; }
  });

  if (onFlow.length === 0) {
    throw new Error(
      'Khong thay tab nao dang mo flow.google.com.\n' +
      'Hay mo Chrome (cua so tool vua bat), dang nhap Google va vao project ban muon, roi bam Bat dau lai.'
    );
  }

  const inProject = onFlow.filter((p) => /\/project\//.test(p.url()));
  if (requireProject && inProject.length === 0) {
    throw new Error(
      'Ban dang o flow.google.com nhung chua vao project nao.\n' +
      'Hay mo project ban muon tao anh (URL dang .../project/<id>), roi bam Bat dau lai.'
    );
  }

  const candidates = inProject.length ? inProject : onFlow;
  if (candidates.length > 1) {
    // Uu tien tab dang hien thi
    for (const p of candidates) {
      try { if (await p.evaluate(() => document.visibilityState === 'visible')) return p; }
      catch { /* bo qua */ }
    }
  }
  return candidates[0];
}

module.exports = {
  launchChrome,
  connect,
  acquire,
  release,
  findFlowPage,
  findChrome,
  listTabs,
  tabsOnPort,
  focusTab,
  findPageByTargetId,
  isPortOpen,
  DEFAULT_PORT,
  SCAN_PORTS,
};
