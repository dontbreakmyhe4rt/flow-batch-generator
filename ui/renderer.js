'use strict';

const $ = (id) => document.getElementById(id);

/* ══════════════════════════ trạng thái ══════════════════════════ */

const state = {
  options: null,
  jobs: [],
  currentId: null,
  browser: { profiles: [], groups: [], tabs: [], locks: {} },
  /** jobId -> trạng thái hiển thị của việc đó (log, danh sách, tiến độ) */
  ui: new Map(),
};

function ui(jobId) {
  if (!state.ui.has(jobId)) {
    state.ui.set(jobId, {
      logs: [],
      items: [],
      rows: new Map(),
      done: 0,
      failed: 0,
      total: 0,
      running: false,
      paused: false,
      pane: 'items',
    });
  }
  return state.ui.get(jobId);
}

const currentJob = () => state.jobs.find((j) => j.id === state.currentId) || null;

/* ══════════════════════════ tiện ích ══════════════════════════ */

const STATUS_TEXT = {
  pending: '· chờ',
  running: '⏳ đang tạo',
  retry: '↻ thử lại',
  done: '✓ xong',
  exists: '⊙ đã tồn tại',
  failed: '✗ lỗi',
};

/** Trạng thái coi như đã xong, không cần chạy nữa. */
const FINISHED = new Set(['done', 'exists']);

const JOB_ICON = {
  idle: '·',
  running: '⏳',
  paused: '⏸',
  done: '✓',
  failed: '✗',
};

function shortUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.length > 30 ? `${u.pathname.slice(0, 30)}…` : u.pathname;
    return u.hostname + (p === '/' ? '' : p);
  } catch {
    return url || '(trống)';
  }
}

function tabById(id) {
  return state.browser.tabs.find((t) => t.id === id) || null;
}

/** Trạng thái tổng của một việc, dùng cho icon và màu trong sidebar. */
function jobStatus(jobId) {
  const u = ui(jobId);
  if (u.running) return u.paused ? 'paused' : 'running';
  if (u.failed > 0) return 'failed';
  if (u.total > 0 && u.done >= u.total) return 'done';
  return 'idle';
}

function recount(jobId) {
  const u = ui(jobId);
  u.total = u.items.length;
  u.done = u.items.filter((i) => FINISHED.has(i.status)).length;
  u.failed = u.items.filter((i) => i.status === 'failed').length;
  u.exists = u.items.filter((i) => i.status === 'exists').length;
}

/* ══════════════════════════ hộp thoại xác nhận ══════════════════════════ */

/**
 * Hộp thoại xác nhận dựng bằng HTML, đồng bộ giao diện với app.
 * Trả về Promise<boolean>. Esc / click nền / nút Huỷ = false, Enter = true.
 *
 * @param {{title:string, message:string, detail?:string, list?:string[],
 *          okLabel?:string, danger?:boolean}} opts
 */
function confirmModal({ title, message, detail = '', list = [], okLabel = 'Đồng ý', danger = false }) {
  const back = $('modal');
  const ok = $('modalOk');
  const cancel = $('modalCancel');

  $('modalTitle').textContent = title;
  $('modalMsg').textContent = message;
  $('modalDetail').textContent = detail;
  $('modalDetail').hidden = !detail;

  const ul = $('modalList');
  ul.textContent = '';
  ul.hidden = !list.length;
  for (const line of list) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }

  ok.textContent = okLabel;
  ok.className = danger ? 'destructive' : 'primary';
  back.hidden = false;

  // Focus vào Huỷ: thao tác nguy hiểm thì lỡ tay Enter cũng không sao
  cancel.focus();

  return new Promise((resolve) => {
    const done = (value) => {
      back.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      back.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };

    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => { if (e.target === back) done(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Tab') {
        // giữ focus quẩn trong hộp thoại
        e.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      }
    };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    back.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

/* ══════════════════════════ sidebar: profile ══════════════════════════ */

function renderProfiles() {
  const { profiles, groups } = state.browser;
  const list = $('profileList');
  list.textContent = '';

  const running = groups.filter((g) => g.running && g.profileId).length;
  $('profileCount').textContent = `${running}/${profiles.length} mở`;

  for (const p of profiles) {
    const g = groups.find((x) => x.profileId === p.id);
    const isRunning = !!(g && g.running);

    const row = document.createElement('div');
    row.className = `profile${isRunning ? ' running' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.title = isRunning ? 'Đang mở' : 'Chưa mở';

    const name = document.createElement('input');
    name.className = 'pname';
    name.value = p.name;
    name.title = 'Bấm để đổi tên — nên đặt theo email đăng nhập';
    name.addEventListener('change', async () => {
      const res = await window.api.renameProfile(p.id, name.value);
      if (res.ok) applyBrowserState(res); else addLog(res.error, 'error');
    });

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = isRunning ? `${p.port}·${g.tabs.length}` : String(p.port);

    const open = document.createElement('button');
    open.textContent = isRunning ? '↗' : 'Mở';
    open.title = isRunning ? 'Đưa cửa sổ này lên trước' : 'Mở cửa sổ Chrome cho profile này';
    open.addEventListener('click', async () => {
      open.disabled = true;
      if (isRunning && g.tabs.length) {
        const res = await window.api.focusTab(g.port, g.tabs[0].id);
        if (!res.ok) addLog(res.error, 'error');
      } else {
        addLog(`Đang mở cửa sổ "${p.name}"…`);
        const res = await window.api.launchBrowser(p.id);
        if (res.ok) {
          addLog(res.launched
            ? `Đã mở "${p.name}". Hãy đăng nhập Google trong cửa sổ đó.`
            : `"${p.name}" đã mở sẵn.`);
          applyBrowserState(res);
        } else addLog(res.error, 'error');
      }
      open.disabled = false;
    });

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Xoá khỏi danh sách (dữ liệu đăng nhập vẫn giữ)';
    del.addEventListener('click', async () => {
      const res = await window.api.removeProfile(p.id, false);
      if (res.ok) { applyBrowserState(res); addLog(`Đã xoá "${p.name}" khỏi danh sách.`); }
      else addLog(res.error, 'error');
    });

    row.append(dot, name, meta, open, del);
    list.appendChild(row);
  }
}

/* ══════════════════════════ sidebar: việc ══════════════════════════ */

function renderJobList() {
  const list = $('jobList');
  list.textContent = '';
  $('jobCount').textContent = String(state.jobs.length);

  state.jobs.forEach((job, i) => {
    const u = ui(job.id);
    const st = jobStatus(job.id);

    const row = document.createElement('div');
    row.className = `job st-${st}${job.id === state.currentId ? ' on' : ''}`;
    row.addEventListener('click', () => selectJob(job.id));

    const top = document.createElement('div');
    top.className = 'job-top';
    const idx = document.createElement('span');
    idx.className = 'job-idx';
    idx.textContent = String(i + 1);
    const title = document.createElement('span');
    title.className = 'job-title';
    title.textContent = job.name || job.id;

    const del = document.createElement('button');
    del.className = 'job-del';
    del.textContent = '✕';
    del.title = 'Xoá Task này';
    del.disabled = state.jobs.length <= 1 || u.running;
    del.addEventListener('click', async (e) => {
      e.stopPropagation(); // đừng chọn Task khi bấm nút xoá
      await removeJob(job.id);
    });

    top.append(idx, title, del);

    const sub = document.createElement('div');
    sub.className = 'job-sub';

    const icon = document.createElement('span');
    icon.className = 'st';
    const finished = u.done + u.failed;
    icon.textContent = u.total
      ? `${JOB_ICON[st]} ${finished}/${u.total}`
        + `${u.failed ? ` · ${u.failed} lỗi` : ''}`
        + `${u.exists ? ` · ${u.exists} có sẵn` : ''}`
      : `${JOB_ICON[st]} chưa có config`;

    const bar = document.createElement('div');
    bar.className = 'job-bar';
    const fill = document.createElement('span');
    fill.style.width = u.total ? `${Math.round((finished / u.total) * 100)}%` : '0';
    bar.appendChild(fill);

    const where = document.createElement('span');
    where.className = 'job-where';
    const t = tabById(job.targetId);
    where.textContent = t ? (t.profileName || '') : '—';
    where.title = t ? `${t.profileName} — ${t.title}` : 'Chưa chọn tab';

    sub.append(icon, bar, where);
    row.append(top, sub);
    list.appendChild(row);
  });
}

/* ══════════════════════════ panel: tab Flow ══════════════════════════ */

function renderTabSelect() {
  const job = currentJob();
  const sel = $('tabSelect');
  sel.textContent = '';
  if (!job) return;

  const { groups, locks } = state.browser;
  const anyTab = groups.some((g) => g.tabs.length);

  if (!anyTab) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(chưa có tab — bấm Mở ở một cửa sổ bên trái)';
    sel.appendChild(opt);
    sel.disabled = true;
    checkTab();
    return;
  }
  sel.disabled = ui(job.id).running;

  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— chưa chọn —';
  sel.appendChild(none);

  for (const g of groups) {
    if (!g.tabs.length) continue;
    const og = document.createElement('optgroup');
    og.label = g.name;
    for (const t of g.tabs) {
      const opt = document.createElement('option');
      opt.value = t.id;

      // Tab đã giao cho Task khác thì làm mờ, không chọn được.
      // Mỗi Task một tab, mỗi tab một Task.
      const ownedBy = state.jobs.find((j) => j.id !== job.id && j.targetId === t.id);
      const holder = locks[t.id];
      const runningBy = holder && holder !== job.id
        ? state.jobs.find((j) => j.id === holder)
        : null;
      const taken = runningBy || ownedBy;

      const mark = t.inProject ? '✓ ' : (t.isFlow ? '• ' : '');
      opt.textContent = `${mark}${t.title} — ${shortUrl(t.url)}`
        + (taken ? `  — đã giao cho "${taken.name}"${runningBy ? ', đang chạy' : ''}` : '');
      opt.disabled = !!taken;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }

  // Tab đã lưu nhưng không còn tồn tại -> vẫn hiện để người dùng biết
  if (job.targetId && !tabById(job.targetId)) {
    const gone = document.createElement('option');
    gone.value = job.targetId;
    gone.textContent = '⚠ tab đã chọn không còn nữa';
    sel.appendChild(gone);
  }

  sel.value = job.targetId || '';
  checkTab();
}

function checkTab() {
  const job = currentJob();
  const warn = $('tabWarn');
  if (!job) { warn.hidden = true; return; }

  const t = tabById(job.targetId);
  if (!job.targetId) {
    warn.hidden = false;
    warn.style.color = 'var(--muted)';
    warn.textContent = 'Chưa chọn tab. Mở một cửa sổ Chrome, vào project Flow, rồi chọn tab ở trên.';
    return;
  }
  if (!t) {
    warn.hidden = false;
    warn.style.color = 'var(--err)';
    warn.textContent = '⚠ Tab đã chọn không còn tồn tại. Bấm ↻ Làm mới bên trái rồi chọn lại.';
    return;
  }

  warn.hidden = false;
  if (t.inProject) {
    warn.style.color = 'var(--ok)';
    warn.textContent = `✓ Tab ở trong một project Flow (${t.profileName}) — sẵn sàng chạy.`;
  } else {
    warn.style.color = 'var(--warn)';
    warn.textContent = t.isFlow
      ? `⚠ Tab (${t.profileName}) đang ở Flow nhưng chưa vào project nào.`
      : `⚠ Tab (${t.profileName}) chưa ở Flow. Hãy đăng nhập và mở project trong chính tab đó.`;
  }
}

/* ══════════════════════════ panel: nội dung ══════════════════════════ */

function fillSelect(select, options, selected) {
  select.textContent = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

function buildSegmented(group, values, selected, render = (v) => v) {
  group.textContent = '';
  for (const v of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.val = String(v);
    b.textContent = render(v);
    if (String(v) === String(selected)) b.classList.add('on');
    group.appendChild(b);
  }
  if (!group.querySelector('button.on') && group.firstChild) group.firstChild.classList.add('on');
}

function segmentedValue(group) {
  const on = group.querySelector('button.on');
  return on ? on.dataset.val : '';
}

function renderPanel() {
  const job = currentJob();
  if (!job) return;
  const u = ui(job.id);
  const o = state.options;

  $('jobName').value = job.name || '';
  $('configPath').value = job.configPath || '';
  $('outDir').value = job.outDir || '';

  fillSelect($('model'), o.models.map((m) => ({ value: m, label: m })), job.model);
  fillSelect($('resolution'), o.resolutions, job.resolution);
  buildSegmented($('aspect'), o.aspectRatios, job.aspectRatio);
  buildSegmented($('count'), o.outputCounts, job.count, (v) => `x${v}`);
  $('multiNote').hidden = Number(job.count || 1) <= 1;

  $('delay').value = Math.round((job.delayMs ?? 3000) / 1000);
  $('timeout').value = Math.round((job.timeoutMs ?? 180000) / 1000);
  $('retries').value = job.retries ?? 2;
  $('onDuplicate').value = job.onDuplicate || 'suffix';

  renderTabSelect();
  renderItems();
  renderLog();
  renderProgress();
  setBusy(u.running);

  const badge = $('jobBadge');
  const st = jobStatus(job.id);
  badge.className = `badge ${st === 'idle' ? '' : st}`;
  badge.textContent = { idle: 'chưa chạy', running: 'đang chạy', paused: 'tạm dừng', done: 'xong', failed: 'có lỗi' }[st];

  $('btnRemoveJob').disabled = state.jobs.length <= 1 || u.running;
  $('btnResetJob').disabled = u.running;
}

function renderItems() {
  const job = currentJob();
  if (!job) return;
  const u = ui(job.id);
  const body = document.querySelector('#itemsTable tbody');
  body.textContent = '';
  u.rows = new Map();

  if (!u.items.length) {
    $('itemsEmpty').hidden = false;
    return;
  }
  $('itemsEmpty').hidden = true;

  for (const it of u.items) {
    const tr = document.createElement('tr');
    tr.className = it.status;

    const num = document.createElement('td');
    num.textContent = String(it.index + 1);
    const name = document.createElement('td');
    name.textContent = it.file_name;
    const prompt = document.createElement('td');
    prompt.className = 'prompt';
    prompt.title = it.prompt;
    prompt.textContent = it.prompt;
    const st = document.createElement('td');
    st.className = 'st';
    setStatusCell(st, it.status, it.error);

    tr.append(num, name, prompt, st);
    body.appendChild(tr);
    u.rows.set(it.id, tr);
  }
}

function setStatusCell(td, status, error) {
  td.textContent = '';
  const span = document.createElement('span');
  span.textContent = STATUS_TEXT[status] || status;
  if (error) span.title = error;
  td.appendChild(span);
}

function renderLog() {
  const job = currentJob();
  if (!job) return;
  const box = $('log');
  box.textContent = '';
  for (const l of ui(job.id).logs) box.appendChild(logLine(l));
  box.scrollTop = box.scrollHeight;
}

function logLine({ time, message, level }) {
  const div = document.createElement('div');
  div.className = level === 'success' ? 'ok' : level;
  const t = document.createElement('span');
  t.className = 'time';
  t.textContent = time;
  div.append(t, document.createTextNode(`  ${message}`));
  return div;
}

function renderProgress() {
  const job = currentJob();
  if (!job) return;
  const u = ui(job.id);
  const finished = u.done + u.failed;
  const pct = u.total ? Math.round((finished / u.total) * 100) : 0;
  $('barFill').style.width = `${pct}%`;
  $('progressText').textContent = `${finished}/${u.total}`
    + (u.failed ? `  (${u.failed} lỗi)` : '')
    + (u.exists ? `  (${u.exists} có sẵn)` : '');
}

function setBusy(running) {
  const u = currentJob() ? ui(currentJob().id) : { paused: false };
  $('btnStart').disabled = running;
  $('btnRetry').disabled = running;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;
  $('btnPickConfig').disabled = running;
  $('btnPickOut').disabled = running;
  $('tabSelect').disabled = running || !state.browser.tabs.length;
  $('btnPause').textContent = u.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
}

/* ══════════════════════════ log ══════════════════════════ */

function addLog(message, level = 'info', jobId = state.currentId) {
  if (!jobId) return;
  const entry = { time: new Date().toLocaleTimeString('vi-VN', { hour12: false }), message, level };
  const u = ui(jobId);
  u.logs.push(entry);
  if (u.logs.length > 2000) u.logs.shift();

  if (jobId === state.currentId) {
    const box = $('log');
    box.appendChild(logLine(entry));
    box.scrollTop = box.scrollHeight;
  }
}

function showLog() {
  const tab = document.querySelector('.tab[data-panel="log"]');
  if (tab && !tab.classList.contains('on')) tab.click();
}

/* ══════════════════════════ tải dữ liệu ══════════════════════════ */

function applyBrowserState(res) {
  state.browser = {
    profiles: res.profiles || [],
    groups: res.groups || [],
    tabs: res.tabs || [],
    locks: res.locks || {},
  };
  renderProfiles();
  renderTabSelect();
  renderJobList();
}

async function refreshBrowser({ quiet = true } = {}) {
  const res = await window.api.browserState();
  if (!res.ok) { addLog(res.error, 'error'); return; }
  applyBrowserState(res);
  if (!quiet) {
    const open = res.groups.filter((g) => g.running).length;
    addLog(`Thấy ${res.tabs.length} tab trong ${open} cửa sổ.`);
  }
}

async function loadPreview(jobId) {
  const job = state.jobs.find((j) => j.id === jobId);
  const u = ui(jobId);
  if (!job || !job.configPath) { u.items = []; recount(jobId); return; }

  const res = await window.api.previewJob(jobId);
  if (!res.ok) {
    u.items = [];
    recount(jobId);
    if (jobId === state.currentId) {
      $('configErr').hidden = false;
      $('configErr').textContent = `Config lỗi: ${res.error}`;
    }
    return;
  }
  if (jobId === state.currentId) $('configErr').hidden = true;
  u.items = res.items;
  recount(jobId);
}

async function reloadJobs(keepId) {
  const res = await window.api.listJobs();
  if (!res.ok) { addLog(res.error, 'error'); return; }
  state.jobs = res.jobs;

  for (const [id, s] of Object.entries(res.statuses || {})) {
    const u = ui(id);
    u.running = s.running;
    u.paused = s.paused;
  }

  if (keepId && state.jobs.some((j) => j.id === keepId)) state.currentId = keepId;
  if (!state.jobs.some((j) => j.id === state.currentId)) {
    state.currentId = state.jobs.length ? state.jobs[0].id : null;
  }
  renderJobList();
}

async function selectJob(id) {
  state.currentId = id;
  renderJobList();
  renderPanel();
  await loadPreview(id);
  renderItems();
  renderProgress();
  renderJobList();
}

/* ══════════════════════════ lưu thay đổi ══════════════════════════ */

/** @returns {Promise<boolean>} true nếu lưu được */
async function patchJob(patch) {
  const job = currentJob();
  if (!job) return false;

  const res = await window.api.updateJob(job.id, patch);
  if (!res.ok) { showLog(); addLog(res.error, 'error'); return false; }

  state.jobs = res.jobs;
  renderJobList();
  return true;
}

function paramsPatch() {
  return {
    model: $('model').value,
    resolution: $('resolution').value,
    aspectRatio: segmentedValue($('aspect')),
    count: Number(segmentedValue($('count')) || 1),
    delayMs: Number($('delay').value) * 1000,
    timeoutMs: Number($('timeout').value) * 1000,
    retries: Number($('retries').value),
    onDuplicate: $('onDuplicate').value,
  };
}

function wireSegmented(group, onChange) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    if (onChange) onChange(btn.dataset.val);
  });
}

/* ══════════════════════════ sự kiện giao diện ══════════════════════════ */

$('btnAddProfile').addEventListener('click', async () => {
  const res = await window.api.addProfile();
  if (!res.ok) { addLog(res.error, 'error'); return; }
  applyBrowserState(res);
  addLog('Đã thêm cửa sổ Chrome mới. Bấm "Mở" rồi đăng nhập tài khoản cho nó.');
});

$('btnRefreshTabs').addEventListener('click', () => refreshBrowser({ quiet: false }));

$('btnAddJob').addEventListener('click', async () => {
  const res = await window.api.addJob({});
  if (!res.ok) { addLog(res.error, 'error'); return; }
  state.jobs = res.jobs;
  await selectJob(res.id);
});

async function removeJob(id) {
  const res = await window.api.removeJob(id);
  if (!res.ok) { showLog(); addLog(res.error, 'error'); return; }

  state.ui.delete(id);
  state.jobs = res.jobs;

  // Xoá Task đang mở thì chuyển sang Task còn lại gần nhất
  if (state.currentId === id) await selectJob(state.jobs[0].id);
  else renderJobList();

  await refreshBrowser();
}

$('btnRemoveJob').addEventListener('click', () => {
  const job = currentJob();
  if (job) removeJob(job.id);
});

$('btnClearJobs').addEventListener('click', async () => {
  const n = state.jobs.length;
  const okToGo = await confirmModal({
    title: `Xoá hết ${n} Task?`,
    message: 'Toàn bộ danh sách Task bị xoá và thay bằng một Task trống.',
    list: state.jobs.map((j, i) => `${i + 1}.  ${j.name}`),
    detail: 'Ảnh đã tải về và file config trên đĩa không bị đụng tới.',
    okLabel: 'Xoá hết',
    danger: true,
  });
  if (!okToGo) return;

  const res = await window.api.clearAllJobs();
  if (!res.ok) { showLog(); addLog(res.error, 'error'); return; }

  state.ui.clear();
  state.jobs = res.jobs;
  await selectJob(state.jobs[0].id);
  await refreshBrowser();
  addLog(`Đã xoá hết ${n} Task.`);
});

$('btnResetJob').addEventListener('click', async () => {
  const job = currentJob();
  if (!job) return;

  const okToGo = await confirmModal({
    title: `Đặt lại Task "${job.name}"?`,
    message: 'Xoá file config, thư mục lưu, tab đã chọn và mọi tham số của riêng Task này.',
    detail: 'Ảnh đã tải về trên đĩa không bị đụng tới.',
    okLabel: 'Đặt lại',
    danger: true,
  });
  if (!okToGo) return;

  const res = await window.api.resetJob(job.id);
  if (!res.ok) { showLog(); addLog(res.error, 'error'); return; }

  state.ui.delete(job.id);
  state.jobs = res.jobs;
  await selectJob(job.id);
  await refreshBrowser();
  addLog('Đã đặt Task này về mặc định.');
});

$('jobName').addEventListener('change', () => patchJob({ name: $('jobName').value.trim() }));

$('btnPickConfig').addEventListener('click', async () => {
  const p = await window.api.pickConfig();
  if (!p) return;

  const before = currentJob().outDir;
  await patchJob({ configPath: p });

  // Thư mục lưu mặc định = thư mục chứa file config (main tự suy ra)
  const job = currentJob();
  $('configPath').value = job.configPath || '';
  $('outDir').value = job.outDir || '';
  $('jobName').value = job.name || '';
  if (job.outDir && job.outDir !== before) {
    addLog(`Thư mục lưu đặt mặc định theo file config: ${job.outDir}`);
  }

  await loadPreview(state.currentId);
  renderItems();
  renderProgress();
  renderJobList();
});

$('btnPickOut').addEventListener('click', async () => {
  const p = await window.api.pickOutDir();
  if (!p) return;
  $('outDir').value = p;
  await patchJob({ outDir: p });
  const job = currentJob();
  if (job) $('jobName').value = job.name;
  await loadPreview(state.currentId);
  renderItems();
  renderProgress();
  renderJobList();
});

$('btnOpenOut').addEventListener('click', () => {
  const job = currentJob();
  if (job && job.outDir) window.api.openPath(job.outDir);
});

$('tabSelect').addEventListener('change', async () => {
  const id = $('tabSelect').value;
  const t = tabById(id);
  const ok = await patchJob({
    targetId: id || null,
    port: t ? t.port : null,
    profileId: t ? t.profileId : null,
  });
  if (!ok) { renderTabSelect(); return; } // bị từ chối -> trả select về đúng thực tế
  checkTab();
  renderJobList();
});

$('btnFocusTab').addEventListener('click', async () => {
  const job = currentJob();
  const t = job && tabById(job.targetId);
  if (!t) { addLog('Chưa chọn tab.', 'warn'); return; }
  const res = await window.api.focusTab(t.port, t.id);
  if (!res.ok) addLog(res.error, 'error');
});

$('btnReadModels').addEventListener('click', async () => {
  const job = currentJob();
  const t = job && tabById(job.targetId);
  if (!t) { addLog('Chưa chọn tab nào để đọc model.', 'error'); showLog(); return; }

  $('btnReadModels').disabled = true;
  addLog('Đang đọc danh sách model từ trang Flow…');
  const res = await window.api.readModels(t.port, t.id);
  $('btnReadModels').disabled = false;

  if (!res.ok) { showLog(); addLog(res.error, 'error'); return; }
  if (!res.models.length) { addLog('Không đọc được model nào.', 'warn'); return; }

  state.options.models = res.models;
  fillSelect($('model'), res.models.map((m) => ({ value: m, label: m })), $('model').value);
  addLog(`Model trên trang: ${res.models.join(' | ')}`, 'success');
  await patchJob(paramsPatch());
});

for (const id of ['model', 'resolution', 'delay', 'timeout', 'retries', 'onDuplicate']) {
  $(id).addEventListener('change', () => patchJob(paramsPatch()));
}

wireSegmented($('aspect'), () => patchJob(paramsPatch()));
wireSegmented($('count'), (v) => {
  $('multiNote').hidden = Number(v) <= 1;
  patchJob(paramsPatch());
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
    tab.classList.add('on');
    $('panel-items').hidden = tab.dataset.panel !== 'items';
    $('panel-log').hidden = tab.dataset.panel !== 'log';
    if (state.currentId) ui(state.currentId).pane = tab.dataset.panel;
  });
});

/* ══════════════════════════ chạy ══════════════════════════ */

async function start(mode) {
  const job = currentJob();
  if (!job) return;

  const u = ui(job.id);
  u.logs = [];
  renderLog();

  const res = await window.api.start(job.id, mode);
  if (!res.ok) {
    showLog();
    addLog(res.error, 'error', job.id);
    return;
  }
  u.running = true;
  u.paused = false;
  setBusy(true);
  renderJobList();
  await refreshBrowser();
}

$('btnStart').addEventListener('click', () => start($('rerunAll').checked ? 'all' : 'resume'));
$('btnRetry').addEventListener('click', () => start('failed'));
$('btnStop').addEventListener('click', () => {
  const job = currentJob();
  if (job) window.api.stop(job.id);
});
$('btnPause').addEventListener('click', () => {
  const job = currentJob();
  if (!job) return;
  const u = ui(job.id);
  u.paused = !u.paused;
  window.api.pause(job.id, u.paused);
  setBusy(u.running);
  renderJobList();
});

/* ══════════════════════════ sự kiện từ runner ══════════════════════════ */

window.api.on('log', ({ jobId, message, level }) => {
  if (level === 'error' && jobId === state.currentId) showLog();
  addLog(message, level, jobId);
});

window.api.on('item', ({ jobId, id, status, error, file }) => {
  const u = ui(jobId);
  const item = u.items.find((i) => i.id === id);
  if (item) {
    item.status = status === 'retry' ? 'retry' : status;
    item.error = error || null;
    if (file) item.file = file;
  }
  recount(jobId);

  if (jobId === state.currentId) {
    const tr = u.rows.get(id);
    if (tr) {
      tr.className = status;
      setStatusCell(tr.querySelector('.st'), status, error);
      if (status === 'running') tr.scrollIntoView({ block: 'nearest' });
    }
  }
  renderJobList();
});

window.api.on('progress', ({ jobId, done, failed }) => {
  const u = ui(jobId);
  u.done = done;
  u.failed = failed;
  if (jobId === state.currentId) renderProgress();
  renderJobList();
});

window.api.on('done', ({ jobId, done, failed, total, stopped }) => {
  const u = ui(jobId);
  u.running = false;
  u.paused = false;
  addLog(
    `Hoàn tất: ${done}/${total} thành công, ${failed} lỗi${stopped ? ' (đã dừng giữa chừng)' : ''}.`,
    failed ? 'warn' : 'success',
    jobId,
  );
  if (jobId === state.currentId) { setBusy(false); renderProgress(); }
  renderJobList();
  refreshBrowser();
});

window.api.on('error', ({ jobId, message }) => {
  const u = ui(jobId);
  u.running = false;
  if (jobId === state.currentId) { showLog(); setBusy(false); }
  addLog(message, 'error', jobId);
  renderJobList();
});

/* ══════════════════════════ khởi động ══════════════════════════ */

(async function init() {
  state.options = await window.api.getOptions();

  await reloadJobs();
  await refreshBrowser();

  // Nạp trước tiến độ của mọi việc để sidebar hiện đúng ngay từ đầu
  await Promise.all(state.jobs.map((j) => loadPreview(j.id)));

  renderJobList();
  renderPanel();

  addLog('Sẵn sàng. Mỗi Task dùng một tab Flow riêng và chạy song song với nhau.');
})();
