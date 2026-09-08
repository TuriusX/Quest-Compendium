const fs = require('fs');
const os = require('os');
const path = require('path');

const p = '/tmp/registry.vdf';
fs.writeFileSync(p, '"Registry"\n{\n  "HKCU"\n  {\n    "Software"\n    {\n      "Valve"\n      {\n        "Steam"\n        {\n          "RunningAppID"		"1046930"\n        }\n      }\n    }\n  }\n}\n');

const data = fs.readFileSync(p, 'utf8');
const match = data.match(/"RunningAppID"\s+"?(\d+)"?/i);
if (match) {
  console.log("Found AppId: " + match[1]);
} else {
  console.log("No match");
}
