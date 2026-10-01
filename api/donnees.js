// GET/PUT /api/donnees — synchronisation entre ordinateurs.
// Garde en ligne (base Upstash Redis branchée au projet Vercel) : réglages, logo, clients, factures, lots, compteur.
// Protégé par un code d'accès (variable d'environnement CODE_ACCES).
// Chaque enregistrement porte un numéro de version : si un autre ordinateur a enregistré entre-temps,
// la demande est refusée (409) et l'ordinateur récupère d'abord la dernière version.

import { createHash, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

export const config = { maxDuration: 30 };

const CLE_VERSION = "factures:version";
const CLE_DONNEES = "factures:donnees";

// Écriture « tout ou rien » : n'enregistre que si la version n'a pas changé depuis la dernière lecture.
const SCRIPT_ECRITURE = `
local actuelle = redis.call('GET', KEYS[1]) or '0'
if actuelle ~= ARGV[1] then return {0, actuelle} end
redis.call('SET', KEYS[2], ARGV[2])
local v = redis.call('INCR', KEYS[1])
return {1, tostring(v)}
`;

function base() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token, automaticDeserialization: false });
}

const empreinte = (s) => createHash("sha256").update(String(s)).digest();
const codeValide = (recu) => {
  const attendu = process.env.CODE_ACCES;
  return !!attendu && !!recu && timingSafeEqual(empreinte(recu), empreinte(attendu));
};

function lireCorps(req) {
  if (typeof req.body !== "string") return req.body || {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const redis = base();
  if (!redis || !process.env.CODE_ACCES) {
    return res.status(501).json({
      erreur:
        "Synchronisation non configurée : branche une base Upstash Redis au projet Vercel et ajoute la variable CODE_ACCES, puis redéploie.",
    });
  }
  if (!codeValide(req.headers["x-code-acces"])) return res.status(401).json({ erreur: "Code d'accès incorrect." });

  try {
    if (req.method === "GET") {
      const [version, donnees] = await redis.mget(CLE_VERSION, CLE_DONNEES);
      return res.status(200).json({ version: Number(version || 0), donnees: donnees ? JSON.parse(donnees) : null });
    }

    if (req.method === "PUT") {
      const { baseVersion, donnees } = lireCorps(req);
      if (!donnees || typeof donnees !== "object") return res.status(400).json({ erreur: "Données manquantes." });
      const [ok, version] = await redis.eval(SCRIPT_ECRITURE, [CLE_VERSION, CLE_DONNEES], [
        String(Number(baseVersion) || 0),
        JSON.stringify(donnees),
      ]);
      if (Number(ok) !== 1) {
        // Un autre ordinateur a enregistré entre-temps : on renvoie la version la plus récente.
        const actuelles = await redis.get(CLE_DONNEES);
        return res.status(409).json({ version: Number(version), donnees: actuelles ? JSON.parse(actuelles) : null });
      }
      return res.status(200).json({ version: Number(version) });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ erreur: "Méthode non autorisée" });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erreur: "La base de données en ligne ne répond pas." });
  }
}
