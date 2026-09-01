import re
with open('server.ts', 'r') as f:
    code = f.read()

bad_code = """      const {
        question,
        history = [],
        imageBase64,
      console.log('Received imageBase64:', !!imageBase64, imageBase64 ? imageBase64.substring(0, 50) : '');

        aiMode = 'standard',"""

good_code = """      const {
        question,
        history = [],
        imageBase64,
        aiMode = 'standard',"""

if bad_code in code:
    code = code.replace(bad_code, good_code)
    with open('server.ts', 'w') as f:
        f.write(code)
    print("Fixed syntax error")
else:
    print("Could not find syntax error block")
