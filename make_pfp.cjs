const sharp = require('sharp');
const fs = require('fs');

async function createPfp() {
  try {
    // First, resize the original icon (app-icon.png)
    const resizedIcon = await sharp('public/app-icon.png')
      .resize(700, 700, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 } // transparent
      })
      .toBuffer();

    // Now composite it onto a dark background
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 10, g: 11, b: 16, alpha: 1 } // #0a0b10 to match the app theme
      }
    })
    .composite([
      { input: resizedIcon, gravity: 'center' }
    ])
    .toFile('public/youtube-pfp.png');
    
    console.log("PFP created successfully!");
  } catch (err) {
    console.error("Error:", err);
  }
}

createPfp();
