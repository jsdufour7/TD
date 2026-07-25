# TwoDots.ca

> **Nous transformons les idées en entreprises.** / *We transform ideas into businesses.*

Studio entrepreneurial québécois — site vitrine bilingue (`/fr`, `/en`) + espace studio
(tableau de bord authentifié avec CRUD entreprises, idées et messages).

**Stack** : Next.js 16 (App Router) · PostgreSQL · Drizzle ORM · Tailwind CSS · Framer Motion · Chart.js

---

## Compte de démonstration

| Champ    | Valeur             |
| -------- | ------------------ |
| Courriel | `demo@twodots.ca`  |
| Mot de passe | `demo1234`     |

Un bouton « Explorer avec le compte démo » est aussi disponible sur `/login`.

---

## Option 1 — Docker (recommandé)

Une seule commande lance PostgreSQL + l'application (schéma appliqué et données
de démo seedées automatiquement au premier démarrage) :

```powershell
docker compose up --build
```

Puis ouvrez <http://localhost:3000>.

Commandes utiles :

```powershell
docker compose up -d db          # PostgreSQL seulement (pour dev local Node)
docker compose down              # arrêter tout
docker compose down -v           # arrêter + supprimer les données
docker compose logs -f app       # journaux de l'application
```

Pour re-seeder une base Docker existante :

```powershell
docker compose exec -e SEED_FORCE=1 app node scripts/seed.mjs
```

---

## Option 2 — PowerShell (Node.js local)

Prérequis : **Node.js 20+** et un **PostgreSQL** accessible (local ou via Docker).

```powershell
# 1. Préparer + lancer (install, schéma, seed, build, start)
.\scripts\setup.ps1

# Mode développement (rechargement à chaud)
.\scripts\setup.ps1 -Dev

# Si votre PostgreSQL tourne déjà et est configuré dans .env
.\scripts\setup.ps1 -SkipDb

# Repartir de zéro côté données
.\scripts\setup.ps1 -ForceSeed
```

Le script démarre automatiquement PostgreSQL via Docker Compose s'il est
installé, sinon il utilise le PostgreSQL local décrit dans `.env`.

### Tests automatisés (smoke tests)

Une fois le serveur lancé, validez l'ensemble des flux :

```powershell
.\scripts\test.ps1
.\scripts\test.ps1 -BaseUrl http://localhost:3000
```

Les tests vérifient : santé de l'API, slogans FR/EN, garde d'authentification
(401), connexion démo, accès au dashboard, API avec session, formulaire de
contact et déconnexion.

---

## Configuration

Copiez `.env.example` vers `.env` si nécessaire :

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

La même URL est utilisée par le service `db` de `docker-compose.yml`
(database `app_db`, utilisateur `postgres`), ce qui permet de passer de
Docker à un PostgreSQL local sans rien changer.

---

## Structure du projet

```
src/
├── app/
│   ├── fr/ · en/            # Landing bilingue
│   ├── login/ · signup/     # Authentification
│   ├── dashboard/           # Espace studio (Vue d'ensemble, Entreprises, Idées, Messages)
│   └── api/                 # auth, contact, ventures, ideas, messages, health
├── components/              # Landing, shell du dashboard, UI kit, marque
├── db/                      # Schéma Drizzle + client pg
└── lib/                     # Auth (sessions, scrypt), i18n FR/EN, constantes
scripts/
├── seed.mjs                 # Données de démo (idempotent)
├── docker-entrypoint.sh     # push schéma + seed + start
├── setup.ps1                # Installation & lancement local
└── test.ps1                 # Smoke tests PowerShell
```

---

## Validation

```powershell
npx next typegen
npm exec tsc -- --noEmit
npm run build
```
