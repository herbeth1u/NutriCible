# Dépendances vendorisées

Aucune étape de build : les dépendances d'exécution sont copiées telles quelles dans `vendor/`.

- vue 3.5.44 — `vendor/vue.esm-browser.prod.js` (copie de `dist/vue.esm-browser.prod.js` du paquet npm officiel `vue`, build ESM navigateur avec compilateur de templates)
- sha256 : 37d771e9e91c9c7f78d7db53b3e1f43bb7a48ca5f84d41b4aca95a7cebc8eb5b

## Mettre à jour Vue

1. Choisir une version publiée depuis au moins deux semaines.
2. Remplacer `vendor/vue.esm-browser.prod.js` par le fichier `dist/vue.esm-browser.prod.js` du paquet npm officiel (`npm pack vue@X.Y.Z`, puis extraire `package/dist/vue.esm-browser.prod.js`).
3. Mettre à jour la version et l'empreinte SHA-256 ci-dessus (`sha256sum vendor/vue.esm-browser.prod.js`).
