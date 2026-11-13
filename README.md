# Clairière céleste

Un petit animal virtuel à faire vivre, dans l'esprit des tamagoshi d'autrefois : une créature de lumière, kawaii ou féérique selon sa naissance, à nourrir, laver, soigner, caresser et faire jouer.

**Jouer** : https://juliestien-jpg.github.io/clairiere-celeste/

- Application web (React, TypeScript, Vite) dans `apps/web`, puis une version mobile Flutter.
- Règles du jeu pures et déterministes dans `packages/rules`, partagées avec la future version mobile par les scénarios de `spec/scenarios`.
- Décisions de conception dans [docs/decisions.md](docs/decisions.md), équilibrage dans [docs/equilibrage.md](docs/equilibrage.md).

## Lancer en local

```bash
npm install
npm run dev -w @tamagoshi/web
```

Tests : `npm test` ; contrôle des types : `npm run typecheck`.
