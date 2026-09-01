import re
with open('server.ts', 'r') as f:
    code = f.read()

old_post = """  app.post('/api/chat', async (req, res) => {
    try {
      const {
        question,
        history = [],
        imageBase64,"""

new_post = """  app.post('/api/chat', async (req, res) => {
    try {
      const {
        question,
        history = [],
        imageBase64,""" + """
      console.log('Received imageBase64:', !!imageBase64, imageBase64 ? imageBase64.substring(0, 50) : '');
"""

if old_post in code:
    code = code.replace(old_post, new_post)
    with open('server.ts', 'w') as f:
        f.write(code)
    print("Patched server log successfully")
else:
    print("Could not find server log to patch")
