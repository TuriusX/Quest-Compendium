const koffi = require('koffi');
koffi.alias('WORD', 'uint16');
koffi.alias('DWORD', 'uint32');
koffi.alias('BYTE', 'uint8');
koffi.alias('SHORT', 'int16');
koffi.alias('WCHAR', 'char16_t');
try {
  const xinput = require('xinput-ffi');
  console.log("xinput loaded:", !!xinput);
  xinput.getState(0).then(() => console.log("getState worked")).catch(e => console.log("getState error code:", e.code, "message:", e.message));
} catch(e) {
  console.error("error:", e);
}
