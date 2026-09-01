import re

# Patch AuthModal.tsx
with open('src/components/AuthModal.tsx', 'r') as f:
    code = f.read()

code = code.replace("import { Sparkles, Book } from 'lucide-react';", "import { Sparkles } from 'lucide-react';\nimport { MagicalBookIcon } from './MagicalBookIcon';")
code = code.replace("import { Book } from 'lucide-react';", "import { MagicalBookIcon } from './MagicalBookIcon';")
code = re.sub(r'<div className="w-16 h-16 rounded-2xl.*?</div>', '<MagicalBookIcon className="w-16 h-16 mb-6 shadow-[0_0_30px_rgba(171,119,250,0.3)] rounded-2xl" />', code, flags=re.DOTALL)

with open('src/components/AuthModal.tsx', 'w') as f:
    f.write(code)

# Patch DesktopLogin.tsx
with open('src/components/DesktopLogin.tsx', 'r') as f:
    code = f.read()

code = code.replace("import { Book, LogIn } from 'lucide-react';", "import { LogIn } from 'lucide-react';\nimport { MagicalBookIcon } from './MagicalBookIcon';")
code = re.sub(r'<div className="w-16 h-16 rounded-2xl.*?</div>', '<MagicalBookIcon className="w-16 h-16 mb-6 shadow-[0_0_40px_rgba(168,127,251,0.4)] rounded-2xl" />', code, flags=re.DOTALL)

with open('src/components/DesktopLogin.tsx', 'w') as f:
    f.write(code)

print("Patched logos")
