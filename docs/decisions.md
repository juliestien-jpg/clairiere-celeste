# Décisions d'architecture et de produit — Tamagoshi

Journal des décisions structurantes. Chaque entrée suit le même format : titre, date, statut, contexte, options examinées, décision, raisons, conséquences.

Statuts possibles :
- **Décidé** : s'applique, les agents doivent le respecter.
- **Proposé, à valider par l'utilisateur** : recommandation de l'architecte. Les agents peuvent avancer sur cette base, mais rien d'irréversible (format publié, données joueur) ne doit en dépendre avant validation.
- **Remplacé par Dxx** : historique conservé.

| # | Sujet | Statut |
|---|---|---|
| D1 | Stack web et partage des règles avec Flutter | Décidé |
| D2 | Sauvegarde : locale, sans compte | Décidé (validé par l'utilisateur) |
| D3 | Mort par Envol après négligence, renaissance par le joueur, un seul animal | Décidé (choix de l'utilisateur) |
| D4 | Direction artistique « Clairière céleste » | Décidé |
| D5 | Notifications web et mobile, déclenchées par les besoins réels | Décidé (choix de l'utilisateur) |
| D6 | Deux espèces tirées au hasard à la naissance : kawaii ou féérique | Décidé (choix de l'utilisateur) |
| Annexe A | Contrats : état sauvegardé, règles, équilibrage, arborescence | Décidé (suit D1 à D6) |

---

## D1 — Stack web et partage des règles du jeu avec Flutter

- **Date** : 2026-11-13
- **Statut** : Décidé

### Contexte
Phase 1 en web, phase 2 en Flutter (Dart). Les règles du jeu sont des fonctions pures `(état, action, heure) → état` et l'équilibrage est en données. Il faut que la version mobile se comporte **exactement** comme la version web, sans maintenir deux jeux de règles qui divergent en silence. Les développeurs sont des agents IA : la stack doit être très répandue et peu ambiguë.

### Options examinées
1. **Flutter Web dès la phase 1** (un seul code Dart pour tout).
   - Pour : partage total, la phase 2 devient un simple ciblage mobile.
   - Contre : premier chargement lourd (plusieurs Mo), rendu canvas peu accessible (lecteurs d'écran, navigation clavier, zoom texte), effets visuels web (SVG, CSS) inutilisables, expérience « pas vraiment web ». Contraire à l'esprit « web d'abord ».
2. **Règles en TypeScript exécutées aussi dans Flutter** (moteur JavaScript embarqué de type QuickJS, ou règles compilées en WebAssembly).
   - Pour : une seule implémentation des règles.
   - Contre : pont asynchrone entre Dart et JS, débogage pénible, dépendance native à maintenir sur iOS et Android, taille de l'app. Beaucoup de machinerie pour quelques centaines de lignes de règles.
3. **Web en TypeScript, règles en paquet TypeScript pur, puis port Dart des règles garanti par une spécification neutre partagée** (duplication contrôlée).
   - Pour : chaque plateforme reste native et simple ; ce qui est partagé est ce qui compte vraiment (paramètres d'équilibrage, schéma de sauvegarde, scénarios de test) et c'est du JSON lisible par les deux.
   - Contre : les règles existent deux fois ; il faut une discipline (scénarios de conformité, arithmétique déterministe) pour qu'elles ne divergent pas.

### Décision
**Option 3.**
- Web : **TypeScript strict + Vite + React 19**, tests avec **Vitest**, dépôt en **workspaces npm** (pas d'outil supplémentaire).
- Règles : paquet `packages/rules`, TypeScript pur, **zéro dépendance**, aucune référence au DOM, à `Date.now()`, à `Math.random()` ni au stockage. C'est l'**implémentation de référence**.
- Source de vérité neutre dans `spec/` : `balance.json` (équilibrage), `save.schema.json` (JSON Schema de la sauvegarde), `scenarios/*.json` (vecteurs de conformité : état initial + suite d'actions horodatées → état et événements attendus), `motion/*.json` (voir D4).
- Phase 2 : port Dart des règles dans `apps/mobile/lib/rules/`. Le port est accepté **quand il passe tous les scénarios de `spec/scenarios/`**, exécutés par un lanceur Dart qui lit les mêmes fichiers JSON que le lanceur Vitest.

### Raisons
- C'est la solution la plus simple qui tient les deux phases : pas de pont entre langages, pas de serveur.
- Les règles d'un tamagoshi sont petites (jauges, seuils, stades) : les réécrire en Dart coûte peu ; ce qui coûterait cher, c'est une divergence silencieuse, et les scénarios partagés l'empêchent.
- React est la bibliothèque d'interface que les agents maîtrisent le mieux ; l'interface est mince, la logique est dans `packages/rules`.

### Conséquences
- **Déterminisme obligatoire** pour que TypeScript et Dart donnent les mêmes nombres :
  - les règles n'utilisent que `+ − × ÷`, `min`, `max`, `floor`, `round`, `clamp` (pas de `pow`, `exp`, `log`, `sin`… dont les résultats peuvent différer au dernier bit selon le moteur) ;
  - le temps est un entier en millisecondes depuis l'époque Unix (UTC), plus un décalage horaire local en minutes passé en entrée ;
  - l'aléatoire passe par un générateur à graine dont l'état est **stocké dans la sauvegarde** ; algorithme fixé dans la spécification (proposition : mulberry32, avec masquage explicite sur 32 bits pour que Dart et JS coïncident) et couvert par des scénarios ;
  - les scénarios comparent les jauges avec une tolérance de 0,001.
- Toute nouvelle règle arrive avec au moins un scénario dans `spec/scenarios/`. Un scénario qui passe en TS et échoue en Dart est un bug du port, jamais un « écart accepté ».
- Le rattrapage du temps d'absence se fait par pas fixes (`catchUp.stepSeconds`) jusqu'à un plafond (`catchUp.maxSeconds`), les deux dans `balance.json`.
- Le moteur de rendu de l'animal suit la même logique de partage (parties SVG et animations décrites en données, voir D4).

---

## D2 — Sauvegarde : locale uniquement, ou avec compte et synchronisation

- **Date** : 2026-11-13
- **Statut** : Décidé (validé par l'utilisateur le 2026-11-13)

### Contexte
Un tamagoshi vit sur un appareil. La question est de savoir si le joueur doit retrouver son animal sur un autre appareil (navigateur du PC puis téléphone), ce qui suppose un compte, un serveur, et donc des données personnelles, de la sécurité et un coût d'hébergement.

### Options examinées
1. **Locale uniquement, avec export / import d'un fichier de sauvegarde.**
   - Pour : aucun serveur, aucune donnée personnelle, aucune revue de sécurité de comptes, fonctionne hors ligne, rien à maintenir.
   - Contre : pas de synchronisation automatique ; le passage web → mobile se fait à la main (fichier, ou plus tard code / QR) ; perte de l'animal si le navigateur efface ses données.
2. **Locale d'abord, compte facultatif et synchronisation ajoutés plus tard** (service hébergé de type base de données + authentification).
   - Pour : le joueur qui le souhaite retrouve son animal partout ; les autres ne sont pas gênés.
   - Contre : serveur, authentification, RGPD (consentement, suppression de compte), gestion des conflits entre appareils, revue de sécurité. Charge disproportionnée pour la phase 1.
3. **Compte obligatoire dès le départ.**
   - Pour : synchronisation simple à raisonner.
   - Contre : friction à l'entrée (on veut adopter un animal, pas créer un compte), mêmes coûts que l'option 2, dépendance au réseau.

### Décision
**Option 1 pour les phases 1 et 2**, avec un format de sauvegarde conçu pour permettre l'option 2 plus tard sans migration douloureuse.
- Web : **IndexedDB** (l'état fait quelques kilo-octets), derrière une interface `SaveStore { load, save, exportFile, importFile }`. IndexedDB plutôt que `localStorage` parce que le service worker des notifications (D5) doit pouvoir relire la sauvegarde, et il n'a pas accès à `localStorage`. Appel à `navigator.storage.persist()` au premier lancement.
- Mobile : fichier JSON dans le stockage de l'application, même format, même interface.
- Export / import d'un fichier `.json` disponible dans les réglages dès la phase 1.

### Raisons
- Le jeu se joue seul, sur un appareil, par visites courtes : la synchronisation est un confort, pas le cœur.
- Sans compte, pas de données personnelles : le projet évite la sécurité des comptes et l'essentiel de la conformité RGPD. Le seul serveur du projet (envoi des notifications, D5) ne reçoit jamais la sauvegarde.
- Les règles étant pures et le temps une entrée, une future synchronisation est simple : on garde la sauvegarde la plus récente (`lastUpdatedAt`) et on recalcule le temps écoulé.

### Conséquences
- La sauvegarde porte dès la v1 un identifiant d'animal (`pet.id`, UUID) et des horodatages (`savedAt`, `pet.lastUpdatedAt`) : c'est tout ce qu'il faudra pour une synchronisation « dernier écrit gagne » sur le document entier.
- **Risque à connaître** : Safari (iOS et macOS) peut effacer le stockage d'un site non visité pendant environ 7 jours s'il n'est pas installé sur l'écran d'accueil. Parades : demande de stockage persistant, invitation à installer l'app (PWA), rappel discret d'exporter la sauvegarde. Je ne suis pas certain du comportement exact selon les versions de Safari : à vérifier par le testeur QA.
- Deux onglets ouverts sur le même animal : l'onglet qui sauvegarde relit d'abord, et un `BroadcastChannel` prévient l'autre onglet, qui recharge l'état (dernier écrit gagne).
- Validé par l'utilisateur : le transfert web → mobile est manuel (fichier) au moins jusqu'à la fin de la phase 2.

---

## D3 — Mort de l'animal : l'Envol, puis la renaissance

- **Date** : 2026-11-13
- **Statut** : Décidé (choix de l'utilisateur le 2026-11-13)

### Contexte
L'utilisateur veut que l'animal puisse mourir, sous la forme d'un **Envol**, et que le joueur doive ensuite en faire renaître un nouveau. L'Envol est déclenché **par la négligence seulement** : un animal bien soigné vit indéfiniment. Le ton reste « doux, attachant, jamais culpabilisant » (CLAUDE.md) : l'Envol est une vraie perte, mais racontée avec tendresse, sans image macabre, dans l'univers magique de D4.

### Options examinées
1. **Mort classique** (écran de fin, tombe). Écartée : contraire au ton et à la direction artistique.
2. **Veille réversible, aucune mort** (recommandation initiale de l'architecte). Écartée par l'utilisateur : la possibilité de perdre l'animal donne de l'enjeu aux soins.
3. **Envol en cas de négligence, renaissance à l'initiative du joueur.** Retenue.

Déclencheurs envisagés : négligence seulement (retenu), négligence et vieillesse, vieillesse seulement.

Nombre d'animaux : un seul à la fois (attachement, interface et équilibrage simples) plutôt que plusieurs (trop de jauges à surveiller, écran chargé).

### Décision
- **Déclencheur** : la santé atteint 0. La santé ne baisse que lorsqu'une autre jauge est critique (`balance.json`) : l'Envol est l'aboutissement d'une négligence prolongée, jamais d'un accident ponctuel. Pas de fin de vie par vieillesse.
- **Avant l'Envol** : quand la santé devient critique, la créature passe dans un état visible « affaiblie » et une notification dédiée prévient le joueur (D5). Des soins la ramènent.
- **L'Envol** : la créature se dissout doucement en lumière, monte dans le ciel et y devient une étoile. Cette étoile reste dans le ciel de la clairière pour toutes les vies suivantes : le ciel devient la mémoire du joueur.
- **Renaissance obligatoire, à l'initiative du joueur** : après l'Envol, le jeu reste sur l'écran du ciel jusqu'à ce que le joueur choisisse « Faire renaître ». Une lueur descend de l'étoile et devient un nouvel œuf, que le joueur nomme. Le jeu ne repart jamais tout seul.
- **Album** : chaque créature envolée y est conservée (nom, dates, stade atteint).
- **Un seul animal à la fois.** Les maladies existent et se soignent ; un animal malade et négligé s'approche de l'Envol.

### Raisons
- Choix de l'utilisateur : l'enjeu des soins vient de la possibilité de perdre l'animal.
- L'Envol est cohérent avec la « Clairière céleste » (D4) : une créature de lumière retourne au ciel.
- La renaissance voulue par le joueur lui laisse un moment pour dire au revoir ; l'étoile qui reste évite le sentiment d'avoir tout perdu.

### Conséquences
- `pet.life` vaut `"alive"` ou `"flown"`. Une fois l'animal envolé, toute action est refusée (`actionRefused`) sauf `rebirth`. Aucune règle ne vide l'album.
- **Garanties d'équilibrage**, chacune vérifiée par un scénario dans `spec/scenarios/` (game designer et testeur QA) :
  - en partant de jauges correctes, une nuit de 10 h sans soin ne mène jamais à l'état « affaiblie » ;
  - en partant de jauges pleines, 48 h sans aucun soin (un week-end) ne provoquent pas l'Envol ;
  - entre l'état « affaiblie » et l'Envol, il s'écoule au moins 24 h, pendant lesquelles le joueur est prévenu.
- Le plafond de rattrapage du temps (`catchUp.maxSeconds`) doit être **supérieur** à la durée minimale avant l'Envol ; sinon une longue absence ne pourrait jamais tuer l'animal. Proposition : plafond de 7 jours, Envol possible au bout d'environ 3 à 4 jours sans soin.
- Exigence assumée (validée par l'utilisateur le 2026-11-13) : l'équilibrage de `spec/balance.json` est confortable à 3 visites par jour et volontairement exigeant à 2 visites ou moins (animal souvent affamé et malade, sans jamais s'envoler). Ne pas l'adoucir sans nouvelle décision de l'utilisateur.
- Les textes de l'Envol et de la renaissance sont doux et sans reproche (exemple d'intention : « Lumi est devenu une étoile. Il veille sur la clairière. »). Rédaction : `redacteur-doc` ; ton à faire relire par l'utilisateur.

---

## D4 — Direction artistique : « Clairière céleste »

- **Date** : 2026-11-13
- **Statut** : Décidé (suit la consigne de l'utilisateur : visuel **magique**, **pas néo-rétro**, on s'éloigne du pixel art)

### Contexte
L'utilisateur veut un univers magique et doux, à l'opposé du pixel art monochrome du tamagoshi d'origine. Contraintes : chaque état de l'animal (content, faim, fatigué, malade, endormi, sale) doit se reconnaître d'un coup d'œil, sans s'appuyer sur la couleur seule ; les assets sont produits par des agents IA (donc sous forme de texte) ; le rendu doit tenir sur un téléphone d'entrée de gamme, respecter `prefers-reduced-motion`, et pouvoir être porté dans Flutter.

### Options de technique de rendu examinées
1. **SVG en parties séparées + animations décrites en données + Canvas 2D pour les particules.**
   - Pour : les agents écrivent du SVG et du JSON sans outil graphique ; vectoriel net à toutes les tailles ; accessible (titres, rôles) ; les parties SVG se chargent dans Flutter (`flutter_svg` ou compilation `vector_graphics`) et les animations en JSON se rejouent avec les contrôleurs d'animation de Flutter ; particules en Canvas 2D côté web et `CustomPainter` côté Flutter.
   - Contre : il faut écrire un petit interprète d'animation de chaque côté ; les effets de lueur doivent être « peints » (dégradés) plutôt que calculés (filtres).
2. **Rive** (machines à états, moteurs officiels web et Flutter).
   - Pour : meilleur rendu et meilleure fidélité web ↔ Flutter, machines à états idéales pour les états de l'animal.
   - Contre : les fichiers `.riv` se créent dans l'éditeur graphique de Rive, par un humain ; une équipe d'agents IA ne peut ni les produire ni les retoucher. À garder comme évolution si un illustrateur humain rejoint le projet.
3. **Lottie, ou WebGL / shaders.**
   - Lottie : JSON très verbeux, quasi impossible à écrire à la main par un agent, performances moyennes de `lottie-web`.
   - WebGL : lueurs superbes mais consommation de batterie, complexité, aucune accessibilité, pas de réemploi direct dans Flutter.

### Décision
**Direction « Clairière céleste », rendue en SVG par parties + animations en données (option 1).**

#### Intention
Une petite créature de lumière vit dans une clairière flottante, sous un ciel qui suit l'heure réelle. Elle brille de l'intérieur ; prendre soin d'elle, c'est entretenir sa lumière. Magique et tendre, jamais sombre ni inquiétant ; aucun pixel, aucune trame d'écran LCD, aucune police bitmap.

#### Palette (codes indicatifs)
| Nom | Hex | Rôle |
|---|---|---|
| Nuit d'encre | `#1B1838` | Fond principal du thème nuit, texte du thème jour |
| Indigo velours | `#2E2A5C` | Panneaux, ciel du crépuscule, texte du thème jour |
| Lavande brume | `#8E7CC3` | Brumes, contours décoratifs, grands textes seulement (contraste ≈ 4,7:1 sur Nuit d'encre) |
| Bleu lune | `#A9C8FF` | Reflets, étoiles froides, sommeil |
| Aurore rose | `#F4A6C6` | Bandes d'aurore, jeu, tendresse |
| Or de luciole | `#FFD27A` | Lueurs, particules, récompenses, accents (≈ 12:1 sur Nuit d'encre) |
| Menthe féerique | `#8FE3CF` | Soin, santé, propreté |
| Crème lait de lune | `#FFF6E9` | Corps de la créature, texte sur fond sombre (≈ 16:1 sur Nuit d'encre) |
| Pêche tendre | `#FFB89A` | Joues, chaleur |
| Ambre doux | `#FFB547` | Signaux « besoin » (jamais de rouge vif : on alerte sans culpabiliser) |
| Vert tisane | `#A7B89A` | Teinte de maladie, désaturée et douce |
| Ciel nacré | `#F3EEFF` | Fond du thème jour (texte Indigo velours ≈ 11:1) |

Les ratios sont des estimations : le designer UI les vérifie à l'outil avant livraison.

#### Formes
- Tout est rond et organique : gouttes, croissants, galets, bulles. Aucun angle vif, aucune grille de pixels.
- Étincelles à quatre branches aux pointes arrondies comme motif signature.
- Boutons d'action en « pierres de lune » rondes (icône + libellé texte), cibles tactiles d'au moins 48 px.
- Jauges en **fioles** qui se remplissent d'un liquide lumineux, chacune avec son icône, son libellé et une valeur lisible par les lecteurs d'écran.

#### Lumière
- **Halo intérieur** de la créature : dégradé radial derrière le corps, dont l'intensité suit le bien-être.
- **Lucioles** qui dérivent lentement dans la clairière (quelques-unes, jamais un essaim).
- **Scintillement** des étoiles du ciel, lent (cycles de 2 s ou plus, jamais plus de 3 éclats par seconde).
- **Retour lumineux à chaque soin** : nourrir libère des étincelles dorées, laver des bulles irisées, soigner une spirale de feuilles menthe, jouer une pluie d'étoiles roses, coucher fait monter de petites lunes.
- **Ciel selon l'heure locale** : aube (rose et lavande), jour (Ciel nacré pastel, thème clair), crépuscule (indigo et aurore), nuit (Nuit d'encre étoilée).

#### Matières
- Corps en **velours lumineux** : dégradés doux qui suggèrent un pelage sans le dessiner poil à poil.
- Reflets **nacrés** sur les yeux, l'œuf et les fioles.
- Panneaux d'interface en **verre dépoli simulé** (fond semi-transparent et bord clair d'un pixel) ; pas de `backdrop-filter` animé, coûteux sur mobile.
- Clairière en mousse ronde et duveteuse, flottant sur un coussin de brume.

#### Style de l'animal
- Silhouette simple, lisible à 64 px : corps en goutte ronde (un peu « mochi »), deux petites oreilles terminées par un bourgeon lumineux, grands yeux avec deux reflets, petite bouche, joues pêche.
- Chaque stade ajoute **un seul** élément, pour limiter le coût de production : œuf opalescent qui pulse → bébé (boule) → enfant (les oreilles poussent) → adolescent (queue en petite flamme de lumière) → adulte (ailes de lumière translucides).
- Construction en **parties SVG nommées** (`body`, `ear-left`, `ear-right`, `eye-left`, `eye-right`, `mouth`, `cheeks`, `tail`, `wings`, `halo`), pour composer les états par combinaison plutôt que par dessins entiers.

#### Lisibilité des états (sans dépendre de la couleur)
Chaque état combine **une pose**, **une expression**, **un emblème** dans une petite bulle au-dessus de la tête et **un libellé texte** dans la barre d'état. Si plusieurs états coexistent, la pose suit l'état prioritaire et jusqu'à deux emblèmes secondaires s'affichent. Ordre de priorité : affaiblie > malade > endormi > faim > sale > fatigué > content (calculé par les règles, voir Annexe A).

| État | Pose et expression | Emblème | Lumière |
|---|---|---|---|
| Content | Yeux en arcs souriants, petit rebond | Aucun (étincelle occasionnelle) | Halo doré plein |
| Faim | Bouche en « o », regard vers le bol, main sur le ventre | Fruit étoilé | Halo qui faiblit au niveau du ventre |
| Fatigué | Paupières mi-closes, oreilles tombantes, bâillement lent | Chandelle à demi consumée | Halo terni, bourgeons des oreilles éteints |
| Malade | Corps un peu affaissé, léger frisson, joues vert tisane | Petit nuage de pluie | Halo pâle et froid |
| Endormi | Roulé en boule, yeux fermés en traits courbes, respiration lente | Petites lunes qui montent | Écran tamisé, veilleuse bleu lune |
| Sale | Taches de « poussière d'ombre » sur le corps, poussières grises en orbite lente | Aucun (les taches suffisent) | Halo moucheté |
| Affaiblie (avant l'Envol, D3) | Corps devenu translucide, mouvements très lents, yeux mi-clos tournés vers le joueur | Petite étoile qui pâlit | Halo presque éteint |

L'Envol (D3) a sa propre séquence : la créature se défait en particules dorées qui montent et se rassemblent en une étoile, qui prend sa place dans le ciel.

#### Ambiance des écrans
- **Éclosion** : œuf opalescent dans un nid de lumière ; fissures dorées ; le joueur choisit le nom.
- **Écran principal** : clairière flottante au centre, ciel selon l'heure, fioles en haut, pierres de lune en bas. Rien d'autre.
- **Sommeil** : l'écran s'assombrit, seule reste une veilleuse ; les boutons non pertinents s'effacent.
- **Après l'Envol** : la clairière est vide et calme, le ciel de nuit montre les étoiles de toutes les créatures envolées ; un seul bouton, « Faire renaître ».
- **Réglages et album** : panneaux de verre dépoli, calmes et très lisibles, sans particules.

#### Principes d'animation
1. **Tout respire, rien ne s'agite** : une boucle de repos lente (respiration de 3 à 4 s) ; jamais d'immobilité totale, jamais de mouvement rapide ni de clignotement.
2. **Courbes douces** : sorties amorties et ressorts légers ; 200 à 400 ms pour l'interface, 600 à 1 200 ms pour les réactions de la créature ; pas de mouvement linéaire ni de rebond brutal.
3. **La lumière récompense** : chaque soin produit un retour lumineux visible (bouffée de particules et halo qui s'intensifie), c'est la récompense principale.
4. **Le visage reste visible** : une seule animation principale à la fois sur la créature ; les particules ne passent jamais devant les yeux ; 40 particules au plus à l'écran.
5. **Mouvement réduit respecté** : avec `prefers-reduced-motion` (et un réglage dans l'app), plus de dérive de particules ni de parallaxe ; les transitions deviennent de simples fondus ; les étoiles sont fixes. Les états restent lisibles car ils sont portés par les poses et les emblèmes, pas par le mouvement.

#### Technique de rendu retenue
- **Créature** : parties SVG au profil restreint pour rester compatibles avec Flutter : `path`, `circle`, `ellipse`, `g` avec `transform`, `linearGradient`, `radialGradient`, `opacity`, `clipPath`. **Interdits** : CSS dans le SVG, filtres (`feGaussianBlur`…), masques complexes, texte. Les lueurs sont peintes en dégradés radiaux.
- **Animations** : décrites dans `spec/motion/poses/<espèce>.json` (un fichier par espèce depuis D6 ; pose par état : transformations par partie, boucles, courbes d'accélération nommées) ; interprétées côté web par l'API Web Animations, côté Flutter par `AnimationController`. Seules `transform` et `opacity` sont animées.
- **Particules** : un seul `<canvas>` 2D en surimpression côté web (mis en pause quand l'onglet est caché), `CustomPainter` côté Flutter ; préréglages partagés dans `spec/motion/particles.json` (nombre, couleurs, durée de vie, vitesse).
- **Décor** : dégradés CSS côté web, `LinearGradient` côté Flutter ; quatre jeux de couleurs (aube, jour, crépuscule, nuit).

#### Références d'inspiration (décrites en mots)
1. Les petits esprits ronds et silencieux des forêts nocturnes dans le cinéma d'animation japonais des années 1980–1990 : créatures simples, attachantes, un peu mystérieuses.
2. La bioluminescence d'un jeu de plateforme comme *Ori and the Blind Forest* : bleus profonds, or chaud, particules qui flottent, mais en version plus enfantine et plus calme.
3. La douceur de *Sky: Children of the Light* : la lumière comme récompense et comme lien, une émotion sans mots et sans violence ; et, pour la texture, les veilleuses projecteurs d'étoiles des chambres d'enfant.

### Raisons
- Répond à la consigne : magique et lumineux, rupture nette avec le pixel art.
- Tout se produit en texte (SVG, JSON) : réalisable et retouchable par l'équipe d'agents, versionnable, révisable en diff.
- Le partage avec Flutter suit le même principe que pour les règles (D1) : on partage les données (parties SVG, poses, particules), chaque plateforme a un petit interprète natif.
- N'animer que `transform` et `opacity`, sans filtres, garde 60 images par seconde sur un téléphone modeste.

### Conséquences
- La mention « pixel art » a été retirée de CLAUDE.md et de la définition de l'agent `designer-ui` (2026-11-13).
- Le designer UI livre d'abord une **planche d'états** (les 6 états + affaiblie, stade bébé, plus la séquence de l'Envol) à valider par l'utilisateur avant de décliner les autres stades.
- Le dev web écrit l'interprète de poses ; s'il dépasse un vocabulaire réduit (translation, rotation, échelle, opacité, boucles, courbes nommées), on préfère dupliquer quelques animations dans Flutter plutôt que de faire grossir l'interprète.
- Rive reste une option d'évolution si un illustrateur humain rejoint le projet ; les parties nommées faciliteront la transition.

---

## D5 — Notifications : web et mobile, déclenchées par les besoins réels

- **Date** : 2026-11-13
- **Statut** : Décidé (choix de l'utilisateur le 2026-11-13)

### Contexte
L'utilisateur veut des notifications **aussi sur le web**, et qu'elles **proviennent des besoins réels de l'animal** : pas de rappels à heure fixe (« pense à ton animal à 18 h »). Sur le web, prévenir un joueur dont la page est fermée exige des notifications push, donc un serveur d'envoi : un navigateur ne laisse pas une page fermée se réveiller d'elle-même à une heure choisie. Sur mobile natif, Flutter sait afficher des notifications locales sans serveur.

### Options examinées
1. **Pas de notification système sur le web** (recommandation initiale). Écartée par l'utilisateur.
2. **Notifications seulement quand l'onglet est ouvert en arrière-plan** (API `Notification`). Sans serveur, mais rien quand tout est fermé.
3. **Synchronisation périodique du navigateur** (le service worker est réveillé de temps en temps). Chrome et Edge seulement, app installée, fréquence décidée par le navigateur (souvent plusieurs heures de retard). Trop peu fiable.
4. **Petit serveur push, déclenché par les besoins calculés.** Retenue par l'utilisateur.

### Décision
**Principe commun : une notification correspond toujours à un besoin réel**, calculé par les règles du jeu à partir de l'état de l'animal. Aucune notification sans besoin, aucun rappel fixé par une horloge.
- Les règles exposent `nextAttentionAt(state, time, balance)` : l'instant exact où le prochain besoin apparaîtra (faim, fatigue, saleté, maladie, état « affaiblie » avant l'Envol…) et lequel. Les règles étant déterministes (D1, aléatoire à graine), cet instant est connu avec certitude tant que le joueur n'agit pas.
- **Après chaque action du joueur**, et quand l'app passe en arrière-plan ou se ferme, le calcul est refait : un soin repousse ou annule l'avertissement suivant. Ce n'est donc pas un rappel programmé, c'est la prédiction du besoin réel, recalculée en permanence.
- **Web, page ouverte** (même en arrière-plan) : la boucle de jeu détecte le besoin au moment où il apparaît, affiche une notification système (API `Notification`) et met à jour le titre de l'onglet.
- **Web, page fermée** : le client envoie au serveur push seulement `{ abonnement, at, need }`. À l'instant `at`, le serveur envoie un push. Le service worker se réveille, relit la sauvegarde (IndexedDB, D2), rejoue les règles jusqu'à maintenant et **compose le texte à partir de l'état réel** (« Lumi a faim »). Si le besoin a disparu entre-temps (soin fait depuis un autre onglet), il annonce le besoin réel le plus pressant, ou un message neutre et doux s'il n'y en a aucun : les navigateurs imposent d'afficher une notification à chaque push. Ce cas reste rare, puisque chaque action reprogramme le serveur.
- **Mobile (phase 2)** : même calcul, sans serveur : notification locale Flutter à `nextAttentionAt`, recalculée à chaque action et à chaque passage en arrière-plan.
- **Permission** demandée au bon moment (après le premier vrai besoin, avec une phrase d'explication), jamais au premier chargement. Désactivable dans les réglages.
- **Heures calmes et nombre maximal par jour** (`balance.json`, bloc `attention`) : un besoin apparu pendant les heures calmes est signalé à leur fin. Exception : l'état « affaiblie » est toujours signalé, car l'Envol approche.

### Serveur push
- **Reporté** (choix de l'utilisateur le 2026-11-13) : le jeu est d'abord publié sur GitHub Pages sans serveur. En attendant, sur le web, seuls les signaux « page ouverte » existent (titre de l'onglet, puis notifications système tant que l'onglet est ouvert). Ne pas construire `apps/push-server` sans nouvelle demande.
- Service minimal en TypeScript (Node) dans `apps/push-server/` : il enregistre ou remplace l'échéance d'un abonnement, envoie les push à l'heure (protocole Web Push, clés VAPID) et supprime les abonnements expirés.
- Il ne reçoit **ni la sauvegarde, ni le nom de l'animal, ni aucune donnée sur le joueur** : seulement l'adresse d'abonnement push (identifiant technique anonyme), l'instant et le type de besoin. Il n'exécute pas les règles.
- Sur iOS et iPadOS, le push web ne fonctionne que si le joueur a installé l'app sur l'écran d'accueil (PWA). L'app l'explique au moment de proposer les notifications.
- Hébergement à choisir avant la mise en ligne (un petit service et une petite base, par exemple SQLite). En développement, le serveur tourne en local.

### Raisons
- C'est la seule solution qui prévient de façon fiable un joueur dont la page est fermée.
- Le besoin est calculé par les mêmes règles que le jeu : la notification dit toujours la vérité sur l'animal.
- Le serveur ne sait rien du joueur : D2 (pas de compte, pas de sauvegarde distante) reste vrai.

### Conséquences
- La sauvegarde web est en IndexedDB et non en `localStorage` (D2), pour que le service worker puisse la lire.
- Le service worker importe `packages/rules` pour rejouer les règles : c'est possible parce que les règles sont pures et sans dépendance.
- `nextAttentionAt` renvoie `{ at, need } | null` ; il est couvert par des scénarios et le port Dart doit donner le même résultat.
- Revue par `relecteur-critique` obligatoire avant la mise en ligne du serveur push (sécurité de l'API, limitation du nombre de requêtes, suppression des abonnements).
- Les textes de notification sont doux et jamais culpabilisants ; leur rédaction revient à `redacteur-doc`.

---

## D6 — Deux espèces de créature, tirées au hasard à la naissance

- **Date** : 2026-11-13
- **Statut** : Décidé (choix de l'utilisateur le 2026-11-13)

### Contexte
La créature existe en deux styles visuels dans l'univers « Clairière céleste » (D4) : **kawaii** (boule ronde, oreilles de lapin, grands yeux ronds) et **féérique** (plus éthérée et délicate, en cours de dessin dans `design/explorations/feerique/`). L'utilisateur veut que chaque naissance tire au hasard l'une des deux.

### Décision
- Chaque animal a une **espèce** `pet.kind` : `"kawaii"` ou `"feerique"`, tirée à la création (`createSave`) et à chaque renaissance (`rebirth`), avec le générateur à graine (D1) : le tirage est déterministe et rejouable.
- Les probabilités sont des données : bloc `kinds` de `spec/balance.json` (poids par espèce, 1 et 1 par défaut, soit une chance sur deux).
- L'espèce est **purement visuelle** : mêmes règles, mêmes jauges, même équilibrage.
- L'œuf est le même pour les deux espèces : l'espèce se découvre à l'éclosion.
- L'album garde l'espèce de chaque créature envolée.
- Les sauvegardes existantes, antérieures à D6, deviennent `kawaii` par migration.

### Conséquences
- Format de sauvegarde en **version 2** (`pet.kind`, `album[].kind`), avec une migration v1 → v2 dans `packages/rules`, portée aussi en Dart.
- Les assets et les poses sont rangés par espèce ; les réactions animées (`spec/motion/reactions.json`) ciblent des noms de parties communs aux deux espèces.
- Le designer garantit que les 8 états sont aussi lisibles dans les deux espèces, en particulier sur mobile.

---

## Annexe A — Contrats découlant des décisions

- **Date** : 2026-11-13
- **Statut** : Décidé

Les noms ci-dessous sont des contrats : les changer impose une migration de sauvegarde et une mise à jour des scénarios. Les valeurs numériques sont indicatives ; elles appartiennent au game designer.

### A1. État sauvegardé versionné (`spec/save.schema.json`)
Toutes les jauges vont dans le même sens : **100 = parfait, 0 = au plus bas** (on parle de `satiety`, satiété, et non de faim).

```json
{
  "version": 2,
  "savedAt": 1763030400000,
  "pet": {
    "id": "8f0c2e4a-…",
    "name": "Lumi",
    "kind": "kawaii",
    "bornAt": 1763030400000,
    "stage": "egg",
    "stageSince": 1763030400000,
    "life": "alive",
    "flownAt": null,
    "gauges": { "satiety": 80, "happiness": 80, "energy": 80, "hygiene": 100, "health": 100 },
    "status": {
      "asleep": false,
      "asleepSince": null,
      "sick": false,
      "sickSince": null,
      "messes": 0,
      "messProgressSeconds": 0,
      "weakSince": null
    },
    "cooldowns": { "feed.snack": 0 },
    "lastUpdatedAt": 1763030400000,
    "rng": 123456789
  },
  "album": [],
  "settings": { "reducedMotion": "system", "sound": true, "notifications": false }
}
```
- `version` : version du **format** (entier), **2** depuis D6. `migrate(raw) → SaveLatest` enchaîne des fonctions pures v1→v2→… dans `packages/rules`, portées aussi en Dart ; chaque migration a son scénario. Historique : v1 = sans espèce ; v2 = `pet.kind` et `album[].kind` (D6).
- `kind` : `"kawaii" | "feerique"` (D6), espèce purement visuelle, tirée à la naissance et à la renaissance (voir A2). Obligatoire en v2 sur `pet` et sur chaque entrée de l'album.
- `stage` : `"egg" | "baby" | "child" | "teen" | "adult"`.
- `life` : `"alive" | "flown"` (D3) ; `flownAt` : instant de l'Envol, `null` tant que l'animal vit.
- `album` : une entrée par créature envolée, `{ id, name, bornAt, flownAt, stage, kind }` (l'espèce est conservée) ; les étoiles du ciel en sont dérivées.
- Horodatages : entiers en millisecondes UTC.
- `rng` : état du générateur aléatoire à graine (D1).
- **Limites de taille** (`LIMITS`, exportées par `packages/rules`, reprises dans `spec/save.schema.json`) : une sauvegarde importée ne doit pas pouvoir figer l'interface. Les longueurs se comptent en **points de code Unicode** (comme `maxLength` de JSON Schema ; `trim` = `String.prototype.trim`, espaces et fins de ligne Unicode). `nameMaxLength` = **40** : `pet.name` et `album[].name`, mesurés **après `trim`** (la valeur stockée n'est pas modifiée) ; `textMaxLength` = **128** : identifiants (`pet.id`, `album[].id`, `id` de `rebirth`), clés de `pet.cooldowns`, et longueur brute (avant `trim`) d'un nom (le schéma ne sait pas exprimer le `trim` : il borne le nom brut à 128, `migrate` applique les 40 après `trim`) ; `albumMaxEntries` = **1000** ; `cooldownsMaxEntries` = **32** entrées. `migrate` refuse (`invalid`) tout dépassement ; `createSave` lève `InvalidIdentityError` (nom ou `id` trop long ; le vide n'est pas vérifié) ; `rebirth` refuse (`invalidIdentity`) un nom de plus de 40 après `trim` ou un `id` de plus de 128. **Album plein** : `rebirth` n'est jamais refusée pour cette raison, elle retire l'entrée la plus ancienne (index 0 du tableau, ordre d'insertion) avant d'ajouter l'animal envolé, l'album restant à 1000 entrées (un album déjà plus long, construit hors `migrate`, est ramené à 1000).

### A2. Signature des fonctions de règles (`packages/rules`)
```ts
type Time = { nowMs: number; utcOffsetMin: number };

type Action =
  | { type: "tick" }                                  // seulement faire passer le temps
  | { type: "feed"; food: "meal" | "snack" }
  | { type: "play" }
  | { type: "clean" }
  | { type: "heal" }
  | { type: "sleep" }
  | { type: "wake" }
  | { type: "pet" }                                   // caresse
  | { type: "rebirth"; id: string; name: string; seed: number; kind?: Kind }; // seule action possible après l'Envol ; `kind` force l'espèce (sans tirage)

type GameEvent =
  | { type: "stageChanged"; from: Stage; to: Stage }
  | { type: "becameSick" } | { type: "recovered" }
  | { type: "fellAsleep" } | { type: "wokeUp" }
  | { type: "weakened" } | { type: "recoveredStrength" }
  | { type: "flewAway" } | { type: "reborn" }
  | { type: "needAppeared"; need: Need } | { type: "needResolved"; need: Need }
  | { type: "clockAdjusted"; deltaMs: number }        // horloge reculée : chronologie translatée (deltaMs < 0, multiple du pas)
  | { type: "actionRefused"; action: Action["type"]; reason: string };

// Cœur : (état, action, heure) → état. Rattrape d'abord le temps écoulé, puis applique l'action.
function reduce(state: SaveState, action: Action, time: Time, balance: Balance):
  { state: SaveState; events: GameEvent[] };

// `kind` (facultatif) force l'espèce, sans tirage (tests, débogage) ; sinon elle est tirée (voir « Espèce » ci-dessous).
// `kind` fourni mais inconnu : lève InvalidKindError (erreur de développement, comme BalanceError).
// `id` ou `name` trop long (A1, LIMITS) : lève InvalidIdentityError.
function createSave(input: { id: string; name: string; seed: number; kind?: Kind }, time: Time, balance: Balance): SaveState;

// Dérivé pur pour l'affichage (partagé web / Flutter, porte la priorité des états de D4).
function deriveView(state: SaveState, time: Time, balance: Balance): {
  kind: Kind;                 // "kawaii" | "feerique" : choix des dessins par l'interface
  primary: "happy" | "hungry" | "tired" | "sick" | "asleep" | "dirty" | "weak" | "flown";
  secondary: Need[];          // au plus 2
  gaugeLevels: Record<Gauge, "ok" | "low" | "critical">;
};

// Prochain besoin réel et l'instant où il apparaîtra, ou null (D5). Tient compte des heures calmes.
// `history` (facultatif, tenu par l'appelant hors de la sauvegarde) : notifications déjà envoyées.
type AttentionHistory = { sent: Array<{ at: number; need: Need }> };
function nextAttentionAt(state: SaveState, time: Time, balance: Balance, history?: AttentionHistory):
  { at: number; need: Need } | null;

// `balance` : facultatif (défaut : spec/balance.json), fournit `messes.max` et le pas de la grille.
function migrate(raw: unknown, balance?: Balance): SaveState;   // lève MigrationError si illisible

class BalanceError extends Error {}   // balance invalide ; voir ci-dessous
class InvalidKindError extends Error {} // createSave : `kind` forcé inconnu
class InvalidIdentityError extends Error {} // createSave : `id` ou `name` au-delà de LIMITS
type Kind = "kawaii" | "feerique";
```
Règles de comportement :
- Une action impossible (nourrir pendant le sommeil, toute action autre que `rebirth` après l'Envol…) renvoie l'état inchangé et un événement `actionRefused`, jamais une exception. Une action mal formée (type inconnu, `null`, `food` ou identité invalide) est refusée de la même façon.
- **Raisons de refus possibles** (`actionRefused.reason`, liste complète, jamais `undefined`) : `unknownAction` (type inconnu, ou action qui n'est pas un objet), `flown` (animal déjà envolé au début de l'appel, toute action sauf `rebirth`), `flownDuringCatchUp` (envolé pendant le rattrapage de cet appel), `notFlown` (`rebirth` d'un animal vivant), `invalidAction` (`feed` dont `food` n'est ni `meal` ni `snack`), `invalidIdentity` (`rebirth` dont `id` ou `name` est manquant, vide, non textuel ou trop long (A1, `LIMITS`), ou dont `kind`, s'il est présent, n'est pas `kawaii` ni `feerique` ; `null` est invalide), `asleep`, `notHungry`, `cooldown`, `tooTired`, `alreadyClean`, `nothingToHeal`, `notTired`, `notAsleep`, `exhausted`. Ordre des vérifications : type connu, état de vie, forme de l'action, règles propres à l'action.
- `rebirth` crée un nouvel animal (stade `egg`) en conservant `album` et `settings`, après avoir ajouté l'animal envolé à l'album. **Il n'est accepté que si l'animal était déjà envolé au début de l'appel** : si l'animal s'envole pendant le rattrapage de l'appel, toute action de cet appel est refusée (`flownDuringCatchUp`, `rebirth` comprise ; seul `tick` passe, sans refus) pour que le joueur voie l'écran de l'Envol avant de pouvoir faire renaître.
- **Espèce (D6)** : `createSave` et `rebirth` tirent `pet.kind` ainsi, **dans cet ordre et sans autre consommation d'aléatoire** : (1) état de départ `s0 = seed` normalisée en entier 32 bits non signé ; (2) **un seul** tirage mulberry32 `(value, s1) = nextRandom(s0)`, `value` dans [0, 1) ; (3) `total` = somme des poids entiers du bloc `kinds` de la balance ; `pick = floor(value × total)` ; (4) on parcourt `kinds` **dans l'ordre du tableau** en cumulant les poids, et on retient la première entrée dont le cumul est strictement supérieur à `pick` ; (5) `pet.rng = s1` (l'état après ce tirage, et non la graine) : le premier tirage de maladie est donc le **deuxième** tirage de la graine. Le tirage part toujours de la graine de la nouvelle vie : pour `rebirth`, l'ancien `pet.rng` n'intervient pas. Seulement `+ × floor` et comparaisons (D1) ; `value × total` est exact car `total` <= 1 000 000. Avec `kind` forcé (`createSave` ou `rebirth`), **aucun tirage n'est consommé** et `pet.rng = seed` normalisée. Vecteurs : poids par défaut, seed 7 -> `kawaii` (`rng` 1831565820), seed 1 -> `feerique` (`rng` 1831565814) ; scénarios `naissance-espece-*` et `renaissance-*`. `rebirth` copie l'espèce de l'animal envolé dans `album[].kind`.
- **Grille de temps fixe** : le temps n'avance que par pas entiers de `catchUp.stepSeconds`. `pet.lastUpdatedAt` est toujours sur la grille `bornAt + k × pas` ; à chaque appel on avance jusqu'au dernier point de grille <= `nowMs` (le reste est reporté à l'appel suivant) et l'action s'applique à ce point. `deriveView` et `nextAttentionAt` projettent sur la même grille. Tant qu'aucun appel ne dépasse le plafond `catchUp.maxSeconds`, tout découpage d'une même absence (un appel, plusieurs `reduce`, avec ou sans `deriveView` / `nextAttentionAt` entre) donne le même état, le même `rng` et les mêmes événements ; l'instant renvoyé par `nextAttentionAt` est un point de grille où le besoin apparaît réellement. Les `stageChanged` sont émis au pas où le seuil d'âge est franchi. Le plafond `catchUp.maxSeconds` s'applique **par appel** (au plus `floor(maxSeconds / stepSeconds)` pas rejoués, le temps au-delà est offert : `lastUpdatedAt` saute alors au dernier point de grille). L'horloge d'un animal envolé s'arrête à `flownAt`. Une sauvegarde plus ancienne dont `lastUpdatedAt` est hors grille est réalignée par `migrate` au point de grille inférieur.
- **Horloge de l'appareil remise en arrière : translation de la chronologie.** Si l'horloge a été avancée puis remise à l'heure, `lastUpdatedAt` serait dans le futur et les recharges (instants absolus) ne se termineraient plus. Règle exacte, appliquée par `reduce` **avant tout le reste** (avant le rattrapage, les événements et l'action), pour un animal vivant **ou envolé** :
  1. `now = floor(nowMs)` ; `nowMs` doit être fini (sinon pas de translation, voir « Entrées de temps invalides ») ;
  2. condition : `pet.lastUpdatedAt - now >= pas` (`pas = catchUp.stepSeconds × 1000`) ; sinon rien (un écart inférieur à un pas reste traité comme avant : rien n'avance, rien ne recule) ;
  3. `G = bornAt + floor((now - bornAt) / pas) × pas` : dernier point de la grille (relative à `bornAt`) <= `now`, éventuellement antérieur à `bornAt` ; `delta = G - lastUpdatedAt`, toujours négatif et multiple entier du pas ; si `G`, `delta` ou `bornAt + delta` n'est pas un entier sûr (|v| > 2^53 - 1, par ex. `nowMs` = -1e300), pas de translation ;
  4. **`delta` est ajouté** à `bornAt`, `stageSince`, `lastUpdatedAt`, `flownAt` (si non nul), `status.asleepSince`, `status.sickSince`, `status.weakSince` (si non nuls), à **chaque `cooldowns[k]` non nul** (0 = disponible reste 0), et à `savedAt`. Jauges, `messProgressSeconds`, `rng`, `stage`, les autres champs de `status`, `album` et `settings` sont **inchangés** : l'âge relatif, les stades et la grille sont conservés à l'identique, aucun pas n'est simulé ;
  5. l'événement `{ type: "clockAdjusted", deltaMs: delta }` est émis **en premier** de l'appel ;
  6. l'appel continue normalement avec `nowMs` : rattrapage depuis le nouveau `lastUpdatedAt` (le reste est inférieur à un pas : rien n'est simulé), puis `savedAt = max(savedAt, lastUpdatedAt)`, puis l'action est évaluée à ce nouveau `lastUpdatedAt`.

  Seul `reduce` translate ; `deriveView` et `nextAttentionAt` restent des projections pures (l'appelant fait d'abord un `reduce` `tick`). L'album n'est pas modifié. L'horloge avancée n'est pas touchée (indiscernable d'une vraie absence ; le plafond de 7 jours s'applique). Rejouer la même heure ne translate pas deux fois. Scénarios `horloge-*`.
- **Entrées de temps invalides** : une heure antérieure à `lastUpdatedAt` de moins d'un pas ne fait pas reculer l'état et n'émet rien (d'au moins un pas : translation ci-dessus) ; `nowMs` non fini (NaN, ±Infinity) est traité comme une heure reculée **sans translation** (rien n'avance, l'action est évaluée à `lastUpdatedAt`) ; `nowMs` fractionnaire est arrondi à l'entier inférieur ; `utcOffsetMin` non fini vaut 0 ; `seed` (`createSave`, `rebirth`) est normalisée en entier 32 bits non signé (non finie : 0).
- **`nextAttentionAt` et `history`** : sans `history`, les besoins déjà actifs sont supposés connus du joueur, sans espacement ni plafond par jour (comportement historique). Avec `history`, un besoin actif n'est « déjà signalé » que s'il figure dans `history.sent` depuis son apparition (`sickSince` / `weakSince` pour la maladie et l'état affaibli ; pour les jauges, l'appelant retire les entrées d'un besoin résolu, événement `needResolved`) ; un besoin actif mais non envoyé reste dû, à l'instant courant, ou à la fin des heures calmes. L'espacement `attention.minGapMinutes` s'applique après le dernier envoi (tout besoin confondu), le plafond `attention.maxPerDay` par jour local, dont `reservedForAlwaysNotify` places gardées aux besoins de `alwaysNotify` (les autres n'ont que `maxPerDay - reservedForAlwaysNotify`) ; un excédent est reporté au lendemain à l'heure de fin des heures calmes, sauf pour les besoins de `alwaysNotify`, reportés à minuit local (début du jour suivant) puisqu'ils ignorent les heures calmes. Les besoins de `alwaysNotify` (« affaiblie ») ignorent heures calmes et espacement, mais pas le plafond total `maxPerDay`. Les instants renvoyés sont toujours des points de grille.
- **`migrate`** copie l'entrée en profondeur (il ne la mute jamais), applique les migrations v1→v2→…, et la valide aussi strictement que `spec/save.schema.json` (propriétés inconnues ignorées), y compris les limites de taille de A1 (`LIMITS` : nom 40 après `trim`, textes 128, album 1000, cooldowns 32) ; **migration v1 → v2 (D6)** : `pet.kind` et chaque `album[].kind` valent `"kawaii"` (écrasés même si présents), le reste est inchangé ; une v2 sans `kind` valide (animal ou album) est refusée (`invalid`), il n'y a pas de valeur par défaut hors migration v1 ; il refuse en plus `messes` hors de [0, `messes.max`], `life: "flown"` sans `flownAt` (et inversement), `asleep` sans `asleepSince` (et inversement).
- **`BalanceError`** : `reduce`, `deriveView`, `nextAttentionAt`, `createSave` et `migrate` valident la balance à l'entrée (`stepSeconds` entier > 0, `maxSeconds` fini >= `stepSeconds`, seuils cohérents : critique <= bas, Envol <= affaiblie <= récupération, `kinds` non vide avec poids entiers >= 1, id connus et uniques, somme <= 1 000 000, etc.) et lèvent `BalanceError` si elle est invalide. C'est une erreur de développement, pas une action du joueur ; elle rend impossible toute boucle infinie.
- `reduce` avec la même entrée donne toujours la même sortie, au bit près entre TS et Dart (D1).

### A3. Fichier d'équilibrage (`spec/balance.json`)
Importé par défaut par `packages/rules`, mais toujours **passé en paramètre** aux fonctions (les tests injectent leurs propres valeurs). Validé par `spec/balance.schema.json`.

Les valeurs d'équilibrage (jauges, sommeil, actions, stades, maladie, salissures, Envol, bloc `attention`, bloc `kinds`) sont dans [`spec/balance.json`](../spec/balance.json) ; le modèle de règles qui les utilise, le pire cas chiffré et la démonstration des garanties de D3 sont dans [`docs/equilibrage.md`](equilibrage.md). Les noms de clés de ce fichier sont des contrats au même titre que le reste de l'annexe.

**Bloc `kinds` (D6)** : tableau d'entrées `{ "id": "kawaii" | "feerique", "weight": entier >= 1 }`, par défaut `[{ "id": "kawaii", "weight": 1 }, { "id": "feerique", "weight": 1 }]` (une chance sur deux). Probabilité d'une espèce = son poids / somme des poids ; l'ordre du tableau est significatif pour le tirage (A2) ; les id sont uniques ; l'espèce est purement visuelle, aucun autre paramètre d'équilibrage n'en dépend. Un bloc vide, un poids non entier ou <= 0, un id inconnu ou dupliqué lève `BalanceError`.

### A4. Arborescence de départ du dépôt
```
tamagoshi/
├─ CLAUDE.md
├─ package.json                  # workspaces npm : packages/*, apps/web
├─ docs/
│  └─ decisions.md               # ce fichier
├─ spec/                         # source de vérité neutre, lue par TS et par Dart
│  ├─ balance.json
│  ├─ balance.schema.json
│  ├─ save.schema.json
│  ├─ scenarios/                 # vecteurs de conformité (état + actions horodatées → attendu)
│  └─ motion/
│     ├─ poses/                  # kawaii.json, feerique.json : poses et boucles par état et par stade (D4, D6)
│     ├─ reactions.json          # réactions animées aux soins et aux gestes
│     └─ particles.json          # préréglages de particules (D4)
├─ assets/
│  └─ creature/                  # parties SVG par stade : baby/body.svg, baby/eye-left.svg…
├─ packages/
│  └─ rules/                     # TypeScript pur, zéro dépendance (implémentation de référence)
│     ├─ src/                    # state, actions, reduce, advance, view, attention, migrate, rng
│     └─ test/                   # tests unitaires + lanceur des scénarios de spec/
├─ apps/
│  ├─ web/                       # Vite + React 19 + TypeScript
│  │  └─ src/                    # ui/, creature/ (rendu SVG + interprète de poses), particles/, storage/, loop/, sw/ (service worker des notifications)
│  ├─ push-server/               # serveur push minimal (D5) : abonnements, échéances, envoi Web Push
│  └─ mobile/                    # phase 2 : Flutter
│     ├─ lib/rules/              # port Dart des règles
│     └─ test/                   # lanceur Dart des mêmes scénarios de spec/
```
Règles de dépendance : `apps/web` et `apps/mobile` dépendent de `packages/rules` et lisent `spec/` et `assets/` ; `apps/push-server` ne dépend pas des règles ; `packages/rules` ne dépend de rien d'autre que `spec/` ; rien ne dépend de `apps/*`.

---

## Points d'incertitude signalés par l'architecte
- Comportement exact de Safari sur l'effacement du stockage local après inactivité : à vérifier en phase 1 (impact direct sur D2).
- Taille réelle de l'interprète de poses (D4) : si elle dépasse quelques centaines de lignes, revenir à une duplication des animations dans Flutter.
- Équilibrage de l'Envol (D3) : les garanties (nuit, week-end, 24 h de préavis) sont démontrées par simulation dans `docs/equilibrage.md` ; elles restent à fixer en scénarios de `spec/scenarios/` et à confirmer par un essai humain.
- Hébergement du serveur push (D5) : à choisir avant la mise en ligne ; sur iOS, le push web exige que l'app soit installée sur l'écran d'accueil.
- Copie de travail locale : à garder hors de tout dossier servi par un serveur web, pour ne pas exposer les fichiers de développement (dont `.git`).
