const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Installed from the Microsoft Store: updates come from the Store, not the app's own check.
  isStoreBuild: (() => { try { return ipcRenderer.sendSync('is-store-build') === true; } catch { return false; } })(),
  // The installed version, and updates (electron/updater.cjs): "Version X is ready" and Restart to update.
  appVersion: (() => { try { return String(ipcRenderer.sendSync('get-app-version') || ''); } catch { return ''; } })(),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  onAppUpdate: (callback) => { ipcRenderer.removeAllListeners('app-update'); ipcRenderer.on('app-update', (event, s) => callback(s)); },
  installUpdate: () => ipcRenderer.send('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getActiveGame: () => ipcRenderer.invoke('get-active-game'),
  fetchAchievementsLocally: (appId, steamId) => ipcRenderer.invoke('fetch-achievements-locally', appId, steamId),
  fetchSteamProfileLocally: (steamId) => ipcRenderer.invoke('fetch-steam-profile-locally', steamId),
  fetchNewsLocally: (appId) => ipcRenderer.invoke('fetch-news-locally', appId),
  startDesktopLogin: () => ipcRenderer.send('start-desktop-login'),
  // Premium checkout and "Manage or cancel" (Stripe), and our own pages: in the system browser, not the overlay.
  openExternal: (url) => ipcRenderer.send('open-external', url),
  startSteamLogin: () => ipcRenderer.send('start-steam-login'),
  setUiScale: (scale) => ipcRenderer.send('set-ui-scale', scale),
  resizeWindow: (width) => ipcRenderer.send('resize-window', width),
  setDockPosition: (pos) => ipcRenderer.send('set-dock-position', pos),
  toggleSlide: () => ipcRenderer.send('toggle-slide'),
  // Hold to talk: after sending, the panel slides away and the answer is read aloud.
  hidePanel: () => ipcRenderer.send('hide-panel'),
  showPanel: () => ipcRenderer.send('show-panel'),
  // The hidden panel's spine: the theme's accent and its label (electron/spine.cjs).
  setLook: (look) => ipcRenderer.send('set-look', look),
  // The right-click menu's words (spelling suggestions, Cut, Copy, Paste) in the app's language.
  setEditLabels: (labels) => ipcRenderer.send('set-edit-labels', labels),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  // "Next turn" and "Locate me": a fresh screenshot of the game now (an open panel slides away for it), never the snapshot on open.
  captureFresh: () => ipcRenderer.invoke('capture-fresh'),
  // An automatic Locate me's quiet screenshot ({ image } or null: not now).
  locateCapture: () => ipcRenderer.invoke('locate-capture'),
  onGameInView: (callback) => { ipcRenderer.removeAllListeners('game-in-view'); ipcRenderer.on('game-in-view', (event, e) => callback(e)); },
  // Pin a video or picture beside the game (electron/pin.cjs): { kind: 'video', videoId, start, title } or { kind: 'picture', url, alt }.
  pinVisual: (item) => ipcRenderer.invoke('pin-visual', item),
  onLocateKey: (callback) => { ipcRenderer.removeAllListeners('locate-key'); ipcRenderer.on('locate-key', () => callback()); },
  closeApp: () => ipcRenderer.send('close-app'),
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  closeSettingsWindow: () => ipcRenderer.send('close-settings-window'),
  forceFocus: () => ipcRenderer.send('force-focus'),
  updateShortcuts: (shortcuts) => ipcRenderer.send('update-shortcuts', shortcuts),
  // The "free your mouse" tips' state (settings.mouseTips): the quest log and the book spine show their hint from it.
  setMouseTips: (tips) => ipcRenderer.send('set-mouse-tips', tips),
  onDesktopAuthSuccess: (callback) => ipcRenderer.on('desktop-auth-success', (event, token) => callback(token)),
  onDesktopSteamSuccess: (callback) => ipcRenderer.on('desktop-steam-success', (event, steamId) => callback(steamId)),
  onActiveGameDetected: (callback) => ipcRenderer.on('active-game-detected', (event, gameData) => callback(gameData)),
  // Detection beyond Steam (games-not-tabs; off until the app's flag turns it on): a game from a launcher, an emulator
  // or the screen-filling program, as electron/gameDetect.cjs describes it (null when it closes).
  setDetectBeyondSteam: (on) => ipcRenderer.send('set-detect-beyond-steam', !!on),
  getProgramGame: () => ipcRenderer.invoke('get-program-game'),
  onProgramDetected: (callback) => ipcRenderer.on('program-detected', (event, game) => callback(game)),
  onTriggerVoiceInputStart: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input-start'); ipcRenderer.on('trigger-voice-input-start', () => callback()); },
  onTriggerVoiceInputStop: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input-stop'); ipcRenderer.on('trigger-voice-input-stop', () => callback()); },
  onTriggerVoiceInput: (callback) => { ipcRenderer.removeAllListeners('trigger-voice-input'); ipcRenderer.on('trigger-voice-input', () => callback()); },
  onTriggerAutoScreenshot: (callback) => { ipcRenderer.removeAllListeners('trigger-auto-screenshot'); ipcRenderer.on('trigger-auto-screenshot', () => callback()); },
  // The owner's picture capture (Ctrl+Shift+P, admins only): the app says what the picture likely shows, and hears when
  // it was saved to the review queue.
  onOwnerCaptureContextRequest: (callback) => {
    ipcRenderer.removeAllListeners('owner-capture-context-request');
    ipcRenderer.on('owner-capture-context-request', async () => {
      let ctx = null;
      try { ctx = await callback(); } catch (_) { ctx = null; }
      ipcRenderer.send('owner-capture-context', ctx);
    });
  },
  onOwnerCaptureSaved: (callback) => { ipcRenderer.removeAllListeners('owner-capture-saved'); ipcRenderer.on('owner-capture-saved', () => callback()); },
  // Controller support (see electron/controller.cjs)
  setOverlayOptions: (opts) => ipcRenderer.send('set-overlay-options', opts),
  // On-screen pointers (markers drawn over the game)
  showScreenPointers: (points, accent, opts) => ipcRenderer.invoke('show-screen-pointers', { points, accent, opts }),
  hideScreenPointers: () => ipcRenderer.send('hide-screen-pointers'),
  // Markers v2: a fresh picture of the game's screen when the answer arrives (null if it can't be taken).
  captureScreenNow: () => ipcRenderer.invoke('capture-screen-now'),
  // The quick menu over the game (wheel.cjs): its labels, what was picked there, and "an answer arrived".
  setQuickMenu: (items, strings) => ipcRenderer.send('quick-menu-items', { items, strings }),
  onQuickAction: (callback) => { ipcRenderer.removeAllListeners('quick-action'); ipcRenderer.on('quick-action', (event, key) => callback(String(key || ''))); },
  answerArrived: (a) => ipcRenderer.send('answer-arrived', a && typeof a === 'object' ? { id: String(a.id || ''), question: String(a.question || ''), title: String(a.title || ''), text: String(a.text || '') } : null),
  // The Guides tab's browser (guideBrowser.cjs): web tabs laid over the panel's page area.
  guideBrowser: {
    open: (url, background) => ipcRenderer.invoke('gb:open', { url: String(url || ''), background: !!background }),
    close: (id) => ipcRenderer.send('gb:close', String(id)),
    select: (id) => ipcRenderer.send('gb:select', String(id)),
    navigate: (id, url) => ipcRenderer.send('gb:navigate', { id: String(id), url: String(url || '') }),
    action: (id, action, arg) => ipcRenderer.send('gb:action', { id: String(id), action: String(action), arg }),
    move: (id, to) => ipcRenderer.send('gb:move', { id: String(id), to: Number(to) || 0 }),
    layout: (visible, rect) => ipcRenderer.send('gb:layout', { visible: !!visible, rect: rect || null }),
    restore: (tabs, active) => ipcRenderer.send('gb:restore', { tabs, active }),
    snapshot: () => ipcRenderer.invoke('gb:snapshot'),
    external: (url) => ipcRenderer.send('gb:external', String(url || '')),
    state: () => ipcRenderer.invoke('gb:state'),
    onState: (cb) => { ipcRenderer.removeAllListeners('gb:state'); ipcRenderer.on('gb:state', (e, s) => cb(s)); },
    onKey: (cb) => { ipcRenderer.removeAllListeners('gb:key'); ipcRenderer.on('gb:key', (e, k) => cb(k || {})); },
    onFound: (cb) => { ipcRenderer.removeAllListeners('gb:found'); ipcRenderer.on('gb:found', (e, f) => cb(f || {})); },
    onDownload: (cb) => { ipcRenderer.removeAllListeners('gb:download'); ipcRenderer.on('gb:download', (e, d) => cb(d || {})); },
  },
  // Find the markers again: asked by the marker page (auto) or the shortcut key.
  onRefindRequest: (callback) => { ipcRenderer.removeAllListeners('refind-request'); ipcRenderer.on('refind-request', (event, r) => callback(r || {})); },
  // The objectives tracker drawn over the game (electron/tracker.cjs).
  showObjectivesTracker: (data, gameKey) => ipcRenderer.invoke('tracker-show', { data, gameKey }),
  updateObjectivesTracker: (patch, gameKey) => ipcRenderer.send('tracker-update', { data: patch, gameKey }),
  hideObjectivesTracker: () => ipcRenderer.send('tracker-hide'),
  // The panel header's "Quest log" toggle (shown if away or never shown, else sent away), and showing it for an answer.
  toggleQuestLog: (data, gameKey) => ipcRenderer.invoke('tracker-toggle', { data, gameKey }),
  showQuestLog: (data, gameKey) => ipcRenderer.invoke('tracker-show-log', { data, gameKey }),
  peekObjectivesTracker: () => ipcRenderer.send('tracker-peek'),
  // The controller in the attached quest log: 'focus' / 'blur', 'next' / 'prev' (the highlight), 'tick'.
  trackerKey: (action) => ipcRenderer.invoke('tracker-key', action),
  // The quest log (owner, Oct 30 2026): a heads-up over the game after a tick, and docking / popping out the log.
  trackerHeads: (text) => ipcRenderer.invoke('tracker-heads', text),
  trackerAttach: (on) => ipcRenderer.invoke('tracker-attach', !!on),
  // The panel was hidden (any route): the app shows the objectives tracker for the latest answer.
  onPanelHidden: (callback) => { ipcRenderer.removeAllListeners('panel-hidden'); ipcRenderer.on('panel-hidden', () => callback()); },
  onTrackerEvent: (callback) => { ipcRenderer.removeAllListeners('tracker-event'); ipcRenderer.on('tracker-event', (event, p) => callback(p)); },
  setPointersHidden: (id, hidden) => ipcRenderer.send('pointers-hidden', { id, hidden }),
  highlightPointer: (id, index) => ipcRenderer.send('pointers-highlight', { id, index }),
  addPointers: (id, points, refImage, startIndex) => ipcRenderer.send('pointers-add', { id, points, refImage, startIndex }),
  locateDone: (id, remaining) => ipcRenderer.send('pointers-locate-done', { id, remaining }),
  movePointers: (id, moves) => ipcRenderer.send('pointers-move', { id, moves }),
  settlePointers: (id, moves, removed) => ipcRenderer.send('pointers-settle', { id, moves, removed }),
  markerLog: (message) => ipcRenderer.send('pointers-log', message),
  onPointersState: (callback) => { ipcRenderer.removeAllListeners('pointers-state'); ipcRenderer.on('pointers-state', (event, s) => callback(s)); },
  onLocateRequest: (callback) => { ipcRenderer.removeAllListeners('locate-request'); ipcRenderer.on('locate-request', (event, r) => callback(r)); },
  setControllerConfig: (cfg) => ipcRenderer.send('set-controller-config', cfg),
  getControllerStatus: () => ipcRenderer.invoke('get-controller-status'),
  onControllerInput: (callback) => { ipcRenderer.removeAllListeners('controller-input'); ipcRenderer.on('controller-input', (event, evt) => callback(evt)); },
  onControllerActivated: (callback) => { ipcRenderer.removeAllListeners('controller-activated'); ipcRenderer.on('controller-activated', () => callback()); }
});
