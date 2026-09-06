const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
	<steamID64>76561197960434622</steamID64>
	<steamID><![CDATA[al]]></steamID>
	<onlineState>online</onlineState>
	<stateMessage><![CDATA[Online]]></stateMessage>
	<privacyState>public</privacyState>
	<visibilityState>3</visibilityState>
	<avatarIcon><![CDATA[https://avatars.fastly.steamstatic.com/fdaef0111714471445bb422b8021d3a887c86a99.jpg]]></avatarIcon>
	<avatarMedium><![CDATA[https://avatars.fastly.steamstatic.com/fdaef0111714471445bb422b8021d3a887c86a99_medium.jpg]]></avatarMedium>
	<avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/fdaef0111714471445bb422b8021d3a887c86a99_full.jpg]]></avatarFull>
</profile>`;
const steamIDMatch = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/) || xml.match(/<steamID>(.*?)<\/steamID>/);
const avatarIconMatch = xml.match(/<avatarIcon><!\[CDATA\[(.*?)\]\]><\/avatarIcon>/) || xml.match(/<avatarIcon>(.*?)<\/avatarIcon>/);
const avatarMediumMatch = xml.match(/<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/) || xml.match(/<avatarMedium>(.*?)<\/avatarMedium>/);
const avatarFullMatch = xml.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/) || xml.match(/<avatarFull>(.*?)<\/avatarFull>/);

console.log(steamIDMatch[1]);
console.log(avatarIconMatch[1]);
console.log(avatarMediumMatch[1]);
console.log(avatarFullMatch[1]);
