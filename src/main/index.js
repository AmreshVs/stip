const { app } = require('electron');

// Stip lives in the tray, so make sure only one copy runs.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
});

// Keep running in the tray when windows close.
app.on('window-all-closed', () => {});
