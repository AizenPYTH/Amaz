// ============================================================
//  ASSISTANT : pose les questions une par une et remplit la facture
// ============================================================

(function () {
  const C = window.FACTURE_CONFIG;
  const $ = (s) => document.querySelector(s);
  const fil = $("#fil");
  const champ = $("#reponse");
  const feuille = $("#feuille");
  const cadre = $("#cadre");
  const zoneSuggestions = $("#suggestions");

  // ---------- Stockage local (tolérant aux navigateurs qui bloquent) ----------
  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };

  // ---------- Police de la facture ----------
  (function chargerPolice() {
    const p = C.police || {};
    if (p.googleFont) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(p.googleFont)}:wght@400;700&display=swap`;
      document.head.appendChild(l);
    }
    if (p.fichierPolice) {
      const st = document.createElement("style");
      st.textContent = `@font-face{font-family:"PoliceFacture";src:url("${p.fichierPolice}");font-weight:100 900;}`;
      document.head.appendChild(st);
    }
    const nom = p.fichierPolice ? "PoliceFacture" : p.googleFont || p.nom || "Arial";
    document.documentElement.style.setProperty("--police-facture", `"${nom}"`);
  })();

  // ---------- Utilitaires ----------
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const dateFR = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const aujourdhui = () => dateFR(new Date());

  function lireDate(v) {
    const s = v.trim().toLowerCase();
    if (/^auj/.test(s)) return aujourdhui();
    if (s === "hier") return dateFR(new Date(Date.now() - 864e5));
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${pad(m[3])}/${pad(m[2])}/${m[1]}`;
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
    if (m) {
      let an = m[3] || String(new Date().getFullYear());
      if (an.length === 2) an = "20" + an;
      return `${pad(m[1])}/${pad(m[2])}/${an}`;
    }
    return v.trim();
  }

  function lirePrix(v) {
    const s = v.toLowerCase();
    const base = /\bht\b/.test(s) ? "HT" : /\bttc\b/.test(s) ? "TTC" : C.prixSaisisEn;
    let n = s.replace(/[^0-9,.\-]/g, "");
    if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
    const prix = parseFloat(n);
    return isNaN(prix) || prix < 0 ? null : { prix, base };
  }

  function villeDepuisCP(cp) {
    if (/^750\d\d$/.test(cp)) return "Paris";
    if (/^6900\d$/.test(cp)) return "Lyon";
    if (/^130(0\d|1[0-6])$/.test(cp)) return "Marseille";
    return "";
  }

  const nomComplet = (d) => [d.client?.prenom, d.client?.nom].filter(Boolean).join(" ");

  function prochainNumero() {
    const n = C.numeroFacture;
    const dernier = store.get("facture.compteur", n.premierNumero - 1);
    return n.prefixe + pad(dernier + 1, n.chiffres);
  }

  const get = (o, chemin) => chemin.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
  function set(o, chemin, v) {
    const ks = chemin.split(".");
    let x = o;
    ks.slice(0, -1).forEach((k) => (x = x[k] = x[k] && typeof x[k] === "object" ? x[k] : {}));
    x[ks[ks.length - 1]] = v;
  }

  // ---------- Données de la facture ----------
  const vide = () => ({
    client: {},
    facturation: { pays: "France" },
    livraisonIdentique: null,
    livraison: { pays: "France" },
    vendeur: "",
    commande: {},
    facture: {},
    articles: [{}],
    fraisLivraison: null,
  });

  let data = store.get("facture.brouillon", null) || vide();
  let pos = 0;
  let historique = [];
  let preRempli = false;

  // ---------- Liste des questions ----------
  // Champ texte simple
  const q = (chemin, question, opts = {}) => ({
    id: chemin,
    question,
    valeur: (d) => get(d, chemin),
    appliquer: (d, v) => set(d, chemin, v),
    ...opts,
  });

  function etapes(d) {
    const liste = [
      q("client.prenom", "Prénom du client ?"),
      q("client.nom", "Nom du client ?"),
      q("client.societe", "Société du client ? (facultatif)", { optionnel: true }),
      q("facturation.adresse", "Adresse de facturation (numéro et rue) ?"),
      q("facturation.complement", "Complément d'adresse ? (bâtiment, étage… facultatif)", { optionnel: true }),
      q("facturation.cp", "Code postal / arrondissement ? (ex : 75011)"),
      q("facturation.ville", "Ville ?", { defaut: (d) => villeDepuisCP(d.facturation?.cp || "") }),
      {
        id: "livraisonIdentique",
        question: "L'adresse de livraison est-elle la même que l'adresse de facturation ?",
        choix: ["Oui", "Non"],
        valeur: (d) => (d.livraisonIdentique == null ? "" : d.livraisonIdentique ? "Oui" : "Non"),
        defaut: () => "Oui",
        valider: (v) => (/^(o|oui|n|non)$/i.test(v) ? "" : "Réponds Oui ou Non."),
        appliquer: (d, v) => (d.livraisonIdentique = /^o/i.test(v)),
      },
    ];

    if (d.livraisonIdentique === false) {
      liste.push(
        q("livraison.nom", "Nom du destinataire de la livraison ?", { defaut: nomComplet }),
        q("livraison.adresse", "Adresse de livraison (numéro et rue) ?"),
        q("livraison.complement", "Complément d'adresse de livraison ? (facultatif)", { optionnel: true }),
        q("livraison.cp", "Code postal / arrondissement de livraison ?"),
        q("livraison.ville", "Ville de livraison ?", { defaut: (d) => villeDepuisCP(d.livraison?.cp || "") })
      );
    }

    liste.push(
      q("vendeur", "Vendu par ? (marque / vendeur affiché sur la facture)", {
        defaut: () => store.get("facture.dernierVendeur", C.venduParDefaut),
      }),
      q("commande.numero", "Numéro de commande ?"),
      q("commande.date", "Date de la commande ?", {
        choix: ["Aujourd'hui", "Hier"],
        defaut: aujourdhui,
        transformer: lireDate,
      }),
      q("commande.par", "Commandé par ?", { defaut: nomComplet }),
      q("facture.numero", "Numéro de facture ?", { defaut: prochainNumero }),
      q("facture.date", "Date de la facture ?", { choix: ["Aujourd'hui"], defaut: aujourdhui, transformer: lireDate })
    );

    const articles = d.articles && d.articles.length ? d.articles : [{}];
    articles.forEach((_, i) => {
      const n = articles.length > 1 || i > 0 ? ` n°${i + 1}` : "";
      liste.push(
        q(`articles.${i}.description`, `Article${n} : désignation du produit ?`),
        q(`articles.${i}.quantite`, `Quantité${n} ?`, {
          defaut: () => "1",
          valider: (v) => (/^\d+([.,]\d+)?$/.test(v.trim()) && parseFloat(v.replace(",", ".")) > 0 ? "" : "Mets un nombre (ex : 1)."),
          transformer: (v) => parseFloat(v.replace(",", ".")),
        }),
        {
          id: `articles.${i}.prix`,
          question: `Prix unitaire${n} (${C.prixSaisisEn}) ? — tape « ht » ou « ttc » après le prix pour préciser`,
          valeur: (d) => {
            const a = d.articles?.[i];
            return a && a.prix != null ? `${String(a.prix).replace(".", ",")} ${a.base || C.prixSaisisEn}` : "";
          },
          valider: (v) => (lirePrix(v) ? "" : "Je n'ai pas compris le prix (ex : 49,90 ou 41,58 ht)."),
          appliquer: (d, v) => Object.assign(d.articles[i], lirePrix(v)),
        },
        {
          id: `articles.${i}.autre`,
          question: "Ajouter un autre article ?",
          choix: ["Oui", "Non"],
          valeur: () => "",
          defaut: (d) => (i < d.articles.length - 1 ? "Oui" : "Non"),
          valider: (v) => (/^(o|oui|n|non)$/i.test(v) ? "" : "Réponds Oui ou Non."),
          appliquer: (d, v) => {
            if (/^o/i.test(v)) {
              if (i === d.articles.length - 1) d.articles.push({});
            } else d.articles.length = i + 1;
          },
        }
      );
    });

    liste.push(
      {
        id: "fraisLivraison",
        question: "Frais de livraison (TTC) ?",
        choix: ["Gratuit"],
        valeur: (d) => (d.fraisLivraison == null ? "" : String(d.fraisLivraison).replace(".", ",")),
        defaut: () => "0",
        valider: (v) => (/^gratuit$/i.test(v.trim()) || lirePrix(v) ? "" : "Mets un montant (ex : 4,99) ou 0."),
        appliquer: (d, v) => (d.fraisLivraison = /^gratuit$/i.test(v.trim()) ? 0 : lirePrix(v).prix),
      },
      { id: "fin", fin: true }
    );
    return liste;
  }

  // ---------- Affichage ----------
  function bulle(texte, classe, defaut) {
    const b = document.createElement("div");
    b.className = `bulle ${classe}`;
    b.textContent = texte;
    if (defaut) {
      const s = document.createElement("span");
      s.className = "defaut";
      s.textContent = `Proposé : ${defaut} — Entrée pour garder`;
      b.appendChild(s);
    }
    fil.appendChild(b);
    fil.scrollTop = fil.scrollHeight;
  }

  function ajusterApercu() {
    feuille.style.transform = "none";
    const largeurDispo = cadre.parentElement.clientWidth - (window.innerWidth <= 860 ? 32 : 48);
    const l = feuille.offsetWidth;
    const h = feuille.offsetHeight;
    const echelle = Math.min(1, largeurDispo / l);
    feuille.style.transform = `scale(${echelle})`;
    cadre.style.width = `${l * echelle}px`;
    cadre.style.height = `${h * echelle}px`;
  }

  function rafraichir() {
    if (feuille.getAttribute("contenteditable") !== "true") feuille.innerHTML = window.Facture.rendre(data);
    store.set("facture.brouillon", data);
    ajusterApercu();
  }

  function valeurProposee(etape) {
    const v = etape.valeur(data);
    if (v != null && String(v).trim() !== "") return String(v);
    return etape.defaut ? etape.defaut(data) || "" : "";
  }

  function poser() {
    const liste = etapes(data);
    const etape = liste[pos];
    zoneSuggestions.innerHTML = "";
    $("#btn-retour").disabled = historique.length === 0;

    if (etape.fin) {
      const t = window.Facture.calculer(data);
      const m = window.Facture.money;
      bulle(
        `✅ Facture prête !\nTotal HT : ${m(t.totalHT)}\nTVA : ${m(t.totalTVA)}\nTotal TTC : ${m(t.totalTTC)}\n\n` +
          "Clique sur « Télécharger le PDF ». Tu peux aussi cliquer directement dans la facture pour corriger un détail.",
        "ia"
      );
      champ.value = "";
      champ.disabled = true;
      champ.placeholder = "Facture terminée";
      feuille.setAttribute("contenteditable", "true");
      ajouterPuce("Nouvelle facture", nouvelle);
      return;
    }

    champ.disabled = false;
    champ.placeholder = "Ta réponse… (Entrée pour valider)";
    feuille.removeAttribute("contenteditable");
    const proposee = valeurProposee(etape);
    bulle(etape.question, "ia", proposee);
    (etape.choix || []).forEach((c) => ajouterPuce(c, () => repondre(c)));
    if (preRempli) ajouterPuce("✔ Valider tout ce qui est pré-rempli", toutValider);
    champ.value = "";
    champ.focus();
  }

  function ajouterPuce(texte, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "puce";
    b.textContent = texte;
    b.onclick = action;
    zoneSuggestions.appendChild(b);
  }

  // Applique une réponse. Renvoie un message d'erreur ou "".
  function appliquerReponse(etape, brut) {
    let v = brut.trim();
    if (v === "") v = valeurProposee(etape);
    if (v === "-") {
      if (!etape.optionnel) return "Ce champ est obligatoire.";
      v = "";
    }
    if (v === "" && !etape.optionnel) return "Ce champ est obligatoire.";
    if (v !== "" && etape.valider) {
      const err = etape.valider(v);
      if (err) return err;
    }
    historique.push({ data: JSON.parse(JSON.stringify(data)), pos });
    etape.appliquer(data, etape.transformer && v !== "" ? etape.transformer(v) : v);
    pos++;
    return "";
  }

  function repondre(brut) {
    const etape = etapes(data)[pos];
    if (!etape || etape.fin) return;
    const affiche = brut.trim() || valeurProposee(etape) || "(vide)";
    const err = appliquerReponse(etape, brut);
    if (err) {
      bulle(err, "erreur");
      return;
    }
    bulle(affiche === "-" ? "(vide)" : affiche, "moi");
    rafraichir();
    poser();
  }

  function toutValider() {
    let n = 0;
    for (;;) {
      const etape = etapes(data)[pos];
      if (!etape || etape.fin) break;
      if (!valeurProposee(etape) && !etape.optionnel) break;
      if (appliquerReponse(etape, "")) break;
      n++;
    }
    preRempli = false;
    bulle(`${n} réponse(s) validée(s) automatiquement.`, "moi");
    rafraichir();
    poser();
  }

  function retour() {
    const prec = historique.pop();
    if (!prec) return;
    data = prec.data;
    pos = prec.pos;
    feuille.removeAttribute("contenteditable");
    bulle("↩ Retour à la question précédente", "moi");
    rafraichir();
    poser();
  }

  function nouvelle() {
    data = vide();
    pos = 0;
    historique = [];
    preRempli = false;
    feuille.removeAttribute("contenteditable");
    fil.innerHTML = "";
    rafraichir();
    bulle("Nouvelle facture. Réponds aux questions une par une, l'aperçu se met à jour en direct.", "ia");
    poser();
  }

  function telechargerPDF() {
    // Mémorise le compteur et le dernier vendeur utilisé
    const n = C.numeroFacture;
    const num = data.facture?.numero || "";
    if (num.startsWith(n.prefixe)) {
      const v = parseInt(num.slice(n.prefixe.length), 10);
      if (!isNaN(v)) store.set("facture.compteur", Math.max(v, store.get("facture.compteur", 0)));
    }
    if (data.vendeur) store.set("facture.dernierVendeur", data.vendeur);

    const titre = document.title;
    document.title = `Facture ${num || ""}`.trim();
    window.print();
    setTimeout(() => (document.title = titre), 500);
  }

  // ---------- Remplissage par l'IA ----------
  function fusionner(cible, source) {
    for (const [k, v] of Object.entries(source || {})) {
      if (v == null || v === "") continue;
      if (Array.isArray(v)) cible[k] = v;
      else if (typeof v === "object") fusionner((cible[k] = cible[k] && typeof cible[k] === "object" ? cible[k] : {}), v);
      else cible[k] = v;
    }
    return cible;
  }

  async function remplirIA(texte) {
    const btn = $("#btn-ia-go");
    const erreur = $("#erreur-ia");
    erreur.hidden = true;
    btn.disabled = true;
    btn.textContent = "Analyse en cours…";
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texte }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.erreur || `Erreur ${r.status}`);

      const extrait = json.facture || {};
      if (Array.isArray(extrait.articles) && extrait.articles.length === 0) delete extrait.articles;
      data = fusionner(vide(), extrait);
      if (!data.articles.length) data.articles = [{}];
      pos = 0;
      historique = [];
      preRempli = true;
      $("#dlg-ia").close();
      fil.innerHTML = "";
      rafraichir();
      bulle(
        "J'ai pré-rempli la facture avec ce que j'ai trouvé. Je te repose les questions une par une : Entrée pour valider chaque valeur proposée, ou tape la bonne.",
        "ia"
      );
      poser();
    } catch (e) {
      erreur.textContent = e.message || "Erreur inconnue";
      erreur.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Pré-remplir";
    }
  }

  // ---------- Événements ----------
  $("#saisie").addEventListener("submit", (e) => {
    e.preventDefault();
    repondre(champ.value);
  });
  $("#btn-retour").addEventListener("click", retour);
  $("#btn-nouvelle").addEventListener("click", () => {
    if (confirm("Commencer une nouvelle facture ? La facture en cours sera effacée.")) nouvelle();
  });
  $("#btn-pdf").addEventListener("click", telechargerPDF);
  $("#btn-ia").addEventListener("click", () => {
    $("#erreur-ia").hidden = true;
    $("#dlg-ia").showModal();
    $("#texte-ia").focus();
  });
  $("#btn-ia-go").addEventListener("click", (e) => {
    e.preventDefault();
    const t = $("#texte-ia").value.trim();
    if (t) remplirIA(t);
  });
  window.addEventListener("resize", ajusterApercu);

  // ---------- Démarrage ----------
  rafraichir();
  feuille.addEventListener("load", ajusterApercu, true); // logo chargé
  const reprise = store.get("facture.brouillon", null);
  if (reprise && reprise.client && reprise.client.prenom) {
    bulle("J'ai repris ta facture en cours. Je te repose les questions depuis le début avec les valeurs déjà saisies (Entrée pour garder).", "ia");
    preRempli = true;
  } else {
    bulle("Bonjour 👋 Je vais te poser les questions une par une pour remplir la facture. L'aperçu de la facture se met à jour en direct.", "ia");
  }
  poser();
})();
