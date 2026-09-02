const koffi = require('koffi');
try {
  const xinput = require('xinput-ffi');
  console.log("xinput loaded successfully");
} catch(e) {
  console.log("xinput error:", e);
}
