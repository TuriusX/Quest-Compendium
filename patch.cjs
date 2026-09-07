const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

if (pkg.devDependencies['@ghostery/adblocker-electron']) {
  pkg.dependencies['@ghostery/adblocker-electron'] = pkg.devDependencies['@ghostery/adblocker-electron'];
  delete pkg.devDependencies['@ghostery/adblocker-electron'];
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
  console.log("Moved adblocker back to dependencies!");
}

let main = fs.readFileSync('electron/main.cjs', 'utf-8');
if (!main.includes('try {\\n    const { ElectronBlocker }')) {
  main = main.replace(
    "const { ElectronBlocker } = require('@ghostery/adblocker-electron');",
    "try {\n    const { ElectronBlocker } = require('@ghostery/adblocker-electron');"
  ).replace(
    "}).catch((err) => console.error(\"Adblocker failed:\", err));",
    "}).catch((err) => console.error(\"Adblocker failed:\", err));\n  } catch(e) { console.error(\"Adblocker module missing, skipping adblocker initialization.\"); }"
  );
  fs.writeFileSync('electron/main.cjs', main);
  console.log("Patched main.cjs with try/catch");
}
