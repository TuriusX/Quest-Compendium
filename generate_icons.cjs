const sharp = require('sharp');
const fs = require('fs');

async function generate() {
  const input = 'public/app-icon.png';
  if (!fs.existsSync(input)) {
    console.error('No input icon found');
    return;
  }
  
  await sharp(input).resize(192, 192).toFile('public/pwa-192x192.png');
  await sharp(input).resize(512, 512).toFile('public/pwa-512x512.png');
  await sharp(input).resize(180, 180).toFile('public/apple-touch-icon.png');
  
  // Create maskable with padding
  await sharp(input)
    .resize(400, 400, { fit: 'contain' })
    .extend({
      top: 56, bottom: 56, left: 56, right: 56,
      background: { r: 17, g: 18, b: 26, alpha: 1 } // #11121a dark theme background
    })
    .toFile('public/pwa-maskable-512x512.png');
    
  console.log('Icons generated successfully');
}
generate();
