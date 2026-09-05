#!/bin/bash
sed -i '/{\/\* Achievements \/ Medals Drawer Toggle \*\/}/i \        {activeGame && (' src/components/HeaderBar.tsx
sed -i '/{\/\* Vertical Divider \*\/}/i \        )}' src/components/HeaderBar.tsx
sed -i '/{\/\* Font Quick Switcher \*\/}/,/{\/\* Beta Feedback \*\/}/c \        {/* Beta Feedback */}' src/components/HeaderBar.tsx
