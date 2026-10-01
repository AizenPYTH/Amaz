// ============================================================
//  VALEURS PAR DÉFAUT DE "MON ENTREPRISE" (la partie FIXE)
//
//  Tu n'es pas obligé de modifier ce fichier : sur le site, le bouton
//  « ⚙ Mon entreprise » permet de mettre ton logo et tes infos
//  (ou de les faire lire par l'IA depuis ta propre facture).
//  Ce qui est réglé là-bas est gardé dans ton navigateur et
//  remplace les valeurs ci-dessous.
//
//  Si tu veux que tes infos soient les mêmes sur tous tes appareils,
//  remplis-les ici directement.
// ============================================================

window.FACTURE_CONFIG = {
  logo: "assets/logo.svg",
  logoTaille: 15, // hauteur du logo en mm
  logoX: 0, // décalage horizontal en mm (+ = vers la droite)
  logoY: 0, // décalage vertical en mm (+ = vers le bas)
  couleur: "#1f6aa8", // couleur de la bande en haut de la facture

  // Bloc « Vendu par » + encadré « Payé »
  vendeur: {
    nom: "Ma Société SAS",
    adresse: "12 rue de l'Exemple",
    cp: "75011",
    ville: "Paris",
    pays: "France",
    tva: "FR00123456789",
  },

  // Ligne sous l'adresse du client
  contact: "Pour toute question, contactez-nous à l'adresse : contact@masociete.fr",

  // Petit texte au-dessus du trait en bas de page
  mentions:
    "Mentions obligatoires : Escompte pour paiement anticipé : néant. En cas de retard de paiement, des pénalités au taux de 3 fois le taux d'intérêt légal sont applicables, ainsi qu'une indemnité forfaitaire de 40 euros pour frais de recouvrement.",

  // Lignes en bas de page (une ligne par retour à la ligne)
  piedDePage:
    "Ma Société SAS - 12 rue de l'Exemple, 75011 Paris, France\nSIREN : 123456789 • RCS Paris • APE : 4791B • Capital social : 1 000 EUR • TVA : FR00123456789",

  // Numérotation automatique des factures : PREFIXE + compteur (ex : FR-2026-00001)
  prefixeFacture: "FR-" + new Date().getFullYear() + "-",
  chiffresFacture: 5,

  // Libellé de la petite ligne de référence sous chaque article (ex : « Réf. », « SKU », « EAN »)
  libelleReference: "Réf.",

  // Police de la facture (Arial par défaut, comme le modèle)
  police: "Arial",

  tauxTVA: 0.2, // 20 %
  devise: "EUR",

  // Les prix que tu tapes sont-ils TTC ou HT par défaut ?
  // (tu peux toujours forcer en tapant « 41,58 ht » ou « 49,90 ttc »)
  prixSaisisEn: "TTC",
};
