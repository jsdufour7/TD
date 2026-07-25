export const IDEA_STAGES = [
  "exploration",
  "validation",
  "creation",
  "construction",
  "lancement",
] as const;

export const IDEA_PRIORITIES = ["basse", "moyenne", "haute"] as const;

export const VENTURE_STATUSES = ["idee", "incubation", "developpement", "lancee"] as const;

export const STAGE_LABELS: Record<string, string> = {
  exploration: "Exploration",
  validation: "Validation",
  creation: "Création",
  construction: "Construction",
  lancement: "Lancement",
};

export const PRIORITY_LABELS: Record<string, string> = {
  basse: "Basse",
  moyenne: "Moyenne",
  haute: "Haute",
};

export const PRIORITY_COLORS: Record<string, string> = {
  basse: "#475569",
  moyenne: "#2563EB",
  haute: "#dc2626",
};
