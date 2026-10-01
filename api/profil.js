// POST /api/profil — lit TA facture (PDF ou image) et en sort la partie FIXE :
// l'entreprise qui vend, la ligne de contact, les mentions, le pied de page, la numérotation.
// Les infos du client de cette facture sont ignorées.

import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { MODELE, clientOpenAI, lireCorps, partieFichier, erreurIA, verifierMethode } from "./_openai.js";

export const config = { maxDuration: 60 };

const t = z.string().nullable();

const Profil = z.object({
  vendeur: z.object({
    nom: t.describe("Nom de l'entreprise qui émet la facture (bloc « Vendu par »)"),
    adresse: t.describe("Numéro et rue"),
    cp: t,
    ville: t,
    pays: t,
    tva: t.describe("N° de TVA de l'entreprise qui vend"),
  }),
  contact: t.describe("Phrase de contact affichée sous l'adresse du client, recopiée telle quelle"),
  mentions: t.describe("Petit paragraphe des mentions obligatoires (escompte, pénalités de retard…), recopié tel quel"),
  piedDePage: t.describe("Lignes d'identité légale en bas de page (adresse, RCS, SIREN, capital, TVA…), séparées par \\n, recopiées telles quelles"),
  prefixeFacture: t.describe("Partie fixe au début du numéro de facture, si on la devine (ex : « FR-2026- »), sinon null"),
  libelleReference: t.describe("Libellé de la ligne de référence sous les articles (ex : « Réf. », « SKU »), sinon null"),
});

const CONSIGNES = `On te donne une facture émise par l'utilisateur (sa propre entreprise).
Extrais UNIQUEMENT la partie FIXE, celle qui est identique sur toutes ses factures :
l'entreprise qui vend (bloc « Vendu par »), la ligne de contact, les mentions obligatoires,
le pied de page légal, le préfixe des numéros de facture et le libellé des références d'articles.

Ignore complètement la partie qui change : le client, ses adresses, la commande, les articles, les prix, les dates.
Recopie les textes exactement, sans les reformuler. Si une info est absente, mets null.`;

export default async function handler(req, res) {
  if (!verifierMethode(req, res)) return;
  const openai = clientOpenAI(res);
  if (!openai) return;

  const fichier = partieFichier(lireCorps(req).fichier);
  if (!fichier) return res.status(400).json({ erreur: "Joins ta facture en PDF ou en image." });

  try {
    const reponse = await openai.responses.parse({
      model: MODELE,
      instructions: CONSIGNES,
      input: [{ role: "user", content: [{ type: "input_text", text: "Voici ma facture." }, fichier] }],
      text: { format: zodTextFormat(Profil, "profil") },
    });
    if (!reponse.output_parsed) return res.status(502).json({ erreur: "Réponse de l'IA illisible, réessaie." });
    return res.status(200).json({ profil: reponse.output_parsed });
  } catch (e) {
    return erreurIA(res, e);
  }
}
