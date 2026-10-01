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

  function lireBudget(v) {
    const s = String(v).toLowerCase();
    let n = s.replace(/[^0-9,.]/g, "");
    if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
    const montant = parseFloat(n);
    if (isNaN(montant) || montant <= 0) return null;
    const type = /\btva\b/.test(s) ? "TVA" : /\bht\b/.test(s) ? "HT" : "TTC";
    return { montant: Math.round(montant * 100) / 100, type };
  }

  // Calcule les prix des produits pour que la facture tombe pile sur le budget.
  // - Les produits « auto » se partagent ce qui reste après les produits à prix fixé.
  // - S'il n'y a aucun produit « auto », tous les prix sont ajustés en gardant leurs proportions.
  function repartirBudget(d) {
    const t = P.tauxTVA;
    const b = d.budget;
    const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
    const mesure = () => {
      const tot = window.Facture.calculer(d, P);
      return b.type === "HT" ? tot.totalHT : b.type === "TVA" ? tot.totalTVA : tot.totalTTC;
    };
    const parEuroHT = b.type === "HT" ? 1 : b.type === "TVA" ? t : 1 + t;
    const qte = (a) => Number(a.quantite) || 1;
    const unitHT = (a) => (a.base === "HT" ? Number(a.prix) || 0 : (Number(a.prix) || 0) / (1 + t));

    const auto = d.articles.filter((a) => a.auto);
    const cibles = auto.length ? auto : d.articles;
    const poids = cibles.map((a) => (auto.length ? 1 : unitHT(a) * qte(a)));
    const totalPoids = poids.reduce((x, y) => x + y, 0);
    if (!totalPoids) return { erreur: "Donne au moins un prix, ou mets un produit en « auto »." };

    // Ce que coûtent déjà le reste de la facture (prix fixés + livraison)
    cibles.forEach((a) => Object.assign(a, { prix: 0, base: "HT", tvaSaisie: undefined }));
    const reste = b.montant - mesure();
    if (reste <= 0) return { erreur: "Les prix fixés et la livraison dépassent déjà le budget." };

    // Répartition, puis ajustement au centime sur les produits en plus petite quantité
    cibles.forEach((a, i) => (a.prix = r2((reste / parEuroHT) * (poids[i] / totalPoids) / qte(a))));
    const ordre = [...cibles].sort((x, y) => qte(x) - qte(y));
    for (let essai = 0; essai < 200; essai++) {
      const ecart = r2(b.montant - mesure());
      if (Math.abs(ecart) < 0.005) return { ecart: 0 };
      const a = ordre[essai % ordre.length];
      let pas = r2(ecart / parEuroHT / qte(a));
      if (pas === 0) pas = ecart > 0 ? 0.01 : -0.01;
      if (a.prix + pas > 0) a.prix = r2(a.prix + pas);
    }
    return { ecart: r2(b.montant - mesure()) };
  }

  function villeDepuisCP(cp) {
    if (/^750\d\d$/.test(cp)) return "Paris";
    if (/^6900\d$/.test(cp)) return "Lyon";
    if (/^130(0\d|1[0-6])$/.test(cp)) return "Marseille";
    return "";
  }

  const nomComplet = (d) => [d.client?.prenom, d.client?.nom].filter(Boolean).join(" ");

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
    facture: {},
    articles: [{}],
    fraisLivraison: null,
    budget: null, // { montant, type: "TTC" | "HT" | "TVA" } — budget donné par le client
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
    const liste = [];
    const clients = listeClients();
    if (clients.length && !d.sansChoixClient) liste.push(etapeChoixClient(clients));
    if (!d.clientConnu) etapesClient(d, liste);
    etapesFacture(d, liste);
    return liste;
  }

  // Le client choisit dans la liste des clients enregistrés, ou « Nouveau client »
  function etapeChoixClient(clients) {
    const trouver = (v) => {
      const t = v.trim().toLowerCase();
      return clients.find((c) => c.libelle.toLowerCase() === t) || clients.find((c) => c.libelle.toLowerCase().includes(t));
    };
    return {
      id: "choixClient",
      question: "Pour quel client ? Choisis un client enregistré, ou « Nouveau client ».",
      choix: [...clients.slice(0, 8).map((c) => c.libelle), "Nouveau client"],
      valeur: () => "",
      defaut: () => "Nouveau client",
      valider: (v) => (/^nouveau/i.test(v.trim()) || trouver(v) ? "" : "Je ne trouve pas ce client. Clique sur un nom ou sur « Nouveau client »."),
      appliquer: (d, v) => {
        const c = /^nouveau/i.test(v.trim()) ? null : trouver(v);
        if (c) Object.assign(d, JSON.parse(JSON.stringify(c.infos)), { clientConnu: true });
      },
      apres: (d) => (d.clientConnu ? `👤 ${libelleClient(d)} : adresses reprises. On passe à la commande.` : ""),
    };
  }

  function etapesClient(d, liste) {
    liste.push(
      q("client.prenom", "Prénom du client ?"),
      q("client.nom", "Nom du client ?"),
      ...questionsAdresse("facturation", "Adresse du client"),
      q("societe.nom", "Nom de la société du client, pour l'« Adresse commerciale » ? (facultatif — « - » si c'est un particulier)", {
        optionnel: true,
      })
    );

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
  }

  function etapesFacture(d, liste) {
    liste.push(
      q("commande.numero", "Numéro de la commande ?"),
      q("commande.date", "Date de la commande ?", { choix: ["Aujourd'hui", "Hier"], defaut: aujourdhui, transformer: lireDate }),
      q("commande.par", "Commandé par ?", { defaut: nomComplet }),
      q("facture.numero", "Numéro de la facture ?", { defaut: prochainNumero }),
      q("facture.date", "Date de la facture / de la livraison ?", { choix: ["Aujourd'hui"], defaut: aujourdhui, transformer: lireDate }),
      q("facture.referencePaiement", "Référence du paiement reçu (n° de virement, de transaction carte…) ? (facultatif — « - » si aucune)", {
        optionnel: true,
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

    liste.push({
      id: "budget",
      question:
        "Le client t'a donné un budget à respecter ? Tape-le suivi de « ttc », « ht » ou « tva » " +
        "(ex : 3468,67 ttc · 2890,56 ht · 578,11 tva). « - » si tu mets les prix toi-même.",
      optionnel: true,
      valeur: (d) => (d.budget ? `${String(d.budget.montant).replace(".", ",")} ${d.budget.type.toLowerCase()}` : ""),
      valider: (v) => (lireBudget(v) ? "" : "Je n'ai pas compris le budget (ex : 3468,67 ttc)."),
      appliquer: (d, v) => {
        d.budget = v ? lireBudget(v) : null;
        if (!d.budget) d.articles.forEach((a) => delete a.auto);
      },
      apres: (d) =>
        d.budget
          ? `Budget : ${euros(d.budget.montant)} ${d.budget.type}. Pour chaque produit, donne son prix si tu veux le fixer, ou « auto » : je calculerai les prix « auto » pour tomber pile sur le budget.`
          : "",
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
          question: d.budget
            ? `Produit${n} : prix unitaire ? « auto » = calculé avec le budget, ou tape un prix pour le fixer (ex : 49,90 ttc).`
            : `Produit${n} : prix unitaire ? Tape le montant suivi de « ttc », « ht » ou « tva » ` +
              `(ex : 3468,67 ttc · 2890,56 ht · 578,11 tva). Sans précision = ${P.prixSaisisEn}.`,
          choix: d.budget ? ["auto"] : undefined,
          defaut: (d) => (d.budget ? "auto" : ""),
          valeur: (d) => {
            const a = d.articles?.[i];
            if (a?.auto) return "auto";
            if (!a || a.prix == null) return "";
            const virgule = (x) => String(x).replace(".", ",");
            return a.tvaSaisie != null ? `${virgule(a.tvaSaisie)} tva` : `${virgule(a.prix)} ${(a.base || P.prixSaisisEn).toLowerCase()}`;
          },
          valider: (v) =>
            (d.budget && /^auto$/i.test(v.trim())) || lirePrix(v) ? "" : "Je n'ai pas compris le montant (ex : 49,90 ttc, 41,58 ht ou 8,32 tva).",
          appliquer: (d, v) => {
            const a = d.articles[i];
            if (d.budget && /^auto$/i.test(v.trim())) {
              a.auto = true;
              delete a.prix;
              delete a.tvaSaisie;
            } else Object.assign(a, lirePrix(v), { auto: false });
          },
          apres: (d) => {
            if (d.articles[i]?.auto) return "";
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
      }
    );

    if (d.budget) {
      liste.push({
        id: "repartition",
        question: `Je calcule les prix pour arriver pile à ${euros(d.budget.montant)} ${d.budget.type} ?`,
        choix: ["Oui", "Non"],
        valeur: () => "",
        defaut: () => "Oui",
        valider: (v) => (/^(o|oui|n|non)$/i.test(v) ? "" : "Réponds Oui ou Non."),
        appliquer: (d, v) => {
          d._repartition = /^o/i.test(v) ? repartirBudget(d) : null;
        },
        apres: (d) => {
          const r = d._repartition;
          delete d._repartition;
          if (!r) return "";
          if (r.erreur) return `⚠ ${r.erreur}`;
          const t = window.Facture.calculer(d, P);
          const detail = t.lignes
            .map((l) => `• ${l.description} : ${l.quantite} × ${euros(l.unitTTC)} TTC (${euros(l.unitHT)} HT)`)
            .join("\n");
          const bilan = `Total HT ${euros(t.totalHT)} · TVA ${euros(t.totalTVA)} · TTC ${euros(t.totalTTC)}`;
          return r.ecart
            ? `${detail}\n\n${bilan}\n⚠ Écart de ${euros(r.ecart)} : avec ces quantités on ne peut pas tomber au centime près. Mets un des produits en quantité 1 (bouton ↩) pour un total exact.`
            : `${detail}\n\n✔ Budget respecté au centime : ${bilan}\nTu peux changer un prix avec ↩ si besoin.`;
        },
      });
    }

    liste.push({ id: "fin", fin: true });
  }

  // ---------- Clients enregistrés ----------
  const CHAMPS_CLIENT = ["client", "facturation", "societe", "commercialeIdentique", "commerciale", "livraisonIdentique", "livraison"];
  const listeClients = () => store.get("facture.clients", []);
  const libelleClient = (d) => [nomComplet(d), d.societe?.nom].filter(Boolean).join(" — ");
  const cleClient = (d) => libelleClient(d).toLowerCase();

  function infosClient(d) {
    const infos = {};
    for (const k of CHAMPS_CLIENT) infos[k] = JSON.parse(JSON.stringify(d[k] ?? null));
    return infos;
  }

  // Enregistre (ou met à jour) le client de la facture, en tête de liste.
  function enregistrerClient(d) {
    if (!nomComplet(d)) return false;
    const autres = listeClients().filter((c) => c.cle !== cleClient(d));
    const c = { cle: cleClient(d), libelle: libelleClient(d), infos: infosClient(d), maj: Date.now() };
    return store.set("facture.clients", [c, ...autres].slice(0, 300));
  }

  function supprimerClient(cle) {
    store.set("facture.clients", listeClients().filter((c) => c.cle !== cle));
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
      if (enregistrerClient(data)) bulle(`👤 Client enregistré : ${libelleClient(data)}`, "ia");
      ajouterPuce("Nouvelle facture pour le même client", () => nouvelle(infosClient(data)));
      ajouterPuce("Nouvelle facture", () => nouvelle());
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

  // infos : client à reprendre (facture pour le même client), sinon facture vierge
  function nouvelle(infos) {
    data = vide();
    if (infos) Object.assign(data, JSON.parse(JSON.stringify(infos)), { clientConnu: true, sansChoixClient: true });
    pos = 0;
    historique = [];
    preRempli = false;
    feuille.removeAttribute("contenteditable");
    fil.innerHTML = "";
    rafraichir();
    bulle(
      infos
        ? `Nouvelle facture pour ${libelleClient(data)} : ses adresses sont déjà remplies. On passe directement à la commande et aux produits.`
        : "Nouvelle facture. Réponds aux questions une par une, l'aperçu se met à jour en direct.",
      "ia"
    );
    poser();
  }

  function chargerScript(src) {
    return new Promise((ok, ko) => {
      if (document.querySelector(`script[src="${src}"]`)) return ok();
      const sc = document.createElement("script");
      sc.src = src;
      sc.onload = ok;
      sc.onerror = () => ko(new Error("Impossible de charger le générateur de PDF."));
      document.head.appendChild(sc);
    });
  }

  // Télécharge directement la facture en fichier PDF (sans passer par l'imprimante).
  async function telechargerPDF() {
    // Mémorise le compteur de factures
    const num = data.facture?.numero || "";
    if (num.startsWith(P.prefixeFacture)) {
      const v = parseInt(num.slice(P.prefixeFacture.length), 10);
      if (!isNaN(v)) store.set("facture.compteur", Math.max(v, compteur()));
    }

    const btn = $("#btn-pdf");
    const texte = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Création du PDF…";
    // Copie de la facture, à taille réelle, hors de l'écran (garde les corrections faites à la main)
    const zone = document.createElement("div");
    zone.style.cssText = "position:fixed;left:-10000px;top:0;";
    const page = document.createElement("div");
    page.className = "page-a4 pour-pdf";
    page.innerHTML = feuille.innerHTML;
    zone.appendChild(page);
    document.body.appendChild(zone);
    try {
      await chargerScript("assets/vendor/html2pdf.bundle.min.js");
      await Promise.all(
        [...page.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((ok) => (img.onload = img.onerror = ok))))
      );
      const nomFichier = `Facture ${num}`.trim().replace(/[\\/:*?"<>|]/g, "-") + ".pdf";
      const travail = window
        .html2pdf()
        .set({
          margin: 0,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css"] },
        })
        .from(page)
        .toPdf();
      const pdf = await travail.get("pdf");

      // Si la facture dépasse un peu la page (beaucoup de produits), on la réduit pour qu'elle tienne sur 1 page.
      const hauteurA4 = (297 * 96) / 25.4;
      const hauteur = page.scrollHeight;
      if (hauteur <= hauteurA4 * 1.3) {
        while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages());
        if (hauteur > hauteurA4 + 1) {
          const canvas = await travail.get("canvas");
          const largeur = 210 * (hauteurA4 / hauteur);
          pdf.setPage(1);
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, 210, 297, "F");
          pdf.addImage(canvas.toDataURL("image/jpeg", 0.98), "JPEG", (210 - largeur) / 2, 0, largeur, 297);
        }
      }
      pdf.save(nomFichier);
    } catch (e) {
      bulle(`${e.message || "Erreur PDF"} — j'ouvre l'impression à la place : choisis « Enregistrer au format PDF ».`, "erreur");
      window.print();
    } finally {
      zone.remove();
      btn.disabled = false;
      btn.textContent = texte;
    }
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
    return (await rognerImage(c.toDataURL("image/png"))).src;
  }

  // Enlève le blanc / transparent autour d'une image (souvent la raison d'un logo qui paraît tout petit).
  async function rognerImage(src) {
    const img = new Image();
    await new Promise((ok, ko) => ((img.onload = ok), (img.onerror = () => ko(new Error("Logo illisible."))), (img.src = src)));
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return { src, rogne: false };
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const blanc = px[i] > 242 && px[i + 1] > 242 && px[i + 2] > 242;
        if (px[i + 3] > 16 && !blanc) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return { src, rogne: false };
    x0 = Math.max(0, x0 - 2);
    y0 = Math.max(0, y0 - 2);
    x1 = Math.min(w - 1, x1 + 2);
    y1 = Math.min(h - 1, y1 + 2);
    if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return { src, rogne: false };
    const o = document.createElement("canvas");
    o.width = x1 - x0 + 1;
    o.height = y1 - y0 + 1;
    o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return { src: o.toDataURL("image/png"), rogne: true };
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

  // Enregistre seulement les réglages donnés, sans toucher au reste du profil.
  function sauverProfil(modifs) {
    const nouveau = Object.assign(store.get("facture.profil", {}), modifs);
    const ok = store.set("facture.profil", nouveau);
    P = fusionner(profilParDefaut(), nouveau, true);
    return ok;
  }

  function enregistrerProfil() {
    const nouveau = { ...store.get("facture.profil", {}), logo: logoBrouillon };
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

  // ---------- Sauvegarde / restauration des réglages dans un fichier ----------
  function telechargerReglages() {
    const contenu = { version: 2, profil: store.get("facture.profil", {}), compteur: compteur(), clients: listeClients() };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(contenu, null, 2)], { type: "application/json" }));
    a.download = "reglages-factures.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restaurerReglages(f) {
    const erreur = $("#erreur-profil");
    erreur.hidden = true;
    try {
      let json;
      try {
        json = JSON.parse(await f.text());
      } catch {
        json = null;
      }
      if (!json || typeof json.profil !== "object") throw new Error("Ce fichier n'est pas un fichier de réglages.");
      if (!store.set("facture.profil", json.profil)) throw new Error("Impossible d'enregistrer dans ce navigateur.");
      if (Number.isInteger(json.compteur)) store.set("facture.compteur", json.compteur);
      if (Array.isArray(json.clients)) store.set("facture.clients", json.clients);
      P = fusionner(profilParDefaut(), json.profil, true);
      remplirFormProfil(P);
      rafraichir(true);
      $("#etat-profil").textContent = "✔ Réglages restaurés.";
    } catch (e) {
      erreur.textContent = e.message;
      erreur.hidden = false;
    }
  }

  // ---------- Fenêtre « Mes clients » ----------
  function afficherClients() {
    const ul = $("#liste-clients");
    const t = $("#recherche-client").value.trim().toLowerCase();
    const clients = listeClients().filter((c) => !t || c.libelle.toLowerCase().includes(t));
    ul.innerHTML = "";
    if (!clients.length) {
      const li = document.createElement("li");
      li.className = "vide";
      li.textContent = t ? "Aucun client trouvé." : "Aucun client pour l'instant : ils s'enregistrent tout seuls à la fin de chaque facture.";
      return ul.appendChild(li);
    }
    for (const c of clients) {
      const f = c.infos.facturation || {};
      const li = document.createElement("li");
      const infos = document.createElement("div");
      infos.className = "infos";
      const nom = document.createElement("strong");
      nom.textContent = c.libelle;
      const adr = document.createElement("span");
      adr.textContent = [f.adresse, [f.cp, f.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      infos.append(nom, adr);
      const facturer = document.createElement("button");
      facturer.type = "button";
      facturer.className = "btn btn-principal";
      facturer.textContent = "Nouvelle facture";
      facturer.onclick = () => {
        $("#dlg-clients").close();
        nouvelle(c.infos);
      };
      const suppr = document.createElement("button");
      suppr.type = "button";
      suppr.className = "btn btn-secondaire";
      suppr.textContent = "Supprimer";
      suppr.onclick = () => {
        if (confirm(`Supprimer ${c.libelle} de tes clients ?`)) {
          supprimerClient(c.cle);
          afficherClients();
        }
      };
      li.append(infos, facturer, suppr);
      ul.appendChild(li);
    }
  }

  // ---------- Panneau « Ajuster le logo » ----------
  const reglagesLogo = [
    ["r-taille", "logoTaille", "v-taille", 5, 60],
    ["r-x", "logoX", "v-x", -10, 140],
    ["r-y", "logoY", "v-y", -8, 40],
  ];
  let minuterieLogo;

  function afficherReglagesLogo() {
    for (const [r, cle, v] of reglagesLogo) {
      const n = Number(P[cle]) || 0;
      $("#" + r).value = n;
      $("#" + v).textContent = `${n.toLocaleString("fr-FR")} mm`;
    }
  }

  function changerLogo(modifs) {
    for (const [, cle, , min, max] of reglagesLogo) {
      if (cle in modifs) P[cle] = Math.min(max, Math.max(min, Math.round(Number(modifs[cle]) * 2) / 2));
    }
    const f = feuille.querySelector(".facture");
    if (f) {
      f.style.setProperty("--logo-h", `${P.logoTaille}mm`);
      f.style.setProperty("--logo-x", `${P.logoX}mm`);
      f.style.setProperty("--logo-y", `${P.logoY}mm`);
    }
    afficherReglagesLogo();
    ajusterApercu();
    clearTimeout(minuterieLogo);
    minuterieLogo = setTimeout(() => sauverProfil({ logoTaille: P.logoTaille, logoX: P.logoX, logoY: P.logoY }), 200);
  }

  function ouvrirPanneauLogo() {
    afficherReglagesLogo();
    $("#etat-logo").textContent = "";
    $("#panneau-logo").hidden = false;
    document.body.classList.add("reglage-logo");
  }

  function fermerPanneauLogo() {
    $("#panneau-logo").hidden = true;
    document.body.classList.remove("reglage-logo");
  }

  // Glisser le logo directement sur la facture
  let glisse = null;
  feuille.addEventListener("pointerdown", (e) => {
    if (!document.body.classList.contains("reglage-logo") || !e.target.classList.contains("f-logo")) return;
    e.preventDefault();
    const echelle = feuille.getBoundingClientRect().width / feuille.offsetWidth;
    glisse = { x: e.clientX, y: e.clientY, lx: Number(P.logoX) || 0, ly: Number(P.logoY) || 0, pxParMm: (96 / 25.4) * echelle };
    e.target.setPointerCapture(e.pointerId);
  });
  feuille.addEventListener("pointermove", (e) => {
    if (!glisse) return;
    changerLogo({
      logoX: glisse.lx + (e.clientX - glisse.x) / glisse.pxParMm,
      logoY: glisse.ly + (e.clientY - glisse.y) / glisse.pxParMm,
    });
  });
  ["pointerup", "pointercancel"].forEach((t) => feuille.addEventListener(t, () => (glisse = null)));

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

  $("#btn-clients").addEventListener("click", () => {
    $("#recherche-client").value = "";
    afficherClients();
    $("#dlg-clients").showModal();
  });
  $("#recherche-client").addEventListener("input", afficherClients);

  $("#btn-sauver").addEventListener("click", telechargerReglages);
  $("#fichier-reglages").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) restaurerReglages(f);
  });

  $("#btn-logo").addEventListener("click", () => ($("#panneau-logo").hidden ? ouvrirPanneauLogo() : fermerPanneauLogo()));
  $("#btn-logo-fermer").addEventListener("click", fermerPanneauLogo);
  for (const [r, cle] of reglagesLogo) $("#" + r).addEventListener("input", (e) => changerLogo({ [cle]: e.target.value }));
  $("#btn-logo-reset").addEventListener("click", () =>
    changerLogo({ logoTaille: C.logoTaille ?? 15, logoX: C.logoX ?? 0, logoY: C.logoY ?? 0 })
  );
  $("#btn-logo-rogner").addEventListener("click", async () => {
    const etat = $("#etat-logo");
    if (!P.logo) return (etat.textContent = "Aucun logo : ajoute-le dans « ⚙ Mon entreprise ».");
    if (/^data:image\/svg|\.svg$/i.test(P.logo)) return (etat.textContent = "Logo SVG : pas besoin de rogner, utilise juste la taille.");
    try {
      const { src, rogne } = await rognerImage(P.logo);
      if (!rogne) return (etat.textContent = "Il n'y a pas de marge vide à enlever.");
      if (!sauverProfil({ logo: src })) return (etat.textContent = "Impossible d'enregistrer dans ce navigateur.");
      rafraichir(true);
      etat.textContent = "✔ Marges vides enlevées : le logo prend maintenant toute la place.";
    } catch (e) {
      etat.textContent = e.message;
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
