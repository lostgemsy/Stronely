import { onDisconnect, onValue, orderByChild, push, query, ref, remove, set, serverTimestamp, limitToLast } from 'firebase/database';
import { database } from './firebase.js';

const cleanRoom = (value) => (value || 'lobby').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'lobby';

export async function connectRoom(user, callbacks) {
  const roomId = cleanRoom(new URLSearchParams(location.search).get('room'));
  const username = user.displayName || 'Player';
  const playersRef = ref(database, `rooms/${roomId}/players`);
  const playerRef = ref(database, `rooms/${roomId}/players/${user.uid}`);
  const chatQuery = query(ref(database, `rooms/${roomId}/chat`), orderByChild('createdAt'), limitToLast(50));

  const stopPlayers = onValue(playersRef, (snapshot) => callbacks.players(snapshot.val() || {}), callbacks.error);
  const stopChat = onValue(chatQuery, (snapshot) => {
    const messages = [];
    snapshot.forEach((child) => messages.push({ id: child.key, ...child.val() }));
    callbacks.chat(messages);
  }, callbacks.error);

  await set(playerRef, { uid: user.uid, username, x: 0, y: 0, z: 0, yaw: 0, updatedAt: Date.now() });
  await onDisconnect(playerRef).remove();

  return {
    roomId,
    uid: user.uid,
    publish(position) {
      return set(playerRef, { uid: user.uid, username, ...position, updatedAt: Date.now() });
    },
    async sendChat(text) {
      const messageRef = push(ref(database, `rooms/${roomId}/chat`));
      await set(messageRef, { uid: user.uid, username, text, createdAt: serverTimestamp() });
    },
    disconnect() {
      stopPlayers();
      stopChat();
      return remove(playerRef);
    },
  };
}
