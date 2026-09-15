const fetch = require('cross-fetch');

async function test() {
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'I am outside figaro castle for the first time. What do I do?',
      history: [],
      aiMode: 'guide',
      preferredModel: 'pro'
    })
  });
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Data:', data.text ? data.text.substring(0, 100) + '...' : data);
}

test();
