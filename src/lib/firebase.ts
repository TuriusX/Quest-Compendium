import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  initializeAuth, 
  browserLocalPersistence, 
  indexedDBLocalPersistence, 
  browserSessionPersistence,
  inMemoryPersistence, 
  browserPopupRedirectResolver,
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
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

export const auth = (() => {
  let a;
  try {
    a = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
      popupRedirectResolver: browserPopupRedirectResolver
    });
  } catch {
    a = getAuth(app);
  }
  if (a && !(a as any)._popupRedirectResolver && browserPopupRedirectResolver) {
    try {
      (a as any)._popupRedirectResolver = typeof (browserPopupRedirectResolver as any) === 'function'
        ? new (browserPopupRedirectResolver as any)()
        : browserPopupRedirectResolver;
    } catch (e) {
      console.warn("[Firebase] Could not attach fallback popup resolver:", e);
    }
  }
  return a;
})();

export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    return result;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const signInWithGoogleRedirect = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
  } catch (error) {
    console.error("Error signing in with Google redirect", error);
    throw error;
  }
};

export { getRedirectResult, browserPopupRedirectResolver };

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
