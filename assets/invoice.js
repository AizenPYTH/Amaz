// ============================================================
//  MODÈLE DE FACTURE
//  C'est ici qu'on dessine la facture. Les {{...}} sont remplacés
//  par les infos saisies. La mise en forme est dans invoice.css.
// ============================================================

(function () {
  const C = window.FACTURE_CONFIG;

  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const money = (n) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: C.devise }).format(n || 0);

  const pct = (t) => `${Math.round(t * 1000) / 10} %`;

  // Calcule HT / TVA / TTC ligne par ligne, puis les totaux.
  function calculer(data) {
    const t = C.tauxTVA;
    const lignes = (data.articles || [])
      .filter((a) => a.description)
      .map((a) => {
        const q = Number(a.quantite) || 0;
        const p = Number(a.prix) || 0;
        let totalTTC, totalHT, unitHT, unitTTC;
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
        return { ...a, quantite: q, unitHT, unitTTC, totalHT, totalTTC, tva: round2(totalTTC - totalHT) };
      });

    const port = Number(data.fraisLivraison) || 0;
    if (port > 0) {
      const ht = round2(port / (1 + t));
      lignes.push({
        description: "Frais de livraison",
        quantite: 1,
        unitHT: ht,
        unitTTC: port,
        totalHT: ht,
        totalTTC: port,
        tva: round2(port - ht),
        estPort: true,
      });
    }

    const totalHT = round2(lignes.reduce((s, l) => s + l.totalHT, 0));
    const totalTTC = round2(lignes.reduce((s, l) => s + l.totalTTC, 0));
    const totalTVA = round2(totalTTC - totalHT);
    return { lignes, totalHT, totalTVA, totalTTC };
  }

  // Affiche une valeur, ou un exemple grisé si le champ n'est pas encore rempli.
  const val = (v, exemple) =>
    v && String(v).trim() ? esc(v) : `<span class="exemple">${esc(exemple)}</span>`;

  function blocAdresse(a, exemple) {
    a = a || {};
    return `
      ${val(a.nom, exemple.nom)}<br>
      ${a.societe ? esc(a.societe) + "<br>" : ""}
      ${val(a.adresse, exemple.adresse)}<br>
      ${a.complement ? esc(a.complement) + "<br>" : ""}
      ${val(a.cp, exemple.cp)} ${val(a.ville, exemple.ville)}<br>
      ${esc(a.pays || "France")}`;
  }

  function rendre(data) {
    const E = C.entreprise;
    const tot = calculer(data);
    const nomClient = [data.client?.prenom, data.client?.nom].filter(Boolean).join(" ");

    const facturation = { ...(data.facturation || {}), nom: nomClient, societe: data.client?.societe };
    const livraison = data.livraisonIdentique !== false ? facturation : data.livraison || {};

    const exemple = { nom: "Jean Dupont", adresse: "25 avenue des Exemples", cp: "75015", ville: "Paris" };

    const lignesHTML = tot.lignes.length
      ? tot.lignes
          .map(
            (l) => `
        <tr>
          <td class="desc">${esc(l.description)}</td>
          <td class="num">${l.quantite}</td>
          <td class="num">${money(l.unitHT)}</td>
          <td class="num">${pct(C.tauxTVA)}</td>
          <td class="num">${money(l.unitTTC)}</td>
          <td class="num">${money(l.totalTTC)}</td>
        </tr>`
          )
          .join("")
      : `
        <tr class="exemple">
          <td class="desc">Exemple d'article</td>
          <td class="num">1</td>
          <td class="num">${money(41.58)}</td>
          <td class="num">${pct(C.tauxTVA)}</td>
          <td class="num">${money(49.9)}</td>
          <td class="num">${money(49.9)}</td>
        </tr>`;

    return `
    <div class="facture">
      <header class="f-entete">
        <img class="f-logo" src="${esc(C.logo)}" alt="Logo" style="height:${esc(C.logoHauteur)}">
        <div class="f-titre">
          <h1>Facture</h1>
          <div class="f-paye">Payé</div>
        </div>
      </header>

      <section class="f-refs">
        <div><span>Numéro de facture</span><strong>${val(data.facture?.numero, "FR-2026-00001")}</strong></div>
        <div><span>Date de facture</span><strong>${val(data.facture?.date, "01/10/2026")}</strong></div>
        <div><span>Total à payer</span><strong>${money(tot.lignes.length ? tot.totalTTC : 49.9)}</strong></div>
      </section>

      <section class="f-adresses">
        <div class="f-bloc">
          <h3>Adresse de facturation</h3>
          <p>${blocAdresse(facturation, exemple)}</p>
        </div>
        <div class="f-bloc">
          <h3>Adresse de livraison</h3>
          <p>${blocAdresse(livraison, exemple)}</p>
        </div>
        <div class="f-bloc">
          <h3>Vendu par</h3>
          <p>
            <strong>${val(data.vendeur, C.venduParDefaut)}</strong><br>
            ${esc(E.adresse)}<br>
            ${esc(E.cp)} ${esc(E.ville)}<br>
            ${esc(E.pays)}<br>
            N° TVA : ${esc(E.tvaIntra)}<br>
            SIRET : ${esc(E.siret)}
          </p>
        </div>
      </section>

      <section class="f-commande">
        <h3>Informations sur la commande</h3>
        <div class="f-commande-grille">
          <div><span>Date de la commande</span>${val(data.commande?.date, "28/09/2026")}</div>
          <div><span>Numéro de la commande</span>${val(data.commande?.numero, "402-1234567-1234567")}</div>
          <div><span>Commandé par</span>${val(data.commande?.par, nomClient || exemple.nom)}</div>
        </div>
      </section>

      <table class="f-articles">
        <thead>
          <tr>
            <th class="desc">Description</th>
            <th class="num">Qté</th>
            <th class="num">Prix unitaire<br>(HT)</th>
            <th class="num">Taux TVA</th>
            <th class="num">Prix unitaire<br>(TTC)</th>
            <th class="num">Total<br>(TTC)</th>
          </tr>
        </thead>
        <tbody>${lignesHTML}</tbody>
      </table>

      <section class="f-totaux">
        <table>
          <tr><td>Total HT</td><td class="num">${money(tot.lignes.length ? tot.totalHT : 41.58)}</td></tr>
          <tr><td>TVA ${pct(C.tauxTVA)}</td><td class="num">${money(tot.lignes.length ? tot.totalTVA : 8.32)}</td></tr>
          <tr class="f-total"><td>Total TTC</td><td class="num">${money(tot.lignes.length ? tot.totalTTC : 49.9)}</td></tr>
        </table>
      </section>

      <footer class="f-pied">
        ${esc(C.piedDePage)}<br>
        ${esc(E.rcs)} — ${esc(E.capital)} — ${esc(E.email)} — ${esc(E.telephone)}
      </footer>
    </div>`;
  }

  window.Facture = { rendre, calculer, money };
})();
