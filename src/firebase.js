import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: 'AIzaSyC_mWlv7NuLbedCxc99DL51OlT-V0F-Bog',
  authDomain: 'multiplayer-code.firebaseapp.com',
  databaseURL: 'https://multiplayer-code-default-rtdb.firebaseio.com',
  projectId: 'multiplayer-code',
  storageBucket: 'multiplayer-code.firebasestorage.app',
  messagingSenderId: '976456965612',
  appId: '1:976456965612:web:87755c7adde2f16639b4c9',
  measurementId: 'G-735HLGCNLM',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
