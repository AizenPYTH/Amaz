// POST /api/extract — pré-remplit UNIQUEMENT la partie qui change d'une facture
// (client, adresses, commande, articles, prix) à partir d'un texte et/ou d'un fichier.
// La partie fixe (logo, entreprise qui vend, mentions, pied de page) n'est volontairement
// pas dans le schéma : l'IA ne peut pas la modifier.

import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { MODELE, clientOpenAI, lireCorps, partieFichier, erreurIA, verifierMethode } from "./_openai.js";

export const config = { maxDuration: 60 };

const t = z.string().nullable();

const Adresse = z.object({
  adresse: t.describe("Numéro et nom de rue"),
  complement: t.describe("Bâtiment, étage, appartement…"),
  cp: t.describe("Code postal, ex : 13001"),
  ville: t,
  pays: t.describe("Code pays sur 2 lettres, ex : FR"),
});

const FactureVariable = z.object({
  client: z.object({ prenom: t, nom: t }),
  facturation: Adresse.describe("Adresse du client (destinataire de la facture)"),
  societe: z.object({
    nom: t.describe("Raison sociale du client s'il achète pour une entreprise, sinon null"),
    tva: t.describe("N° de TVA intracommunautaire DU CLIENT, sinon null"),
  }),
  commercialeIdentique: z.boolean().nullable().describe("true si l'adresse de la société du client est la même que celle du client"),
  commerciale: Adresse.describe("Adresse de la société du client si elle est différente, sinon tout à null"),
  livraisonIdentique: z.boolean().nullable().describe("true si la livraison se fait à l'adresse du client"),
  livraison: Adresse.extend({ nom: t.describe("Nom du destinataire de la livraison") }),
  commande: z.object({
    numero: t,
    date: t.describe("Date de la commande, format « 08 décembre 2025 »"),
    par: t.describe("Personne qui a passé la commande"),
  }),
  articles: z.array(
    z.object({
      description: z.string(),
      reference: t.describe("Référence produit (SKU, EAN, code article…) si présente"),
      quantite: z.number(),
      prix: z.number().describe("Prix UNITAIRE"),
      base: z.enum(["TTC", "HT"]).describe("Le prix unitaire est-il TTC ou HT ?"),
    })
  ),
  fraisLivraison: z.number().nullable().describe("Frais de livraison TTC, 0 si gratuits, null si inconnus"),
});

const CONSIGNES = `Tu aides à remplir une facture française. La facture a deux parties :

1) PARTIE FIXE — tu n'y touches JAMAIS et tu ne la renvoies pas :
   le logo, l'entreprise qui vend (bloc « Vendu par » : nom, adresse, n° de TVA), la ligne de contact,
   les mentions obligatoires, le pied de page, le numéro et la date de la facture.
   Si le document contient un vendeur, un logo ou des mentions légales, ignore-les.

2) PARTIE QUI CHANGE — c'est la seule que tu extrais :
   le client (prénom, nom, adresse), la société du client et son n° de TVA (adresse commerciale),
   l'adresse de livraison, la commande (numéro, date, commandé par), les articles (description,
   référence, quantité, prix unitaire) et les frais de livraison.

Règles :
- N'invente rien : si une info n'apparaît pas, mets null.
- Sépare bien prénom et nom.
- Dates au format « 08 décembre 2025 ».
- Prix en nombres (49.9, pas « 49,90 € »). Choisis "TTC" sauf si le prix est clairement HT.
- Une seule adresse donnée ⇒ livraisonIdentique = true (et commercialeIdentique = true s'il y a une société).`;

export default async function handler(req, res) {
  if (!verifierMethode(req, res)) return;
  const openai = clientOpenAI(res);
  if (!openai) return;

  const corps = lireCorps(req);
  const texte = String(corps.texte || "").trim().slice(0, 20000);
  const fichier = partieFichier(corps.fichier);
  if (!texte && !fichier) return res.status(400).json({ erreur: "Colle un texte ou joins un fichier." });

  const contenu = [{ type: "input_text", text: texte ? `Informations de la commande :\n\n${texte}` : "Informations de la commande : voir le fichier joint." }];
  if (fichier) contenu.push(fichier);

  try {
    const reponse = await openai.responses.parse({
      model: MODELE,
      instructions: CONSIGNES,
      input: [{ role: "user", content: contenu }],
      text: { format: zodTextFormat(FactureVariable, "facture") },
    });
    if (!reponse.output_parsed) return res.status(502).json({ erreur: "Réponse de l'IA illisible, réessaie." });
    return res.status(200).json({ facture: reponse.output_parsed });
  } catch (e) {
    return erreurIA(res, e);
  }
}
