const koffi = require('koffi');
try { koffi.alias('WORD', 'uint16'); } catch(e){}
try { koffi.alias('DWORD', 'uint32'); } catch(e){}
try { koffi.alias('BYTE', 'uint8'); } catch(e){}
try { koffi.alias('SHORT', 'int16'); } catch(e){}
try { koffi.alias('WCHAR', 'char16_t'); } catch(e){}
try {
  const xinput = require('xinput-ffi');
  console.log("xinput loaded successfully");
} catch(e) {
  console.log("xinput error:", e);
}
