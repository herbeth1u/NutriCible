# NutriCible

Application web **statique** (sans étape de build) dont le cœur est un **recueil de repas** pour une phase de **maintien du poids** : 93 repas répartis en 7 catégories, des journées types, des cibles calculées depuis ton profil et un export CSV pour Notion.

- Site : https://herbeth1u.github.io/NutriCible/ (voir « Mettre en ligne » plus bas)
- Pile : JavaScript moderne en modules ES, **Vue 3** (copie vendorisée, sans build), CSS maison, tests avec `node --test`.

## Confidentialité : aucune donnée personnelle dans ce dépôt

Le dépôt est **public**. Aucune donnée personnelle ne doit y figurer : ni dans le code, les données, la configuration, ce README, `CLAUDE.md`, les tests, les commentaires ou les messages de commit. Cela couvre l'identité, les mesures corporelles (sexe, âge, taille, poids, fourchette de poids) et les valeurs qui en découlent (métabolisme de base, dépense, calories actives de référence, cibles chiffrées).

- Ces informations se saisissent dans l'interface, bouton **« Mon profil »**, et sont enregistrées **uniquement dans ton navigateur** (`localStorage`). Le profil est vide par défaut.
- Le projet ne contient que des éléments génériques : formule de Mifflin-St Jeor, facteur 1,2, coefficients en g/kg, seuils des types de sortie.
- `scripts/validate-data.mjs` échoue si un champ de profil apparaît dans `data/`. Les tests n'utilisent que des profils fictifs.
- La **sauvegarde JSON** de tes données inclut ton profil : ne la publie pas et ne la dépose pas dans le dépôt (`.gitignore` exclut `nutricible-sauvegarde*.json`).

## Utiliser l'application

### Mettre en ligne (GitHub Pages)

1. Fusionner la branche de travail dans `main`.
2. Sur GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Le site est servi à l'adresse https://herbeth1u.github.io/NutriCible/ (le fichier `.nojekyll` désactive Jekyll). Tous les chemins sont **relatifs** : le site vit sous le sous-chemin `/NutriCible/`.

### En local

Les modules ES ne fonctionnent pas en ouvrant `index.html` directement depuis le disque (`file://`). Lance un serveur local à la racine du dépôt :

```
python -m http.server 8000
```

puis ouvre http://localhost:8000/.

### Premier lancement

1. Ouvre **Mon profil** (en-tête) et renseigne sexe, âge, taille, poids. Facultatif : fourchette de poids cible, dépense « au repos » de ta montre Garmin (utilisée telle quelle, sans facteur d'activité), calories actives d'une sortie longue de référence (par défaut le seuil bas, 1 500 kcal).
2. Tant que le profil est vide, un bandeau t'invite à le renseigner et les totaux restent affichés sans comparaison à une cible.
3. Parcours les onglets : **Repas**, **Journées types**, **Cibles et hypothèses**, **Substitutions et ajustements**, **Aliments**. Le panneau **Ma journée** reste accessible depuis tous les onglets.
4. Tes filtres et tris de l'onglet Repas, ceux de l'onglet Aliments, l'onglet actif et « Ma journée » sont retrouvés quand tu reviens sur la page (un compteur indique les filtres actifs).

### Ajuster les portions

Un **curseur global** (×0,5 à ×2, par pas de 0,05) règle les portions de toute une journée, dans **Journées types** comme dans **Ma journée**. Dans « Ma journée », le dernier changement l'emporte : un facteur réglé sur un repas lui est propre ; bouger ensuite le curseur global remet tous les repas sur ce facteur.

L'onglet **Cibles et hypothèses** donne un **facteur conseillé par jour** et le bilan hebdomadaire de la semaine type après ajustement (la **journée type de chaque jour est modifiable** : le choix est enregistré dans ton navigateur, le Planificateur l'utilise pour « Semaine type » et pour les nouvelles semaines, et « Rétablir la semaine type d'origine » revient à la semaine par défaut) : les journées types sont dimensionnées pour un adulte moyen, ce calcul (fait dans ton navigateur, à partir de ton profil) les ramène au maintien.

### Planificateur de semaine

L'onglet **Planificateur** tire au sort une semaine de repas du recueil, selon le type de chaque journée (par défaut, la semaine type) :

- **Budget par jour** : chaque jour a sa dépense (ton profil et les coefficients des types de journée). Le jour du cheat meal est fixe (le repas d'environ 3 000 kcal) ; le reste du budget de la semaine est réparti sur les autres jours, jamais en dessous de 90 % de leur dépense. Un **facteur de portion** global (au centième, par pas de 1 %) ramène chaque jour à son budget ; l'écart à la cible est affiché. Sans profil, les repas sont tirés près d'une journée type, avec des portions ×1 et sans budget.
- **Créneaux et règles** : petit-déjeuner, déjeuner, une collation, effort, récupération, dîner selon le type de journée ; les candidats sont filtrés par contexte. Règles strictes : légumineuses au moins 4 fois dans la semaine (le tirage les place sur 4 jours différents), saumon au moins une fois, abats une fois au plus, lait et cacao sucré seulement après une sortie moyenne ou longue, aucun repas répété dans la semaine. Si une règle est impossible à tenir, un avertissement l'indique.
- **Tirage mémorisé** : « Générer une nouvelle semaine » (avec un « Annuler » d'un niveau), « Regénérer ce jour » (les autres jours ne bougent pas), menu du type de journée (les budgets des autres jours se rééquilibrent), « Ajouter à Ma journée » (remplace le contenu de Ma journée par ce jour, avec son facteur). La semaine générée, retouches comprises, est enregistrée dans le navigateur et dans la sauvegarde JSON : elle reste identique après un rechargement ou une restauration.
- **Ajustements de portions** : un curseur « Ajustement de la semaine » (×0,75 à ×1,25) et un curseur « Ajustement du jour » (×0,50 à ×2,00), par pas de 0,01, multiplient le facteur calculé par le planificateur ; ils se cumulent, et le jour du cheat meal n'est pas concerné. « Réaligner sur la cible » règle l'ajustement du jour pour rejoindre sa cible (utile après un retrait). Les ajustements sont conservés par « Générer une nouvelle semaine » et « Regénérer ce jour », et remis à ×1 par un changement de type de journée et par « Semaine type ».
- **Retirer un repas** : le ✕ d'une ligne retire le repas sans recalculer les portions des autres : le total du jour baisse, l'écart à la cible devient négatif (sans avertissement) et le solde de la semaine en tient compte. Le repas retiré n'entre plus dans le bilan, la liste de courses ni « Ma journée » ; il reste affiché sous le tableau du jour avec « Rétablir » (« Annuler » fonctionne aussi).
- **Remplacer un repas** : le **⇄** d'une ligne de repas du planning ouvre une fenêtre avec des suggestions (repas de la même catégorie, proches du repas actuel en kcal, protéines et glucides, qui respectent les règles de la semaine) et une recherche libre dans tous les repas ; un repas déjà présent ailleurs dans la semaine reste proposé (une pastille bleue l'indique : tu réutilises des ingrédients déjà achetés), et une pastille jaune signale chaque règle qui ne serait pas tenue (autre catégorie, contexte inadapté, lait + cacao, second repas d'abats). Le planning affiche ensuite le même message : en jaune pour une règle non tenue, en bleu pour un repas qui revient. Le repas garde son créneau, les portions du jour sont recalculées, les ajustements et les repas retirés sont conservés, et « Annuler » défait le remplacement. Le ⇄ d'une ligne d'ingrédient, lui, substitue un aliment.
- **Bilan** : macros, kcal et solde hebdomadaire (apports moins dépense). **Liste de courses** : aliments dédoublonnés, quantités cumulées (portions comprises), regroupés par type, avec « Copier la liste ».
- Le nom d'un repas ouvre sa fiche ; ⇄ y remplace un aliment, et la variante prend la place du repas dans le planning.

Le planning est enregistré dans le navigateur et dans la sauvegarde JSON.

### Fiche repas et substitution

- Dans **Ma journée**, le nom d'un repas ouvre sa **fiche complète en popup** : macros (pour la portion de la journée), recette, variante, contextes, switch Cru / Cuit et actions (copier, dupliquer, modifier si le repas est perso, retirer de la journée). La liste de « Ma journée » ne garde que le nom, la catégorie, la densité et les kcal de la portion ; le bouton « Ingrédients » reste plié-déplié.
- Chaque ligne d'ingrédient a un bouton **⇄** (fiche repas, « Ma journée », carte de l'onglet Repas). Il ouvre le panneau de substitution : aliments proches du même type, triés par répartition de macros, avec la **quantité équivalente en kcal, en protéines ou en glucides** (au choix) et une recherche libre sur tous les types.
- Choisir un aliment ouvre **« Dupliquer ce repas »** avec la variante préremplie (un repas perso). Le même panneau ⇄ est disponible sur chaque ligne de ce formulaire : on peut substituer plusieurs aliments avant d'enregistrer. À l'enregistrement, la variante **remplace le repas dans « Ma journée »**, avec la même portion. Fermer la fenêtre ne change rien.
- Si une variante identique existe déjà (même catégorie, mêmes aliments aux mêmes quantités), l'appli la propose au lieu d'en créer une nouvelle.
- La page **Substitutions et ajustements → Échanger un aliment** reste un calculateur : même classement, sans rien enregistrer, avec un lien vers la fiche de chaque aliment (onglet Aliments).

### Vocabulaire des sorties

Trois termes seulement, d'après les **calories actives** de la montre : **sortie courte** (0 à 749 kcal), **sortie moyenne** (750 à 1 499 kcal), **sortie longue** (1 500 kcal ou plus).

## Mes données et la sauvegarde

Tes ajouts et modifications (profil, repas perso, aliments perso, valeurs modifiées des aliments du recueil, aliments supprimés, remplacements, « Ma journée », planning de la semaine, semaine type personnalisée) sont enregistrés dans le `localStorage` du navigateur sous des clés préfixées `nutricible:v1:` (le domaine GitHub Pages est partagé entre dépôts). Aucun total n'est stocké : tout est recalculé.

La sauvegarde JSON est au **format 3** (elle contient « Ma journée », le planning et la semaine type personnalisée) ; les sauvegardes des formats 1 et 2 se restaurent toujours (migration), sans toucher à « Ma journée », au planning ni à la semaine type quand le fichier n'en contient pas.

Pour changer d'appareil ou de navigateur : **Sauvegarde → Sauvegarder mes données (JSON)**, puis **Restaurer** sur l'autre appareil (fusion avec gestion des conflits de noms, ou remplacement complet). Si le stockage du navigateur est indisponible, l'appli reste utilisable en mémoire et un bandeau l'indique.

## Exporter vers Notion

Bouton **Exporter vers Notion** (en-tête) : un CSV (`nutricible-notion-AAAA-MM-JJ.csv`, UTF-8 avec BOM, séparateur virgule, point décimal) est généré à la volée à partir des données actuelles, repas perso compris si tu le souhaites. Les repas « ⚠ Incomplet » sont exclus et listés. Le profil n'est jamais exporté.

- **Première fois** : dans Notion, *Importer → CSV*, puis vérifier les types de colonnes : *Nom* (titre) ; *Origine*, *Catégorie*, *Densité* (sélection) ; *Contextes*, *Aliments principaux*, *Tags* (sélection multiple) ; *Kcal*, *Protéines (g)*, *Glucides (g)*, *Lipides (g)*, *Fibres (g)*, *Temps (min)* (nombre) ; *Ingrédients*, *Préparation et variante* (texte). Vues conseillées : tableau groupé par *Catégorie*, galerie, filtre par *Contextes*. La page Notion peut ensuite être intégrée ailleurs avec `/embed`.
- **Mises à jour** : importer à nouveau le CSV dans la base existante avec l'option **« Merge with CSV »** du menu de la base ; la fusion s'appuie sur la colonne *Nom*.
- Les noms de colonnes et les valeurs de catégories, contextes et tags doivent rester **strictement identiques** d'un export à l'autre, sinon Notion crée des doublons.

## Modifier les données

Tout est dans `data/` (JSON avec `schemaVersion`, identifiants stables, aucun total stocké) :

| Fichier | Contenu |
| --- | --- |
| `foods.json` | aliments visibles (valeurs pour 100 g, état de référence, coefficient cuit ÷ cru, saison, portion usuelle) |
| `internal-ingredients.json` | ingrédients internes des recettes, jamais affichés |
| `meals.json` | repas du recueil : listes de couples `[identifiant d'aliment, quantité en g]` |
| `days.json` | journées types (facteurs de portion, une seule par type de journée) et semaine type d'origine |
| `config.json` | catégories, contextes, tags, seuils de densité, règles des tags, coefficients génériques, réglages du planificateur (`planner`) |

Après toute modification : `npm run validate` puis `npm test`. Le détail des conventions (ajouter un repas, un aliment, un contexte) est dans `CLAUDE.md`. Pour demander une modification à Claude, décris-la simplement (« ajoute un dîner à base de lentilles corail », « passe le seuil de densité des collations à 250 kcal ») : il modifie par petits changements ciblés et relance les tests.

## Développement

```
npm run validate   # validation des données (références, listes, absence de données personnelles)
npm test           # tests (lanceur intégré de Node ≥ 20), aucune dépendance
```

Les tests couvrent notamment : macros et arrondis, conversion cru/cuit, aliments composés et surcharge, densité par catégorie, tags automatiques (dont « Saisonnier »), métabolisme de base et cibles (profils fictifs), export CSV, sauvegarde et restauration (formats 1 à 3), planificateur de semaine (règles, graine, budgets, ajustements, retrait de repas, liste de courses), règles alimentaires sur les données.

### Vue vendorisée

Vue 3 est copié tel quel dans `vendor/vue.esm-browser.prod.js` (build ESM navigateur avec compilateur), version exacte et empreinte SHA-256 dans `vendor/VERSIONS.md`. Toute l'application importe Vue via `src/vue.js`, **sans repli CDN** : aucune requête externe, l'application démarre de la même façon hors ligne. Un test (`tests/docs.test.mjs`) vérifie que le fichier est présent et que son empreinte correspond à `VERSIONS.md`.

Pour mettre à jour ou re-vendoriser :

```
npm pack vue@3.5.44
tar -xzf vue-3.5.44.tgz package/dist/vue.esm-browser.prod.js
mkdir -p vendor && cp package/dist/vue.esm-browser.prod.js vendor/
sha256sum vendor/vue.esm-browser.prod.js   # doit correspondre à vendor/VERSIONS.md
```

### Intégration continue

Les workflows GitHub Actions sont dans `.github/workflows/` : `ci.yml` (validation et tests à chaque push et pull request) et `vendor-vue.yml` (vendorisation automatique de Vue).

### Structure

```
index.html            page d'entrée (chemins relatifs uniquement)
src/main.js           démarrage
src/vue.js            point d'entrée unique de Vue
src/store.js          état, valeurs dérivées, persistance préfixée
src/calc.js           fonctions pures : une seule fonction de calcul pour tous les repas
src/substitute.js     substitution d'aliments (aliments proches, quantité équivalente, variante identique)
src/swap.js           remplacement d'un seul repas du planificateur (classement des repas proches)
src/planner.js        planificateur de semaine (tirage à graine, budgets, règles, ajustements, retrait et remplacement de repas, liste de courses)
src/notion-export.js  génération du CSV
src/backup.js         sauvegarde, restauration, migrations de format
src/components/       un fichier par onglet et par boîte de dialogue
src/styles/           CSS maison (thèmes clair et sombre)
data/                 données (voir plus haut)
scripts/              validation des données
tests/                tests (profils fictifs uniquement)
vendor/               dépendances vendorisées
```

Voir `LICENSE` pour la licence.
