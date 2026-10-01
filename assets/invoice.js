// ============================================================
//  MODÈLE DE FACTURE
//  - P (profil)  = la partie FIXE : logo, ton entreprise, mentions, pied de page
//  - data        = la partie qui CHANGE : client, adresses, commande, articles, prix
//  La mise en forme est dans invoice.css.
// ============================================================

(function () {
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const money = (n, devise = "EUR") =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise }).format(n || 0);

  const pct = (t) => `${Math.round(t * 1000) / 10} %`;

  // HT / TVA / TTC ligne par ligne, puis totaux.
  function calculer(data, P) {
    const t = P.tauxTVA;
    // Une ligne par produit (y compris ceux pas encore remplis, pour préparer les cases)
    const lignes = (data.articles || []).map((a, index) => {
      const q = Number(a.quantite) || 1;
      const p = Number(a.prix) || 0;
      let unitHT, unitTTC, totalHT, totalTTC;
      if (a.base === "HT") {
        unitHT = p;
        unitTTC = round2(p * (1 + t));
        totalHT = round2(q * p);
        totalTTC = round2(totalHT * (1 + t));
      } else {
        unitTTC = p;
        unitHT = round2(p / (1 + t));
        totalTTC = round2(q * p);
        totalHT = round2(totalTTC / (1 + t));
      }
      const rempli = !!a.description && a.prix != null;
      return { ...a, index, rempli, quantite: q, unitHT, unitTTC, totalHT, totalTTC, totalTVA: round2(totalTTC - totalHT) };
    });
    const articles = lignes.filter((l) => l.rempli);

    const portTTC = round2(Number(data.fraisLivraison) || 0);
    const portHT = round2(portTTC / (1 + t));

    const totalHT = round2(articles.reduce((s, l) => s + l.totalHT, 0) + portHT);
    const totalTTC = round2(articles.reduce((s, l) => s + l.totalTTC, 0) + portTTC);
    return { lignes, articles, portHT, portTTC, totalHT, totalTVA: round2(totalTTC - totalHT), totalTTC };
  }

  // Valeur saisie, ou exemple grisé tant que le champ est vide.
  const val = (v, exemple) =>
    v != null && String(v).trim() !== "" ? esc(v) : `<span class="exemple">${esc(exemple)}</span>`;

  const EX = {
    prenom: "Jean",
    nom: "Dupont",
    adresse: "7 square de l'Exemple",
    cp: "13001",
    ville: "Marseille",
    pays: "FR",
  };

  function lignesAdresse(a, nom, { majuscules = false, tva = "" } = {}) {
    const m = (s) => (majuscules ? String(s).toUpperCase() : s);
    const v = (x, ex) => (x != null && String(x).trim() !== "" ? esc(m(x)) : `<span class="exemple">${esc(m(ex))}</span>`);
    return [
      nom,
      v(a.adresse, EX.adresse),
      a.complement ? esc(m(a.complement)) : "",
      `${v(a.ville, EX.ville)}, ${v(a.cp, EX.cp)}`,
      v(a.pays, EX.pays),
      tva ? `TVA ${esc(tva)}` : "",
    ]
      .filter(Boolean)
      .map((l) => `<div>${l}</div>`)
      .join("");
  }

  function rendre(data, P) {
    const tot = calculer(data, P);
    const vide = tot.articles.length === 0;
    const m = (n) => money(n, P.devise);
    const V = P.vendeur || {};

    const fact = data.facturation || {};
    const nomClient = [data.client?.prenom, data.client?.nom].filter(Boolean).join(" ");
    const nomClientHTML = nomClient ? esc(nomClient) : `<span class="exemple">${EX.prenom} ${EX.nom}</span>`;

    // Adresse commerciale = société du client (ou le client lui-même) + adresse
    const soc = data.societe || {};
    const adrCommerciale = soc.nom && data.commercialeIdentique === false ? data.commerciale || {} : fact;
    const nomCommercial = soc.nom ? esc(soc.nom) : nomClientHTML;

    // Adresse de livraison
    const liv = data.livraisonIdentique === false ? data.livraison || {} : fact;
    const nomLivraison = data.livraisonIdentique === false && data.livraison?.nom ? esc(data.livraison.nom) : nomClientHTML;

    const totalAPayer = vide ? `<span class="exemple">${m(49.9)}</span>` : m(tot.totalTTC);

    const exempleArticle = `<tr class="f-art exemple">
           <td class="desc">Exemple d'article<div class="f-ref">${esc(P.libelleReference)} : ABC123</div></td>
           <td class="c">1</td><td class="num">${m(41.58)}</td><td class="c">${pct(P.tauxTVA)}</td>
           <td class="num">${m(49.9)}</td><td class="num">${m(49.9)}</td></tr>`;

    // Case préparée mais pas encore remplie
    const caseVide = (l) => `<tr class="f-art exemple">
           <td class="desc">${l.description ? esc(l.description) : `Produit ${l.index + 1}`}</td>
           <td class="c">${l.quantite}</td><td class="num">…</td><td class="c">${pct(P.tauxTVA)}</td>
           <td class="num">…</td><td class="num">…</td></tr>`;

    const ligneArticle = (a) => `<tr class="f-art">
           <td class="desc">${esc(a.description)}${
             a.reference ? `<div class="f-ref">${esc(P.libelleReference)} : <b>${esc(a.reference)}</b></div>` : ""
           }</td>
           <td class="c">${a.quantite}</td>
           <td class="num">${m(a.unitHT)}</td>
           <td class="c">${pct(P.tauxTVA)}</td>
           <td class="num">${m(a.unitTTC)}</td>
           <td class="num">${m(a.totalTTC)}</td></tr>`;

    const lignesArticles =
      tot.lignes.length <= 1 && !tot.lignes[0]?.description ? exempleArticle : tot.lignes.map((l) => (l.rempli ? ligneArticle(l) : caseVide(l))).join("");

    const piedDePage = String(P.piedDePage || "")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `<div>${esc(l)}</div>`)
      .join("");

    return `
    <div class="facture" style="--couleur:${esc(P.couleur || "#1f6aa8")};--logo-h:${Number(P.logoTaille) || 15}mm;--logo-x:${Number(P.logoX) || 0}mm;--logo-y:${Number(P.logoY) || 0}mm">
      <div class="f-bande"></div>

      <header class="f-entete">
        ${P.logo ? `<img class="f-logo" src="${esc(P.logo)}" alt="Logo" draggable="false">` : `<div></div>`}
        <div class="f-titre">Facture</div>
      </header>

      <section class="f-haut">
        <div class="f-destinataire">
          ${lignesAdresse(fact, nomClient ? esc(nomClient.toUpperCase()) : `<span class="exemple">JEAN DUPONT</span>`, { majuscules: true })}
        </div>
        <div class="f-paye">
          <div class="f-paye-titre">Payé</div>
          ${data.facture?.referencePaiement ? `<div>Référence de paiement ${esc(data.facture.referencePaiement)}</div>` : ""}
          <div>Vendu par ${esc(V.nom)}</div>
          ${V.tva ? `<div>TVA ${esc(V.tva)}</div>` : ""}
          <table class="f-paye-infos">
            <tr><td>Date de la facture/Date de la livraison</td><td>${val(data.facture?.date, "08 décembre 2025")}</td></tr>
            <tr><td>Numéro de la facture</td><td>${val(data.facture?.numero, "FR-2026-00001")}</td></tr>
            <tr><td>Total à payer</td><td>${totalAPayer}</td></tr>
          </table>
        </div>
      </section>

      ${P.contact ? `<p class="f-contact">${esc(P.contact)}</p>` : ""}

      <section class="f-trois">
        <div>
          <h3>Adresse commerciale</h3>
          ${lignesAdresse(adrCommerciale, nomCommercial, { tva: soc.nom ? soc.tva : "" })}
        </div>
        <div>
          <h3>Adresse de livraison</h3>
          ${lignesAdresse(liv, nomLivraison)}
        </div>
        <div>
          <h3>Vendu par</h3>
          <div>${esc(V.nom)}</div>
          <div>${esc(V.adresse)}</div>
          <div>${esc(V.ville)} ${esc(V.cp)}</div>
          <div>${esc(V.pays)}</div>
          ${V.tva ? `<div>TVA ${esc(V.tva)}</div>` : ""}
        </div>
      </section>

      <section class="f-commande">
        <h2>Informations de la commande</h2>
        <table>
          <tr><td>Date de la commande</td><td>${val(data.commande?.date, "08 décembre 2025")}</td></tr>
          <tr><td>Numéro de la commande</td><td>${val(data.commande?.numero, "403-1234567-1234567")}</td></tr>
          <tr><td>Commandé par</td><td>${val(data.commande?.par, nomClient || "Jean Dupont")}</td></tr>
        </table>
      </section>

      <section class="f-details">
        <h2>Détails de la facture</h2>
        <table class="f-articles">
          <thead>
            <tr>
              <th class="desc">Description</th>
              <th class="c">Qté</th>
              <th class="num">Prix Unitaire<br>HT</th>
              <th class="c">Taux TVA</th>
              <th class="num">Prix Unitaire<br>TTC</th>
              <th class="num">Total<br>TTC</th>
            </tr>
          </thead>
          <tbody>
            ${lignesArticles}
            <tr class="f-port">
              <td class="desc">Livraison</td><td></td>
              <td class="num">${m(tot.portHT)}</td><td></td>
              <td class="num">${m(tot.portTTC)}</td>
              <td class="num">${m(tot.portTTC)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="f-totaux">
        <div class="f-total-ligne"><span>Facture Total</span><span>${vide ? `<span class="exemple">${m(49.9)}</span>` : m(tot.totalTTC)}</span></div>
        <table class="f-tva">
          <tr><th></th><th class="c">Taux TVA</th><th class="num">Total HT</th><th class="num">TVA</th></tr>
          <tr class="f-tva-ligne"><td></td><td class="c">${pct(P.tauxTVA)}</td><td class="num">${m(vide ? 41.58 : tot.totalHT)}</td><td class="num">${m(vide ? 8.32 : tot.totalTVA)}</td></tr>
          <tr><td>Total</td><td></td><td class="num">${m(vide ? 41.58 : tot.totalHT)}</td><td class="num">${m(vide ? 8.32 : tot.totalTVA)}</td></tr>
        </table>
      </section>

      <footer class="f-pied">
        ${P.mentions ? `<div class="f-mentions">${esc(P.mentions)}</div>` : ""}
        <div class="f-legal">${piedDePage}</div>
        <div class="f-page">Page 1 de 1</div>
      </footer>
    </div>`;
  }

  window.Facture = { rendre, calculer, money };
})();
