# Féérique : stades enfant, adolescent, adulte

À ouvrir : `stades.html` (autonome, mobile d'abord : ciels, mouvement réduit, les 4 stades côte à côte, grille stades × 8 états). Le bébé n'est pas modifié (`design/explorations/feerique/`, copié dans `assets/creature/feerique/baby/`). L'œuf commun n'est pas dessiné ici.

## Courbe de croissance (un seul élément nouveau par stade)
| Stade | Nouveau | Silhouette |
|---|---|---|
| Bébé (existant) | bourgeons d'ailes, antennes à bouton de fleur doré, brume au sol | goutte 120 × 146 |
| Enfant | **les antennes s'allongent et le bouton s'ouvre en fleur à 5 pétales** (fermée en bouton pâle : `dim`) | corps × 1,03 en largeur, × 1,06 en hauteur ; ailes × 1,1 |
| Adolescent | **queue en petite comète** (plume de lumière terminée par une étincelle) ; fleurs à 6 pétales | × 1,05 / 1,12 ; ailes × 1,2, 2 veines |
| Adulte | **couronne de 5 pétales lumineux** ; ailes larges à 3 veines et étincelles | × 1,06 / 1,18 (plus fin, plus élancé) ; ailes × 1,3 |

Le visage garde sa taille (proportions plus délicates en grandissant) et suit le corps : mêmes yeux, joues, bouche que le bébé, décalés vers le haut. Pieds toujours à y = 200, donc ombre, brume, accessoires et emplacements de particules restent là où les réactions les attendent.

## Lisibilité des états (même grammaire que le bébé)
Pose, visage, étoile de poitrine `core` (anneau vide = faim, éteinte = fatigué, bleue = sommeil, froide = malade, étincelle = affaiblie) et emblème. En plus, aux stades qui les ont :
- fleurs ouvertes (content, faim, fatigué, malade, sale) ou **refermées en boutons** (endormi, affaiblie) ;
- queue : droite et vivante (content), tombante et repliée (faim, fatigué, malade), enroulée (endormi), pâle (malade, sale), presque invisible (affaiblie) ;
- couronne : allumée, de travers (fatigué), pâle (malade, sale), repliée (endormi), presque invisible (affaiblie).
`tired` reste debout, bouche ouverte, paupières lourdes ; `weak` reste posée, aplatie et translucide.

## Parties
Mêmes noms que le bébé : `shadow`, `halo`, `trail`, `wing-left/right`, `antenna-left/right`, `body`, `core`, `dust-stains`, `cheeks`, `eye-left/right`, `mouth`, `hand`, `dust-specks`, `star`. Toutes les cibles communes des réactions existent à chaque stade (`head-tips` = antennes, `wings`, `chest-light` = `core`) : `reactions.json` fonctionne sans changement.

Nouvelles parties (aux stades indiqués), variantes `default` et `dim` :
| Partie | Stades | Origine | Couche |
|---|---|---|---|
| `tail` | adolescent, adulte | racine de la queue (150, 186) / (152, 184) | après `trail`, avant les ailes |
| `crown` | adulte | base de la couronne (120, 53) | après `body`, avant `core` |

Les variantes d'antenne gardent `lit` (fleur ouverte) et `dim` (bouton refermé). Ces deux nouvelles parties ne sont visées par aucune réaction ; si on veut les faire réagir, ajouter un groupe commun (`tail-tip`, `crown`) dans `reactions.json` sans toucher aux autres.

## `poses.json` : format étendu
Même format que `spec/motion/README.md`, avec un niveau de plus : `easings`, `targets`, `emblems`, `rest`, `transition`, `reducedMotion`, `priority` sont communs (premier niveau) ; `stages.<child|teen|adult>` donne `parts` (origines propres à chaque stade), `layers` et `states` (8 états). L'interprète charge `{ ...commun, ...stages[view.stage] }`. Chaque état ajoute à celui du bébé : `tail` et `crown` dans `visible`/`variants`/`static`, `cue` complétée, boucles `tail-sway` et `crown-glint` (content), `tail-droop` (faim), dissolution de `tail` et `crown` dans l'Envol. Chemins relatifs à ce fichier (emblèmes en `../../../assets/emblems/`, à rendre relatifs à `assets/` à l'intégration). Seules `transform` et `opacity` sont animées.

## Mobile et performance
- Traits : minimum 2,8 unités du viewBox 240 sur toutes les parties des stades (2,05 px quand la créature mesure 176 px de large, comme dans la grille mobile, 2,3 px dans les cartes à 198 px). Les seuls traits plus fins sont ceux du bébé, non touchés (2,4 à 2,6).
- Zone de jeu (viewBox 240) : ailes, antennes, couronne et queue mesurées en navigateur sur les 8 états, 8 instants de chaque boucle (points sur les tracés, pose et respiration comprises) : jamais hors de x = 5,6 à 234,4 ni au-dessus de y = 6 ; les pointes de l'adulte restent à plus de 5 unités du bord.
- Profil D4 vérifié par script : 138 SVG, ni filtre, ni CSS, ni texte, ni masque ; dégradés radiaux pour les lueurs.
- Au plus 17 parties à l'écran (adulte, état `dirty`). Aucune particule ajoutée : le plafond de 40 reste inchangé.

## Coût d'intégration
- **Données** : copier `child/`, `teen/`, `adult/` sous `assets/creature/feerique/` et fusionner `poses.json` (ou le scinder en 3 fichiers `poses/feerique-<stade>.json` si l'interprète préfère un fichier par stade : même contenu).
- **Interprète** : choisir `stages[view.stage]` ; deux noms de partie de plus à connaître (`tail`, `crown`), rien de spécial à coder. Aucune extension du vocabulaire (translation, rotation, échelle, opacité, boucles).
- **Interface** : l'emblème et la zone de jeu 240 × 300 sont inchangés ; l'adulte monte à y ≈ 6 au sommet de sa flottaison, ce qui laisse la bulle d'emblème (qui descend à y ≈ 4) sans recouvrement pour tous les états qui en ont un (la flottaison n'a lieu qu'en `happy`, sans emblème).
- **Règles** : aucune ; les seuils d'âge viennent de `balance.json`.

## Points faibles
- Les ailes se lisent comme des ailes à partir d'environ 150 px de créature ; en dessous, la paire fait penser à des bras.
- La silhouette ne grandit que de 6, 12 et 18 % : le gain vient surtout des éléments ajoutés. Plus grand ferait déborder les ailes de la zone de jeu.
- `weak` reste le moins contrasté : translucide sur le ciel du jour et le crépuscule rosé ; l'emblème et la forme aplatie portent la lecture.
- `asleep` : les fleurs refermées et couchées à ±78° sont presque cachées derrière le corps ; le sommeil se lit par les yeux, les lunes, l'étoile bleue et les ailes à plat.
- La queue de l'adolescent a la forme d'un croissant plein ; à petite taille elle évoque un croissant de lune plus qu'une comète.
- Les antennes `dim` (boutons refermés) sont pâles sur le ciel du jour.
- Les préréglages de particules (lucioles de `happy` et `weak`, lunes) et l'éclosion ne sont pas montrés dans `stades.html`.
- Dans la grille, l'`Envol` est montré à son image figée (étoile dans le ciel) ; la séquence de 9 s se joue dans la bande des quatre stades.
