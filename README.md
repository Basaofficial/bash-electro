# #bash-electro

Planer elektro instalacija i ormara (Verteiler) za njemačko tržište: 3D kuća, 3D Verteiler, montaža, Crtač 5D, strujni krugovi, proračun (Ib, Iz, ΔU, Abschaltbedingung), Prüfprotokoll i PDF dokumentacija – sada s Firebase oblakom: nalog, projekti po korisniku, chat, admin i kontakt forma.

**Web aplikacija:** https://basaofficial.github.io/bash-electro/
**Android APK:** [Releases](../../releases)

## Struktura

| Datoteka | Sadržaj |
|---|---|
| `index.html` | Cijela aplikacija (planer, 3D, PDF) |
| `js/cloud.js` | Firebase: prijava, Moji projekti, Chat, Admin, slanje kontakt forme |
| `js/firebase-config.js` | `firebaseConfig` projekta *bash-electro* |
| `css/cloud.css` | Izgled prijave, chata i admina |
| `firestore.rules` | Sigurnosna pravila baze |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (offline, instalacija na početni ekran) |
| `capacitor.config.json`, `package.json`, `scripts/` | Android APK preko Capacitora |
| `.github/workflows/android-apk.yml` | Automatska izrada APK-a na GitHubu |

Planer radi i bez prijave (podaci ostaju u pregledniku). Nalog treba za oblak i chat.

---

## 1. Firebase – jednokratno podešavanje

U [Firebase konzoli](https://console.firebase.google.com/project/bash-electro):

1. **Authentication → Sign-in method** → uključi **Email/Password** i **Google** (kod Googlea izaberi support e-mail i spremi).
2. **Authentication → Settings → Authorized domains** → *Add domain* → `basaofficial.github.io`
   (`localhost` je već na listi – treba ga APK i lokalno testiranje).
3. **Firestore Database → Create database** → lokacija `eur3 (europe-west)` → *Production mode*.
4. **Firestore Database → Rules** → zalijepi cijeli sadržaj datoteke `firestore.rules` → **Publish**.
   (Ili preko CLI: `npm i -g firebase-tools`, `firebase login`, `firebase deploy --only firestore:rules`.)
5. **Postavi sebe za admina** (samo prvi put):
   - otvori aplikaciju i registriraj se / prijavi se,
   - u konzoli: Firestore → kolekcija `users` → tvoj dokument → polje `role` promijeni iz `user` u `admin`,
   - osvježi aplikaciju: u izborniku se pojavljuje **Admin**. Ostale admine kasnije postavljaš iz same aplikacije (Admin → Korisnici).

### Model podataka

```
users/{uid}                 name, email, photo, role ('user'|'admin'), banned, createdAt
users/{uid}/projects/{id}   name, data (JSON projekta), size, createdAt, updatedAt
channels/global/messages    globalni chat
channels/{šifra}            createdBy, createdAt      (npr. channels/1332)
channels/{šifra}/messages   uid, name, text, ts
news/{id}                   objave admina (prikazuju se na vrhu chata)
contact/{id}                poruke iz kontakt forme (čita samo admin)
```

### Što pravila osiguravaju

- Projekte čita i mijenja **samo vlasnik**.
- Korisnik ne može sam sebi dati `admin` ni skinuti ban; admin ne može mijenjati sebe.
- Chat: samo prijavljeni i neblokirani korisnici; ime u poruci mora odgovarati imenu iz profila; poruka max 1000 znakova; brisanje – autor ili admin.
- Kanali se **ne mogu izlistati**, ulazi se samo poznatom šifrom. Kratku šifru (npr. 4 broja) netko može pogoditi – za stvarno privatne razgovore koristi dužu šifru (8+ znakova).
- Kontakt formu može poslati svako (i bez prijave), čitaju je samo admini.

### Obavijest e-mailom za kontakt formu (opcionalno)

Poruke se spremaju u Firestore i vidiš ih u **Admin → Kontakt**. Ako želiš da svaka poruka stigne i na e-mail, instaliraj ekstenziju **Trigger Email from Firestore** (traži Blaze plan) ili Cloud Function koja na novi dokument u `contact` šalje mail.

---

## 2. GitHub Pages

1. Repo → **Settings → Pages** → *Source:* **Deploy from a branch** → Branch **main**, folder **/(root)** → Save.
2. Nakon 1–2 minute aplikacija je na `https://basaofficial.github.io/bash-electro/`.
3. Svaki `git push` na `main` automatski osvježava stranicu (service worker preuzima novu verziju pri sljedećem otvaranju).

Lokalno testiranje: `npx serve .` ili `python3 -m http.server 8080`, pa otvori `http://localhost:8080` (ne otvarati `index.html` direktno kao datoteku – ES moduli tada ne rade).

---

## 3. Android APK (Capacitor)

### Automatski na GitHubu (preporučeno)

- **Actions → Android APK → Run workflow** → nakon ~5 min APK je u artefaktima tog pokretanja.
- Ili napravi tag: `git tag v1.1.0 && git push origin v1.1.0` → APK se automatski dodaje u **Releases**.

### Lokalno na računaru

Treba: Node.js 20+, Android Studio (s Android SDK) i Java 21.

```bash
npm install
npm run android:add      # prvi put: kreira folder android/
npm run android:sync     # nakon svake promjene u index.html / js / css
npm run android:open     # otvara Android Studio → Run ili Build → Build APK(s)
# ili bez Android Studija:
npm run android:apk      # APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Prijava u APK-u

- **E-mail i lozinka** rade odmah.
- **Google prijava** u Android WebViewu ne radi preko popupa (Google to blokira). Za nju je potreban nativni dodatak:
  1. `npm install @capacitor-firebase/authentication firebase` i `npx cap sync android`
  2. Firebase konzola → Project settings → **Add app → Android**, package `com.basaofficial.bashelectro`, dodaj **SHA-1** ključa (`cd android && ./gradlew signingReport`)
  3. preuzmi `google-services.json` u `android/app/`
  4. u `capacitor.config.json` dodaj:
     `"plugins": { "FirebaseAuthentication": { "skipNativeAuth": true, "providers": ["google.com"] } }`
  5. `npx cap sync android` i ponovo izgradi APK. `js/cloud.js` dodatak prepoznaje sam.

### Izvoz PDF-a u APK-u

U WebViewu klasično preuzimanje datoteka nije uvijek podržano. Ako PDF/JSON ne stiže u *Downloads*, sljedeći korak je dodatak `@capacitor/filesystem` + `@capacitor/share`.

---

Alat za planiranje i dokumentaciju. Ne zamjenjuje projekt ni prijem instalacije od strane Elektrofachkraft.
