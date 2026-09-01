import re
with open('server.ts', 'r') as f:
    code = f.read()

old_tts = """      // Clean markdown citations and hashtags for crisp spoken narration
      const cleanText = text
        .replace(/\[\^?\d+\]/g, '')
        .replace(/[*_#`~>]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\\n\s*-\s*/g, '. ')
        .trim()
        .slice(0, 4000); // OpenAI limit is 4096

      const apiKey = openAiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is missing.' });
      }

      // voice is now passed directly as the OpenAI voice name (e.g., 'fable', 'onyx')
      const openaiVoice = voice || 'nova';

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: cleanText,
          voice: openaiVoice,
          response_format: 'mp3'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `OpenAI TTS error: ${errorText}` });
      }

      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/mp3'
      });"""

new_tts = """      // Clean markdown citations and hashtags for crisp spoken narration
      const cleanText = text
        .replace(/\[\^?\d+\]/g, '')
        .replace(/[*_#`~>]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\\n\s*-\s*/g, '. ')
        .trim();

      const apiKey = openAiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is missing.' });
      }

      // voice is now passed directly as the OpenAI voice name (e.g., 'fable', 'onyx')
      const openaiVoice = voice || 'nova';

      // OpenAI TTS limit is 4096. We'll chunk text and combine MP3 buffers.
      const chunks: string[] = [];
      let remainingText = cleanText;
      while (remainingText.length > 0) {
        if (remainingText.length <= 4000) {
          chunks.push(remainingText);
          break;
        }
        
        let splitIndex = remainingText.lastIndexOf('.', 4000);
        if (splitIndex === -1) splitIndex = remainingText.lastIndexOf(' ', 4000);
        if (splitIndex === -1) splitIndex = 4000;
        
        chunks.push(remainingText.slice(0, splitIndex + 1).trim());
        remainingText = remainingText.slice(splitIndex + 1).trim();
      }

      const audioPromises = chunks.map(async (chunkText, index) => {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: chunkText,
            voice: openaiVoice,
            response_format: 'mp3'
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI TTS error: ${errorText}`);
        }
        return await response.arrayBuffer();
      });

      // Fetch all chunks in parallel to reduce wait time
      const audioBuffers = await Promise.all(audioPromises);
      
      // Concatenate all MP3 buffers sequentially
      const combinedBuffer = Buffer.concat(audioBuffers.map(b => Buffer.from(b)));
      const base64Audio = combinedBuffer.toString('base64');

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/mp3'
      });"""

if old_tts in code:
    code = code.replace(old_tts, new_tts)
    with open('server.ts', 'w') as f:
        f.write(code)
    print("Patched successfully")
else:
    print("Could not find block to patch")

