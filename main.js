'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

const store = require('./src/config');
const flow = require('./src/flow-driver');
const launcher = require('./src/chrome-launcher');
const profiles = require('./src/profiles');
const jobs = require('./src/jobs');
const { Runner } = require('./src/runner');
const { FlowDriver } = require('./src/flow-driver');

/**
 * Hai duong dan tach bach nhau - RAT QUAN TRONG khi dong goi:
 *
 *   APP_DIR  ma nguon (preload.js, ui/). Sau khi dong goi no nam trong
 *            app.asar va CHI DOC.
 *   DATA_DIR noi ghi jobs.json, profiles.json va cac profile Chrome.
 *            Phai nam ngoai asar, neu khong moi thao tac ghi deu that bai.
 *
 * Khi chay tu ma nguon (npm start) thi DATA_DIR chinh la thu muc du an,
 * de khong lam mat cau hinh dang co trong luc phat trien.
 */
const APP_DIR = __dirname;
const DATA_DIR = app.isPackaged ? app.getPath('userData') : __dirname;
const ROOT = DATA_DIR; // moi lenh doc/ghi du lieu deu di qua bien nay

let win = null;
let forceQuit = false;

/** Mot Runner cho moi viec. Cac viec chay doc lap, song song voi nhau. */
const runners = new Map();

/** targetId -> jobId. Mot tab Flow chi phuc vu mot viec dang chay. */
const tabLocks = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: 'Flow Batch Generator',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(APP_DIR, 'ui', 'index.html'));

  // Con viec dang chay thi hoi truoc khi thoat
  win.on('close', async (e) => {
    if (forceQuit) return;
    const busy = [...runners.entries()].filter(([, r]) => r.running).map(([id]) => id);
    if (busy.length === 0) return;

    e.preventDefault();
    const list = jobs.load(ROOT);
    const names = busy.map((id) => (list.find((j) => j.id === id) || {}).name || id).join(', ');

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Huỷ', 'Dừng và thoát'],
      defaultId: 0,
      cancelId: 0,
      title: 'Còn Task đang chạy',
      message: `Còn ${busy.length} Task đang chạy: ${names}`,
      detail: 'Thoát bây giờ sẽ dừng các Task đó giữa chừng. Tiến độ đã lưu trong .state.json '
        + 'nên lần sau vẫn chạy tiếp được.',
    });

    if (response === 1) {
      for (const [, r] of runners) r.stop();
      forceQuit = true;
      win.close();
    }
  });
}

/** Lay (hoac tao) runner cua mot viec, da noi san vao kenh su kien. */
function runnerFor(jobId) {
  if (runners.has(jobId)) return runners.get(jobId);

  const runner = new Runner();
  const forward = (channel) => (payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, { jobId, ...payload });
  };
  runner.on('log', forward('runner:log'));
  runner.on('item', forward('runner:item'));
  runner.on('progress', forward('runner:progress'));
  runner.on('done', forward('runner:done'));
  runner.on('error', forward('runner:error'));

  runners.set(jobId, runner);
  return runner;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------ IPC ------------------------------ */

const wrap = (fn) => async (...args) => {
  try {
    return { ok: true, ...(await fn(...args)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

/* ---- Hop thoai chon file / thu muc ---- */

ipcMain.handle('dialog:pickConfig', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Chọn file config JSON',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickOutDir', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Chọn thư mục lưu ảnh',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

/* ---- Trinh duyet: dung chung cho moi viec ---- */

async function browserState() {
  const list = profiles.load(ROOT);
  const { groups, tabs } = await launcher.listTabs({ profiles: list });
  return { profiles: list, groups, tabs, locks: Object.fromEntries(tabLocks) };
}

ipcMain.handle('browser:state', wrap(() => browserState()));

ipcMain.handle('browser:launch', wrap(async (_e, profileId) => {
  const list = profiles.load(ROOT);
  const p = list.find((x) => x.id === profileId);
  if (!p) throw new Error(`Không có profile "${profileId}".`);

  const already = await launcher.isPortOpen(p.port);
  if (!already) {
    await launcher.launchChrome({
      profileDir: profiles.profileDir(ROOT, p.id),
      port: p.port,
      startUrl: 'https://flow.google.com/',
      log: () => {},
    });
  }
  return { launched: !already, profile: p, ...(await browserState()) };
}));

ipcMain.handle('browser:focus', wrap(async (_e, { port, targetId }) => ({
  url: await launcher.focusTab(port, targetId),
})));

ipcMain.handle('profiles:add', wrap(async (_e, name) => {
  profiles.add(ROOT, name);
  return browserState();
}));

ipcMain.handle('profiles:rename', wrap(async (_e, { id, name }) => {
  profiles.rename(ROOT, id, name);
  return browserState();
}));

ipcMain.handle('profiles:remove', wrap(async (_e, { id, removeData }) => {
  profiles.remove(ROOT, id, { removeData });
  return browserState();
}));

/* ---- Viec ---- */

function jobStatuses() {
  const out = {};
  for (const [id, r] of runners) {
    out[id] = { running: r.running, paused: r.paused, stopping: r.stopping };
  }
  return out;
}

ipcMain.handle('meta:options', () => ({
  models: flow.MODELS,
  aspectRatios: flow.ASPECT_RATIOS,
  outputCounts: flow.OUTPUT_COUNTS,
  resolutions: flow.RESOLUTIONS,
}));

ipcMain.handle('jobs:list', wrap(async () => ({
  jobs: jobs.load(ROOT),
  statuses: jobStatuses(),
})));

ipcMain.handle('jobs:add', wrap(async (_e, patch) => {
  const { jobs: list, id } = jobs.add(ROOT, patch || {});
  return { jobs: list, id };
}));

ipcMain.handle('jobs:update', wrap(async (_e, { id, patch }) => ({
  jobs: jobs.update(ROOT, id, patch),
})));

ipcMain.handle('jobs:remove', wrap(async (_e, id) => {
  const runner = runners.get(id);
  if (runner && runner.running) throw new Error('Task này đang chạy, hãy dừng trước khi xoá.');
  runners.delete(id);
  return { jobs: jobs.remove(ROOT, id) };
}));

// Viec xac nhan do renderer lo bang hop thoai HTML dong bo giao dien app.
// Main chi kiem tra dieu kien an toan roi thuc hien.
ipcMain.handle('jobs:reset', wrap(async (_e, id) => {
  const runner = runners.get(id);
  if (runner && runner.running) throw new Error('Task này đang chạy, hãy dừng trước khi đặt lại.');

  const job = jobs.load(ROOT).find((j) => j.id === id);
  if (!job) throw new Error(`Không có Task "${id}".`);

  if (job.targetId && tabLocks.get(job.targetId) === id) tabLocks.delete(job.targetId);
  return { jobs: jobs.reset(ROOT, id) };
}));

ipcMain.handle('jobs:clearAll', wrap(async () => {
  const busy = [...runners.entries()].filter(([, r]) => r.running);
  if (busy.length) throw new Error(`Còn ${busy.length} Task đang chạy, hãy dừng trước khi xoá hết.`);

  runners.clear();
  tabLocks.clear();
  return { jobs: jobs.clearAll(ROOT) };
}));

/** Doc config cua mot viec de hien bang danh sach. */
ipcMain.handle('jobs:preview', wrap(async (_e, id) => {
  const job = jobs.load(ROOT).find((j) => j.id === id);
  if (!job) throw new Error(`Không có Task "".`);
  if (!job.configPath) return { items: [] };

  const items = store.loadConfig(job.configPath);
  const state = job.outDir ? store.loadState(job.outDir) : { items: {} };
  const existing = store.scanExisting(job.outDir);

  return {
    items: items.map((it) => {
      const s = state.items[it.id] || {};
      // File that tren dia thang hon .state.json: chep thu muc sang may khac
      // hoac xoa .state.json thi van nhan ra dung nhung anh da co.
      const onDisk = store.alreadyOnDisk(it, existing);
      return {
        id: it.id,
        index: it.index,
        file_name: it.file_name,
        prompt: it.prompt,
        status: onDisk && s.status !== 'done' ? 'exists' : (s.status || 'pending'),
        error: s.error || null,
        file: s.file || null,
      };
    }),
  };
}));

/* ---- Doc model that tu trang ---- */

ipcMain.handle('flow:models', wrap(async (_e, { port, targetId }) => {
  const browser = await launcher.acquire(port);
  try {
    const page = targetId
      ? await launcher.findPageByTargetId(browser, targetId)
      : await launcher.findFlowPage(browser);
    const driver = new FlowDriver(page, () => {});
    await driver.assertReady();
    return { models: await driver.listModels({ mode: 'Image' }) };
  } finally {
    await launcher.release(port);
  }
}));

/* ---- Chay ---- */

ipcMain.handle('run:start', wrap(async (_e, { jobId, mode }) => {
  const list = jobs.load(ROOT);
  const job = list.find((j) => j.id === jobId);
  if (!job) throw new Error(`Không có Task "".`);

  const runner = runnerFor(jobId);
  if (runner.running) throw new Error('Task này đang chạy rồi.');

  if (!job.configPath) throw new Error('Chưa chọn file config.json.');
  if (!job.outDir) throw new Error('Chưa chọn thư mục lưu.');
  if (!job.targetId) throw new Error('Chưa chọn tab Flow cho Task này.');

  // Mot tab chi phuc vu mot viec dang chay
  const holder = tabLocks.get(job.targetId);
  if (holder && holder !== jobId) {
    const other = list.find((j) => j.id === holder);
    throw new Error(`Tab này đang được Task "${(other && other.name) || holder}" sử dụng.`);
  }

  const p = profiles.load(ROOT).find((x) => x.id === job.profileId);
  tabLocks.set(job.targetId, jobId);

  runner
    .run({
      ...job,
      mode,
      profileDir: profiles.profileDir(ROOT, (p && p.id) || 'p1'),
      port: job.port || (p && p.port) || launcher.DEFAULT_PORT,
    })
    .catch(() => { /* loi da duoc bao qua su kien */ })
    .finally(() => {
      if (tabLocks.get(job.targetId) === jobId) tabLocks.delete(job.targetId);
    });

  return { started: true };
}));

ipcMain.handle('run:stop', wrap(async (_e, jobId) => {
  const runner = runners.get(jobId);
  if (runner) runner.stop();
  return {};
}));

ipcMain.handle('run:pause', wrap(async (_e, { jobId, paused }) => {
  const runner = runners.get(jobId);
  if (runner) runner.setPaused(paused);
  return {};
}));

ipcMain.handle('run:statuses', wrap(async () => ({ statuses: jobStatuses() })));

/* ---- Tien ich ---- */

ipcMain.handle('shell:openPath', async (_e, p) => {
  if (!p) return { ok: false };
  await shell.openPath(p);
  return { ok: true };
});

ipcMain.handle('shell:showItem', (_e, p) => {
  if (p) shell.showItemInFolder(p);
  return { ok: true };
});
