// Outils partagés par les fonctions /api (le "_" au début : Vercel n'en fait pas une route).

import OpenAI from "openai";

export const MODELE = process.env.OPENAI_MODEL || "gpt-5.4-mini";

export function clientOpenAI(res) {
  if (!process.env.OPENAI_API_KEY) {
    res.status(501).json({
      erreur:
        "L'IA n'est pas configurée : ajoute la variable OPENAI_API_KEY dans les réglages Vercel du projet, puis redéploie. (Tu peux quand même tout remplir à la main.)",
    });
    return null;
  }
  return new OpenAI();
}

export function lireCorps(req) {
  if (typeof req.body !== "string") return req.body || {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

// Transforme un fichier envoyé par le site ({ nom, type, contenu: "data:...;base64,..." })
// en morceau de message pour l'IA.
export function partieFichier(fichier) {
  if (!fichier || typeof fichier.contenu !== "string" || !fichier.contenu.startsWith("data:")) return null;
  if (fichier.type === "application/pdf") {
    return { type: "input_file", filename: fichier.nom || "document.pdf", file_data: fichier.contenu };
  }
  if (String(fichier.type).startsWith("image/")) {
    return { type: "input_image", image_url: fichier.contenu, detail: "high" };
  }
  return null;
}

export function erreurIA(res, e) {
  if (e instanceof OpenAI.AuthenticationError) return res.status(500).json({ erreur: "Clé OPENAI_API_KEY invalide." });
  if (e instanceof OpenAI.RateLimitError)
    return res.status(429).json({ erreur: "Limite OpenAI atteinte (trop de demandes ou crédit épuisé). Réessaie plus tard." });
  if (e instanceof OpenAI.NotFoundError)
    return res.status(500).json({ erreur: `Modèle « ${MODELE} » indisponible : change OPENAI_MODEL dans Vercel.` });
  if (e instanceof OpenAI.APIError) return res.status(502).json({ erreur: `Erreur de l'IA (${e.status ?? "réseau"}) : ${e.message}` });
  console.error(e);
  return res.status(500).json({ erreur: "Erreur interne." });
}

export function verifierMethode(req, res) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  res.status(405).json({ erreur: "Méthode non autorisée" });
  return false;
}
