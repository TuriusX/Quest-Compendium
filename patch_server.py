import re

with open('server.ts', 'r') as f:
    code = f.read()

old_tts = """      const ai = getGeminiClient(customApiKey);

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice as any || 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        return res.status(500).json({ error: 'Audio data not generated' });
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/mp3'
      });"""

new_tts = """      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is missing.' });
      }

      const voiceMap: Record<string, string> = {
        'Kore': 'nova',
        'Puck': 'shimmer',
        'Fenrir': 'onyx',
        'Zephyr': 'alloy',
        'Charon': 'echo'
      };
      
      const openaiVoice = voiceMap[voice] || 'nova';

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

code = code.replace(old_tts, new_tts)
with open('server.ts', 'w') as f:
    f.write(code)

