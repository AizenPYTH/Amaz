// ============================================================
//  CONFIGURATION DE TON ENTREPRISE
//  Tout ce qui est ici est FIXE et apparaît sur chaque facture.
//  Modifie ces valeurs une seule fois.
// ============================================================

window.FACTURE_CONFIG = {
  entreprise: {
    nom: "Ma Société SAS",
    adresse: "12 rue de l'Exemple",
    cp: "75011",
    ville: "Paris",
    pays: "France",
    siret: "123 456 789 00012",
    rcs: "RCS Paris 123 456 789",
    tvaIntra: "FR12 123456789",
    capital: "Capital social : 1 000 €",
    email: "contact@masociete.fr",
    telephone: "01 23 45 67 89",
  },

  // Logo : remplace le fichier assets/logo.svg par ton logo
  // (ou mets assets/logo.png et change le chemin ici).
  logo: "assets/logo.svg",
  logoHauteur: "56px",

  // Police de la facture.
  // - Si c'est une police Google Fonts : mets son nom dans googleFont (ex : "Roboto").
  // - Si tu as un fichier de police (.ttf / .woff2) : mets-le dans assets/fonts/
  //   et indique son chemin dans fichierPolice.
  police: {
    nom: "Arial",
    googleFont: "",
    fichierPolice: "", // ex : "assets/fonts/MaPolice.woff2"
  },

  // Valeur proposée par défaut pour "Vendu par" (tu peux la changer à chaque facture).
  venduParDefaut: "Ma Société SAS",

  // Numérotation automatique des factures : PREFIXE + compteur (ex : FR-2026-00001)
  numeroFacture: {
    prefixe: "FR-" + new Date().getFullYear() + "-",
    chiffres: 5,
    premierNumero: 1,
  },

  tauxTVA: 0.2, // 20 %
  devise: "EUR",

  // Les prix que tu tapes sont-ils TTC ou HT par défaut ?
  // (tu peux toujours forcer en tapant "41,58 ht" ou "49,90 ttc")
  prixSaisisEn: "TTC",

  piedDePage:
    "Ma Société SAS — 12 rue de l'Exemple, 75011 Paris — SIRET 123 456 789 00012 — TVA FR12 123456789",
};
