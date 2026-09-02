import koffi_esm from 'koffi';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const koffi_cjs = require('koffi');

koffi_cjs.alias('MY_TEST', 'uint16');
try {
  koffi_esm.resolve('MY_TEST');
  console.log("ESM resolved the alias!");
} catch(e) {
  console.log("ESM failed to resolve:", e.message);
}
