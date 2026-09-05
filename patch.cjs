const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /\/\/ Fetch real Steam achievements if steamId is set[\s\S]*?\}, \[activeGame\?\.appId, settings\.steamId, activeTabId\]\);/;

const replacement = `  // Fetch Steam achievements and patch notes
  useEffect(() => {
    if (!activeGame || !activeTab) return;
    let isMounted = true;
    const fetchData = async () => {
      try {
        const fetchPromises = [];
        let achIndex = -1;
        let newsIndex = -1;
        
        if (settings.steamId) {
          achIndex = fetchPromises.length;
          fetchPromises.push(fetch(\`\${getApiBaseUrl()}/api/steam/achievements/\${activeGame.appId}?steamId=\${encodeURIComponent(settings.steamId)}\`));
        }
        
        newsIndex = fetchPromises.length;
        fetchPromises.push(fetch(\`\${getApiBaseUrl()}/api/steam/news/\${activeGame.appId}\`));
        
        const results = await Promise.all(fetchPromises);
        
        if (isMounted) {
          let achievements = activeGame.achievements || [];
          if (achIndex !== -1 && results[achIndex].ok) {
            const data = await results[achIndex].json();
            achievements = data.achievements || [];
          }
          
          let patchNotes = activeGame.patchNotes || [];
          if (newsIndex !== -1 && results[newsIndex].ok) {
            const newsData = await results[newsIndex].json();
            patchNotes = newsData.news?.map((n: any) => n.contents) || [];
          }
          
          if (activeGame.isAutoDetected) {
            setGlobalActiveGame(prev => prev && prev.appId === activeGame.appId ? { ...prev, achievements, patchNotes } as SteamGameData : prev);
          } else {
            setTabs(prev => prev.map(t => {
              if (t.id === activeTab.id) {
                return {
                  ...t,
                  activeSteamGame: {
                    ...(t.activeSteamGame?.appId === activeGame.appId ? t.activeSteamGame : {
                      name: activeGame.name,
                      appId: activeGame.appId
                    }),
                    ...(activeGame.headerImage ? { headerImage: activeGame.headerImage } : {}),
                    achievements,
                    patchNotes
                  }
                };
              }
              return t;
            }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch Steam data:', err);
      }
    };
    fetchData();
    return () => { isMounted = false; };
  }, [activeGame?.appId, settings.steamId, activeTab?.id]);`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/App.tsx', code);
