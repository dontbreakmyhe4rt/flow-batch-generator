'use strict';

/**
 * =====================================================================
 *  FlowDriver - lop dieu khien giao dien https://flow.google.com
 * =====================================================================
 *  Khao sat DOM that ngay 2026-09-07. Flow la app Angular dung custom
 *  element ten on dinh (flow-*) + Angular Material, khong obfuscate.
 *
 *  ⚠ QUAN TRONG - KHONG DUNG NHAN CHU DE TIM PHAN TU.
 *  Giao dien Flow duoc dich theo ngon ngu trinh duyet ("Mode" -> "Che do",
 *  "Download" -> "Tai xuong"...) nen moi selector dua tren aria-label hay
 *  text tieng Anh deu vo hieu tren may cai ngon ngu khac. Thay vao do ta
 *  chi dua vao nhung thu KHONG bi dich:
 *
 *    - ten class / ten custom element   (.generate-icon-button, flow-toggles)
 *    - ten ligature cua Material icon   (image, videocam, crop_16_9, download,
 *                                        more_vert) - luon la tieng Anh
 *    - aria-haspopup="menu"             (thuoc tinh, khong phai noi dung)
 *    - cac nhan thuan so/ki hieu        ("16:9", "x1", "1K")
 * =====================================================================
 */

const SELECTORS = {
  promptBox: 'flow-base-prompt-box',
  promptInput: 'flow-rich-text-editor .ProseMirror',
  generateButton: 'button.generate-icon-button',
  settingsTrigger: 'button.settings-trigger-button',

  settingsPanel: 'flow-prompt-box-settings',
  toggleGroup: 'flow-toggles',
  toggleOption: 'button[role="radio"]',
  // Nut duy nhat trong panel co menu xo xuong = chon model
  modelTrigger: 'button[aria-haspopup="menu"]:not([role="radio"])',

  menuPanel: '.cdk-overlay-container .mat-mdc-menu-panel',
  menuItem: '[role="menuitem"]',

  tile: 'flow-tile-container',
  pendingTile: 'flow-pending-tile',
  tileImage: 'flow-image-tile img[alt]',
  // Moi anh da tao xong mang mot UUID on dinh - day la neo danh tinh
  // duy nhat dang tin cay de mapping anh <-> item trong config.
  mediaImage: 'img[data-media-id]',
  // Nut "More options" cua tile - icon more_vert, co menu xo xuong
  tileMoreButton: 'button[aria-haspopup="menu"]',
};

/** Ten icon Material dung de nhan dien, khong bao gio bi dich. */
const ICONS = {
  modeImage: 'image',
  modeVideo: 'videocam',
  download: 'download',
};

const MODELS = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'];
const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];
const OUTPUT_COUNTS = [1, 2, 3, 4];
const RESOLUTIONS = [
  { value: '1K', label: '1K Original size' },
  { value: '2K', label: '2K Upscaled' },
  { value: '4K', label: '4K Upscaled' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** UUID trong response cua Flow - dung de lay media-id that cua lenh Generate. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/* ------------------------------------------------------------------ */
/* Ham chay trong trang - viet dang chuoi-thuan de de doc              */
/* ------------------------------------------------------------------ */

/**
 * Doc cac nhom toggle trong panel va tim dung (nhom, lua chon) can bam.
 * Chay trong page context.
 */
function resolveToggleInPage(root, args) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const readGroup = (g) => [...g.querySelectorAll('button[role="radio"]')].map((b) => {
    const iconEl = b.querySelector('mat-icon');
    const icon = norm(iconEl ? iconEl.textContent : '');
    const full = norm(b.innerText);
    const label = norm(full.startsWith(icon) ? full.slice(icon.length) : full);
    return { icon, label, checked: b.getAttribute('aria-checked') === 'true' };
  });

  const groups = [...root.querySelectorAll('flow-toggles')].map(readGroup);

  // Nhan dien nhom bang noi dung, khong bang aria-label (aria-label bi dich)
  let gi = -1;
  if (args.kind === 'mode') {
    gi = groups.findIndex((o) => o.some((x) => x.icon === args.iconImage)
      && o.some((x) => x.icon === args.iconVideo));
  } else if (args.kind === 'aspect') {
    gi = groups.findIndex((o) => o.length && o.every((x) => /^\d+:\d+$/.test(x.label)));
  } else if (args.kind === 'count') {
    gi = groups.findIndex((o) => o.length && o.every((x) => /^x[1-4]$/i.test(x.label)));
  }

  if (gi < 0) {
    return { error: `khong tim thay nhom "${args.kind}"`, seen: groups.map((o) => o.map((x) => x.label)) };
  }

  const opts = groups[gi];
  let oi = -1;
  if (args.kind === 'mode') {
    oi = opts.findIndex((x) => x.icon === (args.value === 'Video' ? args.iconVideo : args.iconImage));
  } else {
    oi = opts.findIndex((x) => x.label.toLowerCase() === String(args.value).toLowerCase());
  }

  if (oi < 0) {
    return { error: `khong co lua chon "${args.value}"`, seen: opts.map((x) => x.label) };
  }

  return { groupIndex: gi, optionIndex: oi, already: opts[oi].checked, label: opts[oi].label };
}

/** Tim mot muc trong menu theo ten icon, hoac theo tien to nhan. Chay trong page. */
function findMenuItemInPage(root, args) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const items = [...root.querySelectorAll('[role="menuitem"]')].map((b) => {
    const iconEl = b.querySelector('mat-icon');
    const icon = norm(iconEl ? iconEl.textContent : '');
    const full = norm(b.innerText);
    return {
      icon,
      label: norm(full.startsWith(icon) ? full.slice(icon.length) : full),
      hasSubmenu: b.getAttribute('aria-haspopup') === 'menu',
    };
  });

  let idx = -1;
  if (args.icon) idx = items.findIndex((x) => x.icon === args.icon);
  if (idx < 0 && args.textPrefix) {
    const want = args.textPrefix.toUpperCase();
    idx = items.findIndex((x) => x.label.toUpperCase().startsWith(want));
  }
  if (idx < 0 && args.submenuOnly) idx = items.findIndex((x) => x.hasSubmenu);

  return { index: idx, seen: items.map((x) => (x.icon ? `${x.icon}:${x.label}` : x.label)) };
}

/* ------------------------------------------------------------------ */

class FlowDriver {
  /**
   * @param {import('playwright-core').Page} page tab Flow nguoi dung dang mo
   * @param {(msg:string, level?:string)=>void} log
   */
  constructor(page, log = () => {}) {
    this.page = page;
    this.log = log;
  }

  /** Kiem tra tab van dang o trong mot project cua Flow va da tai xong. */
  async assertReady() {
    const url = this.page.url();
    if (!/flow\.google\.com/.test(url)) {
      throw new Error(`Tab da roi khoi Flow (hien tai: ${url})`);
    }
    if (!/\/project\//.test(url)) {
      throw new Error('Tab Flow chua o trong mot project nao.');
    }
    await this.page.waitForSelector(SELECTORS.promptBox, { timeout: 30000 });
    return url;
  }

  /* ---------------- Panel tham so ---------------- */

  async _openSettings() {
    const panel = this.page.locator(SELECTORS.settingsPanel);
    if (await panel.count()) return panel;

    // Overlay con sot lai tu lan chay truoc se chan cu click -> don truoc da.
    await this.closeOverlays();

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.page.locator(SELECTORS.settingsTrigger).click({ timeout: 8000 });
        await panel.waitFor({ state: 'visible', timeout: 8000 });
        return panel;
      } catch (err) {
        lastErr = err;
        await this.closeOverlays();
        await sleep(600);
      }
    }
    throw new Error(`Khong mo duoc panel tham so sau 3 lan thu: ${lastErr && lastErr.message}`);
  }

  async closeOverlays() {
    for (let i = 0; i < 4; i += 1) {
      const open = (await this.page.locator(SELECTORS.settingsPanel).count())
        + (await this.page.locator(SELECTORS.menuPanel).count());
      if (!open) return;
      await this.page.keyboard.press('Escape');
      await sleep(250);
    }
  }

  /**
   * Bam mot lua chon trong nhom toggle.
   * @param {'mode'|'aspect'|'count'} kind
   * @param {string} value 'Image'|'Video' | '16:9' | 'x2'
   * @returns {Promise<boolean>} true neu co thay doi
   */
  async _pickToggle(panel, kind, value) {
    const r = await panel.evaluate(resolveToggleInPage, {
      kind,
      value,
      iconImage: ICONS.modeImage,
      iconVideo: ICONS.modeVideo,
    });

    if (r.error) {
      throw new Error(`Panel tham so: ${r.error}. Trang dang co: ${JSON.stringify(r.seen)}`);
    }
    if (r.already) return false;

    await panel.locator(SELECTORS.toggleGroup).nth(r.groupIndex)
      .locator(SELECTORS.toggleOption).nth(r.optionIndex)
      .click();
    await sleep(450);
    return true;
  }

  /**
   * Dat toan bo tham so tao anh mot lan truoc khi chay lo.
   * Thu tu quan trong: doi Mode truoc, vi danh sach model / ti le / so anh
   * cua che do Image va Video khac han nhau.
   */
  async applySettings({ mode = 'Image', model, aspectRatio, count } = {}) {
    const panel = await this._openSettings();
    try {
      if (mode) {
        const changed = await this._pickToggle(panel, 'mode', mode);
        this.log(`Che do: ${mode}${changed ? ' (vua doi)' : ''}`);
        if (changed) await sleep(500); // cho panel dung lai theo che do moi
      }

      if (aspectRatio) {
        await this._pickToggle(panel, 'aspect', aspectRatio);
        this.log(`Ti le: ${aspectRatio}`);
      }

      if (count) {
        await this._pickToggle(panel, 'count', `x${count}`);
        this.log(`So anh moi prompt: x${count}`);
      }

      if (model) await this._setModel(panel, model);
    } finally {
      await this.closeOverlays();
    }
  }

  async _setModel(panel, model) {
    const trigger = panel.locator(SELECTORS.modelTrigger).first();
    if (!(await trigger.count())) throw new Error('Khong tim thay nut chon model trong panel tham so.');

    const current = ((await trigger.innerText()) || '').replace(/\s+/g, ' ');
    if (current.includes(model)) {
      this.log(`Model: ${model}`);
      return;
    }

    await trigger.click();
    const menu = this.page.locator(SELECTORS.menuPanel).last();
    await menu.waitFor({ state: 'visible', timeout: 6000 });

    const r = await menu.evaluate(findMenuItemInPage, { textPrefix: null, icon: null });
    const names = r.seen.map((s) => s.replace(/^[^\p{L}\p{N}]*/u, '').trim());
    const idx = names.findIndex((n) => n.toLowerCase() === model.toLowerCase());

    if (idx < 0) {
      await this.closeOverlays();
      throw new Error(
        `Khong co model "${model}" trong che do nay.\n` +
        `Model kha dung: ${names.join(' | ')}\n` +
        'Hay bam "↻ Doc model tu trang" tren giao dien roi chon lai.'
      );
    }

    await menu.locator(SELECTORS.menuItem).nth(idx).click();
    await sleep(500);
    this.log(`Model: ${model}`);
  }

  /** Doc danh sach model that cua che do hien tai (de do vao GUI). */
  async listModels({ mode = 'Image' } = {}) {
    const panel = await this._openSettings();
    try {
      if (mode) await this._pickToggle(panel, 'mode', mode);

      const trigger = panel.locator(SELECTORS.modelTrigger).first();
      await trigger.click();
      const menu = this.page.locator(SELECTORS.menuPanel).last();
      await menu.waitFor({ state: 'visible', timeout: 6000 });

      const r = await menu.evaluate(findMenuItemInPage, { textPrefix: null, icon: null });
      return r.seen
        .map((s) => s.replace(/^[^\p{L}\p{N}]*/u, '').trim())
        .filter(Boolean);
    } finally {
      await this.closeOverlays();
    }
  }

  /* ---------------- Nhap prompt + tao anh ---------------- */

  /**
   * Dat noi dung cho o prompt (ProseMirror).
   * Khong gan .value duoc vi day la contenteditable do ProseMirror quan ly;
   * dung execCommand de ProseMirror nhan dung transaction.
   */
  async setPrompt(text) {
    const input = this.page.locator(SELECTORS.promptInput).first();
    await input.waitFor({ state: 'visible', timeout: 15000 });

    const got = await input.evaluate((el, value) => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, value);
      return el.innerText.trim();
    }, text);

    if (!got.includes(text.slice(0, 24))) {
      throw new Error('Khong nhap duoc prompt vao o (noi dung khong khop).');
    }
    return got;
  }

  /**
   * Bam Generate.
   * Nut bi disabled ca khi prompt rong LAN khi dang tao, nen phai doi
   * no enable tro lai truoc khi bam.
   */
  async submit({ timeoutMs = 60000 } = {}) {
    const btn = this.page.locator(SELECTORS.generateButton).first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await btn.isEnabled()) break;
      await sleep(500);
    }
    if (!(await btn.isEnabled())) {
      throw new Error('Nut Generate van bi khoa (co the dang tao anh khac hoac het credit).');
    }

    await btn.click();
    this.log('Da bam Generate, dang cho anh...');
  }

  async countTiles() {
    return this.page.locator(SELECTORS.tile).count();
  }

  async isBusy() {
    return (await this.page.locator(SELECTORS.pendingTile).count()) > 0;
  }

  /**
   * Bat dau nghe cac response cua Flow de lay media-id that cua lenh Generate.
   *
   * Khi bam Generate, Flow goi /_/AiSandboxAngularFrontend/data/batchexecute
   * va response chua UUID cua dung nhung anh sap duoc tao. Day la neo danh
   * tinh chac chan nhat - khong the lam thay doi boi bat ky thu gi khac dang
   * xay ra tren trang.
   *
   * Goi TRUOC submit(), va truyen ket qua vao waitForNewMedia().
   */
  startMediaCapture() {
    const seen = new Set();
    const pending = [];

    const onResponse = (res) => {
      if (res.request().method() !== 'POST') return;
      if (!/batchexecute/.test(res.url())) return;
      pending.push(
        res.text()
          .then((body) => {
            for (const id of body.match(UUID_RE) || []) seen.add(id);
          })
          .catch(() => { /* response khong doc duoc thi bo qua */ }),
      );
    };

    this.page.on('response', onResponse);

    return {
      /** Doi cac response dang doc dang do roi tra ve tap UUID thu duoc. */
      settle: async () => {
        await Promise.allSettled(pending);
        return seen;
      },
      stop: () => this.page.off('response', onResponse),
    };
  }

  /**
   * Danh sach media-id cua moi anh DA TAO XONG, theo dung thu tu DOM
   * (moi nhat truoc). Tile dang tao chua co media-id nen khong lot vao day.
   */
  async mediaIds() {
    return this.page.$$eval(
      SELECTORS.mediaImage,
      (imgs) => imgs.map((im) => im.getAttribute('data-media-id')).filter(Boolean),
    );
  }

  /**
   * Quet TOAN BO media-id cua project, ke ca anh chua duoc render.
   *
   * Luoi anh cua Flow dung cdk-virtual-scroll-viewport: chi nhung tile trong
   * tam nhin moi ton tai trong DOM. Neu chi chup mediaIds() mot lan thi voi
   * project nhieu anh ta se BO SOT anh cu - va anh cu do co the tro lai DOM
   * giua chung, bi hieu nham la "anh moi".
   *
   * Vi vay truoc ca lo ta cuon het luoi mot lan de lay danh sach day du.
   * Chi ton mot lan cho ca batch.
   */
  async collectAllMediaIds({ maxMs = 45000 } = {}) {
    const seen = new Set(await this.mediaIds());
    const deadline = Date.now() + maxMs;

    const scroller = await this.page.evaluateHandle(() => {
      const vp = document.querySelector('cdk-virtual-scroll-viewport');
      if (vp && vp.scrollHeight > vp.clientHeight) return vp;
      const cand = [...document.querySelectorAll('*')]
        .filter((e) => e.scrollHeight > e.clientHeight + 100 && e.clientHeight > 200);
      return cand[0] || document.scrollingElement;
    });

    let stagnant = 0;
    while (Date.now() < deadline && stagnant < 3) {
      const moved = await scroller.evaluate((el) => {
        const before = el.scrollTop;
        el.scrollTop = Math.min(el.scrollTop + el.clientHeight * 0.8, el.scrollHeight);
        return el.scrollTop !== before;
      });

      await sleep(400);
      const sizeBefore = seen.size;
      for (const id of await this.mediaIds()) seen.add(id);

      stagnant = (!moved && seen.size === sizeBefore) ? stagnant + 1 : 0;
    }

    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await scroller.dispose();
    await sleep(400);

    return [...seen];
  }

  /**
   * Cho anh tao xong, roi tra ve CHINH XAC media-id cua nhung anh vua sinh ra.
   *
   * Khong dua vao vi tri hay phep dem tile nua: ta so sanh tap media-id truoc
   * va sau khi bam Generate. Anh nao co id moi thi dung la anh cua prompt vua
   * gui - bat ke trong luc do co tile nao khac chen vao hay luoi bi ao hoa.
   *
   * @param {{before: string[], expected: number, timeoutMs: number}} opts
   * @returns {Promise<string[]>} media-id moi, theo thu tu DOM (moi nhat truoc)
   */
  async waitForNewMedia({ before = [], expected = 1, timeoutMs = 180000, capture = null } = {}) {
    const known = new Set(before);
    const deadline = Date.now() + timeoutMs;
    let sawPending = false;

    while (Date.now() < deadline) {
      const busy = await this.isBusy();
      if (busy) sawPending = true;

      if (!busy) {
        // Tang 1: anh nao chua ton tai truoc khi bam Generate
        const fresh = (await this.mediaIds()).filter((id) => !known.has(id));

        if (fresh.length) {
          // Tang 2: chi nhan nhung anh ma CHINH response cua lenh Generate
          // xac nhan. Day la dieu kien BAT BUOC, khong phai bo loc tuy chon:
          // luoi anh bi ao hoa nen rieng phep hieu tren DOM khong du chac -
          // mot anh cu vua duoc render lai cung trong "moi".
          const confirmedIds = capture ? await capture.settle() : new Set();
          const picked = fresh.filter((id) => confirmedIds.has(id));

          if (picked.length === expected) {
            await sleep(500); // cho anh render xong han
            return picked;
          }

          if (picked.length > expected) {
            throw new Error(
              `Flow xac nhan ${picked.length} anh moi trong khi chi cho doi ${expected}.\n`
              + 'Co the co anh khac duoc tao trong cung tab luc tool dang chay.\n'
              + 'Dung tao anh thu cong trong tab ma tool dang dieu khien.'
            );
          }

          // Co anh moi tren luoi nhung KHONG anh nao duoc response xac nhan.
          // Tha bao loi con hon doan bua roi dat sai ten file.
          if (picked.length === 0 && confirmedIds.size === 0 && sawPending) {
            throw new Error(
              `Da thay ${fresh.length} anh moi nhung khong doc duoc media-id tu response `
              + 'cua Flow, nen khong the khang dinh anh nao la cua prompt nay.\n'
              + 'Tool dung lai de tranh dat sai ten file. '
              + 'Co the Flow da doi API - can cap nhat startMediaCapture() trong flow-driver.js.'
            );
          }
        }

        // Da tao xong (het pending) ma khong ra anh nao moi -> that bai
        if (sawPending && fresh.length === 0) {
          throw new Error('Flow khong tra ve anh nao (co the bi tu choi prompt hoac het credit).');
        }
      }

      await sleep(1000);
    }
    throw new Error(`Qua ${Math.round(timeoutMs / 1000)}s ma anh chua tao xong.`);
  }

  /* ---------------- Tai anh ---------------- */

  /**
   * Tai dung anh mang media-id da cho.
   * Day la duong tai chinh: khong phu thuoc vi tri tile trong luoi.
   */
  async downloadByMediaId(mediaId, opts = {}) {
    if (!/^[A-Za-z0-9-]+$/.test(mediaId)) throw new Error(`media-id khong hop le: ${mediaId}`);

    const tile = this.page
      .locator(`${SELECTORS.tile}:has(img[data-media-id="${mediaId}"])`)
      .first();

    if (!(await tile.count())) {
      throw new Error(
        `Khong con thay anh ${mediaId} tren luoi (co the da bi xoa hoac trang da tai lai).`
      );
    }
    return this._downloadFromTile(tile, opts);
  }

  /**
   * Tai tile thu `index` (0 = moi nhat). Chi dung khi khong co media-id.
   * @returns {Promise<{buffer: Buffer, ext: string, suggested: string}>}
   */
  async downloadTile(index = 0, opts = {}) {
    return this._downloadFromTile(this.page.locator(SELECTORS.tile).nth(index), opts);
  }

  async _downloadFromTile(tile, { resolution = '1K', timeoutMs = 120000 } = {}) {
    const res = RESOLUTIONS.find((r) => r.value === resolution) || RESOLUTIONS[0];
    await tile.waitFor({ state: 'visible', timeout: 15000 });
    await tile.scrollIntoViewIfNeeded();

    // Thanh nut cua tile (favorite / reuse / more) chi hien khi hover, va
    // trang thai hover khong song sot qua buoc click cua Playwright ->
    // click() that bai voi "element is not visible".
    // Ban su kien click thang vao nut thi khong bi rang buoc hien thi.
    // (Chi lam vay voi nut MO MENU; muc tai xuong trong menu van click that.)
    await tile.hover().catch(() => {});
    const more = tile.locator(SELECTORS.tileMoreButton).first();
    await more.waitFor({ state: 'attached', timeout: 10000 });
    await more.dispatchEvent('click');

    const menu = this.page.locator(SELECTORS.menuPanel).last();
    await menu.waitFor({ state: 'visible', timeout: 8000 });

    const dl = await menu.evaluate(findMenuItemInPage, { icon: ICONS.download, submenuOnly: true });
    if (dl.index < 0) {
      await this.closeOverlays();
      throw new Error(`Khong thay muc Download trong menu. Menu dang co: ${dl.seen.join(' | ')}`);
    }
    await menu.locator(SELECTORS.menuItem).nth(dl.index).click();

    const submenu = this.page.locator(SELECTORS.menuPanel).last();
    await submenu.waitFor({ state: 'visible', timeout: 8000 });

    // Nhan dang "1K Original size" / "2K Upscaled" - phan chu bi dich,
    // rieng tien to 1K/2K/4K thi khong.
    const pick = await submenu.evaluate(findMenuItemInPage, { textPrefix: res.value });
    if (pick.index < 0) {
      await this.closeOverlays();
      throw new Error(`Khong thay muc tai "${res.value}". Submenu dang co: ${pick.seen.join(' | ')}`);
    }

    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: timeoutMs }),
      submenu.locator(SELECTORS.menuItem).nth(pick.index).click(),
    ]);

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buffer = Buffer.concat(chunks);

    const suggested = download.suggestedFilename() || 'image.jpeg';
    let ext = (suggested.split('.').pop() || 'jpeg').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';

    await this.closeOverlays();

    if (!buffer.length) throw new Error('File tai ve rong (0 byte).');
    return { buffer, ext, suggested };
  }
}

module.exports = { FlowDriver, SELECTORS, ICONS, MODELS, ASPECT_RATIOS, OUTPUT_COUNTS, RESOLUTIONS };
