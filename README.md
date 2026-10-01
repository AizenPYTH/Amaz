# 🧾 Générateur de factures

Un site qui te pose les questions **une par une** (client, adresses, commande, articles, prix…), affiche la facture en direct et la sort en **PDF**.
Le modèle, le logo et la police ne bougent pas : seules les infos saisies changent.

- Calcul automatique du **HT**, de la **TVA 20 %** et du **TTC** (tu tapes un prix TTC, ou `41,58 ht` pour un prix HT)
- Numéro de facture automatique (`FR-2026-00001`, `00002`…)
- Code postal `750xx` → ville « Paris » proposée automatiquement (pareil pour Lyon et Marseille)
- Bouton **↩** pour revenir à la question précédente
- **⚙ Mon entreprise** : la partie FIXE (logo, couleur, bloc « Vendu par », ligne de contact, mentions, pied de page, numérotation).
  Bouton « Remplir automatiquement depuis MA facture » : l'IA lit ta facture (PDF/image) et remplit ces champs.
- **✨ Coller la commande (IA)** : tu colles le mail de commande (ou une capture), l'IA pré-remplit UNIQUEMENT la partie qui change
  (client, adresses, commande, articles, prix). Elle ne peut pas toucher au logo ni à ton entreprise : ces champs ne lui sont même pas demandés.
- Une fois la facture finie, tu peux cliquer dans la facture pour corriger un détail avant le PDF

## Mettre en ligne sur Vercel

1. Va sur [vercel.com/new](https://vercel.com/new) et importe ce dépôt GitHub.
2. Ne change aucun réglage (pas de framework, pas de build) → **Deploy**.
3. *(Pour les boutons IA)* Dans **Settings → Environment Variables**, ajoute
   `OPENAI_API_KEY` = ta clé OpenAI, puis redéploie.
   Optionnel : `OPENAI_MODEL` pour choisir le modèle (par défaut `gpt-5.4-mini`).
   Sans clé, le site marche quand même : tu remplis juste à la main.

## Mettre TA facture (logo, police, infos de ton entreprise)

| Quoi | Où |
|---|---|
| Logo, couleur, « Vendu par », mentions, pied de page | sur le site : **⚙ Mon entreprise** (gardé dans ton navigateur) |
| Les mêmes valeurs, pour tous tes appareils | `assets/config.js` (et ton logo à la place de `assets/logo.svg`) |
| Disposition de la facture | `assets/invoice.js` (contenu) et `assets/invoice.css` (mise en page) |

## Télécharger le PDF

Clique sur **Télécharger le PDF** puis choisis **« Enregistrer au format PDF »** comme imprimante.
Dans les options, décoche « En-têtes et pieds de page » si ton navigateur les ajoute.

## Tester en local

```bash
npm install
npx vercel dev
```
