const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oricalApp', {
  getDefaults: () => ipcRenderer.invoke('app:get-defaults'),
  startScrape: (payload) => ipcRenderer.invoke('scrape:start', payload),
  openOutputFolder: () => ipcRenderer.invoke('scrape:open-output-folder'),
  openOutputFile: (filePath) => ipcRenderer.invoke('scrape:open-output-file', filePath),
  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external-url', url),
  loadResultsFile: () => ipcRenderer.invoke('app:load-results-file'),
  loadAllResults: () => ipcRenderer.invoke('app:load-all-results'),
  pickOutputFolder: () => ipcRenderer.invoke('app:pick-output-folder'),
  onScrapeEvent: (handler) => {
    const listener = (_, event) => handler(event);
    ipcRenderer.on('scrape:event', listener);
    return () => ipcRenderer.removeListener('scrape:event', listener);
  },
});
