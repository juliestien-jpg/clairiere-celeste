# Format des poses et des particules (D4)

Ce dossier décrit **en données** comment la créature bouge. Trois sortes de fichiers :

- `poses/kawaii.json` et `poses/feerique.json` : **un fichier par espèce** (D6, `pet.kind` / `view.kind`). Même format, mêmes 8 états de `deriveView` (`happy`, `hungry`, `tired`, `sick`, `asleep`, `dirty`, `weak`, `flown`), mêmes courbes, emblèmes et transitions ; seules les **parties** (et leurs poses) diffèrent. Chaque fichier décrit le bébé à sa racine et les stades suivants dans `stages` (voir « Stades et œuf »). Le choix se fait sur `view.kind` et sur le stade `pet.stage`.
- `poses/egg.json` : l'**œuf**, commun aux deux espèces (états `idle`, `soon`, `hatch`).
- `reactions.json` : réactions aux actions et aux gestes, communes aux deux espèces grâce aux cibles communes (voir plus bas).
- `particles.json` : préréglages de particules.

### Rangement par espèce

| | kawaii | féérique |
|---|---|---|
| Parties SVG | `assets/creature/kawaii/<stade>/` | `assets/creature/feerique/<stade>/` |
| Poses | `spec/motion/poses/kawaii.json` | `spec/motion/poses/feerique.json` |
| Parties propres à l'espèce | `ear-left`, `ear-right` ; `wing-left`, `wing-right` à l'âge adulte | `antenna-left`, `antenna-right`, `wing-left`, `wing-right`, `core`, `trail`, `crown` (adulte) |
| Parties communes aux deux espèces à partir de l'adolescent | `tail` | `tail` |
| Œuf (commun) | `assets/creature/egg/`, `spec/motion/poses/egg.json` | idem |
| Parties communes (mêmes noms) | `shadow`, `halo`, `body`, `cheeks`, `eye-left`, `eye-right`, `mouth`, `hand`, `dust-stains`, `dust-specks`, `star` | idem |

Les emblèmes (`assets/emblems/`) et les accessoires (`assets/props/`) sont partagés. Les fichiers d'une espèce n'en partagent aucun avec l'autre.

Les couleurs viennent de `spec/theme.json`, les parties SVG de `assets/`. Chaque plateforme écrit un petit interprète : web (API Web Animations + canvas 2D), Flutter (`AnimationController` + `CustomPainter`). **Seules `transform` (translation, rotation, échelle) et `opacity` sont animées.**

Une implémentation de référence de la version **kawaii seule** tient dans `assets/creature/planche.html` (générée avant D6 à partir de l'ancien `poses.json` et autonome : elle fonctionne mais n'est **pas régénérée** et ne montre pas l'espèce féérique ; pour celle-ci, voir `design/explorations/feerique/comparaison.html`, archive).

## Stades et œuf

Stades : `egg`, `baby`, `child`, `teen`, `adult` (`pet.stage`, calculé par les règles : 24 h, 96 h, 240 h d'après `spec/balance.json`). Un seul élément nouveau par stade (kawaii : oreilles longues, queue en flamme, ailes ; féérique : fleurs ouvertes, queue en comète, couronne).

### Structure d'un fichier d'espèce

```json
{ "version": 1, "stage": "baby", "kind": "kawaii",
  "easings": {}, "targets": {}, "emblems": {}, "rest": {}, "transition": {}, "reducedMotion": {}, "priority": [],
  "parts": {}, "layers": [], "states": {},
  "stages": { "child": { "label": "Enfant", "parts": {}, "layers": [], "states": {} }, "teen": {}, "adult": {} } }
```

- La **racine** est le bébé (`parts`, `layers`, `states`) **et** les clés communes à tous les stades (`easings`, `targets`, `emblems`, `rest`, `transition`, `reducedMotion`, `priority`).
- `stages.<stade>` donne ce qui change : `parts` (origines propres au stade), `layers` (ordre de dessin) et `states` (les 8 états). Les parties inchangées d'un stade à l'autre **réutilisent le fichier du bébé** (ex. `creature/kawaii/baby/eye-left-open.svg`) ; féérique redessine tout le corps à chaque stade (`creature/feerique/<stade>/…`).
- L'interprète charge `{ ...racine sans stages, ...stages[stade] }` (`composeStage` dans `apps/web/src/creature/parts.ts`). Un stade absent (ou le bébé) = la racine. Aucune partie n'est obligatoire : une réaction qui vise une partie absente d'un stade est ignorée.
- `poses/egg.json` n'a que `parts`, `layers` et `states` (`idle`, `soon`, `hatch`) : les clés communes viennent du fichier kawaii (`composeEgg`).

### Œuf et éclosion

- `idle` : l'œuf pulse. `soon` : fissures dorées, lumière qui filtre, balancement ; choisi quand l'éclosion approche (**60 % de la durée du stade œuf** d'après l'équilibrage : `egg` dure jusqu'à `minAgeHours` de `baby`, soit 0,05 h = 3 min, donc `soon` à partir de 1 min 48 s ; `hatchProgress` et `eggState` dans `apps/web/src/creature/egg.ts`).
- `hatch` : séquence de 3 s jouée une fois quand le stade passe de l'œuf au bébé sous les yeux du joueur (jamais à la réouverture d'une sauvegarde déjà éclose). Sa clé **`handoff`** `{ "at": 0.6, "reveal": "baby" }` dit à l'interprète : à cet offset de la séquence, afficher la créature de l'espèce tirée (stade bébé, état courant) en fondu par-dessus l'œuf, puis jouer la réaction `hatch-<espèce>` (voir plus bas). C'est la seule clé ajoutée au vocabulaire des états. En mouvement réduit : pas de séquence, l'œuf s'efface et le bébé apparaît en fondu de 250 ms.
- **Gabarit `{kind}`** : un nom de préréglage de `particles` peut contenir `{kind}`, remplacé par l'espèce affichée (`hatch-{kind}` donne `hatch-kawaii` ou `hatch-feerique`). Ainsi un seul état d'œuf sert les deux espèces.

## Unités

- Longueurs : unités du `viewBox` **240 × 240** commun à toutes les parties de la créature (les emblèmes ont leur propre repère 64 × 64).
- Angles : degrés, sens horaire positif. Durées : millisecondes.
- Toutes les parties de `assets/creature/<espèce>/baby/` partagent le même `viewBox` : on les superpose telles quelles, sans calcul de position.

## poses/<espèce>.json

| Clé | Rôle |
|---|---|
| `easings` | Courbes nommées, `[x1, y1, x2, y2]` (Bézier cubique). Web : `cubic-bezier(x1,y1,x2,y2)`. Flutter : `Cubic(x1,y1,x2,y2)`. `linear` n'est permis que pour les rotations continues (orbite de poussières). |
| `targets` | Cibles d'animation sans fichier SVG : `creature` (groupe racine, reçoit la respiration), `pose` (groupe imbriqué, mouvement d'ensemble propre à l'état), `emblem` (bulle et emblème). Chacune a un `origin`. |
| `kind` | Espèce décrite (`kawaii` ou `feerique`). |
| `parts` | Chaque partie : `origin` (centre des rotations et échelles, repère 240) et `variants` (nom → fichier relatif à `assets/`, ex. `creature/feerique/baby/body.svg`). |
| `layers` | Ordre de dessin, du fond vers l'avant. |
| `emblems` | Emblèmes : `bubble`, `file`, `label`. |
| `rest` | Boucle de repos **globale** : respiration de 3,6 s sur `creature`. |
| `transition` | Passage d'un état à l'autre : on interpole la pose statique et les variantes se fondent. |
| `reducedMotion` | Comportement en mouvement réduit (voir plus bas). |
| `priority` | Rappel de l'ordre de priorité des états (calculé par les règles, jamais ici). |
| `states` | Une entrée par état. |

### Un état

```json
"hungry": {
  "label": "Faim",
  "cue": "texte décrivant pose et emblème (alternative textuelle)",
  "emblem": "starfruit",
  "visible": ["shadow", "halo", "..."],
  "variants": { "mouth": "o", "halo": "hungry" },
  "static": { "eye-left": { "translate": [-3, 3] } },
  "rest": null,
  "loops": [ { "id": "sway", "duration": 3400, "...": "..." } ],
  "sequence": { "...": "..." },
  "after": { "loops": [] },
  "particles": [ { "preset": "ambient", "continuous": true } ]
}
```

- `visible` : parties dessinées (les autres sont masquées), dans l'ordre de `layers`.
- `variants` : variante choisie par partie (clé de `parts.<partie>.variants`).
- `static` : **pose tenue**, par cible : `translate: [x, y]`, `rotate`, `scale` (nombre ou `[sx, sy]`), `opacity`. Elle est appliquée en permanence ; c'est la seule chose qui reste en mouvement réduit.
- `rest` : absent = boucle de repos globale ; objet = boucle qui la remplace (sommeil, affaiblie) ; `null` = aucune (Envol).
- `loops` : boucles de l'état, jouées en parallèle de `rest`. Une seule animation **principale** à la fois : les boucles d'un état visent des cibles différentes (ou des propriétés différentes).
- `sequence` : séquence jouée **une fois** (`iterations: 1`, `fill: "forwards"`), seulement pour `flown`. À sa fin on joue `after.loops`. `reducedAt` : offset (0 à 1) de l'image figée en mouvement réduit.
- `particles` : préréglages associés. `continuous: true` = tant que l'état dure ; `at` = offset de la séquence où déclencher une bouffée.

### Boucle (`loops[]`, `rest`, `sequence`)

| Champ | Sens |
|---|---|
| `id` | Nom, pour le débogage. |
| `duration` | Durée d'un cycle (ms). |
| `iterations` | `"infinite"` ou un entier. |
| `easing` | Courbe **par défaut de chaque segment** entre deux images clés (une image clé peut la remplacer). L'animation globale elle-même reste linéaire. |
| `fill` | `"none"` (défaut) ou `"forwards"`. |
| `delay` | Optionnel (ms). |
| `targets` | `{ cible: [images clés] }`. |

Image clé : `{ "offset": 0..1, "translate": [x, y], "rotate": deg, "scale": n | [sx, sy], "opacity": 0..1, "easing": "nom" }`. Les offsets de 0 et de 1 sont obligatoires, croissants. Une propriété absente reprend la valeur de `static` pour cette cible (ou l'identité : `[0,0]`, `0`, `1`). Un cycle de boucle commence et finit sur la même image pour boucler sans saut. `easing` d'une image clé s'applique au segment qui **suit** cette image.

### Ordre de composition d'une transformation

Pour chaque cible : `translate`, puis `rotate`, puis `scale`, autour de `origin` (point fixe du repère 240 ; pour `emblem`, repère 64). Web : `transform-box: view-box; transform-origin: Xpx Ypx; transform: translate() rotate() scale()`. Flutter : `Matrix4` translate(origin) · translate · rotate · scale · translate(-origin). Comme chaque image clé donne les trois composantes, les interpolations sont toujours compatibles.

### Mouvement réduit

`prefers-reduced-motion` ou réglage de l'application :

1. aucune boucle, aucune particule, `rest` ignoré ;
2. on applique seulement `static` et l'emblème fixe ;
3. pour `flown`, on fige la séquence à `reducedAt` ;
4. les transitions d'état deviennent un fondu de 250 ms.

Les états restent lisibles : ils sont portés par les variantes (yeux, bouche, oreilles ou antennes, halo), les poses statiques et les emblèmes, pas par le mouvement.

### Règles de sobriété (D4)

Respiration de 3 à 4 s ; réactions de la créature de 600 à 1 200 ms ; jamais de clignotement ni de mouvement rapide (le frisson de `sick` fait ±1,4 unité, avec des pauses) ; courbes douces, pas de mouvement linéaire sauf l'orbite de `dirty`.

### Les 8 états

| État | Visage | Pose | Halo | Emblème |
|---|---|---|---|---|
| `happy` | yeux en arcs, bouche ouverte souriante | rebond léger | doré plein | aucun |
| `hungry` | yeux ronds tournés vers le bas, bouche « o » | oscillation, main sur le ventre | doré creusé au ventre | fruit étoilé |
| `tired` | yeux mi-clos, bâillement lent | affaissé, oreilles tombantes éteintes | terni | chandelle |
| `sick` | yeux ronds, bouche ondulée, joues vert tisane | affaissé, léger frisson | pâle, froid | nuage de pluie |
| `asleep` | yeux fermés en traits courbes | roulé en boule, oreilles couchées | bleu lune | petites lunes |
| `dirty` | yeux ronds, bouche plate | grattouille lente | moucheté | aucun (taches + poussières en orbite) |
| `weak` | yeux mi-clos, bouche plate | translucide (opacité 0,6), très lent | presque éteint | étoile qui pâlit |
| `flown` | yeux fermés, sourire | se dissout et monte, l'étoile prend sa place | s'élargit puis s'efface | aucun |

## particles.json

Un seul canvas 2D (web) ou un `CustomPainter` (Flutter). **Au plus 40 particules à l'écran** (`limits.maxParticles`, tous préréglages confondus) ; au plafond, un préréglage de `priority` plus basse cède la place. Rien ne passe devant les yeux : la zone `avoidZones.face` fait disparaître en fondu toute particule qui y entre (sauf `avoidFace: false`). Pause quand l'onglet est caché ; aucune particule en mouvement réduit.

Les champs sont décrits dans `fields` du fichier. Longueurs et vitesses sont en unités du viewBox 240 de la créature ; le moteur les met à l'échelle de la créature affichée. Les couleurs sont des jetons de `spec/theme.json`. Formes (`shapes`) : `orb`, `sparkle4`, `bubble`, `leaf`, `moon`, `star`. Les lueurs sont des dégradés radiaux (`glow`), jamais des flous.

Préréglages : `ambient` (lucioles, continu), `feed` (étincelles dorées), `wash` (bulles irisées), `heal` (spirale de feuilles menthe), `play` (pluie d'étoiles roses), `sleep` (petites lunes qui montent, continu), `flight` (Envol : lumière dorée qui monte et se rassemble vers l'étoile), `hatch-kawaii` et `hatch-feerique` (éclosion, une bouffée de 20 et de 18 particules).

**Féérique, état `weak`** : `poses/feerique.json` y joue le préréglage continu `ambient` (quelques lucioles qui montent lentement, 7 au plus), comme `happy` ; ce préréglage existait déjà, rien de plus à ajouter. Avec une bouffée d'éclosion, le total reste sous les 40 particules.

## reactions.json

Réactions courtes de la créature à une action ou à un geste (repas, goûter, laver, soigner, jouer, caresser, coucher, réveiller, refus doux, touche, étoile attrapée). Elles se jouent **une fois, par-dessus** l'état courant : elles ne remplacent ni `static`, ni les boucles, ni les séquences de `poses/<espèce>.json`, dont le format n'a pas changé. Durée de 600 à 1 200 ms (`limits`).

| Clé | Rôle |
|---|---|
| `targets` | Groupes ajoutés autour de la créature, avec leur `origin` : `touch` (enveloppe toute la créature, au-dessus de `creature` et `pose` : rebonds et inclinaisons des réactions, suivi du geste) et `gaze` (enveloppe les deux yeux : regard, quelques unités). |
| `groups` | **Cibles communes aux espèces** (D6) : un nom que les réactions visent, résolu en parties de l'espèce affichée (voir ci-dessous). |
| `props` | Accessoires : `file` (SVG de `assets/props/`, viewBox 48 x 48, profil restreint de D4), `at` (centre, repère 240), `size` (largeur dessinée). L'accessoire est créé au début de la réaction et retiré à la fin. |
| `reactions.<id>` | `duration`, `easing`, `tracks`, `swaps`, `particles`. |

- `tracks` : `{ cible: [images clés] }`, **même format que les boucles** (`offset`, `translate`, `rotate`, `scale`, `opacity`, `easing`). La cible est un **nom de partie** de `poses/<espèce>.json` commun aux deux espèces (`mouth`, `eye-left`, `halo`, `cheeks`...), un groupe de `targets`, un **groupe commun** de `groups` (`head-tips`, `wings`, `chest-light`) ou un accessoire de `props`. Une réaction ne vise **jamais** une partie propre à une espèce (`ear-left`, `antenna-left`, `wing-left`, `core`) : la validation refuse qu'une même partie soit visée à la fois par son nom et par un groupe. Une propriété absente reprend la pose statique de l'état (la réaction finit donc sur la pose de l'état). Un accessoire fixe toujours `opacity`.
- `swaps` : expressions, `{ part, variant, from, to }`. Pendant la fenêtre (offsets 0 à 1), la variante remplace celle de l'état (passage net, sans fondu). Les fenêtres d'une même partie ne se chevauchent pas. Les noms de variantes sont ceux de `parts.<partie>.variants` (communs aux deux espèces).
- `particles` : `{ preset, at, count?, emitDuration? }` : bouffée à l'offset `at`, `count` remplace celui du préréglage. Le plafond de 40 particules reste celui du moteur.
- Toute cible absente de la créature affichée est **ignorée** sans erreur (`touch` et `gaze` sont ajoutés par l'interprète autour de la créature quelle qu'elle soit ; `gaze` : parties `eye-left` et `eye-right`). Les parties propres à une espèce se visent par un groupe commun.
- `swaps` : `part` et `variant` doivent exister dans les **deux** espèces (mêmes noms de variantes : `mouth` `o`, `smile`, `yawn`, `sleep`... ; `eye-*` `arc`, `closed`, `half`...).

### Cibles communes (`groups`)

```json
"head-tips": { "mirror": true, "additive": true,
  "parts": { "kawaii": ["ear-left", "ear-right"], "feerique": ["antenna-left", "antenna-right"] } }
```

| Groupe | kawaii | féérique | Usage |
|---|---|---|---|
| `head-tips` | `ear-left`, `ear-right` | `antenna-left`, `antenna-right` | extrémités de la tête : frémissent à la caresse, à la touche, au réveil, au jeu, au repas |
| `wings` | `wing-left`, `wing-right` (adulte seulement, ignorées avant) | `wing-left`, `wing-right` | ailes : battent, s'ouvrent à l'étirement |
| `chest-light` | absent (ignoré) | `core` | étoile de poitrine : pulse à chaque soin |
| `tail-wag` | `tail` (ado, adulte) | `tail` (ado, adulte) | queue : frétille (rotation seule, autour de sa racine), mêmes moments que `head-tips` |
| `crown-glow` | absent (ignoré) | `crown` (adulte) | couronne de pétales : pulse (échelle) avec `chest-light` |

Un groupe ne porte jamais le nom d'une partie : `tail-wag` et `crown-glow`, pas `tail` et `crown`. Une partie absente du stade affiché (oreilles longues, queue, ailes qui n'existent pas encore) est ignorée sans erreur ; la validation exige seulement que la partie existe à au moins un stade de l'espèce.

- `parts.<espèce>` : parties visées dans cette espèce. Une espèce absente de `parts` ignore le groupe.
- `mirror` : `parts` est la paire **[gauche, droite]**. Les images clés décrivent le côté **droit** (rotation positive = vers l'extérieur ; pour une aile, elle s'ouvre) ; le côté gauche reçoit `rotate` et `translate[0]` de signe opposé. Sans `mirror`, toutes les parties reçoivent les mêmes images clés.
- `additive` : les images clés sont des **écarts** ajoutés à ce qui joue déjà sur la partie (pose statique de l'état, boucles). C'est ce qui permet de faire frémir des antennes déjà tombantes (`tired`, `weak`) sans les redresser ; une échelle de 1,25 grossit l'élément de 25 % par rapport à sa taille du moment. Web : `composite: "add"` de l'API Web Animations ; Flutter : transformation relative composée avec celle de l'état. Un groupe additif n'a pas d'`opacity`.
- Un nom de groupe ne peut pas être un nom de partie, de cible ou d'accessoire.
- Mouvement réduit : les groupes additifs (sans `opacity`) sont ignorés, comme tout rebond.

### Éclosion : l'espèce se découvre

`hatch-kawaii` et `hatch-feerique` sont jouées quand l'œuf s'ouvre sous les yeux du joueur (réaction de l'espèce tirée) : pop et étincelles dorées et roses pour kawaii ; élévation douce, ailes et antennes qui se déploient, étoile de poitrine qui s'allume et lucioles qui montent pour féérique (préréglages `hatch-kawaii` et `hatch-feerique` de `particles.json`). Aucune des deux n'est jouée à la réouverture d'une sauvegarde déjà éclose.

- Interprète : on ajoute au vocabulaire des poses seulement les accessoires, les `swaps` et les groupes additifs (composition `add`) ; l'animation reste `transform` et `opacity`.
- **Mouvement réduit** : plus de rebond ni de particule ; les accessoires et les parties n'ont que leurs fondus d'`opacity` ; chaque partie garde sa dernière expression (pose fixe) ; pas de vibration.

## Valider

Les JSON se parsent avec n'importe quel lecteur JSON. Les SVG respectent le profil restreint de D4 : `path`, `circle`, `ellipse`, `g` avec `transform`, `linearGradient`, `radialGradient`, `clipPath`, `opacity` ; ni filtre, ni CSS, ni texte, ni masque.
