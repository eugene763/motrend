# Project Rules (MoTrend)

- We deploy ONLY to Firebase prod by default.
- Before any deploy: run lint + build.
- Never change Firebase project IDs / authDomain / apiKey unless explicitly asked.
- Prefer minimal edits; keep current architecture (Firebase Hosting + Functions + Firestore + Storage).
- When editing security rules: least privilege.
