import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithRedirect, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  projectId: "gen-lang-client-0366642934",
  appId: "1:525238388984:web:714689b601aa7da3d9530d",
  apiKey: "AIzaSyBDbpAln2PG74U25fjURREzCMK7FrES0YE",
  authDomain: "gen-lang-client-0366642934.firebaseapp.com",
  storageBucket: "gen-lang-client-0366642934.firebasestorage.app",
  messagingSenderId: "525238388984"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Use the specific firestore database ID provided in the config
export const db = getFirestore(app, "ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f");

export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};
