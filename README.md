# 🧾 Générateur de factures

Un site qui te pose les questions **une par une** (client, adresses, commande, articles, prix…), affiche la facture en direct et la sort en **PDF**.
Le modèle, le logo et la police ne bougent pas : seules les infos saisies changent.

- Calcul automatique du **HT**, de la **TVA 20 %** et du **TTC** : tu tapes le montant que tu as (`49,90 ttc`, `41,58 ht` ou `8,32 tva`), le reste est calculé
- « Combien de produits ? » : les lignes sont préparées sur la facture, puis remplies une par une
- Numéro de facture automatique (`FR-2026-00001`, `00002`…)
- Code postal `750xx` → ville « Paris » proposée automatiquement (pareil pour Lyon et Marseille)
- Bouton **↩** pour revenir à la question précédente
- **⚙ Mon entreprise** : la partie FIXE (logo, couleur, bloc « Vendu par », ligne de contact, mentions, pied de page, numérotation).
  Bouton « Remplir automatiquement depuis MA facture » : l'IA lit ta facture (PDF/image) et remplit ces champs.
- **✨ Coller la commande (IA)** : tu colles le mail de commande (ou une capture), l'IA pré-remplit UNIQUEMENT la partie qui change
  (client, adresses, commande, articles, prix). Elle ne peut pas toucher au logo ni à ton entreprise : ces champs ne lui sont même pas demandés.
- **🖼 Ajuster le logo** : taille et position avec des curseurs, ou en faisant glisser le logo sur la facture ;
  « Rogner les marges vides » enlève le blanc autour du logo (souvent la cause d'un logo qui paraît minuscule)
- **👥 Clients** : chaque client est enregistré à la fin de sa facture. Pour le refacturer : « Nouvelle facture pour le même client »,
  ou choisis-le au début d'une nouvelle facture ; ses adresses sont reprises et on passe directement à la commande et aux produits
- **💾 Télécharger mes réglages** (dans « Mon entreprise ») : une copie de ton logo, de tes infos et de tes clients dans un fichier, à restaurer en 1 clic
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

## Est-ce que je perds mes réglages en redéployant ?

Non. Tes réglages sont gardés dans ton navigateur, pour l'adresse du site. Un nouveau déploiement ne les efface pas,
**à condition d'ouvrir toujours la même adresse** (celle de production, ex : `ton-projet.vercel.app`).
Les adresses de prévisualisation de Vercel (`ton-projet-xxxx-....vercel.app`) sont considérées comme d'autres sites : tes réglages n'y sont pas.
Ils sont perdus seulement si tu vides les données du navigateur, ou sur un autre appareil : d'où le bouton « 💾 Télécharger mes réglages ».

## Télécharger le PDF

Clique sur **Télécharger le PDF** puis choisis **« Enregistrer au format PDF »** comme imprimante.
Dans les options, décoche « En-têtes et pieds de page » si ton navigateur les ajoute.

## Tester en local

```bash
npm install
npx vercel dev
```
