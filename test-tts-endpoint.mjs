import fetch from 'node-fetch';

async function test() {
  const res = await fetch('http://localhost:3000/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: "Hello world this is a test", voice: "puck", stream: true })
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text.substring(0, 500));
}
test();
