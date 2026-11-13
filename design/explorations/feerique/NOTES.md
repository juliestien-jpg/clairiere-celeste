# Variante féérique de la créature bébé

Exploration, rien de l'existant n'est modifié. À ouvrir : `comparaison.html` (autonome, mobile d'abord).

## Intention
Un petit esprit de lumière plutôt qu'une peluche : silhouette en goutte élancée, étoile dorée qui brille dans la poitrine, bourgeons d'ailes en voile, antennes en vrille terminées par un bouton de fleur lumineux. Même « Clairière céleste », même palette (D4), même ordre de priorité des états ; plus mystérieux, jamais inquiétant (yeux grands et lumineux, bouche douce, joues colorées).

## Ce qui change par rapport à la version kawaii
| | Kawaii (actuelle) | Féérique |
|---|---|---|
| Corps | boule mochi 140 × 134 | goutte 120 × 146, reflet nacré (menthe, rose, bleu lune) |
| Oreilles | oreilles de lapin à bourgeon | `antenna-left/right` : vrilles fines (3,2) + feuille menthe + bouton de fleur doré |
| Yeux | ronds, deux reflets | amande à cil effilé, iris menthe avec une étoile blanche |
| Joues | blush | blush + constellation (3 points reliés) |
| Lumière | halo seul | halo + `core` : étoile à quatre branches dans la poitrine, qui change de forme selon l'état |
| Nouveau | | `wing-left/right`, `trail` (brume, pétales, poussière d'étoile), flottement au lieu de rebond |
| Contour | `#9C8AD0`, 2,4 | `#6A5AAE`, 2,6 (plus sombre : le corps crème se détache du ciel de jour et de l'aube) |

Mêmes noms de parties : `shadow`, `halo`, `body`, `cheeks`, `eye-left/right`, `mouth`, `hand`, `dust-stains`, `dust-specks`, `star`. Même `viewBox` 240 × 240, mêmes origines pour la respiration (`creature`, `pose`, `emblem`).

## Lecture des états à 150-165 px
Chaque état garde la pose, le visage et l'emblème de la version kawaii ; la lumière de poitrine et les ailes s'ajoutent comme indices (jamais la couleur seule).

| État | Pose | Visage | Étoile de poitrine | Ailes et antennes | Emblème |
|---|---|---|---|---|---|
| `happy` | flotte, ailes qui frémissent | yeux en arcs, bouche ouverte | étoile dorée pleine, pulse | ailes ouvertes, boutons dorés | aucun |
| `hungry` | léger balancement, main sur le ventre | yeux vers le bas, bouche « o » | **anneau vide** | légèrement tombantes | fruit étoilé |
| `tired` | **debout**, oscille lentement, tête qui dodeline | paupières lourdes, **grand bâillement bouche ouverte** | étoile tamisée mais présente | antennes qui piquent du nez (boutons allumés), ailes repliées | chandelle |
| `sick` | affaissé, frisson | yeux ronds, bouche ondulée, joues et constellation vert tisane | étoile pâle et froide | ailes pâles repliées | nuage de pluie |
| `asleep` | dôme rond et bas, yeux fermés | traits courbes | étoile bleu lune | antennes couchées, ailes repliées | petites lunes |
| `dirty` | grattouille | yeux ronds, bouche plate | étoile dorée | ailes ternes | taches et poussières en orbite |
| `weak` | **posée, presque allongée**, très basse, translucide (0,52), très lente | yeux mi-clos tournés vers le joueur, bouche plate | simple étincelle qui vacille | antennes inertes à boutons éteints, ailes presque invisibles | étoile qui pâlit |
| `flown` | se défait, l'étoile monte | yeux fermés, sourire | s'élargit et s'efface | se dissolvent | aucun |

## Contraintes mobile (vérifiées)
- Traits visibles : 2,4 minimum (2,2 px à l'échelle d'affichage de 0,9), vérifié par script ; les seuls détails plus fins sont des reflets décoratifs (points blancs).
- Profil D4 : `path`, `circle`, `ellipse`, `g`, dégradés, `clipPath` ; ni filtre, ni CSS, ni texte, ni masque (vérifié par script). Lueurs en dégradés radiaux. Animations sur `transform` et `opacity` seulement.
- Particules : `spec/motion/particles.json` inchangé (le plafond de 40 reste respecté). Les emplacements d'émission (ventre, visage) tombent encore au bon endroit car le corps a le même centre.
- Poids : 44 fichiers SVG, 13 parties à l'écran dans les états courants (9 pour la version kawaii, qui a 31 fichiers).

## Coût d'intégration
- **Données** : remplacer `assets/creature/baby/` et `spec/motion/poses.json` par `baby/` et `poses.json` d'ici. Le format de `spec/motion/README.md` n'a **pas** besoin de changer.
- **Nouveaux noms de parties** que l'interprète doit connaître comme les autres (rien de spécial à coder) : `trail`, `wing-left`, `wing-right`, `antenna-left`, `antenna-right`, `core`. `ear-left/right` disparaissent.
- **Un peu plus de travail** à chaque stade : D4 ajoute un élément par stade (oreilles, queue, ailes). Ici les ailes existent dès le bébé (en bourgeon) ; il faudra revoir la courbe de croissance : enfant = antennes plus longues, adolescent = queue, adulte = ailes grandes. Les 4 stades restants sont à redessiner (aucun gabarit réutilisable de la version kawaii).
- **Chemins** : `poses.json` ici pointe vers `../../../assets/emblems/` ; au moment de l'intégration, remettre des chemins relatifs à `assets/`.
- **Interface** : rien à changer. La planche d'états devra seulement afficher la zone un peu plus haute (antennes jusqu'à y = 26 contre 40).
- Les emblèmes, particules, jauges, ciels, palette restent identiques.

## Points faibles
- À 72 px, `weak` est la plus pâle sur ciel de crépuscule, mais sa silhouette aplatie la distingue de `tired` (debout, bouche ouverte). Les miniatures incluent l'emblème, ce qui aide `asleep`.
- Les lucioles qui montent pour `weak` (préréglage `ambient`) ne sont pas démontrées dans la page de comparaison.
- Sur le ciel de jour, `weak` (corps translucide) reste peu contrasté, comme la version kawaii.
- Les ailes se lisent comme des ailes à partir de 150 px ; plus petites, elles font penser à des bras.
