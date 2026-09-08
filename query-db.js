import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBDbpAln2PG74U25fjURREzCMK7FrES0YE",
  authDomain: "gen-lang-client-0366642934.firebaseapp.com",
  projectId: "gen-lang-client-0366642934",
  storageBucket: "gen-lang-client-0366642934.firebasestorage.app",
  messagingSenderId: "525238388984",
  appId: "1:525238388984:web:714689b601aa7da3d9530d",
  measurementId: ""
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f");

async function run() {
  const querySnapshot = await getDocs(collection(db, "users"));
  querySnapshot.forEach((doc) => {
    console.log(`${doc.id} =>`, JSON.stringify(doc.data()).substring(0, 200));
  });
  process.exit(0);
}
run();
