import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const uuid = () => randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

async function main() {
  await client.connect();

  // Idempotent : ne ré-écrit les données que si la base est vide.
  // Utilisez SEED_FORCE=1 pour repartir de zéro.
  if (process.env.SEED_FORCE !== "1") {
    const { rows } = await client.query(`select count(*)::int as c from users`);
    if (rows[0].c > 0) {
      console.log("Base déjà initialisée — seed ignorée. (SEED_FORCE=1 pour forcer)");
      await client.end();
      return;
    }
  }

  // Clear tables in FK order
  await client.query(`delete from sessions; delete from messages; delete from ideas; delete from ventures; delete from users;`);

  const userId = uuid();
  await client.query(
    `insert into users (id, name, email, password_hash, role) values ($1,$2,$3,$4,$5)`,
    [userId, "Jean-Sébastien Dufour", "demo@twodots.ca", hashPassword("demo1234"), "Fondateur"]
  );

  const ventures = [
    ["Brandely", "De l'idée à l'entreprise.", "La plateforme qui applique la méthode TwoDots pour accompagner les entrepreneurs dans la création de leur marque, leur présence numérique et leur entreprise.", "developpement", "SaaS · Création de marque", "#2563EB", "2026", 1],
    ["ShiftSpot", "Détecter les tendances avant tout le monde.", "Veille intelligente des signaux de marché et des opportunités émergentes pour les entrepreneurs.", "incubation", "Data · Veille de marché", "#475569", "2026", 2],
    ["MarchéLocal", "Le commerce local, en ligne.", "Connecter les commerçants de quartier à leur communauté grâce à une vitrine numérique simple.", "incubation", "Marketplace · Commerce local", "#0D1321", "2027", 3],
    ["PlanPilot", "Le copilote financier des PME.", "Planification financière et pilotage de trésorerie assistés par intelligence artificielle.", "idee", "Fintech · PME", "#475569", "2027", 4],
  ];
  for (const v of ventures) {
    await client.query(
      `insert into ventures (id, name, tagline, description, status, category, accent, year, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuid(), ...v]
    );
  }

  const ideas = [
    ["Réseau de mentors pour premiers fondateurs", "Mettre en relation des entrepreneurs en pré-démarrage avec des fondateurs expérimentés de l'écosystème TwoDots.", "validation", "haute", "Entrepreneuriat"],
    ["Générateur d'identité visuelle par IA", "Produire des pistes de logo, palette et typographie cohérentes avec le positionnement de marque.", "creation", "haute", "Design · IA"],
    ["Tableau de bord unifié des filiales", "Consolider les métriques clés de toutes les entreprises de l'écosystème dans une seule vue.", "construction", "moyenne", "Interne"],
    ["Programme de validation en 30 jours", "Un sprint structuré pour tester la demande réelle avant d'écrire une ligne de code.", "exploration", "moyenne", "Méthode"],
    ["Assistant de lancement localisé", "Adapter les stratégies de lancement au marché québécois et canadien.", "exploration", "basse", "Croissance"],
    ["Modules de marque en marque blanche", "Permettre aux partenaires d'intégrer Brandely dans leurs propres services.", "lancement", "haute", "Partenariats"],
  ];
  for (const i of ideas) {
    await client.query(
      `insert into ideas (id, title, description, stage, priority, market) values ($1,$2,$3,$4,$5,$6)`,
      [uuid(), ...i]
    );
  }

  const now = Date.now();
  const messages = [
    ["Marie-Claude Tremblay", "marie@atelierlumen.co", "Partenariat possible avec Brandely", "Bonjour, nous sommes un collectif de designers et nous croyons que Brandely pourrait bénéficier de notre expertise en identité visuelle. Seriez-vous ouverts à un appel ?", "twodots.ca", true, new Date(now - 1000 * 60 * 60 * 26)],
    ["Alex Nguyen", "alex.nguyen@fondnordiq.ca", "Intérêt d'investissement", "Votre approche de studio entrepreneurial rejoint notre thèse d'investissement. J'aimerais en savoir plus sur la traction de Brandely et la feuille de route 2026.", "twodots.ca", false, new Date(now - 1000 * 60 * 60 * 5)],
    ["Sophie Bérubé", "sophie@cafekitsune.ca", "Une idée pour MarchéLocal", "Je possède une petite boutique et j'adorerais tester MarchéLocal dès la bêta. Comment puis-je m'inscrire à la liste d'attente ?", "twodots.ca", false, new Date(now - 1000 * 60 * 42)],
  ];
  for (const m of messages) {
    await client.query(
      `insert into messages (id, name, email, subject, body, source, read, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), ...m]
    );
  }

  console.log("Seeded: 1 user, 4 ventures, 6 ideas, 3 messages");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
