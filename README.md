# Rwaa Coffee (بن رواق) - Customer Management

A small CRM web page for a coffee shop. The app UI is fully in Arabic (RTL) and mobile responsive. Data is stored in Firebase (Firestore) and access is protected by a login.

## One-time setup (about 10 minutes)

1. Go to https://console.firebase.google.com and create a new project (**Add project**).
2. **Build > Firestore Database > Create database**: choose the closest region (e.g. `eur3` or `me-central2`) and **Production mode**.
3. **Build > Authentication > Get started > Email/Password > Enable**.
4. **Authentication > Users > Add user**: create the user with email `heely@rwaa.com` and a password of your choice (6+ characters). The login page asks for a **username** (`heely`) and password; the app adds `@rwaa.com` automatically (`LOGIN_DOMAIN` in `js/firebase-config.js`). To use another username, change the email here and in `firestore.rules`.
5. **Authentication > Settings > User actions**: disable **Enable create (sign-up)** if the option is available.
6. **Project settings (gear icon) > Your apps > Web (`</>`)**: register a web app and copy the `firebaseConfig` object into `js/firebase-config.js`.
7. **Firestore > Rules**: paste the contents of `firestore.rules` (it already uses `heely@rwaa.com`; change it if you picked another username), then click **Publish**.

## Run locally

Serve the project folder with a local web server (opening `index.html` directly will not work because of ES modules):

```
npx serve .
```

## Deploy (optional)

```
npm i -g firebase-tools
firebase login
firebase init hosting   # pick your project, set public directory to "."
firebase deploy
```

## Notes

- Each customer is stored with an ID equal to their normalized mobile number, so the same number can never be added twice, whether it is typed as `01...`, `+201...`, `00201...`, or with Arabic digits.
- Accepted numbers: Egyptian mobile numbers (010 / 011 / 012 / 015), 11 digits.
- The country code (Egypt = 20) is set in `js/firebase-config.js` (`COUNTRY_CODE`) and is used for number normalization and WhatsApp links.
- The app interface is entirely in Arabic; only this README is in English.
