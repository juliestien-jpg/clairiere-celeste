# Équilibrage et règles d'évolution — Tamagoshi

Document du game designer. Il complète D3 (l'Envol), D5 (notifications) et l'Annexe A de [decisions.md](decisions.md). Les valeurs sont dans [`spec/balance.json`](../spec/balance.json) ; ce document explique le modèle précis (assez pour écrire `packages/rules` sans ambiguïté), chiffre le pire cas et démontre les garanties de D3.

Les chiffres de ce document viennent d'une **simulation exécutée** (Node.js 24, script jetable hors dépôt qui lit `spec/balance.json` et applique le modèle ci-dessous par pas de 60 s). Ce ne sont pas des calculs à la main. Ils sont à reproduire dans des scénarios de `spec/scenarios/` (section 8).

## 1. Résumé

| Garantie (D3) | Exigence | Résultat du pire cas | Marge |
|---|---|---|---|
| G1 — nuit de 10 h sans soin | jamais « affaiblie » | santé minimale 66,1 sur 2 592 départs « corrects » avec malchance maximale (seuil d'affaiblie : 45) | 21 points de santé |
| G2 — week-end de 48 h depuis des jauges pleines | pas d'Envol | santé 53,4 à 48 h, avec malchance maximale ; l'animal n'est même pas affaibli | Envol à T+81,4 h au plus tôt : 33,4 h de marge ; affaiblie à T+53,3 h : 5,3 h de marge |
| G3 — délai entre « affaiblie » et Envol | au moins 24 h | 28,1 h au minimum sur 3 456 départs, malchance maximale | 4,1 h (au plus tôt) ; 36,4 h sans maladie |
| G4 — une longue absence peut mener à l'Envol | plafond `catchUp.maxSeconds` supérieur à la durée minimale avant l'Envol | Envol à T+76,9 h au plus tôt (départ jauges initiales), T+95,8 h au plus tard depuis des jauges pleines, T+106,1 h dans le pire départ imaginable ; plafond à 168 h | 62 h au-dessus du pire départ |

« Malchance maximale » : la maladie survient au premier pas où elle est possible (le tirage aléatoire donne toujours 0). « Malchance minimale » : jamais malade. Les deux bornes encadrent toutes les graines (300 graines testées : Envol entre T+77,0 h et T+83,3 h depuis les jauges initiales, délai « affaiblie → Envol » d'au moins 28,1 h).

## 2. Choix de conception

1. **Le sommeil est déclenché par l'énergie, pas par l'horloge.** L'animal s'endort tout seul quand son énergie tombe à 5 ou moins, et se réveille tout seul à 100. Le joueur peut aussi le coucher (si l'énergie est à 85 ou moins) ou le réveiller. Raisons : aucune dépendance au fuseau horaire ni à l'heure d'été (donc aucun risque de divergence TS/Dart), un seul mécanisme à tester, et la garantie « nuit de 10 h » n'en dépend pas : elle est démontrée **sans aucun sommeil** (le sommeil ne fait que ralentir les jauges). Conséquence de jeu : l'animal vit à son rythme. Un joueur qui le couche à sa dernière visite du soir lui offre une nuit de 8 à 10 h ; un animal abandonné dort de lui-même par tranches d'environ 15 h une fois épuisé.
2. **La santé baisse à vitesse constante, lentement, dès qu'un besoin vital est critique.** Besoins vitaux : satiété, hygiène, bonheur. L'énergie n'en fait pas partie : la fatigue se règle d'elle-même par le sommeil. La maladie s'ajoute. Une vitesse constante (et non proportionnelle au nombre de jauges critiques) rend le délai « affaiblie → Envol » borné et simple à prouver.
3. **La maladie ne vient que d'une négligence** (hygiène ou satiété critique). Un joueur régulier ne la rencontre jamais ; elle sert d'avertissement et se soigne en une action.
4. **Seuil « affaiblie » = santé critique = 45.** Le délai de grâce avant l'Envol (au moins 24 h) est alors `45 / 1,6 = 28,1 h` au pire. Un test de cohérence doit vérifier `gauges.health.critical == envol.weakWhenHealthAtOrBelow`.
5. **Aucun effet des stades sur le rythme des jauges** dans cette version (les stades changent l'apparence). À revoir après un essai humain.

## 3. Modèle de règles (précis)

### 3.1 Conventions

- Les jauges valent de 0 à 100, 100 = parfait. Après chaque modification : `clamp(v, 0, 100)`.
- Un niveau se calcule ainsi : `critical` si `v <= critical`, sinon `low` si `v <= low`, sinon `ok` (comparaisons **inclusives** partout).
- Toute vitesse par heure devient une variation par pas : `variation = vitesse * dt / 3600` (multiplication puis division, dans cet ordre, `dt` en secondes). Même ordre en Dart pour avoir les mêmes bits.
- Opérations autorisées : `+ − × ÷`, `min`, `max`, `clamp`, comparaisons. Aucune `pow/exp/log`.
- Horodatages en ms. Un « instant d'événement » est la fin du pas où l'événement survient.
- **Éviter dans les scénarios les instants posés exactement sur un seuil** (par exemple la satiété initiale de 80 atteint 35 pile à 10 h) : à 10⁻¹² près, le franchissement peut tomber un pas plus tôt ou plus tard. Choisir des durées qui n'y tombent pas.

### 3.2 Rattrapage du temps

Le temps n'avance que par pas entiers de `catchUp.stepSeconds` (60 s), sur la grille fixe `bornAt + k × pas`. À chaque appel de `reduce` :

- **Cible** : le dernier point de grille `<= nowMs`. Le reste (moins d'un pas) n'est pas perdu : il est reporté à l'appel suivant. `pet.lastUpdatedAt` reste donc toujours sur la grille.
- **Plafond** : au plus `floor(catchUp.maxSeconds / stepSeconds)` pas sont rejoués par appel (7 jours). **Au-delà, le temps en trop est offert** : `lastUpdatedAt` saute directement à la cible, sans rejouer les pas. Sans plafond atteint, une même absence découpée en plusieurs appels donne le même état, le même `rng` et les mêmes événements ; si un appel dépasse le plafond, le découpage peut changer l'état.
- **Pas appliqués** : chaque pas applique la séquence de 3.3.
- **Envol** : si l'animal s'envole pendant le rattrapage, on s'arrête : `flownAt` = fin du pas de l'Envol, `life = "flown"`, événement `flewAway`, et l'horloge s'arrête à `flownAt`. L'action du joueur est ensuite traitée au point de grille, avec les refus prévus en A2 (`flownDuringCatchUp`).
- **Âge** : `stage` se calcule sur le temps écoulé depuis `bornAt`, non plafonné. Un `stageChanged` est émis au pas où chaque seuil est franchi, un par palier, dans l'ordre.
- **Sauvegarde hors grille** : une sauvegarde dont `lastUpdatedAt` n'est pas sur la grille est réalignée par `migrate` au point inférieur (A2).

### 3.3 Un pas de `dt` secondes (ordre à respecter)

Soit `asleep = pet.status.asleep`.

1. **Jauges.**
   - Éveillé : `satiety −= 4.5`, `happiness −= 3`, `energy −= 3.5`, `hygiene −= 1.5` (par heure, voir 3.4).
   - Endormi : `satiety −= 1.5`, `happiness −= 1`, `hygiene −= 0.5`, `energy += 6.5`.
2. **Salissures** (éveillé seulement, et seulement si `messes < messes.max`) : `messProgressSeconds += dt`. Quand il atteint `everyHoursAwake * 3600` : `messProgressSeconds −= everyHoursAwake * 3600`, `messes += 1`, `hygiene −= decayPerMess` (15, en une fois). Quand `messes` vaut `max` (3), le compteur est suspendu jusqu'au nettoyage.
3. `clamp` des quatre jauges.
4. **Sommeil.** Si endormi et `energy >= 100` : il se réveille (`wokeUp`). Sinon si éveillé et `energy <= 5` : il s'endort (`fellAsleep`, `asleepSince = fin du pas`).
5. **Maladie** (seulement si `sick = false`). `chance = 0,1/h si hygiène critique + 0,1/h si satiété critique`. Si `chance > 0` : tirer **un** nombre `d` dans `[0,1)` avec le générateur de la sauvegarde (un seul tirage par pas, même si les deux conditions sont vraies) ; il tombe malade si `d < chance * dt / 3600` (`becameSick`, `sickSince`). Aucun tirage quand `chance = 0` : le nombre de tirages ne dépend donc que de l'état, jamais de l'interface.
6. **Santé.** `critiqueVital = satiété critique OU hygiène critique OU bonheur critique`.
   - `critiqueVital` : `health −= 1.3 * dt / 3600`.
   - malade : `health −= 0.3 * dt / 3600` en plus (les deux se cumulent : 1,6/h).
   - ni l'un ni l'autre : `health += 2 * dt / 3600`.
   - puis `clamp`.
7. **Affaiblie / Envol.**
   - si `health <= 0` : Envol (voir 3.2), fin.
   - sinon si pas encore affaiblie et `health <= 45` : `weakSince = fin du pas`, événement `weakened`.
   - sinon si affaiblie et `health > 60` : `weakSince = null`, événement `recoveredStrength`. L'écart 45 / 60 évite les allers-retours.

Un pas est donc sans effet de bord caché : mêmes entrées, mêmes sorties.

### 3.4 Vitesses et ce que le joueur doit faire

« Durée » = depuis une jauge pleine (100), animal éveillé, rien fait. Entre parenthèses : depuis la valeur initiale (80 ; l'hygiène initiale est 100).

| Jauge | Éveillé | Endormi | Pleine → basse | Pleine → critique | Ce qui la remonte |
|---|---|---|---|---|---|
| Satiété (basse 35, critique 15) | −4,5/h | −1,5/h | 14,4 h (10 h) | 18,9 h (14,4 h) | repas +35 (attente 90 min, refusé au-dessus de 90), en-cas +10 (attente 30 min) |
| Bonheur (35, 15) | −3/h | −1/h | 21,7 h (15 h) | 28,3 h (21,7 h) | jeu +25 (coûte 5 d'énergie, 3 de satiété), caresse +5 (attente 5 min), repas +5, en-cas +10 |
| Énergie (30, 10) | −3,5/h | +6,5/h | 20 h (14,3 h) | 25,7 h (20 h) | dormir (rien d'autre : le jeu l'épuise un peu) |
| Hygiène (40, 15) | −1,5/h et −15 par salissure (toutes les 5 h éveillé, 3 au plus) | −0,5/h | 15 h | 26,7 h | nettoyer : hygiène 100 et salissures à 0 |
| Santé (basse 75, critique 45) | −1,3/h si un besoin vital est critique ; −0,3/h de plus si malade | | voir 4 | voir 4 | +2/h si aucun besoin vital critique et pas malade ; soigner +20 et guérit la maladie (attente 15 min) |

Équilibre d'une journée type d'un animal éveillé 14 h et couché 10 h : la satiété perd 14 × 4,5 + 10 × 1,5 = 78 (trois repas apportent 105, avec marge) ; le bonheur perd 52 (deux jeux apportent 50 et les repas 15) ; l'énergie perd environ 49 en éveil plus 5 par jeu, et se rétablit en environ 8 à 10 h de sommeil.

### 3.5 Actions

Toutes sont **refusées** (état inchangé, événement `actionRefused` avec la raison) si l'animal est envolé (sauf `rebirth`). Pendant le sommeil, seules `wake` et `tick` sont acceptées (raison `asleep`). Les attentes (`cooldowns`) sont des instants (ms) avant lesquels l'action est refusée (raison `cooldown`) ; 0 = disponible.

| Action | Effet | Refus |
|---|---|---|
| `feed.meal` | satiété +35, bonheur +5 ; attente 5 400 s | satiété > 90 (`notHungry`), attente |
| `feed.snack` | satiété +10, bonheur +10 ; attente 1 800 s | satiété > 90, attente |
| `play` | bonheur +25, énergie −5, satiété −3 | énergie ≤ 15 (`tooTired`) |
| `clean` | hygiène 100, salissures 0 | hygiène 100 et aucune salissure (`alreadyClean`) |
| `heal` | guérit la maladie, santé +20 ; attente 900 s | non malade et santé 100 (`nothingToHeal`), attente |
| `pet` | bonheur +5 ; attente 300 s | attente |
| `sleep` | endormi | énergie > 85 (`notTired`), déjà endormi |
| `wake` | éveillé | pas endormi ; énergie ≤ 5 (`exhausted`) |

Après une action, on réévalue l'état affaiblie (étape 7) : un soin peut faire quitter « affaiblie » immédiatement.

### 3.6 Maladie

Seul `heal` guérit (événement `recovered`). Un animal malade perd 0,3/h de santé même sans besoin critique, soit 7 jours pour passer de 100 à 0 si on le laissait malade mais nourri : c'est lent par construction, la menace vient des besoins vitaux critiques.

### 3.7 Stades (inchangés)

`egg` 0 h, `baby` 0,05 h, `child` 24 h, `teen` 96 h, `adult` 240 h, selon l'âge réel. Pas de vieillesse (D3). Un stade qui saute plusieurs paliers (longue absence) émet un événement `stageChanged` par palier franchi, dans l'ordre.

### 3.8 Vue dérivée (`deriveView`)

- `gaugeLevels` : niveau de chaque jauge (règle de 3.1).
- `primary`, par ordre de priorité (D4) : `flown` si envolé ; `weak` si affaiblie ; `sick` ; `asleep` ; `hungry` si satiété ≤ basse ; `dirty` si **hygiène** ≤ basse ; `tired` si énergie ≤ basse ; sinon `happy`. Les salissures isolées (hygiène encore correcte) sont montrées comme de petites taches sans changer l'état principal, sinon l'animal serait « sale » presque tout le temps.
- `secondary` : au plus 2 autres besoins actifs parmi `satiety, hygiene, happiness, energy, sick`. **Point ouvert pour `designer-ui`** : un bonheur bas n'a pas d'état principal dans la table D4 ; il apparaît comme besoin secondaire.

### 3.9 Notifications (`attention`) et `nextAttentionAt`

Besoins notifiables : `satiety`, `hygiene`, `happiness` au niveau « bas » (`notifyAt: "low"`), `sick` au moment de la maladie, et `weak` (toujours signalé). **L'énergie n'est jamais notifiée** : l'animal s'endort seul. Raison du niveau « bas » : la santé ne commence à baisser qu'au niveau critique, soit 4 h plus tard pour la satiété (20/4,5) et plus pour les autres : une notification au niveau bas laisse toujours du temps.

Prévision (`nextAttentionAt(state, time, balance, history?)`) : à partir de l'état, avancer sans action sur la grille, avec le générateur aléatoire **copié** (la maladie est donc prédite avec certitude), jusqu'à `catchUp.maxSeconds` au plus, et collecter les besoins qui **apparaissent après l'instant d'appel**.

Ce qui est déjà actif à l'appel dépend de `history` : `{ sent: [{ at, need }] }`, les notifications déjà envoyées, tenues par l'appelant hors de la sauvegarde.
- Sans `history`, les besoins déjà actifs sont supposés connus du joueur, sans espacement ni plafond (comportement historique).
- Avec `history`, un besoin actif n'est « déjà signalé » que s'il figure dans `history.sent` depuis son apparition (`sickSince` pour la maladie, `weakSince` pour « affaiblie » ; pour les jauges, l'appelant retire les entrées d'un besoin résolu). Un besoin actif mais jamais envoyé **reste dû**, à l'instant courant ou à la fin des heures calmes.

Puis, pour chaque besoin ordinaire (tout sauf `weak`) :

1. **Heures calmes** : un besoin apparu pendant les heures calmes (21:30 → 08:00, heure locale = UTC + `utcOffsetMin`) est reporté à 08:00.
2. **Espacement** : deux notifications consécutives sont espacées d'au moins `minGapMinutes` (180), tout besoin confondu. Les besoins qui apparaissent entre-temps sont **regroupés** dans la notification suivante (le texte est composé à l'envoi, d'après l'état réel).
3. **Plafond par jour** : au plus `maxPerDay` (4) notifications par jour local, dont `reservedForAlwaysNotify` (1) place réservée à `weak` : les besoins ordinaires n'en ont donc que 3. Un excédent est reporté au lendemain à 08:00.

`weak` (« affaiblie ») est toujours signalé : il ignore les heures calmes et l'espacement, mais reste soumis au plafond total. Si celui-ci est atteint, il passe au lendemain à minuit local.

Un besoin résolu avant l'envoi disparaît de la prévision au recalcul suivant, c'est-à-dire après chaque action.

`nextAttentionAt` renvoie le premier élément de cette liste (`{ at, need }`, `need` = le besoin le plus pressant du groupe : `weak` > `sick` > `satiety` > `hygiene` > `happiness`) ou `null`. Les instants renvoyés sont des points de la grille. Aucun état supplémentaire n'est requis dans la sauvegarde : l'historique est tenu par l'appelant.

## 4. Pire cas d'abandon total

Hypothèses : aucune action, malchance maximale (malade dès que c'est possible). Les deux départs : jauges **initiales** (animal qui vient d'éclore, 80/80/80/100/100) et jauges **pleines** (tout à 100). T = instant de la dernière action. Santé : `100 − 1,6 × (t − t_critique)`.

| Événement | Départ initial (T+) | Départ pleines (T+) |
|---|---|---|
| Satiété basse | 10,0 h | 14,4 h |
| Énergie basse | 14,3 h | 20,0 h |
| **Satiété critique, maladie, la santé commence à baisser** | **14,4 h** | **18,9 h** |
| Hygiène basse (3ᵉ salissure) | 15,0 h | 15,0 h |
| Bonheur bas | 15,0 h | 21,7 h |
| Énergie critique | 20,0 h | 25,7 h |
| L'animal s'endort (énergie 5), jusqu'à environ 14,6 h plus tard | 21,4 h | 27,1 h |
| Bonheur critique | 22,1 h | 30,7 h |
| Hygiène critique | 36,4 h | 26,7 h |
| Santé 75 (basse) | 30,1 h | 34,5 h |
| **Affaiblie (santé 45)** | **48,8 h** | **53,3 h** |
| **Envol (santé 0)** | **76,9 h** | **81,4 h** |

Santé du départ initial : 84,6 à T+24 h, 65,4 à T+36 h, 46,2 à T+48 h (pas encore affaiblie ; elle le devient à 48,8 h), 27,0 à T+60 h, 7,8 à T+72 h.

Sans maladie (malchance minimale) la décroissance est 1,3/h : affaiblie à T+56,8 h et Envol à T+91,4 h (initial), affaiblie à T+61,2 h et Envol à T+95,8 h (pleines). **Fourchette de l'Envol : environ 3,2 à 4 jours.** Entre affaiblie et Envol : 28,1 h (malade) à 34,6 h (en bonne santé de départ, sans maladie) au minimum, selon le cas.

**Notifications de ce pire cas** (abandon à 08:00, départ initial, malade) : 18:00 le jour même « faim » ; 08:00 le lendemain, **une seule** notification groupée (maladie, hygiène, bonheur) car les besoins sont apparus pendant la nuit calme ; 08:48 le surlendemain, « affaiblie » ; l'Envol survient à T+76,9 h, soit à 12:54 le jour 3, **28,1 h après l'alerte « affaiblie »**. Au plus une notification par jour dans ce scénario. Pour un abandon à 19:30 depuis des jauges pleines : 3 notifications le lendemain (faim à 09:54, hygiène à 12:54, maladie à 15:54, espacées d'au moins 3 h), puis le bonheur à 08:00 le jour suivant, puis une par jour.

### Retour tardif : l'animal se rétablit-il ?

Abandon depuis les jauges initiales, malade, puis le joueur revient et fait **repas + nettoyage + jeu + soin**, puis repasse toutes les 5 h :

| Retour à | Santé avant | Santé juste après les soins | N'est plus « affaiblie » (santé > 60), visites toutes les 5 h |
|---|---|---|---|
| T+24 h | 84,7 | 100 | jamais affaiblie |
| T+48 h | 46,3 | 66,3 | jamais affaiblie |
| T+60 h (affaiblie) | 27,1 | 47,1 | à la 2ᵉ visite suivante (+10 h) |
| T+72 h (affaiblie) | 7,9 | 27,9 | à la 2ᵉ visite suivante (+10 h) |
| T+76 h (à 1 h de l'Envol) | 1,5 | 21,5 | à la 3ᵉ visite suivante (+15 h) |

Même à une heure de l'Envol, les soins suffisent (note : un seul repas laisse la satiété à 32, critique 4 h plus tard ; la maladie revient alors en cas de malchance maximale, et les visites suivantes la soignent). L'animal est rattrapable tant qu'il n'a pas franchi 0.

## 5. Joueur régulier

Politique simulée : visites à 08:00, 13:00 et 19:30 pendant 60 jours ; à chaque visite repas si satiété ≤ 70, nettoyage si salissure ou hygiène ≤ 80, jeu si bonheur ≤ 75, soin si malade, et **coucher à la visite du soir**. Elle reste volontairement économe (un repas, un jeu au plus par visite).

Exemple de deux jours (jour 10 et 11, valeurs avant / après les soins) :

| Visite | Satiété | Bonheur | Énergie | Hygiène | Santé | Actions |
|---|---|---|---|---|---|---|
| J10 08:00 | 61,9 → 93,9 | 65,5 → 95,5 | 86,8 → 81,8 | 75,0 → 100 | 100 | repas, nettoyage, jeu |
| J10 13:00 | 71,4 | 80,5 | 64,3 | 77,5 → 100 | 100 | nettoyage |
| J10 19:30 | 42,1 → 74,1 | 61,0 → 91,0 | 41,6 → 36,6 | 75,2 → 100 | 100 | repas, nettoyage, jeu, coucher |
| J11 08:00 | 47,2 → 82,2 | 73,0 → 78,0 | 90,4 | 76,0 → 100 | 100 | repas, nettoyage |
| J11 13:00 | 59,7 → 91,7 | 63,0 → 93,0 | 72,9 → 67,9 | 77,5 → 100 | 100 | repas, nettoyage, jeu |
| J11 19:30 | 62,4 → 97,4 | 73,5 → 78,5 | 45,2 | 75,2 → 100 | 100 | repas, nettoyage, coucher |

Résultat sur 60 jours, selon le nombre de visites par jour (même politique ; 2 visites avec en-cas en plus) :

| Visites par jour | Satiété min. | Bonheur min. | Énergie min. | Hygiène min. | Santé min. | Maladies | Temps avec un besoin critique | Notifications totales (max par jour) |
|---|---|---|---|---|---|---|---|---|
| 4 (08, 12, 16, 20) | 47,7 | 56,1 | 33,0 | 69,4 | 100 | 0 | 0 % | 0 (0) |
| **3 (08, 13, 19:30)** | **37,8** | **54,4** | **34,8** | **60,2** | **100** | **0** | **0 %** | **0 (0)** |
| 2 (09, 19:30), avec en-cas | 39,8 | 43,7 | 32,9 | 28,3 | 100 | 0 | 0 % | 6 sur 60 jours (1) |
| 1 (19:00) | 0 | 0 | 21,9 | 22,1 | 80,3 | 45 | 50 % | 150 sur 60 jours (3) |

Lecture : **avec 3 visites par jour, aucune jauge ne descend sous son seuil « bas »** (le minimum de satiété, 37,8, reste au-dessus de 35) et aucune notification ne part. Avec 2 visites, l'animal tient à condition de donner repas et en-cas. Avec une seule visite, l'animal a faim une bonne partie de la journée et tombe souvent malade, mais **il ne s'envole jamais** (santé minimale 80,3), car la santé remonte de 2/h dès que les besoins sont satisfaits. Le nombre maximal de notifications par jour reste de 3 dans ce cas, sous le plafond de 4.

### Week-end de 48 h après une semaine régulière

Dernière visite le vendredi à 19:30, retour le dimanche à 19:30, animal couché le vendredi (malchance maximale) : santé 100 le vendredi, **62,8 à son retour**, malade, satiété et bonheur à 0, 3 salissures ; ni affaiblie ni envolée. Sans maladie : santé 69,8. Si l'animal n'a pas été couché le vendredi : 67,9 (malade) ou 73,9. Un soin (repas, nettoyage, jeu, soin) suffit à le remettre en état. **Point d'attention** : après 48 h, toutes les jauges sont à zéro : c'est conforme à la règle (pas d'Envol) mais l'image est dure ; à valider par un essai humain.

## 6. Démonstration des garanties

### G1 — nuit de 10 h, jamais « affaiblie »

Grille de 2 592 départs « corrects » (chaque jauge au-dessus de son seuil bas, satiété et bonheur parmi {36, 60, 100}, hygiène {41, 70, 100}, énergie {31, 60, 100}, santé {76, 100}, salissures 0 ou 3, compteur de salissure neuf ou sur le point de se déclencher, endormi ou non, malade ou non), malchance maximale : aucune des 2 592 simulations n'atteint l'état « affaiblie » ; la santé finale minimale est **66,1** (départ santé 76, malade). Variante où l'animal ne dort jamais (1 296 départs éveillés) : même minimum, 66,1, aucun affaibli. Pour les jauges initiales : à T+10 h, satiété 35,0 (tout juste basse), bonheur 50,0, énergie 45,0, hygiène 55,0 (2 salissures), santé 100, jamais critique.

Raison structurelle : en 10 h la santé ne peut perdre au plus que 10 × 1,6 = 16 points, et un départ « correct » a au moins 76 : il reste plus de 60, loin des 45 de l'état affaiblie.

### G2 — 48 h depuis des jauges pleines, pas d'Envol

Tout à 100, santé 100, malchance maximale : la maladie arrive à T+18,9 h, la santé vaut 53,4 à T+48 h, **non affaiblie**. Même déjà malade au départ : 47,7, non affaiblie. L'Envol arrive au plus tôt à T+81,4 h.

### G3 — au moins 24 h entre « affaiblie » et Envol

L'entrée en affaiblie se fait à une santé d'au plus 45 (et d'au moins 44,97 avec le pas de 60 s). Ensuite la santé ne peut baisser qu'à 1,6/h au maximum (besoin vital critique et maladie), donc `44,97 / 1,6 = 28,1 h`. Simulation sur 3 456 départs (jauges de 20 à 100, énergie 0 à 100, santé 100, 80, 47 ou 46, endormi ou non, malade ou non, salissures 0 ou 3) avec malchance maximale : délai minimal **28,1 h**. Aucune action ne retire de la santé, donc aucune ne peut raccourcir ce délai. Le joueur est prévenu à l'entrée en affaiblie, soit 28 h au moins avant l'Envol.

### G4 — le plafond est supérieur à la durée minimale avant l'Envol

L'Envol arrive à T+76,9 h au plus tôt (jauges initiales, malchance maximale) et à T+106,1 h au plus tard (pire départ de la grille de 1 728 cas : tout à 100 sauf l'hygiène à 60, énergie 0 donc sommeil immédiat, 3 salissures, jamais malade). Le plafond `catchUp.maxSeconds` vaut 604 800 s (168 h) : **62 h de marge** sur le pire départ, 91 h sur le plus rapide. Un joueur absent plus de 168 h trouve donc toujours un animal envolé. Dans la grille complète, tous les animaux finissent par s'envoler.

## 7. Vérifications complémentaires

- Le nombre de notifications ne dépasse jamais 4 par jour dans aucun scénario simulé (3 au maximum), avec `weak` toujours signalé même de nuit (ex. à 00:48 dans l'abandon à 19:30).
- L'énergie n'atteint le niveau bas (30) pour un joueur à 3 visites que le soir, juste avant le coucher (minimum 34,8) : l'animal n'est jamais fatigué en journée.

## 8. Scénarios à écrire (`spec/scenarios/`, testeur QA)

Chaque scénario part d'un état et d'une suite d'actions horodatées ; tolérance des jauges 0,001 ; éviter les instants exactement sur un seuil.
1. `nuit-10h-initial` : jauges initiales, `tick` à +10 h, malchance maximale (graine dont le premier tirage est 0 : à fixer avec la spec du générateur). Attendu : pas d'événement `weakened`, santé 100.
2. `nuit-10h-bornes` : le départ le plus défavorable de G1 (satiété 36, bonheur 36, hygiène 41, énergie 31, santé 76, malade) : santé finale 66,1 ± 0,1.
3. `weekend-48h-pleines` : tout à 100 puis `tick` à +48 h : non envolé, non affaiblie, santé 53,4 en cas de maladie dès que possible.
4. `delai-affaiblie-envol` : abandon depuis les jauges initiales avec malchance maximale : `weakened` à T+48,8 h, `flewAway` à T+76,9 h, écart ≥ 24 h ; même scénario sans maladie : 56,8 h et 91,4 h.
5. `plafond-168h` : absence de 400 h : l'état est celui d'un abandon de 168 h (envolé) ; `lastUpdatedAt` = maintenant.
6. `retour-tardif-76h` : retour à T+76 h, repas + nettoyage + jeu + soin : santé 21,5 juste après, `recoveredStrength` entre la 2ᵉ et la 3ᵉ visite suivante (+10 à +15 h) avec une visite toutes les 5 h (repas, nettoyage, jeu, soin si malade).
7. `regulier-3-visites-60j` : 60 jours de visites à 08:00, 13:00, 19:30 : jamais un niveau critique, santé 100, aucun événement de besoin critique.
8. `sommeil-auto` : énergie 6 éveillé : `fellAsleep` à l'énergie 5, `wokeUp` à 100 sans intervention (durée 14,6 h).
9. `attention-quietHours` : besoin apparu à 22:00 → `nextAttentionAt` à 08:00 ; `weak` apparu à 02:00 → notifié à 02:00.

## 9. Points à valider par un essai humain ou par l'utilisateur

1. **Rythme de la faim** : le joueur à 3 visites est confortable, celui à 2 visites doit penser à l'en-cas, celui à 1 visite subit un animal affamé la moitié du temps (sans risque d'Envol). Est-ce voulu, ou faut-il ralentir la satiété (4,5/h) ? Toucher à ce chiffre déplace tout le tableau du pire cas : relancer la simulation.
2. **Week-end de 48 h** : toutes les jauges à zéro et un animal malade au retour (santé 63). Conforme aux garanties, mais à ressentir en vrai.
3. **Sommeil par l'énergie** : l'animal peut s'endormir en pleine journée s'il est négligé, et se réveiller à 4 h du matin si on le couche tôt avec peu d'énergie utilisée. Acceptable ? Alternative (coucher suivant l'heure locale) non retenue pour la sécurité du déterminisme.
4. **Notification « affaiblie » de nuit** : conforme à D5, mais peut réveiller le joueur ; à confirmer.
5. **Pas d'état principal « triste »** quand le bonheur est bas (D4) : à décider avec `designer-ui`.
6. **Contrats modifiés ou ajoutés** (pour l'architecte) : voir ci-dessous.

### Contrats

- **Ajout à A1 (sauvegarde, `pet.status`)** : `messProgressSeconds` (entier ou nombre, secondes d'éveil accumulées vers la prochaine salissure, 0 à `everyHoursAwake * 3600`). Sans lui, la cadence des salissures ne peut pas être rejouée. `spec/save.schema.json` et `createSave` (valeur initiale 0) sont à adapter. `cooldowns` : les valeurs sont des instants en ms avant lesquels l'action est refusée (0 = disponible).
- **Clés de `balance.json` conservées** : toutes celles de l'Annexe A3 d'origine ; aucune n'est renommée ni supprimée.
- **Valeurs et sens modifiés** : `gauges.health.critical` et `envol.weakWhenHealthAtOrBelow` passent de 20 à 45 (égaux) ; `gauges.health.low` de 40 à 75 ; `gauges.health.decayPerHourWhenCritical` vaut désormais « par heure, une seule fois, si au moins un besoin vital (satiété, hygiène, bonheur) est critique » (1,3), et non 5 ; `maxPerDay` inclut la place réservée à `weak`.
- **Clés ajoutées** : `gauges.hygiene.decayPerHourAsleep`, `gauges.health.decayPerHourWhenSick`, `gauges.health.regenPerHourWhenWell`, `sleep.{autoSleepAtOrBelowEnergy, wakeAtOrAboveEnergy, manualSleepMaxEnergy}`, `actions.*.refusedAboveSatiety` (repas, en-cas), `actions.play.requiresEnergyAbove`, `cooldownSeconds` sur `feed.meal` et `heal`, `envol.recoverWhenHealthAbove`, `attention.{needs, reservedForAlwaysNotify, minGapMinutes}`.
- `balanceVersion` reste à 1 (aucun fichier publié). `spec/balance.schema.json` est à écrire à partir de ce fichier.

## 10. Méthode de la simulation

Script jetable (hors dépôt) : lit `spec/balance.json`, applique le pas de 3.3 toutes les 60 s, avec un tirage aléatoire soit forcé à 0 (malchance maximale), soit forcé à 0,999999 (aucune maladie), soit issu d'un mulberry32 (300 graines). Grilles : G1 2 592 départs sur 10 h ; G3 3 456 départs ; G4 1 728 départs ; joueur régulier 60 jours. Les chiffres sont arrondis au dixième d'heure. Toute modification de `balance.json` impose de relancer ces vérifications, puis de mettre ce document à jour.
