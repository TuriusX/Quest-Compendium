const fs = require('fs');
let code = fs.readFileSync('src/components/HeaderBar.tsx', 'utf-8');

code = code.replace(/userData\.isPremium \? 40 : 3/g, 'userData.isPremium ? 40 : 5');
code = code.replace(/userData\.isPremium \? 100 : 3/g, 'userData.isPremium ? 100 : 5');
code = code.replace(/3 - \(userData\.flashQueriesToday/g, '5 - (userData.flashQueriesToday');
code = code.replace(/\) \/ 3\) \* 100/g, ') / 5) * 100');
code = code.replace(/ \/ 3\}/g, ' / 5}');

fs.writeFileSync('src/components/HeaderBar.tsx', code);
console.log("Updated HeaderBar.tsx");
