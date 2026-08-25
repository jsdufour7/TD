# TwoDots AI Core — Vision

AI Core n'est pas un gestionnaire de tâches augmenté d'IA. C'est un **système
d'exploitation du travail** dans lequel l'utilisateur dirige une équipe d'agents en
parlant ou écrivant à son **COO**, et non en administrant manuellement un tableau de
tâches.

## Le renversement du workflow

Avant : `User → crée Task → choisit Agent → lance Run`.

Maintenant :

```
User → parle au COO → COO comprend → inspecte → planifie → crée les tâches →
choisit les agents → exécute → supervise → vérifie → replanifie → rapporte
```

Le COO n'arrête pas après une tâche réussie si l'objectif reste incomplet. Il ne
demande une intervention humaine que lorsqu'une vraie décision, permission ou
information est nécessaire.

## Principes non négociables

1. **Le COO conversationnel est le point d'entrée principal.** Une directive haut
   niveau (« Termine la V1 », « avance sur la priorité ») suffit.
2. **Recover and extend.** On construit au-dessus de l'existant (Projects, Agents,
   Tasks, Runs, Events, isolation, gateways, chat) — jamais en le jetant.
3. **Verification-first.** Une tâche n'est réussie que vérifiée (tests, lint,
   typecheck, review). Un échec déclenche analyse → retry / tâche corrective / replan.
4. **Local-first, cloud-optional.** LLM local (Ollama/llama.cpp), STT local
   (whisper), TTS local (Kokoro/Piper) sont des options de premier rang. Les APIs
   payantes sont des accélérateurs facultatifs, jamais un prérequis.
5. **La voix = le même COO.** Le micro alimente le même thread que le texte ; il n'y a
   pas de second assistant vocal.
6. **Transparence.** Chaque réponse affiche sa provenance (modèle / données réelles /
   hors-ligne). Les échecs ne sont jamais cachés.
7. **Isolation stricte par projet.** Aucune donnée ne traverse les projets ; les
   erreurs attendues renvoient 404/403, jamais 500.

## Couche Executive

`Objective` (intention haut niveau, mode d'autonomie) → `Plan` (stratégie versionnée
du COO) → `Tasks` (unités d'exécution liées) → `Runs` (tentatives). Quatre modes
d'autonomie : Manual, Approval, Autonomous, Mission.

## Ce que réussit signifie

Le scénario de référence :

> « Inspecte AI Core et avance sur la priorité la plus importante sans me demander
> quoi faire. »

Le COO doit comprendre, inspecter, prioriser, créer objective/plan/tasks, assigner,
exécuter, tester, corriger ou replanifier, mettre à jour la mémoire, informer — et ne
demander une intervention que si réellement nécessaire.
