# Tamagoshi — animal virtuel (web, puis mobile Flutter)

## Le projet

Application d'un petit animal virtuel à faire vivre : le nourrir, le soigner, le nettoyer, jouer avec, le laisser dormir, le voir grandir (ou dépérir), comme les tamagoshi d'autrefois.

- **Phase 1** : application web.
- **Phase 2** : version mobile avec Flutter, en réutilisant au maximum les règles du jeu définies en phase 1.
- Langue de travail, de l'interface et des commentaires : **français**. Identifiants de code en anglais.
- Stack, sauvegarde, mort de l'animal, direction artistique et notifications : **décidées dans [docs/decisions.md](docs/decisions.md)**. Tout agent lit ce fichier avant de travailler et le respecte. Toute nouvelle décision structurante y est ajoutée par l'architecte.

## Principe directeur : le modèle le moins cher qui suffit

Chaque tâche confiée à un sous-agent reçoit **le plus petit modèle capable de la faire correctement**. On monte d'un cran seulement si la tâche l'exige vraiment (voir « Règles d'escalade »).

Chaque rôle ci-dessous existe comme agent dans `.claude/agents/`, avec son modèle **verrouillé dans sa définition** (`model:` dans l'en-tête). Pour déléguer, appeler l'outil `Agent` avec `subagent_type` égal au nom de l'agent (colonne « Agent ») et **sans** paramètre `model` : c'est la définition qui fixe le modèle.

Si aucune de ces définitions ne convient et qu'on utilise un type générique (`general-purpose`, `Explore`, `Plan`), **toujours renseigner `model` explicitement** (`haiku`, `sonnet`, `opus`) : ne jamais laisser un sous-agent hériter du modèle de la session.

| Modèle | Usage | Coût relatif |
|---|---|---|
| `haiku` (Haiku 5.5) | Tâches mécaniques, lecture, recherche, résumé | Le plus bas |
| `sonnet` (Sonnet 5.5) | **Modèle par défaut** : développement, tests, revue courante | Moyen |
| `opus` (Opus 5.5) | Décisions structurantes et revues à fort enjeu | Élevé |
| `fable` (Fable 5.2) | Jamais par défaut, uniquement sur demande explicite de l'utilisateur | Le plus élevé |

## Rôles des sous-agents

### Niveau Haiku — tâches mécaniques

| Rôle | Agent | Missions | Ne fait pas |
|---|---|---|---|
| **Explorateur** | `explorateur` | Trouver où est défini quelque chose, lister des fichiers, lire du code et en faire un résumé, répondre « où / quoi / combien » sur le dépôt | Ne modifie rien, ne propose pas d'architecture |
| **Exécuteur** | `executeur` | Renommages, formatage, imports, boilerplate à partir d'un modèle existant, fichiers de configuration simples, déplacement de fichiers, mise à jour du changelog | Pas de logique métier, pas de décision de conception |
| **Lanceur de tests** | `lanceur-tests` | Lancer lint, build et tests, puis rapporter **uniquement** ce qui échoue (fichier, ligne, message) | Ne corrige pas et ne réécrit pas les tests |
| **Rédacteur doc & textes courts** | `redacteur-doc` | README, commentaires, docs d'API, messages courts de l'animal (« J'ai faim ! »), libellés, traductions de chaînes | Pas de texte de fond sur l'identité de l'animal ou le ton du jeu |

### Niveau Sonnet — travail courant (défaut)

| Rôle | Agent | Missions |
|---|---|---|
| **Développeur web** | `dev-web` | Écran, composants, état du jeu côté client, boucle de jeu (timers, tick), persistance locale, animations de l'animal |
| **Développeur Flutter** | `dev-flutter` | Portage mobile, widgets, notifications locales (« ton animal a faim »), gestion de l'app en arrière-plan |
| **Game designer** | `game-designer` | Règles de jeu : jauges (faim, bonheur, énergie, propreté, santé), vitesses de décroissance, évolution par âge, conditions de mort/maladie, mini-jeux, équilibrage. Livre des règles **sous forme de données et de fonctions pures**, testables |
| **Testeur QA** | `testeur-qa` | Écrire les tests unitaires (règles du jeu), tests d'intégration et scénarios de bout en bout ; tester le temps qui passe (simulation d'horloge) et la reprise après fermeture de l'app |
| **Relecteur** | `relecteur` | Revue de code courante d'un diff : bugs, cas limites, lisibilité, respect des conventions |
| **Designer UI / assets** | `designer-ui` | Interface « Clairière céleste », parties SVG de la créature, poses et particules, accessibilité de base, responsive |

### Niveau Opus — décisions et enjeux élevés

| Rôle | Agent | Quand l'appeler |
|---|---|---|
| **Architecte** | `architecte` | Choix de la stack, modèle de données, stratégie de sauvegarde et de synchronisation web ↔ mobile, **découpage du code pour que les règles du jeu soient partageables avec Flutter** (par ex. spécification indépendante du langage, ou service backend commun) |
| **Relecteur critique** | `relecteur-critique` | Revue avant une mise en ligne ou une publication sur les stores, revue de sécurité (comptes, données personnelles, paiements éventuels), revue d'un gros refactor transverse |
| **Débogueur de dernier recours** | `debogueur` | Bug resté sans explication après deux tentatives d'un agent Sonnet (voir escalade) |

### Niveau Fable — sur demande uniquement

Aucun rôle n'est affecté à Fable. L'utiliser **seulement si l'utilisateur le demande explicitement** pour une tâche donnée. Ne jamais l'ajouter soi-même à un plan de délégation.

## Règles d'escalade

**Monter d'un cran** (Haiku → Sonnet → Opus) quand :
1. L'agent a échoué deux fois sur la même tâche, ou a produit un résultat incohérent avec le brief.
2. La tâche demande en réalité un arbitrage (plusieurs approches valables, compromis à peser) alors qu'elle avait été classée mécanique.
3. Un défaut ici coûterait cher à défaire : format de sauvegarde, schéma de données, contrat entre web et mobile.

**Ne pas monter** simplement parce que :
- la tâche est longue ou volumineuse (la découper, ou la paralléliser sur des agents du même niveau) ;
- le sujet semble « important » : l'importance ne rend pas la tâche difficile ;
- un premier essai est médiocre : d'abord améliorer le brief.

**Descendre d'un cran** quand une tâche classée Sonnet se révèle purement mécanique (par exemple 20 fichiers à modifier de la même façon). On peut alors faire l'arbitrage une fois (Sonnet), puis exécuter à l'échelle (Haiku) avec un modèle de modification clair.

## Règles de délégation

- **Session principale (orchestrateur)** : coordonne, répond à l'utilisateur, intègre les résultats. Elle ne fait elle-même que les petites tâches (quelques appels d'outils). Dès que le travail est volumineux ou parallélisable, elle délègue.
- **Un brief complet et autonome** : objectif, fichiers concernés, contraintes, résultat attendu, ce qui a déjà été essayé. Le sous-agent ne voit pas la conversation.
- **Plusieurs agents en parallèle** seulement si leurs tâches sont indépendantes. **Jamais deux agents qui écrivent dans les mêmes fichiers.**
- **Vérifier avant de rapporter** : le rapport d'un sous-agent est une affirmation, pas une preuve. Relire le diff ou relancer le test avant de dire « c'est fait ».
- **Demander des sorties courtes** : verdict, fichiers touchés, points ouverts. Pas de copie de fichiers entiers dans les rapports.
- **Pas d'agent pour un geste simple** : lire un fichier connu, une recherche ciblée ou une modification d'une ligne se font directement.

## Conventions du jeu (à respecter par tous les agents)

- **Règles du jeu séparées de l'interface** : toute la logique (jauges, décroissance, évolution) vit dans des fonctions pures, sans dépendance au DOM ni à une bibliothèque UI. C'est la condition pour réutiliser les règles dans Flutter.
- **Le temps est une entrée, pas un effet de bord** : les fonctions reçoivent l'heure courante en paramètre. Cela rend le jeu testable sans attendre et permet de rattraper le temps écoulé quand l'application était fermée.
- **L'état sauvegardé est versionné** (champ `version`) pour permettre des migrations sans perdre l'animal d'un joueur.
- **Paramètres d'équilibrage en données**, pas en dur dans le code (fichier JSON ou équivalent).
- **Ton du jeu** : doux, attachant, jamais culpabilisant. L'animal peut mourir après une négligence prolongée, sous la forme d'un **Envol** (il devient une étoile), puis le joueur le fait renaître (D3).
- **Notifications** : toujours issues d'un besoin réel calculé par les règles (`nextAttentionAt`), jamais des rappels à heure fixe (D5).
- **Visuel** : magique et lumineux, jamais néo-rétro ni pixel art (D4).
- **Accessibilité** : contrastes suffisants, navigation clavier, pas d'information portée par la couleur seule.

## Décisions

Toutes consignées dans [docs/decisions.md](docs/decisions.md) :

- **D1** : TypeScript strict, Vite et React 19 ; règles dans `packages/rules` (pur, sans dépendance), source neutre dans `spec/`, port Dart validé par les mêmes scénarios.
- **D2** : sauvegarde locale (IndexedDB), sans compte, export et import de fichier.
- **D3** : Envol après négligence seulement, renaissance par le joueur, un seul animal, album des créatures envolées.
- **D4** : direction artistique « Clairière céleste », parties SVG, animations en JSON, particules en Canvas.
- **D5** : notifications web (serveur push minimal et anonyme) et mobile (locales), déclenchées par les besoins réels.
- **Annexe A** : formats de la sauvegarde, signatures des règles, fichier d'équilibrage, arborescence du dépôt.
