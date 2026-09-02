const fs = require('fs');
let code = fs.readFileSync('electron/main.cjs', 'utf-8');

const oldAliases = `    const koffi = require('koffi');
    koffi.alias('WORD', 'uint16');
    koffi.alias('DWORD', 'uint32');
    koffi.alias('BYTE', 'uint8');
    koffi.alias('SHORT', 'int16');
    koffi.alias('WCHAR', 'char16_t');
    xinput = require('xinput-ffi');`;

const newAliases = `    const koffi = require('koffi');
    try { koffi.alias('WORD', 'uint16'); } catch(e){}
    try { koffi.alias('DWORD', 'uint32'); } catch(e){}
    try { koffi.alias('BYTE', 'uint8'); } catch(e){}
    try { koffi.alias('SHORT', 'int16'); } catch(e){}
    try { koffi.alias('WCHAR', 'char16_t'); } catch(e){}
    xinput = require('xinput-ffi');`;

if (code.includes(oldAliases)) {
  code = code.replace(oldAliases, newAliases);
  fs.writeFileSync('electron/main.cjs', code);
  console.log("Patched koffi aliases");
} else {
  console.log("Could not find aliases block");
}
