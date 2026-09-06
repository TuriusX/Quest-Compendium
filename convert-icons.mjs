import sharp from 'sharp';
import fs from 'fs';
import pngToIco from 'png-to-ico';

async function main() {
  // Convert SVG to PNG
  await sharp('public/icon.svg')
    .resize(256, 256)
    .png()
    .toFile('public/app-icon.png');
    
  console.log('Generated app-icon.png');

  await sharp('public/icon.svg')
    .resize(256, 256)
    .png()
    .toFile('public/book.png');
    
  console.log('Generated book.png');

  // Convert PNG to ICO
  const buf = await pngToIco('public/app-icon.png');
  fs.writeFileSync('public/app-icon.ico', buf);
  fs.writeFileSync('public/favicon.ico', buf);
  fs.writeFileSync('app-icon.ico', buf);
  console.log('Generated ICO files');
}

main().catch(console.error);
