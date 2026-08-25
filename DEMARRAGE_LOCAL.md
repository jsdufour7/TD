# TwoDots AI Core — Démarrage local

## Prérequis

- **Node.js 22 ou plus** (vérifié avec v22.22.3)
- npm

Aucun PostgreSQL, Redis ou Docker à installer : la base embarquée est **PGlite**,
le vrai moteur PostgreSQL 18 compilé en WebAssembly.

## Installation

```bash
npm install
```

C'est tout. L'application fonctionne sans fichier `.env` : `src/lib/env.ts` fournit
des valeurs par défaut pour le développement, y compris une clé maîtresse de dev.

## Premier lancement

```bash
npm run db:migrate    # crée les 40 tables dans .data/pglite
npm run db:seed       # catalogue d'agents, providers, routes, intégrations
npm run dev           # http://localhost:3000
```

> `npm run dev` s'auto-amorce aussi au premier appel HTTP (migrations, utilisateur
> admin, catalogue d'agents, worker). Les deux commandes ci-dessus servent surtout
> à voir leur sortie.

## Connexion

```
admin@twodots.local
changeme-please
```

Créés par `AI_CORE_BOOTSTRAP_EMAIL` / `AI_CORE_BOOTSTRAP_PASSWORD` si vous voulez
changer.

## Windows / PowerShell

### `&&` n'est pas reconnu

```
Le jeton « && » n'est pas un séparateur d'instruction valide.
```

PowerShell 5.1 (celui livré avec Windows) ne supporte pas `&&`. Deux solutions :

```powershell
# PowerShell 7+ ou CMD : && fonctionne
npm run db:migrate && npm run db:seed

# PowerShell 5.1 : séparer les commandes
npm run db:migrate
npm run db:seed

# ou avec l'opérateur PowerShell
npm run db:migrate; if ($?) { npm run db:seed }
```

### Les scripts npm fonctionnent quand même

`npm run verify` utilise `&&` **à l'intérieur** du script. npm exécute les scripts via
`cmd.exe` sur Windows, qui supporte `&&` — donc `npm run verify` fonctionne tel quel.
Seules les commandes tapées directement dans PowerShell sont concernées.

### `EPERM: operation not permitted, rmdir` pendant npm install

```
npm warn cleanup Failed to remove some directories
npm warn cleanup   [Error: EPERM: operation not permitted, rmdir '...\@unrs\resolver-binding-wasm32-wasi\...']
```

C'est un **avertissement**, pas une erreur : Windows verrouille brièvement les fichiers
que npm essaie de nettoyer (souvent à cause d'un antivirus ou d'un indexeur). Si
`added N packages` s'affiche ensuite, l'installation a réussi.

En cas de doute :

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

## Vérifier que tout est sain

```bash
npm run verify     # typecheck + lint + tests + build
```

Attendu : `tsc` 0 erreur · eslint propre · **54 tests** · build 44 routes.

## ⚠ Piège important : PGlite = un seul processus

**Ne lancez jamais** `db:migrate`, `db:seed` ou un script DB pendant que
`npm run dev` tourne. PGlite n'autorise qu'un processus par répertoire de données ;
un second processus fait avorter l'instance WASM :

```
Failed query: select … from "users" …
cause: RuntimeError: Aborted()
```

Réparation (données de dev uniquement, aucune perte de code) :

```bash
# arrêtez d'abord le serveur
rm -rf .data
npm run db:migrate && npm run db:seed
npm run dev
```

`npm test` peut tourner en parallèle du serveur : `tests/setup.ts` provisionne une
base temporaire distincte.

## Configurer un modèle d'IA (optionnel mais recommandé)

Sans provider, AI Core planifie de façon **déterministe**, exécute les vraies
commandes de vérification du projet (typecheck / lint / test / build) et marque les
tâches qui demandent du raisonnement comme `blocked` avec la raison — il ne simule
jamais un résultat.

```bash
# Option A — hébergé
OPENAI_API_KEY=sk-...

# Option B — local, sans compte (llama.cpp, vLLM, Ollama /v1)
LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_MODEL_NAME=local-model
```

Puis **Models → Check health**. Un provider affiche `online`, `degraded` ou `offline`.

## Vérification navigateur (optionnelle)

```bash
npx playwright install chromium
```

Sans cela, `browserCapability()` le signale explicitement et les outils navigateur
échouent avec un message clair plutôt que de faire semblant.

## En cas de problème

| Symptôme | Cause | Solution |
| --- | --- | --- |
| Bouton « Sign in » sans effet ; login 200 puis `/home` 307 | Cookie `SameSite=Lax` non envoyé depuis une iframe cross-site | Déjà corrigé : `SameSite=None; Secure` en HTTPS. Voir `BUGS.md` B-14 |
| `RuntimeError: Aborted()` sur toutes les requêtes | Un 2ᵉ processus a ouvert `.data/pglite` | Voir le piège ci-dessus |
| Toutes les pages en 500, `node:path` introuvable | Un module Node a atteint le bundle edge | Ne pas réajouter `src/instrumentation.ts` ; utiliser `src/platform/boot.ts` |
| Le bundle client renvoie 403 depuis un hôte distant | Next 16 bloque `/_next/*` en cross-origin | `allowedDevOrigins` dans `next.config.ts`. Voir `BUGS.md` B-12 |
| `npm error Missing script: "tsc --noEmit"` | La *commande* du script passée au lieu de son *nom* | Passer `['run', <nomDuScript>]` |

La table complète est dans **`RUNBOOK.md` §8**.

## Documentation

| Fichier | Contenu |
| --- | --- |
| `RUNBOOK.md` | Installation, commandes, configuration, dépannage |
| `IMPLEMENTATION_STATUS.md` | Ce qui est réel, partiel, absent — avec les preuves |
| `ARCHITECTURE.md` | Modules, persistance, moteur de runs, boot |
| `AI_CORE_SPEC.md` | Spécification produit |
| `SECURITY.md` | Menaces, contrôles, limites assumées |
| `DECISIONS.md` | 9 décisions d'architecture justifiées |
| `BUGS.md` | 15 bugs corrigés + limitations ouvertes |
| `BACKLOG.md` | Travail priorisé |

## Limites connues (honnêtement)

- La **boucle d'outils LLM est implémentée mais non exercée** ici (aucun provider
  atteignable dans l'environnement d'origine). Configurez une clé pour la valider.
- **Aucun runtime navigateur** dans l'environnement d'origine : les specs E2E
  Playwright sont écrites mais non exécutables là-bas. Chez vous, `npx playwright
  install chromium` suffit.
- **Adaptateurs de déploiement absents** : l'outil `deploy` enregistre une erreur
  explicite au lieu de simuler un succès.
- **Isolation = confinement de chemin**, pas de conteneurs. Voir `SECURITY.md` §4.
