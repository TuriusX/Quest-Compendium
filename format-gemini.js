function format(history, text) {
  return history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  })).concat([{ role: 'user', parts: [{ text }] }]);
}
console.log(format([], "hello"));
