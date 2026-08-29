# Déploiement sur Vercel

Ce document décrit ce qui est nécessaire — et ce qui n'est pas possible — pour
faire tourner TwoDots AI Core sur Vercel. Chaque affirmation ci-dessous a été
vérifiée contre un build de production (`next build` + `next start`) dans
l'environnement de développement.

---

## 1. Trois causes réelles de « je clique sur Connexion et rien ne se passe »

### a) La CSP bloquait les scripts d'amorçage de Next.js (corrigé)

`src/proxy.ts` envoyait en production :

```
Content-Security-Policy: … script-src 'self' …
```

Or l'App Router injecte **deux scripts inline** dans chaque document HTML :

```html
<script>(self.__next_f=self.__next_f||[]).push([0])</script>
<script>self.__next_f.push([1,"…"])</script>
```

Sans `'unsafe-inline'` ni nonce, le navigateur **bloque ces deux scripts** :
React ne s'hydrate jamais, la page reste du HTML mort et le bouton « Entrer » ne
fait rien — exactement le symptôme observé. En développement la politique
incluait `'unsafe-inline'`, ce qui masquait le problème.

**Correction** : nonce par requête dans `src/proxy.ts`, propagé par Next à ses
propres scripts. Vérifié sur un build de production :

```
script-src 'self' 'nonce-fZORQzj+u2vjDiKGWMwyJw==' 'strict-dynamic'
scripts inline : 2 | avec le bon nonce : 2   (/login et /home)
```

### b) Sur une base neuve, la connexion renvoyait 500 (corrigé)

`ensurePlatformReady()` n'était appelé que par `getCurrentUser()`. La route de
connexion ne passe pas par cette fonction (il n'y a pas encore de session), donc
les migrations n'étaient jamais appliquées avant la toute première requête :

```
error: relation "users" does not exist   → HTTP 500
```

**Correction** : `authenticateWithPassword()` amorce désormais la plateforme.
Vérifié sur une base **vierge** : `POST /api/auth/login` → `200`, cookie de
session posé, 43 tables créées, administrateur d'amorçage présent.

### c) PGlite ne peut pas persister sur Vercel (contrainte d'hébergement)

PGlite écrit sur le disque local. Sur Vercel le système de fichiers est en
lecture seule hors `/tmp`, et `/tmp` est effacé entre les invocations. Reproduit
localement sur un répertoire non inscriptible :

```
PGlite échoue -> EACCES | EACCES: permission denied, mkdir '/tmp/ro-test/pglite2'
```

`src/db/client.ts` transforme maintenant cette erreur en message explicite
(« passez `DATABASE_DRIVER=postgres` ») au lieu d'un `EACCES` brut, et
`GET /api/health` la signale.

---

## 2. Configuration requise

Dans **Vercel → Project → Settings → Environment Variables** :

| Variable | Valeur | Obligatoire |
| --- | --- | --- |
| `APP_ENV` | `production` | oui |
| `DATABASE_DRIVER` | `postgres` | oui |
| `DATABASE_URL` | `postgres://user:pass@host:5432/ai_core?sslmode=require` | oui |
| `AI_CORE_MASTER_KEY` | `openssl rand -hex 32` | oui (refusé en production si absent ou égal au défaut de dev) |
| `AI_CORE_BOOTSTRAP_EMAIL` | votre courriel | recommandé |
| `AI_CORE_BOOTSTRAP_PASSWORD` | mot de passe fort | **oui — changez la valeur par défaut** |
| `RUN_ENGINE_ENABLED` | `false` | oui sur Vercel (voir §3) |
| `STORAGE_DRIVER` | `s3` ou `r2` | si vous utilisez les fichiers/artefacts |

Base de données : Neon, Supabase ou RDS. Les migrations s'appliquent
automatiquement au build (`vercel.json` exécute `npm run db:migrate` quand
`DATABASE_URL` est défini), sinon au premier démarrage.

## 3. Ce que Vercel ne peut pas héberger

Le moteur de runs (`src/engine/run-engine.ts`) est un **travailleur en
processus** : il boucle, réessaie, reprend les runs après un redémarrage. Une
fonction serverless est gelée entre les requêtes — les runs autonomes
s'arrêteraient en chemin, sans erreur visible.

- Sur Vercel : `RUN_ENGINE_ENABLED=false`. L'interface, le COO conversationnel,
  la passerelle de modèles, les approbations et la lecture d'état fonctionnent.
- Pour les runs autonomes : un hôte à processus durable (VPS, Docker, Fly.io,
  Railway) avec `RUN_ENGINE_ENABLED=true`, ou une refonte vers une file
  d'attente (Qdrant n'y change rien ; il faudrait BullMQ/SQS + un worker séparé).

## 4. Vérifier un déploiement

```
curl https://votre-app.vercel.app/api/health
```

`/api/health` ne demande aucune authentification et ne renvoie aucun secret :
compte de tables, migrations appliquées, présence de l'administrateur,
passerelles en ligne, et la liste `problems` des écarts réels. Exemple obtenu sur
un build de production local :

```json
{
  "ok": false,
  "database": { "driver": "pglite", "reachable": true, "tables": 43, "migrationsApplied": 4 },
  "bootstrap": { "organizations": 1, "users": 1, "adminPresent": true, "agentDefinitions": 13 },
  "problems": ["DATABASE_DRIVER=pglite in production: … Set DATABASE_DRIVER=postgres with a DATABASE_URL."]
}
```

`"ok": true` et `problems` vide = l'installation est cohérente.

## 5. Après la connexion

1. **Modèles** → Gestion de la passerelle → ajoutez votre llama.cpp/Ollama ou un
   provider hébergé. Notez que le serveur doit pouvoir **joindre** l'adresse :
   un llama.cpp qui tourne sur votre poste n'est pas joignable depuis Vercel.
2. **Modèles** → assignez un modèle au COO (ou laissez le routage décider).
3. Changez le mot de passe d'amorçage dans **Admin**.
