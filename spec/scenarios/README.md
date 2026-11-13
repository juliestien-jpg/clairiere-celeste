# Scénarios de conformité

Vecteurs de test partagés par toutes les implémentations des règles (D1) : le lanceur Vitest de `packages/rules/test/scenarios.test.ts` et, en phase 2, un lanceur Dart (`apps/mobile/test/`). **JSON pur, aucun code.** Un port Dart est accepté quand il passe tous les fichiers de ce dossier ; un scénario qui passe en TypeScript et échoue en Dart est un bug du port.

Toute nouvelle règle arrive avec au moins un scénario. Le lanceur de référence est `packages/rules/test/scenario-runner.ts` (une centaine de lignes) : en cas de doute sur une phrase ci-dessous, c'est lui qui fait foi.

## Conventions générales

- Un fichier = un scénario. Nom du fichier = champ `name` + `.json`. Encodage UTF-8.
- Les instants (`nowMs`, `savedAt`, `bornAt`…) sont des **entiers en millisecondes depuis l'époque Unix, UTC** (comme dans la sauvegarde). Les scénarios actuels partent de `1763020800000` (13/11/2025, 08:00:00 UTC) sauf mention contraire.
- Le décalage horaire local (`utcOffsetMin`, en minutes, 0 par défaut) fait partie du temps passé aux fonctions.
- L'équilibrage est celui de `spec/balance.json`, éventuellement modifié par `balanceOverrides`.
- **Tolérance** : tout nombre attendu est comparé avec une tolérance absolue de **0,001** (jauges, mais aussi instants et `rng`, qui sont entiers : la tolérance n'y change rien). Les scénarios évitent les instants posés exactement sur un seuil (voir `docs/equilibrage.md` 3.1).
- Les chemins (`pet.gauges.health`, `album.0.name`) séparent les clés par un point ; un nombre désigne un indice de tableau. Une clé contenant un point (`cooldowns["feed.meal"]`) ne s'écrit donc pas en chemin : on compare l'objet `pet.cooldowns` en entier.

## Structure d'un fichier

```json
{
  "scenarioVersion": 1,
  "name": "delai-affaiblie-envol",
  "description": "Texte libre, en français : ce que le scénario démontre et d'où viennent les valeurs.",
  "guarantee": "G3",
  "balanceOverrides": { "catchUp": { "maxSeconds": 72000 } },
  "initial": {
    "createSave": { "id": "…", "name": "Lumi", "seed": 14056, "nowMs": 1763020800000, "utcOffsetMin": 0 },
    "patch": { "pet": { "gauges": { "satiety": 36 } } }
  },
  "steps": [ … ],
  "forbidEventTypes": ["flewAway"],
  "expectState": { "pet.life": "flown" }
}
```

| Champ | Obligatoire | Sens |
|---|---|---|
| `scenarioVersion` | oui | Version du format de scénario (1). |
| `name`, `description` | oui | Identifiant (nom du fichier) et explication. |
| `guarantee` | non | Garantie visée (`G1` à `G4` de D3, `D3`). Informatif. |
| `balanceOverrides` | non | Fusion JSON (voir ci-dessous) appliquée à `spec/balance.json`. |
| `initial` | oui | État de départ : soit `createSave`, soit `state` (sauvegarde complète), puis éventuellement `patch`. |
| `steps` | oui | Suite d'étapes, exécutées dans l'ordre sur l'état courant. |
| `forbidEventTypes` | non | Types d'événements qui ne doivent apparaître dans **aucune** étape. |
| `expectState` | non | Attentes sur l'état final. |

### Fusion JSON (`patch`, `balanceOverrides`)

Ce n'est **pas** la RFC 7386 (JSON Merge Patch) : ici, `null` ne supprime jamais une clé. Règle exacte, celle de `mergePatch` dans `packages/rules/test/scenario-runner.ts`, qu'un lanceur Dart doit reproduire :

`fusion(base, patch)` :
1. si `patch` n'est pas un objet (nombre, texte, booléen, `null`, **tableau**), le résultat est `patch` : il **remplace** `base` en entier (un tableau n'est jamais fusionné élément par élément) ;
2. sinon (`patch` est un objet), on part d'une copie de `base` si `base` est un objet, d'un objet vide dans tous les autres cas (`base` absent, `null`, nombre, tableau…) ;
3. pour chaque clé `k` de `patch` (les clés de `base` absentes de `patch` sont conservées telles quelles) : si `patch[k]` vaut `null`, la clé `k` du résultat **existe et vaut `null`** (elle n'est pas supprimée : c'est ce qui permet d'écrire `"flownAt": null`) ; sinon le résultat en `k` vaut `fusion(base[k], patch[k])`.

Il n'existe donc aucun moyen de supprimer une clé. `patch` s'applique à la sauvegarde produite par `createSave` (ou à `initial.state`). Les valeurs patchées doivent respecter `spec/save.schema.json`.

### `initial.createSave`

Appelle `createSave({ id, name, seed, kind? }, { nowMs, utcOffsetMin }, balance)`. `kind` (facultatif, `"kawaii"` ou `"feerique"`) force l'espèce **sans tirage** : `pet.rng` vaut alors la graine, ce qui garde la séquence aléatoire (maladie) des scénarios d'Envol ; sans `kind`, l'espèce est tirée (un tirage, voir « Générateur »). Le décalage `utcOffsetMin` devient le décalage par défaut des étapes.

### Étapes

Toute étape a un `nowMs` (l'heure passée aux règles) et un `utcOffsetMin` facultatif (sinon celui de `createSave`, ou 0). Elle est de l'un des quatre genres suivants, reconnu à la présence de `query` ou, sinon, de `action`.

**1. Action** : `{ "nowMs": …, "action": { "type": "feed", "food": "meal" }, … }`. Appelle `reduce(état, action, temps, balance)` ; l'état renvoyé devient l'état courant. Les actions sont celles de l'annexe A2 (`tick`, `feed`, `play`, `clean`, `heal`, `sleep`, `wake`, `pet`, `rebirth` ; `rebirth` accepte un `kind` facultatif qui force l'espèce). Attentes facultatives, toutes évaluées sur le résultat de cet appel :

- `expectEvents` : la liste **exacte** des événements émis, dans l'ordre. Un objet attendu doit avoir exactement les clés de l'événement (par exemple `{"type":"needAppeared","need":"satiety"}`).
- `containsEvents` : chaque événement listé doit apparaître (ordre et événements supplémentaires indifférents).
- `forbidEventTypes` : aucun événement de ces types.
- `expectState` : table `chemin → valeur` évaluée sur l'état **après** l'étape.

**2. `nextAttentionAt`** : `{ "nowMs": …, "query": "nextAttentionAt", "expect": { "at": …, "need": "satiety" } }` ou `"expect": null`. Appelle `nextAttentionAt(état, temps, balance, history)` sans changer l'état ; `history` est facultatif (`{ "sent": [ { "at": …, "need": "satiety" } ] }`, notifications déjà envoyées) et passé tel quel ; sans lui, ni espacement ni plafond par jour. L'objet attendu doit être exactement le résultat.

**3. `deriveView`** : `{ "nowMs": …, "query": "deriveView", "expect": { "primary": "hungry", "secondary": [] } }`. Appelle `deriveView(état, temps, balance)`. Ici `expect` est **partiel** : seules les clés listées sont comparées (à tous les niveaux d'objet) ; les tableaux, eux, sont comparés en entier.

**4. `migrate`** : `{ "nowMs": …, "query": "migrate", "raw": { … }, "expectState": { … } }` ou `"expectError": "invalid"`. Appelle `migrate(raw)`. Succès : l'état migré devient l'état courant et `expectState` s'évalue dessus. Échec : l'erreur doit être typée avec exactement le code attendu : `notAnObject`, `missingVersion`, `unsupportedVersion` ou `invalid`. Toute autre exception est un échec du scénario. Un `migrate` en échec laisse l'état courant intact.

### Valeurs attendues (`expectState`, `expect`)

Une valeur attendue est :

- un **nombre** : égalité à ±0,001 ;
- un **intervalle** `{ "min": a, "max": b }` (l'une des bornes peut manquer) : la valeur réelle doit être un nombre dans l'intervalle, bornes incluses, sans tolérance ;
- `null`, un booléen ou un texte : égalité stricte ;
- un **tableau** : même longueur, éléments comparés un à un avec ces mêmes règles ;
- un **objet** : mêmes clés exactement (sauf pour `deriveView`, voir ci-dessus), valeurs comparées avec ces mêmes règles. Un objet dont les clés sont uniquement `min` et/ou `max` est un intervalle.

### Fin du scénario

À la fin des étapes, le lanceur contrôle `forbidEventTypes` (sur tous les événements de toutes les étapes d'action) puis `expectState` sur l'état final.

## Comportements précisés par les scénarios

Ces points ne figurent pas tous dans l'annexe A2 ; les scénarios les fixent, le port Dart doit les reproduire :

- **Grille de temps fixe** : le temps n'avance que par pas **entiers** de `catchUp.stepSeconds`. `pet.lastUpdatedAt` est toujours un point de la grille `bornAt + k × pas` ; à chaque appel, on avance jusqu'au dernier point de grille <= `nowMs` (il n'y a jamais de pas plus court : le reste est reporté à l'appel suivant), et l'action éventuelle s'applique à ce point de grille. `deriveView` et `nextAttentionAt` projettent sur la même grille. N'importe quel découpage d'une absence (un appel, plusieurs appels, avec ou sans projection entre) donne le même état, le même `rng` et les mêmes événements. Un `nowMs` fractionnaire est arrondi à l'entier inférieur.
- **Horloge qui recule ou invalide** (`horloge-recule`) : si `nowMs < pet.lastUpdatedAt`, ou si `nowMs` n'est pas un nombre fini, aucun temps n'est rattrapé, `lastUpdatedAt` et `savedAt` ne reculent pas, et l'action éventuelle est appliquée à l'instant `lastUpdatedAt`. Un `utcOffsetMin` non fini vaut 0.
- **Action refusée** : l'action n'a aucun effet et `actionRefused` est émis, mais le temps rattrapé juste avant reste acquis. Raisons (liste complète, jamais d'autre valeur) : `unknownAction` (type d'action inconnu, ou action qui n'est pas un objet), `flown`, `flownDuringCatchUp`, `notFlown`, `invalidIdentity` (`rebirth` dont `id` ou `name` est manquant, vide ou non textuel, ou dont `kind` présent n'est pas une espèce connue), `invalidAction` (`feed` dont `food` n'est ni `meal` ni `snack`), `asleep`, `notHungry`, `cooldown`, `tooTired`, `alreadyClean`, `nothingToHeal`, `notTired`, `notAsleep`, `exhausted`. Ordre des vérifications : type d'action connu ; état de vie (`flownDuringCatchUp`, `flown`, `notFlown`) ; forme de l'action (`invalidAction`, `invalidIdentity`) ; puis, pour un repas, sommeil, satiété trop haute, attente.
- **Après l'Envol** : toute action autre que `rebirth`, `tick` compris, renvoie l'état inchangé et `actionRefused` (raison `flown`). Exception : un `tick` qui provoque lui-même l'Envol n'est pas refusé (il émet `flewAway`). **Envol pendant le rattrapage** : si l'animal s'envole pendant le rattrapage d'un appel, l'action de cet appel est refusée, `rebirth` comprise (raison `flownDuringCatchUp`) : le joueur doit voir l'Envol avant de pouvoir faire renaître. `rebirth` n'est accepté que si l'animal était déjà envolé au début de l'appel. L'horloge de l'animal s'arrête à l'Envol : `lastUpdatedAt` = `flownAt` (et `savedAt` ne dépasse pas ce point tant qu'aucune renaissance n'a lieu), ce qui garde l'état indépendant du découpage.
- **Plafond** : le rattrapage est limité **par appel** à `floor(catchUp.maxSeconds / catchUp.stepSeconds)` pas ; `lastUpdatedAt` saute malgré tout au dernier point de grille <= `nowMs` (le temps au-delà est offert). Deux appels successifs ont chacun leur plafond. L'âge (stade) se calcule sur le temps réel depuis `bornAt`, jusqu'à `flownAt` si l'animal s'est envolé.
- **Événements de besoin** : `needAppeared` / `needResolved` sont émis à la fin de chaque pas quand l'ensemble des besoins actifs change. Un besoin est actif quand sa jauge est au niveau « bas » ou pire (satiété, hygiène, bonheur, énergie), quand l'animal est malade (`sick`) ou affaiblie (`weak`). L'ordre dans un même pas suit `satiety, hygiene, happiness, energy, sick, weak`. Les événements d'un rattrapage précèdent ceux de l'action ; un `stageChanged` est émis à la fin du pas où le seuil d'âge est franchi (après les événements de besoin de ce pas) ; un passage de stade dû au temps offert au-delà du plafond est émis à la fin du rattrapage.
- **Générateur** : mulberry32 (voir `packages/rules/src/rng.ts`), état dans `pet.rng`. **Naissance (`createSave`, `rebirth`) : un seul tirage pour l'espèce** (D6, annexe A2), depuis l'état de la graine, `pet.rng` vaut ensuite l'état après ce tirage ; avec `kind` forcé, aucun tirage et `pet.rng` = graine. Ensuite, un seul tirage par pas, uniquement si la chance de maladie est non nulle. Comme la naissance consomme déjà un tirage, les scénarios dont la séquence de maladie est calculée à partir de la graine (`14056`, `11184255`, `23352`, `42`) forcent `"kind": "kawaii"` dans leur `createSave`. Graines des scénarios : `14056` (premier tirage < 0,0001 : maladie dès que possible) et `11184255` (les 4 800 premiers tirages ≥ 0,0034 : jamais malade) ; `23352` est une graine « malchance » qui retombe malade à la 2e visite de `retour-tardif-76h`.
- **`nextAttentionAt`** : le premier élément de la liste de `docs/equilibrage.md` 3.9 ; le besoin le plus pressant est choisi dans l'ordre `weak, sick, satiety, hygiene, happiness`. L'instant renvoyé est un point de la grille (un report à la fin des heures calmes est arrondi au point de grille suivant). Avec `history`, un besoin actif jamais envoyé reste dû, et l'espacement `minGapMinutes` ainsi que le plafond `maxPerDay` par jour local (dont `reservedForAlwaysNotify` pour `alwaysNotify`) s'appliquent ; `alwaysNotify` ignore heures calmes et espacement.
- **`migrate`** : migre v1 -> v2 (`pet.kind` et `album[].kind` = `kawaii`), copie l'entrée en profondeur (jamais mutée), refuse tout ce que `spec/save.schema.json` refuse (sauf les propriétés inconnues, ignorées) et en plus `messes` hors de [0, `messes.max`], `life`/`flownAt` ou `asleep`/`asleepSince` incohérents ; un `lastUpdatedAt` hors grille est réaligné au point de grille inférieur.
- **Balance invalide** : `BalanceError` (erreur de développement, pas un cas de scénario).

## Liste des scénarios

| Fichier | Démontre |
|---|---|
| `nuit-10h-initial`, `nuit-10h-bornes` | G1 : une nuit de 10 h sans soin ne rend jamais « affaiblie » |
| `weekend-48h-pleines` | G2 : 48 h sans soin depuis des jauges pleines, pas d'Envol ; affaiblie vers T+53,3 h, Envol vers T+81,4 h |
| `delai-affaiblie-envol`, `delai-affaiblie-envol-sans-maladie` | G3 : au moins 24 h entre « affaiblie » et l'Envol (pire cas : 48,8 h puis 76,9 h) |
| `plafond-168h`, `plafond-offert` | G4 : le plafond de rattrapage ne protège pas de l'Envol ; le temps au-delà est offert, l'âge reste réel |
| `envol-puis-renaissance` | D3 : refus après l'Envol, `rebirth`, album, réglages conservés |
| `retour-tardif-76h` | Un animal à 1 h de l'Envol se rattrape par les soins |
| `regulier-3-visites-60j` | Joueur à 3 visites par jour : aucun besoin, aucune maladie en 60 jours |
| `actions-refusees*`, `actions-effets` | Refus et effets chiffrés des actions |
| `sommeil-auto` | Endormissement à énergie 5, réveil à 100 |
| `horloge-recule` | L'état ne recule pas |
| `stades-*` | Évolution par l'âge réel |
| `maladie-graine-42` | Vecteur du générateur aléatoire |
| `migrate-v1` | Lecture (v1 -> v2) et erreurs typées de `migrate` |
| `migrate-v1-vers-v2`, `migrate-v2-espece` | D6 : migration v1 -> v2 (tout devient kawaii, sans mutation), v2 sans `kind` valide refusée |
| `naissance-espece-kawaii`, `naissance-espece-feerique`, `naissance-espece-forcee`, `naissance-espece-poids` | D6 : tirage déterministe de l'espèce par graine, forçage sans tirage, poids et ordre du tableau `kinds` |
| `renaissance-tire-espece`, `renaissance-espece-forcee` | D6 : chaque renaissance retire l'espèce, l'album la conserve ; `kind` invalide -> `invalidIdentity` |
| `attention-*` | `nextAttentionAt` : heures calmes, « affaiblie » de nuit, décalage horaire |
| `attention-historique`, `attention-historique-espacement` | `nextAttentionAt` avec `history` : besoin reporté puis recalculé, espacement, plafond par jour |
| `grille-reste-reporte` | Grille fixe : le reste de temps est reporté, l'action s'applique au point de grille |
| `actions-malformees` | `unknownAction`, `invalidAction`, `notFlown` |
| `renaissance-apres-envol-vu` | `flownDuringCatchUp`, `invalidIdentity`, puis renaissance acceptée |
