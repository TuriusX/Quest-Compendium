const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  /const synthesizeChunk = async \(chunkText: string\): Promise<Buffer \| null> => \{[\s\S]*?console\.warn\('Chunk TTS generation error:', err\?\.message\);\n\s*return null;\n\s*\}/g,
  `const synthesizeChunk = async (chunkText: string): Promise<{pcm: Buffer | null, error?: string}> => {
          if (!chunkText.trim()) return { pcm: null };
          try {
            const ttsResult = await ai.models.generateContent({
              model: 'gemini-3.1-flash-tts-preview',
              contents: chunkText,
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: targetVoice }
                  }
                }
              }
            });
            const inlinePart = ttsResult.candidates?.[0]?.content?.parts?.[0];
            const b64Data = inlinePart?.inlineData?.data;
            return { pcm: b64Data ? Buffer.from(b64Data, 'base64') : null };
          } catch (err: any) {
            if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('quota')) {
                return { pcm: null, error: 'QUOTA_EXCEEDED' };
            }
            console.warn('Chunk TTS generation error:', err?.message);
            return { pcm: null };
          }
        `
);

code = code.replace(
`        if (stream && chunks.length > 0) {
          // Streaming mode: send Chunk 0 immediately so browser plays within seconds
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const allPcmBuffers: Buffer[] = [];

          // Synthesize Chunk 0 first
          const firstPcm = await synthesizeChunk(chunks[0]);
          if (firstPcm) {
            allPcmBuffers.push(firstPcm);
            const firstWav = pcmToWav(firstPcm, 24000, 1);`,
`        if (stream && chunks.length > 0) {
          const allPcmBuffers: Buffer[] = [];

          // Synthesize Chunk 0 first
          const firstResult = await synthesizeChunk(chunks[0]);
          if (firstResult.error === 'QUOTA_EXCEEDED') {
             return res.status(429).json({ error: 'TTS Rate limit exceeded (100 requests/day). Using local fallback.' });
          }

          // Streaming mode: send Chunk 0 immediately so browser plays within seconds
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          if (firstResult.pcm) {
            allPcmBuffers.push(firstResult.pcm);
            const firstWav = pcmToWav(firstResult.pcm, 24000, 1);`
);

code = code.replace(
`          // If more chunks exist, synthesize them in parallel!
          if (chunks.length > 1) {
            const remainingPromises = chunks.slice(1).map(async (chunk, idx) => {
              const pcm = await synthesizeChunk(chunk);
              return { index: idx + 1, pcm };
            });`,
`          // If more chunks exist, synthesize them in parallel!
          if (chunks.length > 1) {
            const remainingPromises = chunks.slice(1).map(async (chunk, idx) => {
              const res = await synthesizeChunk(chunk);
              return { index: idx + 1, pcm: res.pcm };
            });`
);

code = code.replace(
`        const pcmResults = await Promise.all(chunks.map(chunk => synthesizeChunk(chunk)));
        const validPcms = pcmResults.filter((b): b is Buffer => b !== null);`,
`        const pcmResults = await Promise.all(chunks.map(chunk => synthesizeChunk(chunk)));
        if (pcmResults.some(r => r.error === 'QUOTA_EXCEEDED')) {
           return res.status(429).json({ error: 'TTS Rate limit exceeded (100 requests/day). Using local fallback.' });
        }
        const validPcms = pcmResults.map(r => r.pcm).filter((b): b is Buffer => b !== null);`
);

fs.writeFileSync('server.ts', code);
