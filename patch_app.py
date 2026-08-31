import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

profile_hook = """  // Fetch Steam Profile
  useEffect(() => {
    if (!settings.steamId) {
      setSettings(prev => ({ ...prev, steamName: undefined, steamAvatar: undefined }));
      return;
    }
    
    async function fetchProfile() {
      try {
        const res = await fetch(`/api/steam/profile?steamId=${encodeURIComponent(settings.steamId)}`);
        if (res.ok) {
          const data = await res.json();
          setSettings(prev => ({ 
            ...prev, 
            steamName: data.steamName, 
            steamAvatar: data.avatarMedium || data.avatarIcon || data.avatarFull 
          }));
        }
      } catch (err) {
        console.error('Failed to fetch Steam profile', err);
      }
    }
    fetchProfile();
  }, [settings.steamId]);

  // Fetch real Steam achievements if steamId is set"""

code = code.replace("  // Fetch real Steam achievements if steamId is set", profile_hook)

with open('src/App.tsx', 'w') as f:
    f.write(code)

