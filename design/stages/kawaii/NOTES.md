# Stades de la créature kawaii : notes de design

Livrable du designer UI (D4, D6). Rien ici n'est encore branché dans le jeu : tout vit dans `design/stages/kawaii/`.
Aperçu autonome : `stades.html` (ouvrir en `file://`, pensé d'abord pour 375 px).

## Contenu

| Chemin | Rôle |
|---|---|
| `egg/` (14 SVG) | **Œuf définitif, commun aux deux espèces** (le designer féérique le réutilise). |
| `child/`, `teen/`, `adult/` (14, 16, 20 SVG) | Parties qui changent d'un stade à l'autre. Les parties identiques au bébé ne sont **pas copiées** (voir plus bas). |
| `poses.json` | Poses des 4 entrées : `egg`, `child`, `teen`, `adult`. |
| `stades.html` | Page de revue, générée (œuf et éclosion, côte à côte, taille de jeu, grille stades × 8 états, 4 ciels, mouvement réduit). |

Le bébé reste là où il est (`assets/creature/kawaii/baby/`, `spec/motion/poses/kawaii.json`), non modifié.

## Intention

Même créature qui grandit : la **face** (yeux, bouche, joues, main), la **respiration**, le **halo** et la matière « velours lumineux » ne changent pas. Chaque stade ajoute **un seul élément** et le corps grossit un peu (largeur 140 → 148 → 156 → 164, hauteur 134 → 144 → 150 → 156 unités du viewBox 240).

| Stade | Ajoute | Détail |
|---|---|---|
| Œuf | (point de départ) | Coquille nacrée (reflets rose, menthe, bleu lune, or qui se répondent), halo doré qui pulse en 3,6 s, deux étincelles à quatre branches. |
| Bébé (existant) | boule + petites oreilles à bourgeon | Inchangé. |
| Enfant | **oreilles longues** | Les oreilles « poussent » (≈ 1,6 fois plus longues, mêmes bourgeons dorés). Corps un peu plus haut. |
| Adolescent | **queue en petite flamme de lumière** | Flamme or et rose, derrière le corps, côté droit, avec sa lueur ; version éteinte (`tail-dim`) quand la créature va mal. |
| Adulte | **ailes de lumière translucides** | Éventail de trois plumes nacrées bleu lune et rose, contour lavande et nervure claire (visibles sur les 4 ciels), version pâle (`wing-*-dim`). |

### Éclosion (données dans `poses.json`, `stages.egg.states`)
Trois états : `idle` (œuf qui pulse), `soon` (fissures dorées `cracks-1` et `cracks-2`, lumière qui filtre, balancement doux de ±3°, avec pauses) et `hatch` (séquence de 3 s).
`hatch` : balancement qui s'amplifie (0 à 0,5), apparition de la ligne dorée ondulée `cracks-3` (0,46), puis la coquille est remplacée par `shell-top` et `shell-bottom` (0,52), le haut s'envole en tournant, le bas s'affaisse et s'efface, un halo blanc-or (`burst`) s'élargit une seule fois (pas de clignotement). **`handoff` à 0,6** : l'interprète affiche le bébé de l'espèce tirée et joue `hatch-<espèce>` ; `particles` utilise `hatch-{kind}` (préréglages existants de `spec/motion/particles.json`). `reducedAt: 1` : en mouvement réduit l'œuf s'efface et le bébé apparaît en fondu de 250 ms. Coupure de la coquille en **vague arrondie** (aucun angle vif).

## Noms de parties

- Conservés : `shadow`, `halo`, `ear-left`, `ear-right`, `body`, `dust-stains`, `cheeks`, `eye-left`, `eye-right`, `mouth`, `hand`, `dust-specks`, `star` (mêmes variantes : `halo` 7 variantes, `ear-*` `lit`/`dim`, etc.). Les cibles communes des réactions (`head-tips` = `ear-left` + `ear-right`) fonctionnent à chaque stade.
- Nouveaux : `tail` (teen, adult ; variantes `lit`, `dim`), `wing-left` et `wing-right` (adult ; `lit`, `dim`), mêmes noms que le féérique pour que le groupe commun `wings` des réactions s'applique.
- Œuf : `shadow`, `glow`, `shell`, `sheen-a`, `sheen-b`, `gloss`, `sparkle`, `light`, `cracks-1`, `cracks-2`, `cracks-3`, `shell-bottom`, `shell-top`, `burst`.

## Poses : ce qui diffère du bébé

`poses.json` garde le format de `spec/motion/README.md` ; chaque entrée de `stages` a les clés `parts`, `layers`, `states` du fichier du bébé, et les clés communes (`easings`, `targets`, `emblems`, `transition`, `reducedMotion`, `priority`, `rest`) sont **à la racine**. Courbes, durées, émblèmes, priorités : identiques au bébé.

- **Réutilisées telles quelles** (mêmes fichiers `creature/kawaii/baby/…`, mêmes origines) : yeux, bouche, joues, joues malades, main, étoile de l'Envol. Les poses d'ensemble (`pose`, `creature`) sont celles du bébé.
- **Redessinées par stade** (même nom, même variante) : `body`, `ear-*`, `shadow`, `halo` (les halos du bébé agrandis ×1,12, ×1,2, ×1,32).
- **Oreilles tombantes** : plus longues et plus droites au repos (inclinaison 16°), donc rotations des états `tired`, `sick`, `asleep`, `weak` **augmentées de 16°** pour garder la même posture (ex. `tired` : ±62° au lieu de ±46°). `happy`, `dirty`, boucles de bâillement : mêmes mouvements.
- **Queue** : `happy` bat et vacille en 2,8 s calé sur le rebond ; `hungry` balance à 3,4 s ; `dirty` gratte ; `tired`, `sick`, `weak` : version éteinte, tombante et plus petite (rotation +36 à +46°, échelle 0,7 à 0,85) ; `asleep` : roulée et plus petite, luit lentement ; `flown` : se dissout avec le reste.
- **Ailes** : `happy` battent avec le rebond (±10°) ; `hungry` oscillent ; `tired`, `sick`, `weak` : version pâle, pendantes (−28° à −46°) ; `asleep` : repliées (−64°, échelle 0,85) ; `flown` : se dissolvent.
- **Envol** : ajoute les pistes `tail`, `wing-left`, `wing-right` à la séquence (fondu et montée).
- **Lisibilité** : l'état se lit d'abord par le visage et les oreilles (communs à tous les stades), puis par les ailes et la queue qui tombent, jamais par la couleur seule ; la version éteinte (`dim`) ne fait que renforcer.

## Mesures et contrôles

- Contours des stades : **3 unités** (bébé : 2,4). Créature visible de 160 à 200 unités de haut (ailes et oreilles comprises) : à 140 px de haut le trait fait ≥ 2,1 px, à 180 px ≥ 2,6 px. Aucun trait sous 2,4 unités ; seuls détails plus fins : reflets du bébé (non modifiés).
- Cadre commun : tout tient dans le viewBox 240 (adulte : x de 4 à 236 hors lueurs, y de 2 à 206 hors lueurs). Prévoir **≈ 12 unités de marge au-dessus** pour le rebond de `happy` (−10) et les lueurs des bourgeons.
- Profil D4 : `path`, `circle`, `ellipse`, `g` (transform ou clip-path), dégradés, `clipPath`, `defs`, `stop` ; ni filtre, ni CSS, ni texte, ni masque. 61 SVG vérifiés par script (bien formés, `url(#…)` résolus, ids uniques par fichier).
- Poses : 78 boucles et séquences vérifiées (offsets 0 et 1, croissants, courbes connues, boucles fermées, cibles et variantes existantes, préréglages de particules existants, réactions : toutes les parties communes visées existent à chaque stade).
- Animations : `transform` et `opacity` seulement ; aucune boucle en mouvement réduit.

## Coût d'intégration

1. **Ranger** : `child/`, `teen/`, `adult/` → `assets/creature/kawaii/` ; `egg/` → `assets/creature/egg/` (partagé). Les chemins de `poses.json` (`creature/kawaii/<stade>/…`, `creature/egg/…`) sont déjà ceux d'après rangement.
2. **Poses** : lire `stages[<stade>]` avec les clés communes de la racine (ou scinder en `spec/motion/poses/kawaii-<stade>.json` par script, sans autre changement). Petit ajout à l'interprète : `handoff` (afficher le bébé à l'offset et jouer `hatch-<espèce>`) et `{kind}` dans le nom d'un préréglage. Rien d'autre de nouveau : `visible`, `variants`, `static`, boucles, séquences, groupes additifs, comme pour le bébé.
3. **Réactions** : dans `spec/motion/reactions.json`, ajouter `"kawaii": ["wing-left", "wing-right"]` à `groups.wings.parts` (les autres stades n'ont pas ces parties : ignorées sans erreur). Aucune réaction ne vise `tail`.
4. **Remplacer `apps/web/src/creature/egg.ts`** par l'œuf défini ici ; le stade courant (`pet.stage`) vient des règles, pas du design.
5. **Poids** : 63 fichiers, 440 Ko d'après `design/stages/kawaii/` (dont la page de 190 Ko). Un stade affiche au plus 17 parties (adulte) ; chaque partie est un petit SVG avec 1 à 3 dégradés.

## Ce qui reste faible

- Les corps grossissent peu (+16 % de hauteur du bébé à l'adulte) : la croissance se lit surtout par l'ajout des éléments. Un agrandissement d'affichage par stade (échelle de l'interprète) est possible sans redessin.
- La flamme de la queue ressemble à une feuille dorée à petite taille ; elle est volontairement simple (profil D4).
- Versions éteintes (queue et ailes `dim`) peu contrastées sur le ciel de jour : l'état se lit par la pose tombante, pas par la teinte, mais elles pâlissent beaucoup.
- Pas de variation de visage à l'âge adulte (même regard que le bébé) : choix de cohérence ; une évolution du regard serait un 5e élément, hors consigne.
- Essai fait dans le navigateur intégré à 375 × 812 et en bureau, pas sur un vrai téléphone ; la navigation au clavier de la page n'a pas été éprouvée à la main.
- `stades.html` rejoue l'éclosion avec de petites étincelles de démonstration : la vraie bouffée vient de `particles.json` (`hatch-kawaii`).
