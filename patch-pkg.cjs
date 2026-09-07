const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

if (pkg.dependencies['@ghostery/adblocker-electron']) {
  pkg.devDependencies['@ghostery/adblocker-electron'] = pkg.dependencies['@ghostery/adblocker-electron'];
  delete pkg.dependencies['@ghostery/adblocker-electron'];
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
  console.log("Moved adblocker to devDependencies!");
}
