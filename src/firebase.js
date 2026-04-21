import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDw6ctIC-NRXjY2upsocOGd_3PgwWjiFVE",
  authDomain: "quiz-board-claude.firebaseapp.com",
  projectId: "quiz-board-claude",
  storageBucket: "quiz-board-claude.firebasestorage.app",
  messagingSenderId: "468154059492",
  appId: "1:468154059492:web:18e0ef6fee7fe5f6e73af1",
  measurementId: "G-KZFKXRCDLN"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
