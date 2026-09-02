const koffi = require('koffi');
koffi.alias('WORD', 'uint16');
koffi.alias('DWORD', 'uint32');
koffi.alias('BYTE', 'uint8');
koffi.alias('SHORT', 'int16');
koffi.alias('WCHAR', 'char16_t');
try {
  require('xinput-ffi');
  console.log("Success");
} catch(e) {
  console.error("Fail", e);
}
