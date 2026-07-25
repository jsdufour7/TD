#!/bin/sh
set -e

echo "==> TwoDots.ca — démarrage du conteneur"
echo "==> Application du schéma de base de données..."
npx drizzle-kit push

echo "==> Seed des données de démonstration (si la base est vide)..."
node scripts/seed.mjs

echo "==> Lancement de TwoDots.ca sur http://localhost:3000"
exec npm start
