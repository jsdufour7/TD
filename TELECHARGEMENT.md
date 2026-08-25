# Obtenir le code source de TwoDots AI Core

## Les 3 moyens qui fonctionnent

### 1. Visionneuse de fichiers (le plus simple)

Le fichier **`twodots-ai-core.zip`** est à la racine du dépôt. Il est ouvert dans le
panneau de fichiers de l'interface — téléchargez-le de là.

### 2. Bouton dans l'application

Sur la **page de connexion**, un bouton :

> ⬇ Télécharger le code source (.zip)

C'est un lien **relatif** (`/download/twodots-ai-core.zip`), donc il se résout sur
l'origine où se trouve réellement votre navigateur. Il fonctionne quel que soit l'ID
du sandbox, et la page de connexion s'affiche sans authentification.

### 3. Chemin relatif, si vous naviguez déjà dans l'aperçu

```
/download/twodots-ai-core.zip
```

À ajouter à l'origine déjà présente dans votre barre d'adresse.

---

## Pourquoi aucune URL absolue ne fonctionne

Deux obstacles indépendants, vérifiés :

| Obstacle | Détail |
| --- | --- |
| **L'ID du sandbox change** | Chaque session reçoit un nouvel ID. `i109uo670veewyf14gxz3`, puis `ir1nt7g8hvk9rr3bqpleg` — tous deux déjà périmés. Toute URL que je pourrais écrire ici est morte avant d'être lue. |
| **Jeton d'accès requis** | Le sandbox exige l'en-tête `e2b-traffic-access-token`. Un `curl` ou un navigateur ouvert directement sur l'URL renvoie `Missing Traffic Access Token`. |

Le jeton est injecté par l'aperçu lui-même. C'est précisément pourquoi le **bouton
dans la page** fonctionne et pas un lien copié-collé : le navigateur navigue depuis
l'intérieur de l'aperçu, qui fournit le jeton.

---

## Contenu de l'archive

**≈377 Ko · 141 fichiers**

Ce document ne contient volontairement **pas** l'empreinte SHA-256 de l'archive : il est
lui-même inclus dans le zip, donc toute empreinte écrite ici serait périmée dès la
régénération suivante. L'empreinte est communiquée séparément.

Pour vérifier l'intégrité après téléchargement :

```bash
shasum -a 256 twodots-ai-core.zip     # macOS
sha256sum twodots-ai-core.zip         # Linux
unzip -t twodots-ai-core.zip          # teste l'archive elle-même
```

Inclus : code source complet, schéma 40 tables + migrations Drizzle, 54 tests,
12 documents.

Exclus : `node_modules` (810 Mo), `.next` (435 Mo), `.data` (41 Mo),
`.env.local` (clé maîtresse), `.git`.

---

## Installation locale

**Prérequis :** Node.js 22 ou plus. Aucun PostgreSQL, Redis ni Docker — la base est
PGlite, le vrai moteur PostgreSQL 18 compilé en WebAssembly.

```bash
unzip twodots-ai-core.zip
cd TD
npm install
npm run db:migrate      # crée les 40 tables
npm run db:seed         # 13 agents, providers, routes, intégrations
npm run dev             # http://localhost:3000
```

**Connexion :**

```
admin@twodots.local
changeme-please
```

L'application démarre même sans fichier `.env` : `src/lib/env.ts` fournit des valeurs
par défaut pour le développement.

**Vérifier l'installation :**

```bash
npm run verify          # typecheck + lint + tests + build
```

Attendu : `tsc` 0 erreur · eslint propre · 54 tests · build 44 routes.

---

## ⚠ Piège à connaître

**PGlite n'autorise qu'un seul processus par répertoire de données.**

Ne lancez jamais `db:migrate`, `db:seed` ou un script DB pendant que `npm run dev`
tourne. Symptôme :

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

`npm test` peut tourner en parallèle : `tests/setup.ts` provisionne une base
temporaire distincte.

---

## En local, deux choses marcheront qui ne marchaient pas dans l'aperçu

1. **La connexion.** `localhost` en fenêtre de premier niveau, pas d'iframe : le
   cookie de session fonctionne normalement. Dans l'aperçu, le navigateur bloque les
   cookies tiers dans l'iframe, ce qu'aucun réglage `SameSite` ne contourne.

2. **Le navigateur et l'IA.**
   ```bash
   npx playwright install chromium     # vérification navigateur + tests E2E
   ```
   Et pour activer la boucle d'outils LLM (implémentée mais jamais exercée faute de
   provider atteignable) :
   ```bash
   OPENAI_API_KEY=sk-...
   # ou, sans compte :
   LOCAL_MODEL_BASE_URL=http://127.0.0.1:8080/v1
   LOCAL_MODEL_NAME=local-model
   ```
   Puis **Models → Check health**.

---

## Documentation incluse

| Fichier | Contenu |
| --- | --- |
| `DEMARRAGE_LOCAL.md` | Guide de démarrage en français |
| `RUNBOOK.md` | Installation, commandes, configuration, dépannage complet |
| `IMPLEMENTATION_STATUS.md` | Ce qui est réel, partiel, absent — avec les preuves |
| `ARCHITECTURE.md` | Modules, persistance, moteur de runs, séquence de boot |
| `AI_CORE_SPEC.md` | Spécification produit |
| `SECURITY.md` | Menaces, contrôles, limites assumées |
| `DECISIONS.md` | 9 décisions d'architecture justifiées |
| `BUGS.md` | 15 bugs corrigés + limitations ouvertes |
| `BACKLOG.md` | Travail priorisé |
