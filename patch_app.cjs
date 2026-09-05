const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /const fetchData = async \(\) => \{\n\s*try \{\n\s*const fetchPromises = \[\];\n\s*let achIndex = -1;\n\s*let newsIndex = -1;\n\s*if \(settings\.steamId\) \{\n\s*achIndex = fetchPromises\.length;\n\s*fetchPromises\.push\(fetch\(\`\$\{getApiBaseUrl\(\)\}\/api\/steam\/achievements\/\$\{activeGame\.appId\}\?steamId=\$\{encodeURIComponent\(settings\.steamId\)\}\`\)\);\n\s*\}\n\s*newsIndex = fetchPromises\.length;\n\s*fetchPromises\.push\(fetch\(\`\$\{getApiBaseUrl\(\)\}\/api\/steam\/news\/\$\{activeGame\.appId\}\`\)\);\n\s*const results = await Promise\.all\(fetchPromises\);\n\s*if \(isMounted\) \{\n\s*let achievements = activeGame\.achievements \|\| \[\];\n\s*if \(achIndex !== -1 && results\[achIndex\]\.ok\) \{\n\s*const data = await results\[achIndex\]\.json\(\);\n\s*achievements = data\.achievements \|\| \[\];\n\s*\}\n\s*let patchNotes = activeGame\.patchNotes \|\| \[\];\n\s*if \(newsIndex !== -1 && results\[newsIndex\]\.ok\) \{\n\s*const newsData = await results\[newsIndex\]\.json\(\);\n\s*patchNotes = newsData\.news\?\.map\(\(n: any\) => n\.contents\) \|\| \[\];\n\s*\}/;

const replacement = `const fetchData = async () => {
      try {
        let achievements = activeGame.achievements || [];
        let patchNotes = activeGame.patchNotes || [];

        if ((window as any).electronAPI && (window as any).electronAPI.fetchAchievementsLocally) {
          // Desktop App Local Fetch
          if (settings.steamId) {
            const localAch = await (window as any).electronAPI.fetchAchievementsLocally(activeGame.appId, settings.steamId);
            if (localAch) achievements = localAch;
          }
          const localNews = await (window as any).electronAPI.fetchNewsLocally(activeGame.appId);
          if (localNews && localNews.length > 0) patchNotes = localNews.map((n: any) => n.contents);
        } else {
          // Web Preview Fetch
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
          
          if (achIndex !== -1 && results[achIndex].ok) {
            const data = await results[achIndex].json();
            achievements = data.achievements || [];
          }
          
          if (newsIndex !== -1 && results[newsIndex].ok) {
            const newsData = await results[newsIndex].json();
            patchNotes = newsData.news?.map((n: any) => n.contents) || [];
          }
        }

        if (isMounted) {`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/App.tsx', code);
