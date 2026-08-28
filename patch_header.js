const fs = require('fs');
const file = 'src/components/HeaderBar.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `            <span className="hidden sm:flex items-center gap-1 text-[10px] text-zinc-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              VISION • ORACLE AI
            </span>
          </div>
        </button>

        {/* Vertical Divider */}
        <div className="h-5 w-[1px] bg-white/10 hidden sm:block" />

        {/* Active Game Selector Card */}
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenGameSearch();
          }}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-[var(--accent-border)] text-xs text-zinc-300 hover:text-white transition-all cursor-pointer group shadow-sm"
          title="Switch Active Game or Search Steam"
        >
          {activeGame?.headerImage ? (
            <img 
              src={activeGame.headerImage} 
              alt={activeGame.name} 
              className="w-5 h-5 rounded object-cover border border-white/20 flex-shrink-0"
            />
          ) : (
            <Gamepad2 className="w-4 h-4 text-[var(--accent-color)] group-hover:scale-110 transition-transform flex-shrink-0" />
          )}

          <div className="flex flex-col text-left">
            <span className="max-w-[110px] sm:max-w-[160px] md:max-w-[220px] truncate font-semibold text-white group-hover:text-[var(--accent-color)] transition-colors leading-tight">
              {activeGame ? activeGame.name : (activeTab ? activeTab.name : 'Select Game')}
            </span>
            <span className="text-[9.5px] text-zinc-400 font-sans hidden sm:inline truncate max-w-[140px]">
              {activeGame?.genre || 'Click to switch game'}
            </span>
          </div>

          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors flex-shrink-0 ml-0.5" />
        </button>`;

const replacement = `            <span className="hidden sm:flex items-center gap-1 text-[10px] text-zinc-400 font-mono uppercase">
              <span className={\`w-1.5 h-1.5 rounded-full \${activeGame || activeTab ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}\`} />
              {activeGame ? activeGame.name : (activeTab ? activeTab.name : 'GAME NOT DETECTED')}
            </span>
          </div>
        </button>`;

code = code.replace(target, replacement);
fs.writeFileSync(file, code);
