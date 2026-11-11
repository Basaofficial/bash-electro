/* bash-electro · oblak (Firebase): prijava, projekti po korisniku, chat, admin, kontakt.
   Učitava se kao ES modul nakon glavne aplikacije i spaja se preko window.__be. */
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  signInWithRedirect, getRedirectResult, GoogleAuthProvider, signInWithCredential, updateProfile,
  sendPasswordResetEmail, sendEmailVerification, signOut
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, orderBy, limit,
  onSnapshot, serverTimestamp, getDocs
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const B = window.__be;
if (!B) throw new Error('bash-electro: glavna aplikacija nije učitana');
const esc = B.esc, toast = B.toast;
const $ = s => document.querySelector(s);
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

/* ---------- inicijalizacija ---------- */
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  ...(NATIVE ? {} : { popupRedirectResolver: browserPopupRedirectResolver })
});
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(app, { localCache: memoryLocalCache() }); }

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const st = {
  ready: false, user: null, prof: null, isAdmin: false, profUnsub: null,
  authMode: 'login', authErr: '', busy: false, pendingName: '',
  chan: LS.get('be_chan', 'global'), chans: LS.get('be_chans', []),
  auto: LS.get('be_autosync', true), lastSynced: '', syncTmr: 0, syncing: false, syncState: '',
  adminTab: 'kontakt', subs: [], news: []
};
const CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const MAX_BYTES = 900000;

/* ---------- pomoćno ---------- */
const ERR = {
  'auth/invalid-email': 'E-mail adresa nije ispravna.',
  'auth/missing-password': 'Upiši lozinku.',
  'auth/weak-password': 'Lozinka mora imati barem 6 znakova.',
  'auth/email-already-in-use': 'Za ovu e-mail adresu već postoji nalog. Prijavi se.',
  'auth/invalid-credential': 'E-mail ili lozinka nisu ispravni.',
  'auth/wrong-password': 'E-mail ili lozinka nisu ispravni.',
  'auth/user-not-found': 'Nalog s ovom e-mail adresom ne postoji.',
  'auth/user-disabled': 'Ovaj nalog je onemogućen.',
  'auth/too-many-requests': 'Previše pokušaja. Pokušaj ponovo za nekoliko minuta.',
  'auth/network-request-failed': 'Nema internetske veze.',
  'auth/popup-closed-by-user': 'Prozor za Google prijavu je zatvoren.',
  'auth/cancelled-popup-request': 'Prijava je prekinuta.',
  'auth/unauthorized-domain': 'Ova domena nije dopuštena u Firebase Authentication (Settings → Authorized domains).',
  'auth/operation-not-allowed': 'Ovaj način prijave nije uključen. Firebase konzola → Authentication → Sign-in method → uključi Email/Password i Google.',
  'auth/configuration-not-found': 'Firebase Authentication nije pokrenut. Firebase konzola → Authentication → Get started, pa uključi Email/Password i Google.',
  'auth/admin-restricted-operation': 'Registracija je zabranjena u Firebase postavkama (Authentication → Settings → User actions → uključi „Enable create (sign-up)“).',
  'auth/invalid-api-key': 'API ključ nije ispravan – provjeri js/firebase-config.js.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'API ključ nije ispravan – provjeri js/firebase-config.js.',
  'auth/requests-from-referer-are-blocked': 'API ključ je ograničen i ne dopušta ovu stranicu. Google Cloud → Credentials → Browser key → dodaj basaofficial.github.io/*.',
  'auth/internal-error': 'Interna greška prijave (često: Authentication nije uključen ili je API ključ ograničen).',
  'auth/popup-blocked': 'Preglednik je blokirao prozor za Google prijavu. Dopusti popup prozore ili pokušaj ponovo.',
  'auth/web-storage-unsupported': 'Preglednik blokira spremanje podataka (privatni način ili kolačići isključeni).',
  'native-google-missing': 'Google prijava u APK-u traži dodatak @capacitor-firebase/authentication (vidi README). Koristi prijavu e-mailom.',
  'permission-denied': 'Nemaš dopuštenje za ovu radnju.',
  'unavailable': 'Server trenutno nije dostupan. Provjeri vezu.'
};
const msgOf = e => { const c = e && e.code || '';
  const k = Object.keys(ERR).find(x => c === x || (c.startsWith('auth/requests-from-referer') && x === 'auth/requests-from-referer-are-blocked') || (c.startsWith('auth/api-key-not-valid') && x.startsWith('auth/api-key-not-valid')));
  const t = k ? ERR[k] : ((e && e.message) || 'Nepoznata greška.').replace(/^Firebase:\s*/, '');
  return c ? t + ' [' + c + ']' : t; };
const INAPP = /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|Snapchat|; wv\)/i.test(navigator.userAgent) && !NATIVE;
const fmtTime = ts => { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); if (!d) return '…';
  const now = new Date(), same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const kb = n => (n / 1024).toFixed(n < 102400 ? 1 : 0).replace('.', ',') + ' KB';
const sub = u => st.subs.push(u);
const route = () => B.getRoute();
const banned = () => !!(st.prof && st.prof.banned);
const myName = () => (st.prof && st.prof.name) || (st.user && (st.user.displayName || (st.user.email || '').split('@')[0])) || 'Korisnik';
function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?'; }
function rerender() { if (['nalog', 'projekti', 'chat', 'admin'].includes(route())) B.render(); else B.chrome(); }
function needLogin(what) {
  return `<section class="panel cl-gate"><div class="cl-ic">⚿</div><h2>Prijava je potrebna</h2><p class="mu">${what}</p>
  <div class="row" style="justify-content:center"><button class="btn" data-a="go" data-v="nalog">Prijava / registracija</button></div></section>`;
}

/* ---------- prijava ---------- */
onAuthStateChanged(auth, async u => {
  if (st.profUnsub) { st.profUnsub(); st.profUnsub = null; }
  st.user = u; st.prof = null; st.isAdmin = false; st.dbErr = '';
  st.ready = true; rerender();
  if (u) loadProfile(u);
});
async function loadProfile(u) {
    const tm = setTimeout(() => { if (st.user === u && !st.prof && !st.dbErr) { st.dbErr = 'Baza (Firestore) ne odgovara. Provjeri da je baza kreirana u Firebase konzoli.'; rerender(); } }, 8000);
    try {
      const ref = doc(db, 'users', u.uid), s = await getDoc(ref);
      if (!s.exists()) {
        const name = (st.pendingName || u.displayName || (u.email || '').split('@')[0] || 'Korisnik').trim().slice(0, 40);
        await setDoc(ref, { name, email: u.email || null, photo: u.photoURL || null, role: 'user', banned: false, createdAt: serverTimestamp() });
      }
      st.pendingName = '';
      st.profUnsub = onSnapshot(ref, d => {
        const was = st.isAdmin, wasBan = banned();
        st.prof = d.data() || null; st.isAdmin = !!(st.prof && st.prof.role === 'admin');
        if (was !== st.isAdmin || wasBan !== banned()) rerender(); else B.chrome();
      }, e => { st.dbErr = dbMsg(e); rerender(); });
    } catch (e) { console.warn('profil', e); st.dbErr = dbMsg(e); rerender(); }
    clearTimeout(tm);
}
function dbMsg(e) {
  const c = e && e.code;
  if (c === 'permission-denied') return 'Baza odbija pristup – sigurnosna pravila (firestore.rules) nisu objavljena. Firebase konzola → Firestore Database → Rules → zalijepi pravila → Publish.';
  if (c === 'not-found' || /database .*does not exist|NOT_FOUND/i.test((e && e.message) || '')) return 'Firestore baza nije kreirana. Firebase konzola → Firestore Database → Create database.';
  if (c === 'unavailable' || /offline/i.test((e && e.message) || '')) return 'Baza ne odgovara (nema veze ili baza nije kreirana).';
  return 'Greška baze: ' + ((e && (e.code || e.message)) || 'nepoznato');
}
if (!NATIVE) getRedirectResult(auth).catch(e => { st.authErr = msgOf(e); rerender(); });

async function googleLogin() {
  if (NATIVE) {
    const P = window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAuthentication;
    if (!P) throw { code: 'native-google-missing' };
    const r = await P.signInWithGoogle();
    const tok = r && r.credential && r.credential.idToken;
    if (!tok) throw { code: 'auth/cancelled-popup-request' };
    await signInWithCredential(auth, GoogleAuthProvider.credential(tok));
    return;
  }
  const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, prov); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) await signInWithRedirect(auth, prov);
    else throw e;
  }
}

function vNalog() {
  if (!st.ready) return `<div class="empty">Provjera prijave …</div>`;
  if (st.user) {
    const u = st.user, p = st.prof || {};
    const pwd = u.providerData.some(x => x.providerId === 'password');
    return `<div class="head"><h2>Nalog</h2></div>${st.dbErr ? `<p class="cl-err" style="margin:0 0 14px">Prijavljen si, ali: ${esc(st.dbErr)}</p>` : ''}<div class="grid">
    <section class="panel"><div class="cl-me"><div class="cl-av">${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc(initials(myName()))}</div>
      <div><b>${esc(myName())}</b><small class="mu">${esc(u.email || '')}</small>
      <div class="row" style="margin-top:6px"><span class="chip ${st.isAdmin ? 'ok' : 'mu'}">${st.isAdmin ? 'Administrator' : 'Korisnik'}</span>${p.banned ? '<span class="chip er">Blokiran u chatu</span>' : ''}${pwd ? (u.emailVerified ? '<span class="chip ok">E-mail potvrđen</span>' : '<span class="chip wa">E-mail nije potvrđen</span>') : '<span class="chip mu">Google</span>'}</div></div></div>
      <form data-clf="name" class="f" style="margin-top:14px"><div style="grid-column:1/-1"><label for="clnm">Ime u chatu</label><input id="clnm" maxlength="40" value="${esc(p.name || '')}" required></div>
      <div class="row"><button class="btn g" type="submit">Spremi ime</button></div></form>
      <div class="row" style="margin-top:14px">${pwd && !u.emailVerified ? '<button class="btn g" data-cl="verify">Pošalji potvrdu e-maila</button>' : ''}${pwd ? '<button class="btn g" data-cl="resetme">Promijeni lozinku</button>' : ''}<button class="btn dg" data-cl="logout">Odjava</button></div></section>
    <section class="panel"><h2>Što ti nalog donosi</h2><ul class="ctl2"><li><b>Moji projekti</b> – projekti spremljeni u oblak, dostupni na svakom uređaju.</li><li><b>Chat</b> – globalni chat i privatni kanali sa šifrom.</li><li>Kontakt poruke vezane uz tvoj nalog.</li></ul>
      <div class="row" style="margin-top:12px"><button class="btn" data-a="go" data-v="projekti">Moji projekti</button><button class="btn g" data-a="go" data-v="chat">Chat</button></div></section>${diagBox()}</div>`;
  }
  const m = st.authMode, err = st.authErr ? `<p class="cl-err">${esc(st.authErr)}</p>` : '';
  const inapp = INAPP ? '<p class="cl-err">Otvoreno si u ugrađenom pregledniku (npr. Instagram). Google prijava ovdje ne radi – otvori stranicu u Chrome ili Safari (⋮ → Otvori u pregledniku).</p>' : '';
  const seg = `<div class="seg" style="margin-bottom:14px"><button class="${m === 'login' ? 'on' : ''}" data-cl="mode" data-v="login">Prijava</button><button class="${m === 'reg' ? 'on' : ''}" data-cl="mode" data-v="reg">Registracija</button></div>`;
  let form;
  if (m === 'reset') form = `<h2>Nova lozinka</h2><p class="mu">Pošaljemo ti link za postavljanje nove lozinke.</p><form data-clf="reset" class="cl-form">
    <label for="cle">E-mail</label><input id="cle" type="email" autocomplete="email" required>${err}
    <button class="btn" type="submit" ${st.busy ? 'disabled' : ''}>Pošalji link</button><button class="btn g" type="button" data-cl="mode" data-v="login">Natrag na prijavu</button></form>`;
  else form = `${seg}<form data-clf="${m}" class="cl-form">
    ${m === 'reg' ? '<label for="cln">Ime i prezime</label><input id="cln" autocomplete="name" maxlength="40" required>' : ''}
    <label for="cle">E-mail</label><input id="cle" type="email" autocomplete="email" inputmode="email" required>
    <label for="clp">Lozinka</label><input id="clp" type="password" autocomplete="${m === 'reg' ? 'new-password' : 'current-password'}" minlength="6" required>
    ${m === 'reg' ? '<label for="clp2">Ponovi lozinku</label><input id="clp2" type="password" autocomplete="new-password" minlength="6" required>' : ''}
    ${err}<button class="btn lg" type="submit" ${st.busy ? 'disabled' : ''}>${m === 'reg' ? 'Kreiraj nalog' : 'Prijavi se'}</button>
    ${m === 'login' ? '<button class="btn g s cl-link" type="button" data-cl="mode" data-v="reset">Zaboravljena lozinka?</button>' : ''}</form>
    <div class="cl-or"><span>ili</span></div>
    <button class="btn g lg cl-google" data-cl="google" ${st.busy ? 'disabled' : ''}><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Nastavi s Google nalogom</button>`;
  return `<div class="cl-auth"><section class="panel"><div class="brand" style="padding:0 0 12px"><b>#</b>bash-electro<small>Nalog za oblak, projekte i chat</small></div>${inapp}${form}</section>
    ${diagBox()}
    <p class="mu cl-note">Planer radi i bez naloga – podaci ostaju u ovom pregledniku. Nalog treba za spremanje u oblak i chat.</p></div>`;
}

function diagBox() { return `<section class="panel" style="margin-top:var(--pad)"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Dijagnostika veze</h2><button class="btn g s" data-cl="diag">Provjeri</button></div><div id="cldiag"><p class="mu" style="margin:8px 0 0;font-size:12px">Ako prijava ne radi, klikni Provjeri – pokazat će tačno šta treba podesiti u Firebaseu.</p></div></section>`; }
async function authSubmit(kind, f) {
  const v = id => (f.querySelector('#' + id) || {}).value || '';
  st.keep = { cle: v('cle'), cln: v('cln') };
  st.authErr = ''; st.busy = true; rerender();
  try {
    if (kind === 'login') await signInWithEmailAndPassword(auth, v('cle').trim(), v('clp'));
    else if (kind === 'reg') {
      const name = v('cln').trim();
      if (name.length < 2) throw { message: 'Upiši ime (barem 2 znaka).' };
      if (v('clp') !== v('clp2')) throw { message: 'Lozinke se ne podudaraju.' };
      st.pendingName = name.slice(0, 40);
      const c = await createUserWithEmailAndPassword(auth, v('cle').trim(), v('clp'));
      await updateProfile(c.user, { displayName: st.pendingName }).catch(() => {});
      sendEmailVerification(c.user).catch(() => {});
      toast('Nalog je kreiran. Provjeri e-mail za potvrdu adrese.');
    } else if (kind === 'reset') {
      await sendPasswordResetEmail(auth, v('cle').trim());
      st.authMode = 'login'; toast('Link za novu lozinku je poslan, ako nalog postoji.');
    }
  } catch (e) { st.authErr = msgOf(e); st.pendingName = ''; }
  st.busy = false; rerender();
  if (st.authErr && st.keep) for (const [id, val] of Object.entries(st.keep)) { const el = document.getElementById(id); if (el && val) el.value = val; }
}

/* ---------- dijagnostika ---------- */
async function diagnose() {
  const out = $('#cldiag'); if (!out) return;
  const R = [], row = (ok, t) => R.push(`<div class="res"><i class="${ok === true ? 'ok' : ok === false ? 'er' : 'wa'}">${ok === true ? 'OK' : ok === false ? 'GREŠKA' : 'INFO'}</i><span>${t}</span></div>`);
  out.innerHTML = '<p class="mu">Provjeravam …</p>';
  row(true, 'Adresa stranice: ' + esc(location.origin));
  if (INAPP) row(false, 'Otvoreno u ugrađenom pregledniku (Instagram/Facebook/…) – Google prijava tu ne radi. Otvori stranicu u Chrome/Safari.');
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=' + firebaseConfig.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dijagnostika@example.com', continueUri: location.origin }) });
    const j = await r.json().catch(() => ({}));
    const m = (j.error && j.error.message) || '';
    if (r.ok) row(true, 'Firebase Authentication radi i prihvata ovu stranicu.');
    else if (/CONFIGURATION_NOT_FOUND/.test(m)) row(false, 'Authentication nije pokrenut: Firebase konzola → Authentication → <b>Get started</b>, zatim uključi Email/Password i Google.');
    else if (/referer|API_KEY_HTTP_REFERRER_BLOCKED/i.test(m) || /referer/i.test(JSON.stringify(j))) row(false, 'API ključ ne dopušta ovu adresu. Google Cloud → Credentials → Browser key → Website restrictions → dodaj <b>' + esc(location.host) + '/*</b>.');
    else if (/API key not valid|API_KEY_INVALID/i.test(m)) row(false, 'API ključ nije ispravan (js/firebase-config.js).');
    else row(false, 'Authentication odgovara greškom: ' + esc(m || r.status));
  } catch (e) { row(false, 'Ne mogu doći do Firebase Authentication servera (nema veze ili ga blokira mreža/ad-blocker).'); }
  try {
    const p = await getDocsNews();
    row(true, 'Firestore baza postoji i pravila su objavljena' + (p ? '' : '') + '.');
  } catch (e) { row(false, esc(dbMsg(e))); }
  if (st.user) row(st.prof ? true : null, st.prof ? 'Profil u bazi je učitan (' + esc(st.prof.role) + ').' : 'Profil u bazi još nije učitan.');
  row(null, 'Google prijava traži da je <b>' + esc(location.hostname) + '</b> na listi Authentication → Settings → Authorized domains.');
  out.innerHTML = R.join('');
}
async function getDocsNews() { const s = await getDocs(query(collection(db, 'news'), limit(1))); return s.size; }

/* ---------- projekti ---------- */
function projData() { const S = B.S, o = Object.assign({}, S); delete o.ui; delete o.cloudId; return JSON.stringify(o); }
async function saveCloud(asNew, silent) {
  if (!st.user) return;
  const S = B.S, data = projData(), size = new Blob([data]).size;
  if (size > MAX_BYTES) { if (!silent) toast('Projekt je prevelik za oblak (' + kb(size) + ', max ' + kb(MAX_BYTES) + ').'); st.syncState = 'prevelik'; return; }
  const col = collection(db, 'users', st.user.uid, 'projects');
  const isNew = asNew || !S.cloudId, ref = isNew ? doc(col) : doc(col, S.cloudId);
  const body = { name: String(S.p.name || 'Projekt').slice(0, 120), data, size, updatedAt: serverTimestamp() };
  if (isNew) body.createdAt = serverTimestamp();
  st.syncing = true; paintSync();
  try {
    await setDoc(ref, body, { merge: true });
    if (isNew) { S.cloudId = ref.id; try { localStorage.setItem('be2', JSON.stringify(S)); } catch (e) {} }
    st.lastSynced = data; st.syncState = 'spremljeno ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (!silent) toast(isNew ? 'Projekt je spremljen u oblak.' : 'Projekt je ažuriran u oblaku.');
  } catch (e) { st.syncState = 'greška'; if (!silent) toast('Spremanje nije uspjelo: ' + msgOf(e)); }
  st.syncing = false; paintSync(); if (route() === 'projekti') paintProjHead();
}
function onSave() {
  if (!st.user || !st.auto || !B.S || !B.S.cloudId) return;
  clearTimeout(st.syncTmr);
  st.syncTmr = setTimeout(() => { const d = projData(); if (d !== st.lastSynced && !st.syncing) saveCloud(false, true); }, 4000);
}
function paintSync() { const e = $('#clsync'); if (e) e.textContent = st.syncing ? 'Spremam …' : (st.syncState || ''); }
function projHead() {
  const S = B.S, linked = !!S.cloudId;
  return `<h2>Trenutni projekt</h2><p style="margin:0 0 4px"><b>${esc(S.p.name)}</b></p>
   <p class="mu" style="margin:0 0 12px;font-size:12px">${linked ? 'Povezan s oblakom' : 'Još nije u oblaku'} · <span id="clsync">${esc(st.syncState)}</span></p>
   <div class="row"><button class="btn" data-cl="psave">${linked ? 'Spremi promjene' : 'Spremi u oblak'}</button>${linked ? '<button class="btn g" data-cl="psavenew">Spremi kao novi</button>' : ''}</div>
   <div class="srow" style="margin-top:10px"><div>Automatsko spremanje<small>Promjene povezanog projekta spremaju se same nakon nekoliko sekundi.</small></div><button class="sw${st.auto ? ' on' : ''}" data-cl="auto" role="switch" aria-checked="${st.auto}" aria-label="Automatsko spremanje"></button></div>`;
}
function paintProjHead() { const e = $('#clph'); if (e) e.innerHTML = projHead(); }
function vProjekti() {
  if (!st.ready) return `<div class="empty">Provjera prijave …</div>`;
  if (!st.user) return `<div class="head"><h2>Moji projekti</h2></div>` + needLogin('Prijavi se da spremiš projekte u oblak i otvoriš ih na telefonu, tabletu ili računaru.');
  return `<div class="head"><h2>Moji projekti</h2><button class="btn g" data-a="blank">Novi prazni projekt</button></div>
  <div class="grid"><section class="panel" id="clph">${projHead()}</section>
  <section class="panel" style="grid-column:1/-1"><h2>U oblaku</h2><div id="clpl"><div class="empty">Učitavanje …</div></div></section></div>`;
}
function mountProjekti() {
  if (!st.user) return;
  sub(onSnapshot(query(collection(db, 'users', st.user.uid, 'projects'), orderBy('updatedAt', 'desc'), limit(100)), s => {
    const el = $('#clpl'); if (!el) return;
    const cur = B.S.cloudId;
    el.innerHTML = s.empty ? '<p class="mu" style="margin:0">Nema spremljenih projekata. Spremi trenutni projekt gore.</p>' :
      `<div class="sc"><table class="t"><thead><tr><th>Naziv</th><th>Promijenjeno</th><th class="num">Veličina</th><th></th></tr></thead><tbody>` +
      s.docs.map(d => { const p = d.data({ serverTimestamps: 'estimate' });
        return `<tr${d.id === cur ? ' class="hl"' : ''}><td><b>${esc(p.name)}</b>${d.id === cur ? ' <span class="chip ok">otvoren</span>' : ''}</td><td class="mono">${esc(fmtTime(p.updatedAt))}</td><td class="num">${kb(p.size || 0)}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn g s" data-cl="popen" data-v="${d.id}">Otvori</button><button class="btn dg s" data-cl="pdel" data-v="${d.id}">Obriši</button></div></td></tr>`; }).join('') + '</tbody></table></div>';
  }, e => { const el = $('#clpl'); if (el) el.innerHTML = `<p class="cl-err">${esc(msgOf(e))}</p>`; }));
}
async function openProject(id) {
  try {
    const s = await getDoc(doc(db, 'users', st.user.uid, 'projects', id));
    if (!s.exists()) { toast('Projekt više ne postoji.'); return; }
    const data = s.data().data, o = JSON.parse(data);
    st.lastSynced = data; B.loadProject(o, id); toast('Projekt „' + (o.p && o.p.name || '') + '“ je otvoren.');
  } catch (e) { toast('Otvaranje nije uspjelo: ' + msgOf(e)); }
}

/* ---------- chat ---------- */
function saveChans() { LS.set('be_chans', st.chans); LS.set('be_chan', st.chan); }
function vChat() {
  if (!st.ready) return `<div class="empty">Provjera prijave …</div>`;
  if (!st.user) return `<div class="head"><h2>Chat</h2></div>` + needLogin('Chat je dostupan prijavljenim korisnicima: globalni kanal za sve i privatni kanali sa šifrom.');
  if (banned()) return `<div class="head"><h2>Chat</h2></div><section class="panel cl-gate"><div class="cl-ic er">⛔</div><h2>Pristup chatu je blokiran</h2><p class="mu">Administrator je blokirao tvoj nalog u chatu. Za pojašnjenje koristi kontakt formu.</p><button class="btn g" data-a="go" data-v="kontakt">Kontakt</button></section>`;
  const c = st.chan, label = c === 'global' ? 'Globalni chat' : 'Kanal ' + c;
  const item = (k, n, sub) => `<button class="cl-ch${c === k ? ' on' : ''}" data-cl="chan" data-v="${esc(k)}"><b>${esc(n)}</b><small>${esc(sub)}</small></button>`;
  return `<div class="cl-chat">
   <aside class="cl-side panel">
    <div class="cl-chs">${item('global', '# Globalni', 'svi korisnici')}${st.chans.map(k => item(k, '🔒 ' + k, 'kanal sa šifrom')).join('')}</div>
    <form data-clf="join" class="cl-join"><label for="clcode">Šifra kanala</label><div class="row" style="flex-wrap:nowrap"><input id="clcode" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="npr. 1332"><button class="btn s" type="submit">Uđi</button></div>
     <button class="btn g s" type="button" data-cl="mkchan">Kreiraj kanal s ovom šifrom</button><small class="mu">4–16 slova ili brojeva. Ko zna šifru, vidi kanal – koristi dužu šifru za privatne razgovore.</small></form>
   </aside>
   <section class="cl-box panel">
    <header class="cl-bh"><div><b>${esc(label)}</b><small class="mu">${c === 'global' ? 'Poruke vide svi prijavljeni korisnici' : 'Podijeli šifru ' + esc(c) + ' s kolegama'}</small></div>
     ${c !== 'global' ? `<button class="btn g s" data-cl="leave" data-v="${esc(c)}">Napusti</button>` : ''}</header>
    <div id="clnews"></div>
    <div class="cl-log" id="cllog"><div class="empty">Učitavanje poruka …</div></div>
    <form data-clf="send" class="cl-in"><textarea id="clmsg" rows="1" maxlength="1000" placeholder="Poruka…" enterkeyhint="send"></textarea><button class="btn" type="submit" aria-label="Pošalji">➤</button></form>
   </section></div>`;
}
function newsHTML(L, admin) {
  return L.map(n => { const v = n.data({ serverTimestamps: 'estimate' });
    return `<article class="cl-news"><div><b>${esc(v.title)}</b><span class="mu mono"> · ${esc(fmtTime(v.ts))}</span></div><p>${esc(v.text)}</p>${admin ? `<button class="btn dg s" data-cl="newsdel" data-v="${n.id}">Obriši objavu</button>` : ''}</article>`; }).join('');
}
function mountChat() {
  if (!st.user || banned()) return;
  const c = st.chan, log = $('#cllog');
  sub(onSnapshot(query(collection(db, 'news'), orderBy('ts', 'desc'), limit(2)), s => { const e = $('#clnews'); if (e) e.innerHTML = newsHTML(s.docs, false); }, () => {}));
  sub(onSnapshot(query(collection(db, 'channels', c, 'messages'), orderBy('ts', 'desc'), limit(150)), s => {
    if (!log.isConnected) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const docs = s.docs.slice().reverse(), me = st.user.uid;
    let prev = null;
    log.innerHTML = docs.length ? docs.map(d => { const m = d.data({ serverTimestamps: 'estimate' }), mine = m.uid === me, cont = prev === m.uid; prev = m.uid;
      const tools = (mine || st.isAdmin) ? `<span class="cl-tools">${st.isAdmin && !mine ? `<button data-cl="ban" data-v="${esc(m.uid)}" data-n="${esc(m.name)}" title="Blokiraj korisnika">Ban</button>` : ''}<button data-cl="mdel" data-v="${d.id}" title="Obriši poruku">Obriši</button></span>` : '';
      return `<div class="cl-msg${mine ? ' me' : ''}${cont ? ' cont' : ''}">${cont ? '' : `<div class="cl-mh"><b>${esc(m.name)}</b><span>${esc(fmtTime(m.ts))}</span></div>`}<div class="cl-bub"><p>${esc(m.text)}</p>${tools}</div></div>`; }).join('')
      : '<div class="empty">Još nema poruka. Napiši prvu.</div>';
    if (nearBottom || s.docChanges().some(ch => ch.type === 'added' && ch.doc.data().uid === me)) log.scrollTop = log.scrollHeight;
  }, e => { if (log.isConnected) log.innerHTML = `<p class="cl-err">${esc(msgOf(e))}</p>`; }));
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const ta = $('#clmsg');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ta.form.requestSubmit(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
}
async function joinChan(code, create) {
  code = (code || '').trim();
  if (!CODE_RE.test(code) || code.toLowerCase() === 'global') { toast('Šifra mora imati 4–16 slova ili brojeva.'); return; }
  try {
    const ref = doc(db, 'channels', code), s = await getDoc(ref);
    if (!s.exists()) {
      if (!create) { toast('Kanal ' + code + ' ne postoji. Klikni „Kreiraj kanal s ovom šifrom“.'); return; }
      await setDoc(ref, { createdBy: st.user.uid, createdAt: serverTimestamp() });
      toast('Kanal ' + code + ' je kreiran. Podijeli šifru s kolegama.');
    } else if (create) toast('Kanal ' + code + ' već postoji – pridružen si.');
    if (!st.chans.includes(code)) st.chans.unshift(code);
    st.chans = st.chans.slice(0, 20); st.chan = code; saveChans(); B.render();
  } catch (e) { toast(msgOf(e)); }
}

/* ---------- admin ---------- */
function vAdmin() {
  if (!st.ready) return `<div class="empty">Provjera prijave …</div>`;
  if (!st.isAdmin) return `<div class="head"><h2>Admin</h2></div><section class="panel cl-gate"><h2>Nemaš pristup</h2><p class="mu">Ovaj dio je samo za administratore.</p></section>`;
  const t = st.adminTab, tb = (k, n) => `<button class="${t === k ? 'on' : ''}" data-cl="atab" data-v="${k}">${n}</button>`;
  let body = '';
  if (t === 'kontakt') body = `<section class="panel"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Kontakt poruke</h2><span class="mu" id="clacnt"></span></div><div id="clalist"><div class="empty">Učitavanje …</div></div></section>`;
  if (t === 'users') body = `<section class="panel"><h2>Korisnici</h2><input id="clufind" placeholder="Traži po imenu ili e-mailu" style="margin-bottom:10px"><div id="clalist"><div class="empty">Učitavanje …</div></div></section>`;
  if (t === 'news') body = `<div class="grid"><section class="panel"><h2>Nova objava</h2><form data-clf="news" class="cl-form"><label for="clnt">Naslov</label><input id="clnt" maxlength="100" required><label for="clnx">Tekst</label><textarea id="clnx" maxlength="1500" rows="5" required></textarea><button class="btn" type="submit">Objavi</button></form><p class="mu" style="font-size:12px">Zadnje dvije objave prikazuju se na vrhu chata.</p></section>
    <section class="panel"><h2>Objave</h2><div id="clalist"><div class="empty">Učitavanje …</div></div></section></div>`;
  return `<div class="head"><h2>Admin</h2><div class="seg">${tb('kontakt', 'Kontakt')}${tb('users', 'Korisnici')}${tb('news', 'Objave')}</div></div>${body}`;
}
function mountAdmin() {
  if (!st.isAdmin) return;
  const el = () => $('#clalist'), fail = e => { const x = el(); if (x) x.innerHTML = `<p class="cl-err">${esc(msgOf(e))}</p>`; };
  if (st.adminTab === 'kontakt') sub(onSnapshot(query(collection(db, 'contact'), orderBy('ts', 'desc'), limit(200)), s => {
    const x = el(); if (!x) return; const un = s.docs.filter(d => !d.data().read).length; const c = $('#clacnt'); if (c) c.textContent = `${s.size} ukupno · ${un} nepročitanih`;
    x.innerHTML = s.empty ? '<p class="mu" style="margin:0">Nema poruka.</p>' : s.docs.map(d => { const m = d.data({ serverTimestamps: 'estimate' });
      return `<article class="msg${m.read ? '' : ' new'}"><header><b>${esc(m.n)}</b><span class="mu mono">${esc(fmtTime(m.ts))}</span></header>
      <div class="mu" style="font-size:12px">${esc(m.t)} · <span class="sel">${esc(m.e)}</span>${m.ph ? ' · ' + esc(m.ph) : ''} · ${esc(m.ref)}${m.uid ? ' · prijavljen korisnik' : ''}</div><p>${esc(m.m)}</p>${m.sum ? `<p class="mu" style="font-size:12px">${esc(m.sum)}</p>` : ''}
      <div class="row"><a class="btn g s" style="text-decoration:none" href="mailto:${encodeURIComponent(m.e)}?subject=${encodeURIComponent('Re: [bash-electro] ' + m.t + ' · ' + m.ref)}">Odgovori e-mailom</a>${m.read ? '' : `<button class="btn g s" data-cl="cread" data-v="${d.id}">Označi pročitano</button>`}<button class="btn dg s" data-cl="cdel" data-v="${d.id}">Obriši</button></div></article>`; }).join('');
  }, fail));
  if (st.adminTab === 'users') {
    let docs = [];
    const paint = () => { const x = el(); if (!x) return; const q = (($('#clufind') || {}).value || '').toLowerCase();
      const L = docs.filter(d => { const u = d.data(); return !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q); });
      x.innerHTML = `<div class="sc"><table class="t"><thead><tr><th>Ime</th><th>E-mail</th><th>Uloga</th><th>Status</th><th></th></tr></thead><tbody>` + L.map(d => { const u = d.data({ serverTimestamps: 'estimate' }), self = d.id === st.user.uid;
        return `<tr><td><b>${esc(u.name)}</b>${self ? ' <span class="chip mu">ti</span>' : ''}</td><td class="sel">${esc(u.email || '–')}</td><td>${u.role === 'admin' ? '<span class="chip ok">admin</span>' : 'korisnik'}</td><td>${u.banned ? '<span class="chip er">blokiran</span>' : '<span class="ok">aktivan</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap">${self ? '' : `<button class="btn ${u.banned ? 'g' : 'dg'} s" data-cl="${u.banned ? 'unban' : 'ban'}" data-v="${d.id}" data-n="${esc(u.name)}">${u.banned ? 'Odblokiraj' : 'Ban'}</button><button class="btn g s" data-cl="role" data-v="${d.id}" data-r="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Ukloni admina' : 'Postavi za admina'}</button>`}</div></td></tr>`; }).join('') + '</tbody></table></div>' + (L.length ? '' : '<p class="mu">Nema rezultata.</p>');
    };
    sub(onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(500)), s => { docs = s.docs; paint(); }, fail));
    const f = $('#clufind'); if (f) f.addEventListener('input', paint);
  }
  if (st.adminTab === 'news') sub(onSnapshot(query(collection(db, 'news'), orderBy('ts', 'desc'), limit(50)), s => { const x = el(); if (x) x.innerHTML = s.empty ? '<p class="mu" style="margin:0">Nema objava.</p>' : newsHTML(s.docs, true); }, fail));
}

/* ---------- kontakt (poziva ga forma u glavnoj aplikaciji) ---------- */
async function sendContact(m) {
  const cut = (x, n) => String(x || '').slice(0, n);
  await addDoc(collection(db, 'contact'), {
    ref: cut(m.ref, 40), n: cut(m.n, 80), e: cut(m.e, 120), ph: cut(m.ph, 30), t: cut(m.t, 60), m: cut(m.m, 2000), sum: cut(m.sum, 600),
    uid: st.user ? st.user.uid : null, read: false, ts: serverTimestamp()
  });
}

/* ---------- događaji ---------- */
const confirm2 = (b, label) => { if (b.dataset.sure) return true; const t = b.textContent; b.dataset.sure = '1'; b.textContent = label || 'Potvrdi';
  setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = t; } }, 4000); return false; };
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cl]'); if (!b) return; e.preventDefault();
  const a = b.dataset.cl, v = b.dataset.v;
  try {
    if (a === 'diag') { diagnose(); return; }
    if (a === 'mode') { st.authMode = v; st.authErr = ''; B.render(); return; }
    if (a === 'google') { st.authErr = ''; st.busy = true; rerender(); try { await googleLogin(); } catch (x) { st.authErr = msgOf(x); } st.busy = false; rerender(); return; }
    if (a === 'logout') { await signOut(auth); toast('Odjavljen si.'); return; }
    if (a === 'verify') { await sendEmailVerification(st.user); toast('Poslan je e-mail za potvrdu.'); return; }
    if (a === 'resetme') { await sendPasswordResetEmail(auth, st.user.email); toast('Link za novu lozinku je poslan na ' + st.user.email + '.'); return; }
    if (a === 'psave') { saveCloud(false); return; }
    if (a === 'psavenew') { saveCloud(true); return; }
    if (a === 'auto') { st.auto = !st.auto; LS.set('be_autosync', st.auto); paintProjHead(); return; }
    if (a === 'popen') { openProject(v); return; }
    if (a === 'pdel') { if (!confirm2(b, 'Potvrdi brisanje')) return; await deleteDoc(doc(db, 'users', st.user.uid, 'projects', v)); if (B.S.cloudId === v) { B.S.cloudId = null; paintProjHead(); } toast('Projekt je obrisan iz oblaka.'); return; }
    if (a === 'chan') { st.chan = v; saveChans(); B.render(); return; }
    if (a === 'leave') { st.chans = st.chans.filter(k => k !== v); st.chan = 'global'; saveChans(); B.render(); return; }
    if (a === 'mkchan') { joinChan(($('#clcode') || {}).value, true); return; }
    if (a === 'mdel') { if (!confirm2(b, 'Sigurno?')) return; await deleteDoc(doc(db, 'channels', st.chan, 'messages', v)); return; }
    if (a === 'ban' || a === 'unban') { if (a === 'ban' && !confirm2(b, 'Potvrdi ban')) return; await updateDoc(doc(db, 'users', v), { banned: a === 'ban' }); toast((a === 'ban' ? 'Blokiran: ' : 'Odblokiran: ') + (b.dataset.n || 'korisnik')); return; }
    if (a === 'role') { if (!confirm2(b, 'Potvrdi')) return; await updateDoc(doc(db, 'users', v), { role: b.dataset.r }); return; }
    if (a === 'atab') { st.adminTab = v; B.render(); return; }
    if (a === 'cread') { await updateDoc(doc(db, 'contact', v), { read: true }); return; }
    if (a === 'cdel') { if (!confirm2(b, 'Potvrdi brisanje')) return; await deleteDoc(doc(db, 'contact', v)); return; }
    if (a === 'newsdel') { if (!confirm2(b, 'Potvrdi brisanje')) return; await deleteDoc(doc(db, 'news', v)); return; }
  } catch (x) { toast(msgOf(x)); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-clf]'); if (!f) return; e.preventDefault();
  const k = f.dataset.clf;
  try {
    if (['login', 'reg', 'reset'].includes(k)) { authSubmit(k, f); return; }
    if (k === 'name') { const n = $('#clnm').value.trim().slice(0, 40); if (n.length < 2) { toast('Ime mora imati barem 2 znaka.'); return; }
      await updateDoc(doc(db, 'users', st.user.uid), { name: n }); await updateProfile(st.user, { displayName: n }).catch(() => {}); toast('Ime je spremljeno.'); return; }
    if (k === 'join') { joinChan($('#clcode').value, false); return; }
    if (k === 'send') { const ta = $('#clmsg'), t = ta.value.trim(); if (!t) return; if (t.length > 1000) { toast('Poruka je preduga (max 1000 znakova).'); return; }
      ta.value = ''; ta.style.height = 'auto';
      try { await addDoc(collection(db, 'channels', st.chan, 'messages'), { uid: st.user.uid, name: myName(), text: t, ts: serverTimestamp() }); }
      catch (x) { ta.value = t; throw x; } return; }
    if (k === 'news') { const ti = $('#clnt').value.trim(), tx = $('#clnx').value.trim(); if (!ti || !tx) return;
      await addDoc(collection(db, 'news'), { title: ti.slice(0, 100), text: tx.slice(0, 1500), by: st.user.uid, ts: serverTimestamp() }); f.reset(); toast('Objava je objavljena.'); return; }
  } catch (x) { toast(msgOf(x)); }
});

/* ---------- most prema glavnoj aplikaciji ---------- */
window.BECloud = {
  get isAdmin() { return st.isAdmin; },
  get user() { return st.user; },
  view(r) { return r === 'nalog' ? vNalog() : r === 'projekti' ? vProjekti() : r === 'chat' ? vChat() : r === 'admin' ? vAdmin() : ''; },
  mount(r) { if (r === 'projekti') mountProjekti(); else if (r === 'chat') mountChat(); else if (r === 'admin') mountAdmin(); },
  unmount() { st.subs.splice(0).forEach(u => { try { u(); } catch (e) {} }); },
  chrome() { const b = $('#acct'); if (b) { b.textContent = st.user ? myName().split(' ')[0] : 'Prijava'; b.classList.toggle('on', !!st.user); } },
  onSave, sendContact
};
rerender();
