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

const data = { tabs: [{ id: "1", messages: [{ text: "hi" }] }] };
const cloudTabsStr = JSON.stringify(data.tabs || []);
console.log("cloudTabsStr:", cloudTabsStr);

const currentTabsStr = JSON.stringify(sanitizeTabsForCloud(data.tabs));
console.log("currentTabsStr:", currentTabsStr);

console.log("Equal?", cloudTabsStr === currentTabsStr);
