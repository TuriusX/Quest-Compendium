import re
with open('src/components/SettingsModal.tsx', 'r') as f:
    code = f.read()

old_voices = """  const voices = [
    { id: 'Kore', name: 'Kore (Warm / Epic Storyteller)' },
    { id: 'Puck', name: 'Puck (Playful / Witty Companion)' },
    { id: 'Fenrir', name: 'Fenrir (Deep / Heroic Warrior)' },
    { id: 'Zephyr', name: 'Zephyr (Smooth / Navigator AI)' },
    { id: 'Charon', name: 'Charon (Mystic / Cryptic Oracle)' },
  ];"""

new_voices = """  const voices = [
    { id: 'fable', name: 'Fable (The British Storyteller)' },
    { id: 'onyx', name: 'Onyx (The Dark Overlord)' },
    { id: 'nova', name: 'Nova (The Energetic Guide)' },
    { id: 'echo', name: 'Echo (The Wise Mentor)' },
    { id: 'shimmer', name: 'Shimmer (The Ethereal Spirit)' },
    { id: 'sage', name: 'Sage (The Mystical Oracle)' },
    { id: 'ash', name: 'Ash (The Bold Adventurer)' },
    { id: 'coral', name: 'Coral (The Cheerful Sidekick)' },
    { id: 'alloy', name: 'Alloy (The Neutral Construct)' }
  ];"""

code = code.replace(old_voices, new_voices)

with open('src/components/SettingsModal.tsx', 'w') as f:
    f.write(code)

