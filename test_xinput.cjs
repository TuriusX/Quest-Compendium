const xinput = require('xinput-ffi');
async function test() {
  for (let i=0; i<4; i++) {
    try {
      let state = await xinput.getState(i);
      console.log(`Slot ${i} state:`, state);
    } catch(e) {
      console.log(`Slot ${i} error:`, e.code || e.message);
    }
  }
}
test();
