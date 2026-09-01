import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_buttons = """          {/* Action Buttons inside Input Bar */}
          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">

            {/* Push to Talk / Voice Dictation */}
            <button"""

new_buttons = """          {/* Action Buttons inside Input Bar */}
          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">

            {/* Hidden file input for manual upload */}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />

            {/* Manual Image Upload */}
            <button
              type="button"
              onClick={() => {
                playBlipSound(soundEnabled);
                fileInputRef.current?.click();
              }}
              title="Upload Screenshot"
              className="p-2 rounded-xl text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10 transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4" />
            </button>

            {/* Live Screen Capture */}
            <button
              type="button"
              onClick={captureGameScreen}
              disabled={isCapturingScreen}
              title="Live Capture Game Window"
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isCapturingScreen 
                  ? 'bg-blue-500/20 text-blue-300 animate-pulse' 
                  : 'text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10'
              }`}
            >
              <Camera className="w-4 h-4" />
            </button>

            {/* Push to Talk / Voice Dictation */}
            <button"""

if old_buttons in code:
    code = code.replace(old_buttons, new_buttons)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched successfully")
else:
    print("Could not find block to patch")

