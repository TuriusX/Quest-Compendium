const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const html = `
    <html>
      <body style="margin: 0; padding: 0; background: transparent;">
        <svg id="svg" viewBox="0 0 32 32" width="64" height="64" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated;">
          <rect width="32" height="32" rx="8" fill="#2d2a45" />
          <rect x="9" y="8" width="16" height="18" fill="#0f0c1b" />
          <rect x="22" y="7" width="2" height="18" fill="#d6cda4" />
          <rect x="24" y="8" width="1" height="16" fill="#a49a71" />
          <rect x="9" y="7" width="13" height="18" fill="#16112c" />
          <rect x="10" y="7" width="2" height="18" fill="#1c1635" />
          <rect x="8" y="8" width="4" height="1" fill="#f4c535" />
          <rect x="11" y="9" width="1" height="1" fill="#f4c535" />
          <rect x="8" y="23" width="4" height="1" fill="#f4c535" />
          <rect x="11" y="22" width="1" height="1" fill="#f4c535" />
          <rect x="20" y="7" width="2" height="1" fill="#f4c535" />
          <rect x="21" y="8" width="1" height="2" fill="#f4c535" />
          <rect x="20" y="24" width="2" height="1" fill="#f4c535" />
          <rect x="21" y="22" width="1" height="2" fill="#f4c535" />
          <rect x="14" y="13" width="3" height="5" fill="#ab77fa" />
          <rect x="13" y="14" width="5" height="3" fill="#ab77fa" />
          <!-- Single pixel center -->
          <rect x="15" y="15" width="1" height="1" fill="#ffffff" />
        </svg>
        <script>
          const { ipcRenderer } = require('electron');
          const svg = document.getElementById('svg');
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext('2d');
          const img = new Image();
          const svgData = new XMLSerializer().serializeToString(svg);
          img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
          img.onload = () => {
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            ipcRenderer.send('icon-done', dataUrl);
          };
        </script>
      </body>
    </html>
  `;
  
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  
  ipcMain.on('icon-done', (e, dataUrl) => {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync('public/book.png', base64Data, 'base64');
    fs.writeFileSync('dist/book.png', base64Data, 'base64');
    console.log("Successfully rendered and saved book.png");
    app.quit();
  });
});
