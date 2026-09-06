const { app, desktopCapturer, screen } = require('electron');
app.whenReady().then(async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  console.log('SOURCES:', sources.map(s => ({ id: s.id, display_id: s.display_id, name: s.name })));
  
  const activeDisplay = screen.getPrimaryDisplay();
  console.log('DISPLAYS:', screen.getAllDisplays().map(d => ({ id: d.id })));
  
  app.quit();
});
