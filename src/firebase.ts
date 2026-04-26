import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDL0EKyFA2NdrkhgUBrVRpipxZVj3cvVvI",
  authDomain: "magician-cabinet.firebaseapp.com",
  projectId: "magician-cabinet",
  storageBucket: "magician-cabinet.firebasestorage.app",
  messagingSenderId: "787528431798",
  appId: "1:787528431798:web:ad491e943e9e27bf8e0e17",
  measurementId: "G-YFRJZ9S6HJ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
