const claimedId = 'https://steamcommunity.com/openid/id/76561198031317111';
const match = claimedId.match(/\/id\/(\d+)/);
console.log(match ? match[1] : null);
