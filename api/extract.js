// Fonction serverless Vercel : POST /api/extract
// Reçoit le texte brut d'une commande et renvoie les champs de la facture pré-remplis.
// Nécessite la variable d'environnement ANTHROPIC_API_KEY (réglages du projet Vercel).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const config = { maxDuration: 60 };

const texte = z.string().nullable();

const Adresse = z.object({
  adresse: texte.describe("Numéro et nom de rue"),
  complement: texte.describe("Bâtiment, étage, appartement, etc."),
  cp: texte.describe("Code postal (ex : 75011)"),
  ville: texte,
  pays: texte,
});

const FactureSchema = z.object({
  client: z.object({
    prenom: texte,
    nom: texte,
    societe: texte.describe("Raison sociale du client si c'est une entreprise"),
  }),
  facturation: Adresse,
  livraisonIdentique: z
    .boolean()
    .nullable()
    .describe("true si l'adresse de livraison est la même que celle de facturation, null si inconnu"),
  livraison: Adresse.extend({ nom: texte.describe("Nom du destinataire de la livraison") }),
  vendeur: texte.describe("Vendeur / marque indiqué après « Vendu par »"),
  commande: z.object({
    numero: texte,
    date: texte.describe("Date de la commande au format JJ/MM/AAAA"),
    par: texte.describe("Nom de la personne qui a passé la commande"),
  }),
  articles: z.array(
    z.object({
      description: z.string(),
      quantite: z.number(),
      prix: z.number().describe("Prix UNITAIRE de l'article"),
      base: z.enum(["TTC", "HT"]).describe("Le prix unitaire indiqué est-il TTC ou HT ?"),
    })
  ),
  fraisLivraison: z.number().nullable().describe("Frais de livraison TTC, 0 si gratuits, null si inconnu"),
});

const SYSTEME = `Tu extrais les informations d'une commande pour remplir une facture française.
Règles :
- N'invente rien : si une information n'apparaît pas dans le texte, mets null.
- Sépare bien prénom et nom.
- Les dates sont au format JJ/MM/AAAA.
- Les prix sont des nombres (49.9, pas "49,90 €"). En France les prix affichés aux particuliers sont en général TTC : choisis "TTC" sauf si le texte indique clairement HT.
- Si une seule adresse est donnée, considère que la livraison est identique (livraisonIdentique = true).`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ erreur: "Méthode non autorisée" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(501).json({
      erreur:
        "L'IA n'est pas configurée : ajoute la variable ANTHROPIC_API_KEY dans les réglages Vercel du projet. (Tu peux quand même remplir la facture à la main.)",
    });
  }

  const body = typeof req.body === "string" ? safeJSON(req.body) : req.body || {};
  const contenu = String(body.texte || "").trim();
  if (!contenu) return res.status(400).json({ erreur: "Texte vide." });
  if (contenu.length > 20000) return res.status(413).json({ erreur: "Texte trop long (20 000 caractères max)." });

  const client = new Anthropic();

  try {
    const message = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(FactureSchema) },
      system: SYSTEME,
      messages: [{ role: "user", content: `Voici les informations de la commande :\n\n${contenu}` }],
    });

    if (message.stop_reason === "refusal") {
      return res.status(422).json({ erreur: "L'IA a refusé de traiter ce texte. Remplis la facture à la main." });
    }
    if (!message.parsed_output) {
      return res.status(502).json({ erreur: "Réponse de l'IA illisible, réessaie." });
    }
    return res.status(200).json({ facture: message.parsed_output });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ erreur: "Clé ANTHROPIC_API_KEY invalide." });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ erreur: "Trop de demandes, réessaie dans un instant." });
    }
    if (e instanceof Anthropic.APIError) {
      return res.status(502).json({ erreur: `Erreur de l'IA (${e.status ?? "réseau"}).` });
    }
    console.error(e);
    return res.status(500).json({ erreur: "Erreur interne." });
  }
}

function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
