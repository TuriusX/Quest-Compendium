const koffi = require('koffi');
try { koffi.alias('WORD', 'uint16'); } catch(e){}
try {
  const xinput = require('xinput-ffi');
  console.log("xinput loaded successfully");
} catch(e) {
  console.log("xinput error:", e);
}
