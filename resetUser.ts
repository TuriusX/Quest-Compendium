import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp({ projectId: "gen-lang-client-0366642934" });

async function resetUser() {
  const auth = getAuth();
  try {
    const userRecord = await auth.getUserByEmail('NoahFMinton@gmail.com');
    console.log('Found user:', userRecord.uid);
    // Well, wait. I can't easily write to Firestore Admin without credentials in this container.
    // The container only has projectId. Oh, let's see if default credentials work, or maybe the user has to do it via the UI.
    console.log('User UID:', userRecord.uid);
  } catch (error) {
    console.error('Error fetching user data:', error);
  }
}

resetUser();
