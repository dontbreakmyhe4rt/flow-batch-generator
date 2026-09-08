'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Cau noi an toan: renderer chi thay dung nhung ham duoi day. */
contextBridge.exposeInMainWorld('api', {
  pickConfig: () => ipcRenderer.invoke('dialog:pickConfig'),
  pickOutDir: () => ipcRenderer.invoke('dialog:pickOutDir'),

  // Trinh duyet - dung chung cho moi viec
  browserState: () => ipcRenderer.invoke('browser:state'),
  launchBrowser: (profileId) => ipcRenderer.invoke('browser:launch', profileId),
  focusTab: (port, targetId) => ipcRenderer.invoke('browser:focus', { port, targetId }),
  addProfile: (name) => ipcRenderer.invoke('profiles:add', name),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', { id, name }),
  removeProfile: (id, removeData) => ipcRenderer.invoke('profiles:remove', { id, removeData }),

  // Viec
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  addJob: (patch) => ipcRenderer.invoke('jobs:add', patch),
  updateJob: (id, patch) => ipcRenderer.invoke('jobs:update', { id, patch }),
  removeJob: (id) => ipcRenderer.invoke('jobs:remove', id),
  resetJob: (id) => ipcRenderer.invoke('jobs:reset', id),
  clearAllJobs: () => ipcRenderer.invoke('jobs:clearAll'),
  previewJob: (id) => ipcRenderer.invoke('jobs:preview', id),

  getOptions: () => ipcRenderer.invoke('meta:options'),
  readModels: (port, targetId) => ipcRenderer.invoke('flow:models', { port, targetId }),

  // Chay
  start: (jobId, mode) => ipcRenderer.invoke('run:start', { jobId, mode }),
  stop: (jobId) => ipcRenderer.invoke('run:stop', jobId),
  pause: (jobId, paused) => ipcRenderer.invoke('run:pause', { jobId, paused }),
  statuses: () => ipcRenderer.invoke('run:statuses'),

  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  /** Moi su kien deu kem jobId de renderer biet no thuoc viec nao. */
  on: (event, cb) => {
    const allowed = ['log', 'item', 'progress', 'done', 'error'];
    if (!allowed.includes(event)) throw new Error(`Su kien khong hop le: ${event}`);
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(`runner:${event}`, handler);
    return () => ipcRenderer.removeListener(`runner:${event}`, handler);
  },
});
