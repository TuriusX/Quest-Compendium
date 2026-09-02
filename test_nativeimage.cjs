const { nativeImage } = require('electron');
const img = nativeImage.createEmpty();
try {
  img.resize({ width: 1280 });
  console.log("resize ok");
} catch(e) {
  console.log("resize error", e);
}
