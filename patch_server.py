import re
with open('server.ts', 'r') as f:
    code = f.read()

old_loop = """      // Add past conversation turns
      for (const msg of history.slice(-10)) {
        if (msg.role === 'user') {
          const parts: any[] = [{ text: msg.text }];
          if (msg.imageUrl && msg.imageUrl.startsWith('data:image')) {
            const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (match) {
              parts.unshift({
                inlineData: {
                  mimeType: match[1],
                  data: match[2]
                }
              });
            }
          }
          contentsPayload.push({ role: 'user', parts });
        } else if (msg.role === 'assistant') {
          contentsPayload.push({
            role: 'model',
            parts: [{ text: msg.text }]
          });
        }
      }"""

new_loop = """      // Add past conversation turns
      for (const msg of history.slice(-10)) {
        if (msg.role === 'user') {
          const parts: any[] = [{ text: msg.text }];
          if (msg.imageUrl && msg.imageUrl.startsWith('data:image')) {
            const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (match) {
              parts.unshift({
                inlineData: {
                  mimeType: match[1],
                  data: match[2]
                }
              });
            }
          }
          // Avoid consecutive user roles
          if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === 'user') {
            contentsPayload[contentsPayload.length - 1].parts.push(...parts);
          } else {
            contentsPayload.push({ role: 'user', parts });
          }
        } else if (msg.role === 'assistant') {
          if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === 'model') {
            contentsPayload[contentsPayload.length - 1].parts.push({ text: msg.text });
          } else {
            contentsPayload.push({
              role: 'model',
              parts: [{ text: msg.text }]
            });
          }
        }
      }
      
      // Ensure we don't have consecutive user roles with the current message
      const currentRole = 'user';"""

if old_loop in code:
    code = code.replace(old_loop, new_loop)
    with open('server.ts', 'w') as f:
        f.write(code)
    print("Patched server loop successfully")
else:
    print("Could not find server loop to patch")
