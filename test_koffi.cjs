const koffi = require('koffi');

const XINPUT_GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
  wButtons: 'uint16',
  bLeftTrigger: 'uint8',
  bRightTrigger: 'uint8',
  sThumbLX: 'int16',
  sThumbLY: 'int16',
  sThumbRX: 'int16',
  sThumbRY: 'int16'
});

const XINPUT_STATE = koffi.struct('XINPUT_STATE', {
  dwPacketNumber: 'uint32',
  Gamepad: XINPUT_GAMEPAD
});

let xinputLib;
try { xinputLib = koffi.load('XInput1_4.dll'); } catch(e) {
  try { xinputLib = koffi.load('xinput1_3.dll'); } catch(e2) {
    console.error("Failed to load xinput dll");
  }
}

if (xinputLib) {
  const XInputGetState = xinputLib.func('uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ XINPUT_STATE *pState)');
  let state = {};
  let res = XInputGetState(0, state);
  console.log("Result:", res, state);
}
