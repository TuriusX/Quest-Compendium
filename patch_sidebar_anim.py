import re

with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

target = """  return (
    <aside 
      className={`h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col transition-all duration-300 ease-out z-20 flex-shrink-0 relative ${
        isOpen ? 'w-72 sm:w-80' : 'w-0 overflow-hidden border-none'
      }`}
    >"""

replacement = """  return (
    <aside 
      className={`h-full z-20 flex-shrink-0 relative transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${
        isOpen ? 'w-72 sm:w-80' : 'w-0 border-none'
      }`}
      style={{ perspective: '2000px' }}
    >
      <div 
        className="w-72 sm:w-80 h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col overflow-hidden"
        style={{
          transformOrigin: 'left center',
          transform: isOpen ? 'rotateY(0deg)' : 'rotateY(-90deg)',
          opacity: isOpen ? 1 : 0,
          transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >"""

code = code.replace(target, replacement)
code = code.replace('    </aside>', '      </div>\n    </aside>')

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)

with open('src/components/AchievementsDrawer.tsx', 'r') as f:
    code2 = f.read()

target2 = """  return (
    <aside
      className={`h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-l border-white/[0.08] flex flex-col transition-all duration-300 ease-out z-20 flex-shrink-0 relative ${
        isOpen ? 'w-80 sm:w-96' : 'w-0 overflow-hidden border-none'
      }`}
    >"""

replacement2 = """  return (
    <aside
      className={`h-full z-20 flex-shrink-0 relative transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${
        isOpen ? 'w-80 sm:w-96' : 'w-0 border-none'
      }`}
      style={{ perspective: '2000px' }}
    >
      <div 
        className="w-80 sm:w-96 h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-l border-white/[0.08] flex flex-col overflow-hidden"
        style={{
          transformOrigin: 'right center',
          transform: isOpen ? 'rotateY(0deg)' : 'rotateY(90deg)',
          opacity: isOpen ? 1 : 0,
          transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >"""

code2 = code2.replace(target2, replacement2)
code2 = code2.replace('    </aside>', '      </div>\n    </aside>')

with open('src/components/AchievementsDrawer.tsx', 'w') as f:
    f.write(code2)

