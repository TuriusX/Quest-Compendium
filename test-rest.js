const idToken = 'test';
const projectId = 'gen-lang-client-0366642934';
const databaseId = 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f';
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/test?updateMask.fieldPaths=isPremium&updateMask.fieldPaths=lastResetDate`;
console.log(url);
