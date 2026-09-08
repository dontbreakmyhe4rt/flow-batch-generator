'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const { FlowDriver } = require('./flow-driver');
const launcher = require('./chrome-launcher');
const store = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ghi buffer ra dia, xu ly truong hop trung ten.
 * onDuplicate: 'suffix' (them _2, _3...) | 'overwrite' | 'skip'
 */
function writeImage(outDir, fileName, ext, buffer, onDuplicate) {
  fs.mkdirSync(outDir, { recursive: true });
  let target = path.join(outDir, `${fileName}.${ext}`);

  if (fs.existsSync(target)) {
    if (onDuplicate === 'overwrite') {
      // ghi de
    } else if (onDuplicate === 'skip') {
      return { file: target, skipped: true };
    } else {
      let n = 2;
      while (fs.existsSync(path.join(outDir, `${fileName}_${n}.${ext}`))) n += 1;
      target = path.join(outDir, `${fileName}_${n}.${ext}`);
    }
  }

  fs.writeFileSync(target, buffer);
  return { file: target, skipped: false };
}

/**
 * Dieu phoi ca lo. Phat su kien cho GUI:
 *   log     {message, level}
 *   item    {id, index, status, file?, error?, attempt?}
 *   progress{done, failed, total}
 *   done    {done, failed, total, stopped}
 *   error   {message}
 */
class Runner extends EventEmitter {
  constructor() {
    super();
    this.stopping = false;
    this.paused = false;
    this.running = false;
    this.browser = null;

    // EventEmitter NEM ra ngoai neu emit('error') ma khong ai nghe. Loi cua
    // Flow deu da duoc bao qua su kien 'log' roi, nen giu mot listener rong
    // de mot noi goi quen dang ky 'error' khong lam sap ca tien trinh.
    this.on('error', () => {});
  }

  log(message, level = 'info') {
    this.emit('log', { message, level, at: new Date().toISOString() });
  }

  stop() {
    if (!this.running) return;
    this.stopping = true;
    this.log('Da yeu cau dung, se dung sau khi xong item hien tai.', 'warn');
  }

  setPaused(v) {
    this.paused = !!v;
    this.log(this.paused ? 'Tam dung.' : 'Tiep tuc.', 'warn');
  }

  async _waitWhilePaused() {
    while (this.paused && !this.stopping) await sleep(300);
  }

  /**
   * @param {object} opts
   * @param {string} opts.configPath
   * @param {string} opts.outDir
   * @param {string} opts.profileDir
   * @param {'resume'|'all'|'failed'} opts.mode
   * @param {number} opts.delayMs
   * @param {number} opts.timeoutMs
   * @param {number} opts.retries
   * @param {string} opts.onDuplicate
   */
  async run(opts) {
    if (this.running) throw new Error('Dang chay roi.');
    this.running = true;
    this.stopping = false;
    this.paused = false;

    let stopped = false;
    let done = 0;
    let failed = 0;

    try {
      const allItems = store.loadConfig(opts.configPath);
      const state = store.loadState(opts.outDir);
      state.configPath = opts.configPath;

      // Doi chieu voi file THAT tren dia: da co file thi khong tao lai
      const existing = store.scanExisting(opts.outDir);
      const mode = opts.mode || 'resume';
      const items = store.selectItems(allItems, state, mode, existing);
      const total = items.length;

      const skipped = allItems.filter((it) => store.alreadyOnDisk(it, existing)).length;
      this.log(`Config: ${allItems.length} item, se chay ${total} item (che do: ${mode}).`);
      if (skipped && mode !== 'all') {
        this.log(`${skipped} item da co file san trong thu muc luu -> bo qua.`, 'warn');
      }
      if (total === 0) {
        this.emit('done', { done: 0, failed: 0, total: 0, stopped: false });
        return;
      }

      // 1. Chrome + ket noi
      // Neu nguoi dung da chon san mot tab thi bam dung tab do (theo targetId,
      // ben vung ke ca khi ho vua dieu huong tab sang trang khac).
      // Khong chon thi tu do tab Flow nhu truoc.
      const port = opts.port || launcher.DEFAULT_PORT;
      if (!(await launcher.isPortOpen(port))) {
        await launcher.launchChrome({
          profileDir: opts.profileDir,
          port,
          startUrl: 'https://flow.google.com/',
          log: (m) => this.log(m),
        });
      }
      // Dung chung mot ket noi CDP cho moi viec tren cung mot Chrome
      this.port = port;
      this.browser = await launcher.acquire(port);

      const page = opts.targetId
        ? await launcher.findPageByTargetId(this.browser, opts.targetId)
        : await launcher.findFlowPage(this.browser);

      if (opts.targetId) this.log('Dung tab ban da chon.');
      await page.bringToFront().catch(() => {});
      const driver = new FlowDriver(page, (m, l) => this.log(m, l));

      await driver.assertReady();
      this.log(`Lam viec tren tab: ${page.url()}`);

      // 2. Dat tham so tren trang mot lan cho ca lo
      const count = Math.min(4, Math.max(1, Number(opts.count) || 1));
      await driver.applySettings({
        mode: 'Image',
        model: opts.model || undefined,
        aspectRatio: opts.aspectRatio || undefined,
        count,
      });

      // 3. Quet toan bo anh dang co trong project mot lan.
      // Luoi bi ao hoa nen phai cuon het moi thay du - lam mot lan cho ca lo,
      // sau do moi item chi can them media-id vua sinh ra vao danh sach nay.
      this.log('Dang quet danh sach anh co san trong project...');
      const baseline = new Set(await driver.collectAllMediaIds());
      this.log(`Project dang co ${baseline.size} anh.`);

      // 4. Vong lap
      for (const item of items) {
        await this._waitWhilePaused();
        if (this.stopping) { stopped = true; break; }

        this.emit('item', { id: item.id, index: item.index, status: 'running' });
        this.log(`[${item.file_name}] ${item.prompt.slice(0, 80)}${item.prompt.length > 80 ? '...' : ''}`);

        const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1);
        let lastErr = null;
        let ok = false;

        // Hai giai doan tach roi nhau, va CHUNG TIEN DO GIUA CAC LAN THU:
        //   mediaIds = media-id cua dung nhung anh prompt nay sinh ra
        //   files    = cac anh da tai ve dia
        // Nho vay khi tai that bai, lan thu lai chi tai lai - khong tao anh
        // moi (vua ton credit, vua sinh anh rac trong project).
        let mediaIds = null;
        const files = [];

        for (let attempt = 1; attempt <= maxAttempts && !this.stopping; attempt += 1) {
          try {
            await driver.assertReady();

            if (!mediaIds) {
              // Hai tin hieu doc lap de xac dinh dung anh cua prompt nay:
              //   before  - tap anh da ton tai TRUOC khi bam Generate
              //   capture - media-id that lay tu response cua chinh lenh Generate
              for (const id of await driver.mediaIds()) baseline.add(id);
              await driver.setPrompt(item.prompt);

              const capture = driver.startMediaCapture();
              try {
                await driver.submit();
                mediaIds = await driver.waitForNewMedia({
                  before: [...baseline],
                  capture,
                  expected: count,
                  timeoutMs: opts.timeoutMs ?? 180000,
                });
              } finally {
                capture.stop();
              }
              for (const id of mediaIds) baseline.add(id);

              this.log(`[${item.file_name}] Flow da tao xong (${mediaIds.join(', ')}), dang tai ve...`);
            } else {
              this.log(`[${item.file_name}] anh da co san tren Flow, chi tai lai.`, 'warn');
            }

            // Tai theo media-id, khong theo vi tri tile.
            // Bat dau tu files.length de khong tai lai anh da luu thanh cong.
            for (let k = files.length; k < mediaIds.length; k += 1) {
              const { buffer, ext } = await driver.downloadByMediaId(mediaIds[k], {
                resolution: opts.resolution || '1K',
              });
              const base = k === 0 ? item.file_name : `${item.file_name}_${k + 1}`;
              const { file, skipped } = writeImage(
                opts.outDir, base, ext, buffer, opts.onDuplicate || 'suffix'
              );
              files.push(file);
              this.log(skipped
                ? `[${base}] da co san, bo qua ghi de -> ${file}`
                : `[${base}] xong -> ${file}`, 'success');
            }

            store.markItem(opts.outDir, state, item.id, {
              status: 'done', file: files[0], files, mediaIds, error: null, attempts: attempt, prompt: item.prompt,
            });
            this.emit('item', { id: item.id, index: item.index, status: 'done', file: files[0] });
            ok = true;
            break;
          } catch (err) {
            lastErr = err;
            this.log(`[${item.file_name}] lan ${attempt}/${maxAttempts} loi: ${err.message}`, 'error');
            if (attempt < maxAttempts && !this.stopping) {
              this.emit('item', { id: item.id, index: item.index, status: 'retry', attempt, error: err.message });
              await sleep(2000);
            }
          }
        }

        if (!ok) {
          failed += 1;
          const message = lastErr ? lastErr.message : 'khong ro nguyen nhan';
          // Ghi ro da tao duoc anh hay chua, de lan retry sau biet duong
          // (anh van con tren Flow, chi con thieu buoc tai ve).
          store.markItem(opts.outDir, state, item.id, {
            status: 'failed',
            error: message,
            attempts: maxAttempts,
            prompt: item.prompt,
            mediaIds: mediaIds || undefined,
            files: files.length ? files : undefined,
          });
          if (mediaIds) {
            this.log(
              `[${item.file_name}] anh DA duoc tao tren Flow (${mediaIds.join(', ')}) `
              + 'nhung tai ve that bai.', 'warn'
            );
          }
          this.emit('item', { id: item.id, index: item.index, status: 'failed', error: message });
        } else {
          done += 1;
        }

        this.emit('progress', { done, failed, total });

        if (this.stopping) { stopped = true; break; }
        if (opts.delayMs) await sleep(opts.delayMs);
      }

      this.log(`Ket thuc: ${done} thanh cong, ${failed} loi${stopped ? ' (da dung giua chung)' : ''}.`,
        failed ? 'warn' : 'success');
      if (failed) this.log('Bam "Chay lai item loi" de thu lai nhung item that bai.', 'warn');

      this.emit('done', { done, failed, total, stopped });
    } catch (err) {
      this.log(err.message, 'error');
      this.emit('error', { message: err.message });
      this.emit('done', { done, failed, total: 0, stopped: true });
    } finally {
      // Tra lai ket noi CDP (chi that su ngat khi khong con viec nao dung).
      // Khong bao gio dong Chrome cua nguoi dung.
      if (this.browser) {
        await launcher.release(this.port).catch(() => {});
        this.browser = null;
      }
      this.running = false;
      this.stopping = false;
      this.paused = false;
    }
  }
}

module.exports = { Runner, writeImage };
