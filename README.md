# 🧾 Générateur de factures

Un site qui te pose les questions **une par une** (client, adresses, commande, articles, prix…), affiche la facture en direct et la sort en **PDF**.
Le modèle, le logo et la police ne bougent pas : seules les infos saisies changent.

- Calcul automatique du **HT**, de la **TVA 20 %** et du **TTC** (tu tapes un prix TTC, ou `41,58 ht` pour un prix HT)
- Numéro de facture automatique (`FR-2026-00001`, `00002`…)
- Code postal `750xx` → ville « Paris » proposée automatiquement (pareil pour Lyon et Marseille)
- Bouton **↩** pour revenir à la question précédente
- **✨ Coller la commande (IA)** : tu colles le mail de commande, l'IA pré-remplit tout et tu n'as plus qu'à valider (Entrée) ou corriger
- Une fois la facture finie, tu peux cliquer dans la facture pour corriger un détail avant le PDF

## Mettre en ligne sur Vercel

1. Va sur [vercel.com/new](https://vercel.com/new) et importe ce dépôt GitHub.
2. Ne change aucun réglage (pas de framework, pas de build) → **Deploy**.
3. *(Facultatif, pour le bouton IA)* Dans **Settings → Environment Variables**, ajoute
   `ANTHROPIC_API_KEY` = ta clé (à créer sur [console.anthropic.com](https://console.anthropic.com)), puis redéploie.
   Sans clé, le site marche quand même : tu remplis juste à la main.

## Mettre TA facture (logo, police, infos de ton entreprise)

| Quoi | Où |
|---|---|
| Nom, adresse, SIRET, TVA, pied de page, « Vendu par » par défaut | `assets/config.js` |
| Logo | remplace `assets/logo.svg` (ou ajoute `assets/logo.png` et change `logo` dans `assets/config.js`) |
| Police | `assets/config.js` → `police` (nom Google Fonts, ou fichier `.woff2`/`.ttf` dans `assets/fonts/`) |
| Disposition de la facture | `assets/invoice.js` (contenu) et `assets/invoice.css` (mise en page) |

## Télécharger le PDF

Clique sur **Télécharger le PDF** puis choisis **« Enregistrer au format PDF »** comme imprimante.
Dans les options, décoche « En-têtes et pieds de page » si ton navigateur les ajoute.

## Tester en local

```bash
npm install
npx vercel dev
```
