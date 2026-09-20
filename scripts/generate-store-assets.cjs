const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generate() {
  const publicDir = path.join(__dirname, '..', 'public');
  const iconPath = path.join(publicDir, 'youtube-pfp.png');

  // 1. Generate 1:1 Box Art (1080 x 1080)
  // Background with subtle gaming vignette
  const svgBoxArt1080 = `
  <svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bgGlow" cx="50%" cy="45%" r="70%">
        <stop offset="0%" stop-color="#2a1b4e" stop-opacity="0.8"/>
        <stop offset="40%" stop-color="#141126" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#08070e" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="borderGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7" stop-opacity="0.4"/>
        <stop offset="50%" stop-color="#3b82f6" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.4"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#bgGlow)"/>
    <rect x="20" y="20" width="1040" height="1040" rx="40" fill="none" stroke="url(#borderGlow)" stroke-width="3" opacity="0.6"/>
    <text x="540" y="930" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="64" fill="#ffffff" letter-spacing="6">QUEST COMPENDIUM</text>
    <text x="540" y="990" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600" font-size="28" fill="#c084fc" letter-spacing="4">INTELLIGENT GAME COMPANION</text>
  </svg>`;

  const iconResized1080 = await sharp(iconPath)
    .resize(620, 620, { fit: 'contain' })
    .toBuffer();

  await sharp(Buffer.from(svgBoxArt1080))
    .composite([
      {
        input: iconResized1080,
        top: 190,
        left: (1080 - 620) / 2
      }
    ])
    .png()
    .toFile(path.join(publicDir, 'store-box-art-1080x1080.png'));

  console.log('Created: store-box-art-1080x1080.png (1080x1080)');

  // 2. Generate 9:16 Poster Art (720 x 1080)
  const svgPoster720 = `
  <svg width="720" height="1080" viewBox="0 0 720 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="posterGlow" cx="50%" cy="40%" r="65%">
        <stop offset="0%" stop-color="#2a1b4e" stop-opacity="0.85"/>
        <stop offset="45%" stop-color="#141126" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#08070e" stop-opacity="1"/>
      </radialGradient>
      <linearGradient id="posterBorder" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.4"/>
      </linearGradient>
    </defs>
    <rect width="720" height="1080" fill="url(#posterGlow)"/>
    <rect x="16" y="16" width="688" height="1048" rx="32" fill="none" stroke="url(#posterBorder)" stroke-width="2.5" opacity="0.5"/>
    <text x="360" y="860" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="46" fill="#ffffff" letter-spacing="4">QUEST COMPENDIUM</text>
    <text x="360" y="915" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600" font-size="22" fill="#c084fc" letter-spacing="3">AI IN-GAME COMPANION</text>
    <text x="360" y="960" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="400" font-size="16" fill="#94a3b8" letter-spacing="1">WALKTHROUGHS • LORE • NOTEPAD</text>
  </svg>`;

  const iconResized720 = await sharp(iconPath)
    .resize(500, 500, { fit: 'contain' })
    .toBuffer();

  await sharp(Buffer.from(svgPoster720))
    .composite([
      {
        input: iconResized720,
        top: 240,
        left: (720 - 500) / 2
      }
    ])
    .png()
    .toFile(path.join(publicDir, 'store-poster-art-720x1080.png'));

  console.log('Created: store-poster-art-720x1080.png (720x1080)');

  // 3. Generate 300x300 Standard Store Logo
  await sharp(iconPath)
    .resize(300, 300, { fit: 'contain' })
    .png()
    .toFile(path.join(publicDir, 'store-logo-300x300.png'));

  console.log('Created: store-logo-300x300.png (300x300)');

  // 4. Also copy to dist if dist exists
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    fs.copyFileSync(path.join(publicDir, 'store-box-art-1080x1080.png'), path.join(distDir, 'store-box-art-1080x1080.png'));
    fs.copyFileSync(path.join(publicDir, 'store-poster-art-720x1080.png'), path.join(distDir, 'store-poster-art-720x1080.png'));
    fs.copyFileSync(path.join(publicDir, 'store-logo-300x300.png'), path.join(distDir, 'store-logo-300x300.png'));
  }
}

generate().catch(console.error);
