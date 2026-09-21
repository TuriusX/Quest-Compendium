import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  initializeAuth, 
  browserLocalPersistence, 
  indexedDBLocalPersistence, 
  inMemoryPersistence, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut 
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY",
  authDomain: "quest-compendium-1bccf.firebaseapp.com",
  projectId: "quest-compendium-1bccf",
  storageBucket: "quest-compendium-1bccf.firebasestorage.app",
  messagingSenderId: "890629309063",
  appId: "1:890629309063:web:87293cf13f922fd3edee22",
  measurementId: "G-XX6RW18GHY"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence]
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const logOut = async () => {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('quest_guest_session');
      window.dispatchEvent(new Event('quest_auth_change'));
    }
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};
