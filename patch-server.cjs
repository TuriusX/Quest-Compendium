const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldCode = `        // Progressive chunking:
        // Chunk 0 is compact (~180-240 chars) to return fast audio in ~3-4s.
        // Subsequent chunks are ~380-450 chars.
        const chunks: string[] = [];
        if (cleanText.length <= 320) {
          chunks.push(cleanText);
        } else {
          const sentences = cleanText.match(/[^.!?]+[.!?]+(\\s|$)|[^.!?]+$/g) || [cleanText];
          let currentChunk = '';
          let targetLen = 220; // Fast first chunk

          for (const sentence of sentences) {
            const s = sentence.trim();
            if (!s) continue;
            if ((currentChunk + ' ' + s).trim().length <= targetLen || !currentChunk) {
              currentChunk = currentChunk ? \`\${currentChunk} \${s}\` : s;
            } else {
              chunks.push(currentChunk);
              currentChunk = s;
              targetLen = 420; // Normal length for remaining chunks
            }
          }
          if (currentChunk) chunks.push(currentChunk);
        }`;

const newCode = `        // Optimized chunking:
        // We've increased the chunk size massively to preserve Gemini API quota.
        // One message = One request (unless it's extremely long).
        const chunks: string[] = [];
        if (cleanText.length <= 4000) {
          chunks.push(cleanText);
        } else {
          const sentences = cleanText.match(/[^.!?\\n]+[.!?\\n]+(\\s|$)|[^.!?\\n]+$/g) || [cleanText];
          let currentChunk = '';
          let targetLen = 3500; // Much larger limit to save requests

          for (const sentence of sentences) {
            const s = sentence.trim();
            if (!s) continue;
            if ((currentChunk + ' ' + s).trim().length <= targetLen || !currentChunk) {
              currentChunk = currentChunk ? \`\${currentChunk} \${s}\` : s;
            } else {
              chunks.push(currentChunk);
              currentChunk = s;
            }
          }
          if (currentChunk) chunks.push(currentChunk);
        }`;

if (code.includes('targetLen = 220; // Fast first chunk')) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('server.ts', code);
  console.log("Successfully updated server.ts chunking logic.");
} else {
  console.log("Could not find the target code string to replace in server.ts");
}
