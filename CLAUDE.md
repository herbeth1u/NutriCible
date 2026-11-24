# CLAUDE.md — consignes pour les futures éditions de NutriCible

NutriCible est une application web **statique, sans build**, hébergée sur GitHub Pages : https://herbeth1u.github.io/NutriCible/. Elle sert un **recueil de repas pour le maintien du poids** (repas à combiner librement), avec journées types, cibles calculées depuis un profil saisi dans l'interface, et export CSV pour Notion. L'interface est **en français**.

## Règle n° 1 : aucune donnée personnelle dans le dépôt

Le dépôt est public. Ne jamais écrire, nulle part (code, `data/`, `config.json`, README, ce fichier, tests, commentaires, messages de commit, fichiers d'exemple) : identité, mesures corporelles (sexe, âge, taille, poids, fourchette de poids), valeurs physiologiques ou de dépense qui en découlent (métabolisme de base, dépense hors entraînement, calories actives de référence, cibles chiffrées). Ces valeurs sont des **paramètres saisis dans « Mon profil »**, enregistrés uniquement dans le `localStorage` du navigateur, **vides par défaut**. Le projet ne contient que du générique : formule de Mifflin-St Jeor, facteur 1,2, coefficients en g/kg, seuils des types de sortie. Les tests utilisent **exclusivement des profils fictifs** (`tests/helpers.mjs`). `scripts/validate-data.mjs` échoue si un champ de profil apparaît dans `data/`. Les sauvegardes JSON (qui contiennent le profil) sont exclues par `.gitignore` : ne jamais les committer.

## Invariants à ne jamais casser

1. **Une seule fonction de calcul** : `resolveMeal` dans `src/calc.js` sert aux repas du recueil et aux repas perso. Ne jamais dupliquer de logique de calcul ailleurs (composants, export…).
2. **Aucun total stocké** (hors bloc cheat meal, dont les macros estimées sont saisies). Macros, kcal, densité, tags, filtres, tris, totaux de « Ma journée » et des journées types, cibles et export sont **toujours dérivés à la volée** depuis la table des aliments, les compositions et le profil. Modifier un aliment ou le profil met tout à jour sans rechargement.
3. **Ingrédients internes invisibles** (`data/internal-ingredients.json`, identifiants préfixés `i-`) : jamais dans l'onglet Aliments, le sélecteur d'aliments, les filtres ni « Aliments principaux ». Ils n'apparaissent que dans la liste d'ingrédients des repas-recettes et servent au calcul des aliments composés.
4. **Export Notion stable** (`src/notion-export.js`) : noms et ordre des colonnes, valeurs de catégories, contextes, tags et densités strictement identiques d'un export à l'autre (sinon « Merge with CSV » crée des doublons). Le nom d'un repas est la clé stable ; aucun nom d'aliment, de catégorie, de contexte ni de tag ne contient de virgule (colonnes à choix multiples).
5. **Pas de donnée personnelle** (règle n° 1).
6. **Clés de stockage préfixées `nutricible:v1:`** (domaine GitHub Pages partagé). Tout accès au stockage est protégé par try/catch ; l'appli reste utilisable en mémoire.
7. **Chemins relatifs uniquement** (le site vit sous `/NutriCible/`) : jamais de chemin absolu commençant par `/`.
8. **Vue ne s'importe que via `src/vue.js`**. Pas d'étape de build, pas d'autre dépendance d'exécution ; une dépendance supplémentaire se vendorise dans `vendor/`.
9. **Vocabulaire des sorties** : uniquement « sortie courte », « sortie moyenne », « sortie longue » (0 à 749, 750 à 1 499, 1 500 kcal actives ou plus).
10. **Données rétrocompatibles** : toute évolution du format des données utilisateur passe par une migration dans `src/backup.js` (`FORMAT`, `MIGRATIONS`).

## Architecture

```
index.html · src/main.js · src/vue.js · src/store.js · src/calc.js · src/notion-export.js · src/backup.js
src/day.js (modèle de « Ma journée ») · src/prefs.js (filtres, tris et onglet enregistrés) · src/week.js (bilan hebdomadaire en maintien)
src/components/   un fichier par onglet (MealsTab, DaysTab, TargetsTab, SubstitutionsTab, FoodsTab)
                  et par boîte de dialogue (ProfileDialog, MealFormDialog, FoodFormDialog, FoodDeleteDialog,
                  ExportDialog, BackupDialog) + MyDayPanel, MealCard, IngredientList, FoodPicker, Pills, Bar, Modal, App
data/             foods.json · internal-ingredients.json · meals.json · days.json · config.json
scripts/          validate-data.mjs        tests/  (node --test)        vendor/  Vue vendorisé
```

- `calc.js` : fonctions pures (aucun DOM, stockage ni Vue) : macros, conversion cru/cuit, aliments composés, densité, tags, filtres, tri, cibles, bilan hebdomadaire.
- `day.js`, `prefs.js`, `week.js` : fonctions pures, testées dans `tests/state.test.mjs` et `tests/week.test.mjs`. `day.js` : facteur de départ (`base`), facteur propre (`own`) et facteur global d'une journée, règle « le dernier changement l'emporte ». `prefs.js` : toute préférence lue dans le stockage (filtres, tris, onglet) est **revalidée** à la lecture. `week.js` : budget de maintien de chaque jour et facteur de portion conseillé.
- `store.js` : état Vue réactif, `computed` dérivés, persistance, actions. Les composants lisent le store et n'ont pas de logique métier.
- Les composants sont des objets avec `template` (compilé dans le navigateur, build ESM avec compilateur).

## Modèle de données

- **Aliment** : `id` stable (slug), `name`, `type` (de `config.foodTypes`), `per100` (kcal, protein, carbs, fat, fiber **pour 100 g**, ou 100 ml si `unit: "ml"`), `state` = **état de référence** (celui des valeurs et des quantités des repas), `estimated`, `note`, `portion` ({label, g}), `season` (id de `config.seasons`). Aliment ⇄ (cru et cuit) : `coef` = poids cuit ÷ poids cru, `state` vaut `cru` ou `cuit`, `weigh` = état de pesée habituel. `keepCase: true` pour les noms propres (grammaire de l'export). Aliment composé : `recipe` = `[[id, g], …]` pour 100 g de produit fini, valeurs calculées.
- **Repas** : `id`, `name` (unique), `category`, `contexts`, `tags` (manuels), `time`, `items` = `[[id d'aliment, g], …]` dans l'état de référence de chaque aliment, `internal` (ingrédients internes), `prep`, `variant`. Bloc cheat meal : `cheat` = macros estimées, sans `items`.
- **Journée type** : `items` = `[[id de repas, facteur de portion], …]`, `dayType` (de `config.dayTypes`). **Une seule collation par journée** (le goûter de 16 h, creux le plus long ; aucune le jour du cheat meal) ; la boisson ou le repas de récupération après la sortie n'est pas une collation. `week` : la semaine type pour le bilan hebdomadaire (le lundi est un jour de sortie courte). Les journées sont dimensionnées pour un **profil de référence fictif** (à ±6 % des cibles, vérifié par un test) ; c'est `week.js` qui les ramène au **maintien** pour le vrai profil (facteurs conseillés par jour).
- Règles automatiques (seuils de densité par catégorie, tags « OK avant effort », « Riche en protéines », « Riche en fibres », « Saisonnier ») : dans `config.json`, affichées dans l'onglet Cibles.

## Comment faire…

- **Ajouter un repas** : une ligne dans `data/meals.json` (identifiant slug unique, nom unique, catégorie et contextes de `config.json`, couples `[id, g]` avec des aliments existants, `prep` et `variant` non vides). Pas de total. Respecter les règles alimentaires : pas d'huile d'olive au déjeuner (salades froides, concombre au centre), légumineuses au quotidien, fibres limitées avant une sortie longue, abats limités (tag « Abats », cuisson à cœur), lait + cacao sucré uniquement après une sortie moyenne ou longue, cacao sucré en récupération et cacao non sucré en repas, aucun aliment exclu (olives, huiles de noix ou de colza, framboises, vinaigre, herbes, légumes d'hiver non listés). Puis `npm run validate && npm test`.
- **Ajouter un aliment** : `data/foods.json` (valeurs d'étiquette en priorité, sinon Ciqual avec `estimated: true`). Un nom sans virgule, un type existant. Si l'écart kcal/macros dépasse 15 %, un avertissement non bloquant s'affiche (`ignoreKcalWarning: true` si l'écart est normal).
- **Ajouter un contexte, une catégorie ou un tag** : l'ajouter dans `data/config.json` (une catégorie demande aussi des seuils de densité), **garder exactement la même orthographe** partout (l'export Notion en dépend), puis ajouter au moins un repas qui l'utilise (un test le vérifie).
- **Changer un seuil ou un coefficient** : uniquement dans `config.json`, jamais en dur dans le code.
- **Ajouter un champ de profil** : jamais de valeur par défaut personnelle ; migration dans `src/backup.js` si le format de sauvegarde change.

## Tests et vérifications avant une pull request

```
npm run validate && npm test
```

Les tests couvrent le calcul (macros, arrondis, cru/cuit, aliments composés et surcharge, densité par catégorie, tags, cibles avec profils fictifs, filtres, journées), l'export CSV (colonnes, BOM, échappement, valeurs stables), la sauvegarde et les règles alimentaires. L'interface n'a pas de test automatisé dans le dépôt : si tu la modifies, ouvre-la en local (`python -m http.server`) et vérifie à la main : aucune erreur dans la console à l'ouverture ; profil vide puis renseigné ; filtres cumulables ; création, modification, suppression et rechargement d'un repas perso ; création d'un aliment perso et usage dans un repas ; modification des macros d'un aliment du recueil (repas, densités, tags, filtres, « Ma journée » et « Journées types » se mettent à jour sans rechargement) ; suppression, remplacement et restauration d'un aliment ; réinitialisation ; switch Cru / Cuit sans changement des totaux.

## Conventions

- Interface, données et messages de commit **en français**, messages clairs (`feat(ui): …`, `fix(calc): …`, `data: …`).
- **Petits changements ciblés** plutôt que de tout réécrire ; garder le format de données rétrocompatible.
- Affichage arrondi au gramme et à 10 kcal ; calculs internes jamais arrondis. Les condiments négligeables (sel, poivre, épices, moutarde à l'ancienne, jus de citron) ne sont pas comptés : les mentionner dans la préparation.
- Typographie française (virgule décimale, espaces insécables dans les nombres) via les fonctions de formatage de `calc.js`.
- Accessibilité : contrastes, navigation au clavier, jamais la couleur seule (toujours l'emoji ou le libellé pour la densité).
- Le dossier `github-workflows/` contient les workflows à placer dans `.github/workflows/` (le connecteur GitHub utilisé pour la création initiale n'avait pas le droit d'y écrire).
