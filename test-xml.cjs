const fetch = require('node-fetch');
const xml2js = require('xml2js');
async function run() {
  const url = 'https://steamcommunity.com/profiles/76561198031317111/?xml=1';
  const response = await fetch(url);
  const xmlData = await response.text();
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xmlData);
  console.log(result.profile ? Object.keys(result.profile) : null);
}
run();
