import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { ref, runTransaction, set } from 'firebase/database';
import { auth, database } from './firebase.js';

const loginEmail = (username) => `${username.toLowerCase()}@players.multiplayer-code.firebaseapp.com`;
const usernameKey = (username) => username.trim().toLowerCase();

export function watchSession(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function createAccount(usernameInput, password) {
  const username = usernameInput.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new Error('Use a username with 3–16 letters, numbers, or underscores.');
  }
  if (password.length < 6) throw new Error('Use a password with at least 6 characters.');

  const credential = await createUserWithEmailAndPassword(auth, loginEmail(username), password);
  try {
    await updateProfile(credential.user, { displayName: username });
    const claim = await runTransaction(ref(database, `usernames/${usernameKey(username)}`), (current) => {
      if (current === null) return credential.user.uid;
      return;
    });
    if (!claim.committed || claim.snapshot.val() !== credential.user.uid) {
      await deleteUser(credential.user);
      throw new Error('That username is already taken. Try another one.');
    }
    await set(ref(database, `userProfiles/${credential.user.uid}`), { username });
    return credential.user;
  } catch (error) {
    if (error.message === 'That username is already taken. Try another one.') throw error;
    if (auth.currentUser?.uid === credential.user.uid) {
      try { await deleteUser(credential.user); } catch { /* Keep the original setup error. */ }
    }
    throw error;
  }
}

export async function signInWithUsername(usernameInput, password) {
  const username = usernameInput.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Enter a valid username.');
  const credential = await signInWithEmailAndPassword(auth, loginEmail(username), password);
  if (!credential.user.displayName) await updateProfile(credential.user, { displayName: username });
  return credential.user;
}

export async function logOut() {
  await signOut(auth);
}
