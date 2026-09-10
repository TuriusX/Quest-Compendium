const sharp = require('sharp');

async function createPfp() {
  try {
    // Resize the original icon with padding but keep a completely transparent background
    const resizedIcon = await sharp('public/app-icon.png')
      .resize(700, 700, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 } // transparent
      })
      .toBuffer();

    // Composite it onto a 1024x1024 transparent canvas
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } // completely transparent background
      }
    })
    .composite([
      { input: resizedIcon, gravity: 'center' }
    ])
    .toFile('public/youtube-pfp-transparent.png');
    
    console.log("Transparent PFP created successfully!");
  } catch (err) {
    console.error("Error:", err);
  }
}

createPfp();
