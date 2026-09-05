const fs = require('fs');

// 1. Update package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.build) {
  if (!pkg.build.directories) pkg.build.directories = {};
  pkg.build.directories.buildResources = 'build';
  
  if (pkg.build.mac) delete pkg.build.mac.icon;
  if (pkg.build.linux) delete pkg.build.linux.icon;
  if (pkg.build.win) delete pkg.build.win.icon;
}
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));

// 2. Fix .gitignore
let gitignore = fs.readFileSync('.gitignore', 'utf8');
gitignore = gitignore.replace(/^build\/$/m, '');
fs.writeFileSync('.gitignore', gitignore.trim() + '\n');

// 3. Move files to build/
if (!fs.existsSync('build')) fs.mkdirSync('build');
fs.copyFileSync('public/app-icon.ico', 'build/icon.ico');
fs.copyFileSync('public/app-icon.png', 'build/icon.png');

// 4. Update main.cjs
let main = fs.readFileSync('electron/main.cjs', 'utf8');
main = main.replace(/public\/app-icon\.png/g, 'build/icon.png');
main = main.replace(/dist\/app-icon\.png/g, 'build/icon.png');
fs.writeFileSync('electron/main.cjs', main);

console.log('Fixed icon configuration!');
