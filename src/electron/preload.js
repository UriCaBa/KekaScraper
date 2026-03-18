import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kekaApp', {
  getDefaults: () => ipcRenderer.invoke('app:get-defaults'),
  startScrape: (payload) => ipcRenderer.invoke('scrape:start', payload),
  openOutputFolder: (folderPath) => ipcRenderer.invoke('scrape:open-output-folder', folderPath),
  openOutputFile: (filePath) => ipcRenderer.invoke('scrape:open-output-file', filePath),
  onScrapeEvent: (handler) => {
    const listener = (_, event) => handler(event);
    ipcRenderer.on('scrape:event', listener);
    return () => ipcRenderer.removeListener('scrape:event', listener);
  },
});
