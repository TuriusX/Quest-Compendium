function sanitizeTabsForCloud(tabs) {
  return tabs.map(tab => {
    const sanitizedTab = { ...tab };
    if (sanitizedTab.messages) {
      sanitizedTab.messages = sanitizedTab.messages.map(msg => {
        const newMsg = { ...msg };
        if (newMsg.audioBase64) delete newMsg.audioBase64;
        if (newMsg.imageUrl && newMsg.imageUrl.length > 2000) delete newMsg.imageUrl;
        return newMsg;
      });
    }
    if (sanitizedTab.activeSteamGame) {
       const safeGame = { ...sanitizedTab.activeSteamGame };
       if (safeGame.achievements) delete safeGame.achievements;
       if (safeGame.patchNotes) delete safeGame.patchNotes;
       sanitizedTab.activeSteamGame = safeGame;
    }
    return sanitizedTab;
  });
}
console.log("Syntax is fine");
