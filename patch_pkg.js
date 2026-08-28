import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.main = 'electron/main.cjs';
pkg.scripts['desktop:dev'] = 'concurrently "npm run dev" "wait-on http://localhost:3000 && electron ."';
pkg.scripts['desktop:build'] = 'npm run build && electron-builder';

// Basic build config for electron-builder
pkg.build = {
  appId: 'com.questcompendium.app',
  productName: 'Quest Compendium',
  directories: {
    output: 'release'
  },
  files: [
    'dist/**/*',
    'electron/**/*'
  ]
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
