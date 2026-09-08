import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY",
  authDomain: "quest-compendium-1bccf.firebaseapp.com",
  projectId: "quest-compendium-1bccf",
  storageBucket: "quest-compendium-1bccf.firebasestorage.app",
  messagingSenderId: "890629309063",
  appId: "1:890629309063:web:87293cf13f922fd3edee22",
  measurementId: "G-XX6RW18GHY"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  try {
    const docRef = doc(db, "config", "desktop_client");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      console.log("Config:", docSnap.data());
    } else {
      console.log("No config found!");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
  process.exit(0);
}
run();
