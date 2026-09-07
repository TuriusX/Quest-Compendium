import { initializeApp, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
try {
  initializeApp({ projectId: 'gen-lang-client-0366642934' });
} catch(e) {}
async function test() {
  try {
    const list = await getAuth().listUsers(1);
    console.log("Success reading auth. User:", list.users[0]?.uid);
  } catch (err) {
    console.error("Auth Admin error:", err.message);
  }
}
test();
