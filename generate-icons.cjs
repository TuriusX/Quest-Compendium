const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const fs = require('fs');

async function generate() {
  console.log('Generating high-res PNG...');
  const svg = fs.readFileSync('public/icon.svg', 'utf8');
  
  // We need to scale the SVG up. By default sharp renders it at the viewBox size (32x32).
  // We can pass density to scale it up (e.g. 72 * (256/32) = 576).
  const pngBuffer = await sharp(Buffer.from(svg), { density: 576 })
    .resize(256, 256)
    .png()
    .toBuffer();
    
  fs.writeFileSync('public/app-icon.png', pngBuffer);
  console.log('Generated public/app-icon.png');

  console.log('Generating ICO...');
  const icoBuffer = await pngToIco.default('public/app-icon.png');
  fs.writeFileSync('public/app-icon.ico', icoBuffer);
  console.log('Generated public/app-icon.ico');
}

generate().catch(console.error);
