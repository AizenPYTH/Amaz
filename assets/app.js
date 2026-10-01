// ============================================================
//  ASSISTANT : pose les questions une par une et remplit la facture
//
//  Deux parties bien séparées :
//   - profil : la partie FIXE (logo, ton entreprise, mentions…) → « ⚙ Mon entreprise »
//   - data   : la partie qui CHANGE à chaque facture → les questions
// ============================================================

(function () {
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
        return true;
      } catch {
        return false;
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };

  // ---------- Profil (partie fixe) ----------
  const C = window.FACTURE_CONFIG;
  const profilParDefaut = () => JSON.parse(JSON.stringify(C));
  let P = fusionner(profilParDefaut(), store.get("facture.profil", {}), true);

  function appliquerPolice() {
    document.documentElement.style.setProperty("--police-facture", `"${P.police || "Arial"}"`);
  }
  appliquerPolice();

  // ---------- Utilitaires ----------
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const dateLongue = (d) => `${pad(d.getDate())} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
  const aujourdhui = () => dateLongue(new Date());

  function lireDate(v) {
    const s = v.trim().toLowerCase();
    if (/^auj/.test(s)) return aujourdhui();
    if (s === "hier") return dateLongue(new Date(Date.now() - 864e5));
    let j, mo, a;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) [a, mo, j] = [m[1], m[2], m[3]];
    m = m ? null : s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
    if (m) [j, mo, a] = [m[1], m[2], m[3] || String(new Date().getFullYear())];
    if (j && +mo >= 1 && +mo <= 12) {
      if (a.length === 2) a = "20" + a;
      return `${pad(j)} ${MOIS[+mo - 1]} ${a}`;
    }
    return v.trim();
  }

  // Lit un montant : « 49,90 » (TTC par défaut), « 41,58 ht », « 49,90 ttc »,
  // ou « 8,32 tva » (montant de TVA → on en déduit le HT et le TTC).
  function lirePrix(v) {
    const s = String(v).toLowerCase();
    let n = s.replace(/[^0-9,.\-]/g, "");
    if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
    const montant = parseFloat(n);
    if (isNaN(montant) || montant < 0) return null;
    if (/\btva\b/.test(s)) return { prix: Math.round((montant / P.tauxTVA) * 100) / 100, base: "HT", tvaSaisie: montant };
    const base = /\bht\b/.test(s) ? "HT" : /\bttc\b/.test(s) ? "TTC" : P.prixSaisisEn;
    return { prix: montant, base, tvaSaisie: undefined };
  }

  const euros = (n) => window.Facture.money(n, P.devise);

  function villeDepuisCP(cp) {
    if (/^750\d\d$/.test(cp)) return "Paris";
    if (/^6900\d$/.test(cp)) return "Lyon";
    if (/^130(0\d|1[0-6])$/.test(cp)) return "Marseille";
    return "";
  }

  const nomComplet = (d) => [d.client?.prenom, d.client?.nom].filter(Boolean).join(" ");

  function referenceAleatoire() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    const r = new Uint32Array(16);
    crypto.getRandomValues(r);
    return Array.from(r, (x) => a[x % a.length]).join("");
  }

  const compteur = () => store.get("facture.compteur", 0);
  const prochainNumero = () => P.prefixeFacture + pad(compteur() + 1, P.chiffresFacture);

  const get = (o, chemin) => chemin.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
  function set(o, chemin, v) {
    const ks = chemin.split(".");
    let x = o;
    ks.slice(0, -1).forEach((k) => (x = x[k] = x[k] && typeof x[k] === "object" ? x[k] : {}));
    x[ks[ks.length - 1]] = v;
  }

  // garderVides : un champ volontairement vidé (ex : pas de ligne de contact) reste vide
  function fusionner(cible, source, garderVides = false) {
    for (const [k, v] of Object.entries(source || {})) {
      if (v == null || (v === "" && !garderVides)) continue;
      if (Array.isArray(v)) cible[k] = v;
      else if (typeof v === "object")
        fusionner((cible[k] = cible[k] && typeof cible[k] === "object" ? cible[k] : {}), v, garderVides);
      else cible[k] = v;
    }
    return cible;
  }

  // ---------- Données de la facture (partie qui change) ----------
  const vide = () => ({
    client: {},
    facturation: { pays: "FR" },
    societe: {},
    commercialeIdentique: null,
    commerciale: { pays: "FR" },
    livraisonIdentique: null,
    livraison: { pays: "FR" },
    commande: {},
    facture: { referencePaiement: referenceAleatoire() },
    articles: [{}],
    fraisLivraison: null,
  });

  let data = store.get("facture.brouillon", null) || vide();
  let pos = 0;
  let historique = [];
  let preRempli = false;

  // ---------- Liste des questions ----------
  const q = (chemin, question, opts = {}) => ({
    id: chemin,
    question,
    valeur: (d) => get(d, chemin),
    appliquer: (d, v) => set(d, chemin, v),
    ...opts,
  });

  const ouiNon = (id, question, lire, ecrire, defaut = "Oui") => ({
    id,
    question,
    choix: ["Oui", "Non"],
    valeur: (d) => (lire(d) == null ? "" : lire(d) ? "Oui" : "Non"),
    defaut: () => defaut,
    valider: (v) => (/^(o|oui|n|non)$/i.test(v) ? "" : "Réponds Oui ou Non."),
    appliquer: (d, v) => ecrire(d, /^o/i.test(v)),
  });

  const questionsAdresse = (racine, titre) => [
    q(`${racine}.adresse`, `${titre} : numéro et rue ?`),
    q(`${racine}.complement`, `${titre} : complément (bâtiment, étage…) ? (facultatif)`, { optionnel: true }),
    q(`${racine}.cp`, `${titre} : code postal / arrondissement ? (ex : 13001)`),
    q(`${racine}.ville`, `${titre} : ville ?`, { defaut: (d) => villeDepuisCP(get(d, `${racine}.cp`) || "") }),
    q(`${racine}.pays`, `${titre} : pays ?`, { defaut: () => "FR" }),
  ];

  function etapes(d) {
    const liste = [
      q("client.prenom", "Prénom du client ?"),
      q("client.nom", "Nom du client ?"),
      ...questionsAdresse("facturation", "Adresse du client"),
      q("societe.nom", "Nom de la société du client, pour l'« Adresse commerciale » ? (facultatif — « - » si c'est un particulier)", {
        optionnel: true,
      }),
    ];

    if (d.societe?.nom) {
      liste.push(
        q("societe.tva", "N° de TVA de la société du client ? (facultatif)", { optionnel: true }),
        ouiNon(
          "commercialeIdentique",
          "L'adresse commerciale est-elle la même que l'adresse du client ?",
          (d) => d.commercialeIdentique,
          (d, b) => (d.commercialeIdentique = b)
        )
      );
      if (d.commercialeIdentique === false) liste.push(...questionsAdresse("commerciale", "Adresse commerciale"));
    }

    liste.push(
      ouiNon(
        "livraisonIdentique",
        "L'adresse de livraison est-elle la même que l'adresse du client ?",
        (d) => d.livraisonIdentique,
        (d, b) => (d.livraisonIdentique = b)
      )
    );
    if (d.livraisonIdentique === false) {
      liste.push(
        q("livraison.nom", "Nom du destinataire de la livraison ?", { defaut: nomComplet }),
        ...questionsAdresse("livraison", "Adresse de livraison")
      );
    }

    liste.push(
      q("commande.numero", "Numéro de la commande ?"),
      q("commande.date", "Date de la commande ?", { choix: ["Aujourd'hui", "Hier"], defaut: aujourdhui, transformer: lireDate }),
      q("commande.par", "Commandé par ?", { defaut: nomComplet }),
      q("facture.numero", "Numéro de la facture ?", { defaut: prochainNumero }),
      q("facture.date", "Date de la facture / de la livraison ?", { choix: ["Aujourd'hui"], defaut: aujourdhui, transformer: lireDate }),
      q("facture.referencePaiement", "Référence de paiement ?", {
        choix: ["Nouvelle référence au hasard"],
        defaut: () => referenceAleatoire(),
        transformer: (v) => (/^nouvelle r/i.test(v) ? referenceAleatoire() : v),
      })
    );

    liste.push({
      id: "nbArticles",
      question: "Combien de produits différents sur cette facture ?",
      choix: ["1", "2", "3", "4", "5"],
      valeur: (d) => (d.articles?.some((a) => a.description) ? String(d.articles.length) : ""),
      defaut: () => "1",
      valider: (v) => (/^\d+$/.test(v.trim()) && +v >= 1 && +v <= 50 ? "" : "Mets un nombre entre 1 et 50."),
      appliquer: (d, v) => {
        const n = parseInt(v, 10);
        while (d.articles.length < n) d.articles.push({});
        d.articles.length = n;
      },
      apres: (d) => (d.articles.length > 1 ? `OK, je prépare ${d.articles.length} lignes. On les remplit une par une.` : ""),
    });

    const articles = d.articles && d.articles.length ? d.articles : [{}];
    articles.forEach((_, i) => {
      const n = articles.length > 1 ? ` ${i + 1}/${articles.length}` : "";
      liste.push(
        q(`articles.${i}.description`, `Produit${n} : nom / description ?`),
        q(`articles.${i}.reference`, `Produit${n} : référence (${P.libelleReference}) ? (facultatif)`, { optionnel: true }),
        q(`articles.${i}.quantite`, `Produit${n} : quantité ?`, {
          defaut: () => "1",
          valider: (v) => (/^\d+([.,]\d+)?$/.test(String(v).trim()) && parseFloat(String(v).replace(",", ".")) > 0 ? "" : "Mets un nombre (ex : 1)."),
          transformer: (v) => parseFloat(String(v).replace(",", ".")),
        }),
        {
          id: `articles.${i}.prix`,
          question:
            `Produit${n} : prix unitaire ? Tape le montant suivi de « ttc », « ht » ou « tva » ` +
            `(ex : 3468,67 ttc · 2890,56 ht · 578,11 tva). Sans précision = ${P.prixSaisisEn}.`,
          valeur: (d) => {
            const a = d.articles?.[i];
            if (!a || a.prix == null) return "";
            const virgule = (x) => String(x).replace(".", ",");
            return a.tvaSaisie != null ? `${virgule(a.tvaSaisie)} tva` : `${virgule(a.prix)} ${(a.base || P.prixSaisisEn).toLowerCase()}`;
          },
          valider: (v) => (lirePrix(v) ? "" : "Je n'ai pas compris le montant (ex : 49,90 ttc, 41,58 ht ou 8,32 tva)."),
          appliquer: (d, v) => Object.assign(d.articles[i], lirePrix(v)),
          apres: (d) => {
            const l = window.Facture.calculer(d, P).lignes[i];
            if (!l) return "";
            const unite = l.quantite !== 1 ? ` (pour ${l.quantite})` : "";
            return `= HT ${euros(l.totalHT)} · TVA ${euros(l.totalTVA)} · TTC ${euros(l.totalTTC)}${unite}`;
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
        appliquer: (d, v) => {
          if (/^gratuit$/i.test(v.trim())) return (d.fraisLivraison = 0);
          const p = lirePrix(v);
          d.fraisLivraison = p.base === "HT" ? Math.round(p.prix * (1 + P.tauxTVA) * 100) / 100 : p.prix;
        },
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

  function rafraichir(forcer) {
    if (forcer || feuille.getAttribute("contenteditable") !== "true") feuille.innerHTML = window.Facture.rendre(data, P);
    store.set("facture.brouillon", data);
    ajusterApercu();
  }

  function valeurProposee(etape) {
    const v = etape.valeur(data);
    if (v != null && String(v).trim() !== "") return String(v);
    return etape.defaut ? etape.defaut(data) || "" : "";
  }

  function poser() {
    const etape = etapes(data)[pos];
    zoneSuggestions.innerHTML = "";
    $("#btn-retour").disabled = historique.length === 0;

    if (etape.fin) {
      const t = window.Facture.calculer(data, P);
      const m = (n) => window.Facture.money(n, P.devise);
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
    bulle(etape.question, "ia", valeurProposee(etape));
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
    if (err) return bulle(err, "erreur");
    bulle(affiche === "-" ? "(vide)" : affiche, "moi");
    const info = etape.apres && etape.apres(data);
    if (info) bulle(info, "ia");
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
    // Mémorise le compteur de factures
    const num = data.facture?.numero || "";
    if (num.startsWith(P.prefixeFacture)) {
      const v = parseInt(num.slice(P.prefixeFacture.length), 10);
      if (!isNaN(v)) store.set("facture.compteur", Math.max(v, compteur()));
    }
    const titre = document.title;
    document.title = `Facture ${num}`.trim();
    window.print();
    setTimeout(() => (document.title = titre), 500);
  }

  // ---------- Fichiers ----------
  const lireFichier = (f) =>
    new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => ko(new Error("Impossible de lire le fichier."));
      r.readAsDataURL(f);
    });

  // Réduit une image (logo) pour qu'elle tienne dans le stockage du navigateur.
  async function preparerLogo(f) {
    const url = await lireFichier(f);
    if (f.type === "image/svg+xml") return url;
    const img = new Image();
    await new Promise((ok, ko) => ((img.onload = ok), (img.onerror = () => ko(new Error("Image illisible.")), (img.src = url))));
    const max = 900;
    const e = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * e);
    c.height = Math.round(img.height * e);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }

  async function fichierPourIA(input) {
    const f = input.files[0];
    if (!f) return null;
    if (f.size > 3 * 1024 * 1024) throw new Error("Fichier trop lourd (3 Mo maximum).");
    return { nom: f.name, type: f.type, contenu: await lireFichier(f) };
  }

  async function appelIA(url, corps) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.erreur || `Erreur ${r.status}`);
    return json;
  }

  // ---------- Pré-remplir une facture avec l'IA (partie qui change uniquement) ----------
  async function remplirIA() {
    const btn = $("#btn-ia-go");
    const erreur = $("#erreur-ia");
    erreur.hidden = true;
    btn.disabled = true;
    btn.textContent = "Analyse en cours…";
    try {
      const texte = $("#texte-ia").value.trim();
      const fichier = await fichierPourIA($("#fichier-ia"));
      if (!texte && !fichier) throw new Error("Colle un texte ou joins un fichier.");
      const { facture: extrait = {} } = await appelIA("/api/extract", { texte, fichier });

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
        "J'ai pré-rempli la facture avec ce que j'ai trouvé (ton logo et ton entreprise ne changent pas). Je te repose les questions une par une : Entrée pour valider, ou tape la bonne valeur.",
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

  // ---------- Fenêtre « Mon entreprise » ----------
  const champsProfil = {
    "p-couleur": "couleur",
    "p-nom": "vendeur.nom",
    "p-adresse": "vendeur.adresse",
    "p-cp": "vendeur.cp",
    "p-ville": "vendeur.ville",
    "p-pays": "vendeur.pays",
    "p-tva": "vendeur.tva",
    "p-contact": "contact",
    "p-mentions": "mentions",
    "p-pied": "piedDePage",
    "p-prefixe": "prefixeFacture",
    "p-libref": "libelleReference",
    "p-prix": "prixSaisisEn",
  };
  let logoBrouillon = null;

  function remplirFormProfil(src) {
    for (const [id, chemin] of Object.entries(champsProfil)) $("#" + id).value = get(src, chemin) ?? "";
    $("#p-prochain").value = compteur() + 1;
    logoBrouillon = src.logo || "";
    $("#apercu-logo").src = logoBrouillon;
  }

  function ouvrirProfil() {
    remplirFormProfil(P);
    $("#erreur-profil").hidden = true;
    $("#etat-profil").textContent = "";
    $("#fichier-profil").value = "";
    $("#dlg-profil").showModal();
  }

  function enregistrerProfil() {
    const nouveau = { logo: logoBrouillon };
    for (const [id, chemin] of Object.entries(champsProfil)) set(nouveau, chemin, $("#" + id).value.trim());
    if (!store.set("facture.profil", nouveau)) {
      $("#erreur-profil").textContent = "Impossible d'enregistrer (logo trop lourd ou stockage bloqué par le navigateur).";
      $("#erreur-profil").hidden = false;
      return;
    }
    const prochain = parseInt($("#p-prochain").value, 10);
    if (prochain >= 1) store.set("facture.compteur", prochain - 1);
    P = fusionner(profilParDefaut(), nouveau, true);
    $("#dlg-profil").close();
    rafraichir(true);
    bulle("Infos de ton entreprise enregistrées ✔", "moi");
  }

  async function importerProfil() {
    const etat = $("#etat-profil");
    const erreur = $("#erreur-profil");
    erreur.hidden = true;
    try {
      const fichier = await fichierPourIA($("#fichier-profil"));
      if (!fichier) return;
      etat.textContent = "⏳ L'IA lit ta facture…";
      const { profil } = await appelIA("/api/profil", { fichier });
      const actuel = {};
      for (const [id, chemin] of Object.entries(champsProfil)) set(actuel, chemin, $("#" + id).value);
      actuel.logo = logoBrouillon;
      remplirFormProfil(fusionner(actuel, profil));
      etat.textContent = "✔ Champs remplis depuis ta facture — vérifie, ajoute ton logo, puis Enregistrer.";
    } catch (e) {
      etat.textContent = "";
      erreur.textContent = e.message || "Erreur inconnue";
      erreur.hidden = false;
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
    $("#fichier-ia").value = "";
    $("#fichier-ia").parentElement.classList.remove("choisi");
    $("#dlg-ia").showModal();
    $("#texte-ia").focus();
  });
  $("#fichier-ia").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.parentElement.classList.toggle("choisi", !!f);
    e.target.parentElement.firstChild.textContent = f ? `📎 ${f.name} ` : "📎 Joindre une capture ou un PDF (facultatif)";
  });
  $("#btn-ia-go").addEventListener("click", (e) => {
    e.preventDefault();
    remplirIA();
  });

  $("#btn-profil").addEventListener("click", ouvrirProfil);
  $("#btn-profil-ok").addEventListener("click", (e) => {
    e.preventDefault();
    enregistrerProfil();
  });
  $("#btn-profil-reset").addEventListener("click", () => {
    if (confirm("Remettre les valeurs par défaut (assets/config.js) ?")) remplirFormProfil(profilParDefaut());
  });
  $("#fichier-profil").addEventListener("change", importerProfil);
  $("#p-logo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      logoBrouillon = await preparerLogo(f);
      $("#apercu-logo").src = logoBrouillon;
    } catch (err) {
      $("#erreur-profil").textContent = err.message;
      $("#erreur-profil").hidden = false;
    }
  });

  window.addEventListener("resize", ajusterApercu);
  feuille.addEventListener("load", ajusterApercu, true); // logo chargé

  // ---------- Démarrage ----------
  rafraichir();
  if (data.client && data.client.prenom) {
    bulle("J'ai repris ta facture en cours. Je te repose les questions depuis le début avec les valeurs déjà saisies (Entrée pour garder).", "ia");
    preRempli = true;
  } else {
    bulle(
      "Bonjour 👋 Je vais te poser les questions une par une pour remplir la facture. L'aperçu se met à jour en direct.\n\nPremière fois ? Clique d'abord sur « ⚙ Mon entreprise » pour mettre ton logo et tes infos.",
      "ia"
    );
  }
  poser();
})();
