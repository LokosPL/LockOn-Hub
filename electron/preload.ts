import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lockOn', {
  app: { getInfo: () => ipcRenderer.invoke('app:getInfo') },
  ui: {
    setScale: (scale: 'auto' | 'compact' | 'comfortable' | 'large') => ipcRenderer.invoke('ui:setScale', scale)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  auth: {
    getState: () => ipcRenderer.invoke('auth:getState'),
    loginGoogle: () => ipcRenderer.invoke('auth:loginGoogle'),
    loginLocal: () => ipcRenderer.invoke('auth:loginLocal'),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  access: {
    requestPoint: (payload: unknown) => ipcRenderer.invoke('access:requestPoint', payload)
  },
  admin: {
    getOverview: () => ipcRenderer.invoke('admin:getOverview'),
    createPoint: (payload: unknown) => ipcRenderer.invoke('admin:createPoint', payload),
    approveUser: (userId: string, payload: unknown) => ipcRenderer.invoke('admin:approveUser', userId, payload),
    rejectUser: (userId: string) => ipcRenderer.invoke('admin:rejectUser', userId),
    updateUserAccess: (userId: string, payload: unknown) => ipcRenderer.invoke('admin:updateUserAccess', userId, payload)
  },
  finance: {
    list: () => ipcRenderer.invoke('finance:list'),
    submit: (payload: unknown) => ipcRenderer.invoke('finance:submit', payload),
    review: (revenueId: string, action: 'APPROVE' | 'REJECT') => ipcRenderer.invoke('finance:review', revenueId, action)
  },
  data: {
    getDashboard: () => ipcRenderer.invoke('data:getDashboard')
  },
  service: {
    searchCustomers: (query: string) => ipcRenderer.invoke('service:searchCustomers', query),
    createOrder: (payload: unknown) => ipcRenderer.invoke('service:createOrder', payload)
  },
  browser: {
    getState: () => ipcRenderer.invoke('browser:getState'),
    setVisible: (visible: boolean) => ipcRenderer.invoke('browser:setVisible', visible),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('browser:setBounds', bounds),
    navigate: (input: string) => ipcRenderer.invoke('browser:navigate', input),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    home: () => ipcRenderer.invoke('browser:home'),
    openExternal: () => ipcRenderer.invoke('browser:openExternal'),
    onState: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('browser:state', listener);
      return () => ipcRenderer.removeListener('browser:state', listener);
    }
  },
  updater: {
    getState: () => ipcRenderer.invoke('update:getState'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    }
  },
  splash: {
    onProgress: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on('splash:progress', listener);
      return () => ipcRenderer.removeListener('splash:progress', listener);
    }
  }
});
