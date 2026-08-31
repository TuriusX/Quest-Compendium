import re

with open('server.ts', 'r') as f:
    code = f.read()

profile_endpoint = """  // --- API: Steam Profile (XML) ---
  app.get('/api/steam/profile', async (req, res) => {
    const { steamId } = req.query;
    if (!steamId || typeof steamId !== 'string') {
      return res.status(400).json({ error: 'steamId query parameter is required' });
    }
    
    let url = '';
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/?xml=1`;
    }
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(404).json({ error: 'Steam profile not found' });
      }
      
      const xmlData = await response.text();
      const result = await parseStringPromise(xmlData, { explicitArray: false });
      
      const profile = result.profile;
      if (!profile) {
        return res.status(404).json({ error: 'Invalid profile data' });
      }
      
      return res.json({
        steamName: profile.steamID,
        avatarFull: profile.avatarFull,
        avatarMedium: profile.avatarMedium,
        avatarIcon: profile.avatarIcon
      });
    } catch (err) {
      console.error('Failed to fetch Steam profile:', err);
      return res.status(500).json({ error: 'Failed to parse Steam profile' });
    }
  });

  // --- API: Steam Achievements (Public XML) ---"""

code = code.replace("  // --- API: Steam Achievements (Public XML) ---", profile_endpoint)

with open('server.ts', 'w') as f:
    f.write(code)

