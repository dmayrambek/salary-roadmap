// Firebase подключение для Salary Roadmap.
// Web-конфиг публичный — это нормально, секретом он не является.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2mbQOfdIA0ncUMhe8oS9IEr_ixT9SeAI",
  authDomain: "salary-roadmap.firebaseapp.com",
  projectId: "salary-roadmap",
  storageBucket: "salary-roadmap.firebasestorage.app",
  messagingSenderId: "879375192363",
  appId: "1:879375192363:web:eb719f2b49a516fb21b56e"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
