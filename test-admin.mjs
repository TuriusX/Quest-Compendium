import { initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
try {
  initializeApp({ projectId: 'gen-lang-client-0366642934' });
} catch(e) {}
const db = getFirestore();
db.settings({ databaseId: 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f' });
async function test() {
  try {
    const snap = await db.collection('users').limit(1).get();
    console.log("Success reading from Admin SDK. Size:", snap.size);
  } catch (err) {
    console.error("Admin SDK error:", err.message);
  }
}
test();
