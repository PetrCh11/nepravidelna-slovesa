// Firebase Auth + Firestore sync for progress and studyDays.
// Conflict strategy: per-verb last-write-wins via lastSeen timestamp; studyDays = union.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBeIrsdlsA0KOwJxHG1s_jjqfEEyce-oxU',
  authDomain: 'ucse-slovesa.firebaseapp.com',
  projectId: 'ucse-slovesa',
  storageBucket: 'ucse-slovesa.firebasestorage.app',
  messagingSenderId: '594618849247',
  appId: '1:594618849247:web:7b80c8b46b0e4ec012d66a',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const listeners = { onUser: null, onSync: null };
let unsubSnapshot = null;
let pushDebounceTimer = null;
let suppressPushOnce = false; // when true, the next merge from snapshot doesn't trigger a push back

export function setListeners({ onUser, onSync } = {}) {
  if (onUser) listeners.onUser = onUser;
  if (onSync) listeners.onSync = onSync;
}

function setSyncStatus(s) {
  listeners.onSync?.(s);
}

export async function signIn() {
  setSyncStatus('signing-in');
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Sign-in failed', e);
    setSyncStatus('error');
  }
}

export async function signOutNow() {
  if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }
  await signOut(auth);
}

export function getCurrentUser() {
  return auth.currentUser;
}

onAuthStateChanged(auth, (user) => {
  listeners.onUser?.(user);
  if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }
  if (!user) { setSyncStatus('idle'); return; }
  // Subscribe to live updates
  setSyncStatus('syncing');
  const ref = doc(db, 'users', user.uid);
  unsubSnapshot = onSnapshot(ref, (snap) => {
    const remote = snap.exists() ? snap.data() : { progress: {}, studyDays: [] };
    const { shouldPush } = mergeIntoLocal(remote);
    if (suppressPushOnce) { suppressPushOnce = false; setSyncStatus('synced'); return; }
    if (shouldPush) pushNow();
    else setSyncStatus('synced');
  }, (err) => {
    console.error('Firestore snapshot error', err);
    setSyncStatus('error');
  });
});

function mergeIntoLocal(remote) {
  const localProgress = JSON.parse(localStorage.getItem('progress') || '{}');
  const localDays = new Set(JSON.parse(localStorage.getItem('studyDays') || '[]'));
  const remoteProgress = remote.progress || {};
  const remoteDays = new Set(remote.studyDays || []);

  // Premium flag is server-authoritative (set by Stripe webhook). Always reflect remote value.
  if (typeof remote.premium === 'boolean') {
    localStorage.setItem('premium', remote.premium ? 'true' : 'false');
  }

  // Communication style preference (Pracující / Student) — synced across devices.
  // Remote wins if local hasn't been set yet (first sign-in on a new device).
  if (typeof remote.style === 'string' && (remote.style === 'pro' || remote.style === 'student')) {
    if (!localStorage.getItem('styleAsked')) {
      localStorage.setItem('style', remote.style);
      localStorage.setItem('styleAsked', 'true');
    }
  }

  // Per-verb LWW by lastSeen
  const merged = {};
  let shouldPush = false;
  const allKeys = new Set([...Object.keys(localProgress), ...Object.keys(remoteProgress)]);
  for (const inf of allKeys) {
    const l = localProgress[inf];
    const r = remoteProgress[inf];
    if (l && !r) { merged[inf] = l; shouldPush = true; }
    else if (!l && r) { merged[inf] = r; }
    else {
      const lT = l.lastSeen || 0;
      const rT = r.lastSeen || 0;
      merged[inf] = lT >= rT ? l : r;
      if (lT > rT) shouldPush = true;
    }
  }

  // Days = union
  const localExtra = [...localDays].filter((d) => !remoteDays.has(d));
  if (localExtra.length > 0) shouldPush = true;
  const mergedDays = [...new Set([...localDays, ...remoteDays])].sort();

  localStorage.setItem('progress', JSON.stringify(merged));
  localStorage.setItem('studyDays', JSON.stringify(mergedDays));

  // Notify app for re-render
  document.dispatchEvent(new CustomEvent('cloud-merged'));

  return { shouldPush };
}

// Wipe the user's cloud progress + study days. Replaces the whole doc
// (no merge) so nested keys under `progress` are actually deleted.
// Preserves `style` by re-writing it from localStorage if present.
export async function clearCloudProgress() {
  const user = auth.currentUser;
  if (!user) return;
  clearTimeout(pushDebounceTimer);
  setSyncStatus('syncing');
  try {
    const ref = doc(db, 'users', user.uid);
    const style = localStorage.getItem('style');
    const payload = { progress: {}, studyDays: [], updatedAt: Date.now() };
    if (style === 'pro' || style === 'student') payload.style = style;
    suppressPushOnce = true;
    await setDoc(ref, payload); // no merge → progress map fully replaced with {}
    setSyncStatus('synced');
  } catch (e) {
    console.error('Clear cloud failed', e);
    setSyncStatus('error');
  }
}

export function pushSoon() {
  if (!auth.currentUser) return;
  clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(pushNow, 800);
}

async function pushNow() {
  const user = auth.currentUser;
  if (!user) return;
  clearTimeout(pushDebounceTimer);
  setSyncStatus('syncing');
  try {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    const studyDays = JSON.parse(localStorage.getItem('studyDays') || '[]');
    const style = localStorage.getItem('style');
    const payload = { progress, studyDays, updatedAt: Date.now() };
    if (style === 'pro' || style === 'student') payload.style = style;
    const ref = doc(db, 'users', user.uid);
    suppressPushOnce = true; // the snapshot we'll receive is from our own write
    await setDoc(ref, payload, { merge: true });
    setSyncStatus('synced');
  } catch (e) {
    console.error('Push failed', e);
    setSyncStatus('error');
  }
}
