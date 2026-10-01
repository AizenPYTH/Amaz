// ============================================================
//  ASSISTANT : pose les questions une par une et remplit la facture
//
//  Deux parties bien séparées :
//   - profil : la partie FIXE (logo, ton entreprise, mentions…) → « ⚙ Mon entreprise »
//   - data   : la partie qui CHANGE à chaque facture → les questions
// ============================================================

(async function () {
  const $ = (s) => document.querySelector(s);
  const Synchro = window.Synchro;
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
        if (Synchro.CLES.includes(k)) Synchro.planifierEnvoi();
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

  // ---------- Synchronisation : récupère la dernière version en ligne avant de démarrer ----------
  if (Synchro.actif()) await Synchro.tirer();

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

  // Budget max donné par le client pour un lot de factures : « 3468,67 ttc » ou « 2890,56 ht ».
  // C'est un plafond de CONTRÔLE : on compare les ventes réelles, on ne fabrique jamais de prix.
  function lireBudget(v, typeParDefaut = "TTC") {
    const s = String(v).toLowerCase();
    let n = s.replace(/[^0-9,.]/g, "");
    if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
    const montant = parseFloat(n);
    if (isNaN(montant) || montant <= 0) return null;
    const type = /\bht\b/.test(s) ? "HT" : /\bttc\b/.test(s) ? "TTC" : typeParDefaut;
    return { montant: Math.round(montant * 100) / 100, type };
  }

  function villeDepuisCP(cp) {
    if (/^750\d\d$/.test(cp)) return "Paris";
    if (/^6900\d$/.test(cp)) return "Lyon";
    if (/^130(0\d|1[0-6])$/.test(cp)) return "Marseille";
    return "";
  }

  const nomComplet = (d) => [d.client?.prenom, d.client?.nom].filter(Boolean).join(" ");

  // ---------- Numérotation : unique, continue, attribuée seulement à la validation ----------
  const compteur = () => store.get("facture.compteur", 0);
  const formatNumero = (n) => P.prefixeFacture + pad(n, P.chiffresFacture);
  function numeroSuivant() {
    const pris = new Set(listeFactures().filter((f) => f.numero).map((f) => f.numero));
    let n = compteur() + 1;
    while (pris.has(formatNumero(n))) n++;
    return { n, numero: formatNumero(n) };
  }

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
  });

  // ---------- Factures et lots enregistrés ----------
  //  facture : { id, statut: "brouillon" | "validee", numero, lotId, creee, maj, valideeLe, data }
  //  lot     : { id, nom, clientInfos, clientSource, budget: { montant, type } | null, creee }
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let factures = store.get("facture.factures", []);
  let lots = store.get("facture.lots", []);
  const listeFactures = () => factures;
  const sauverFactures = () => store.set("facture.factures", factures) && store.set("facture.lots", lots);
  const factureParId = (id) => factures.find((f) => f.id === id);
  const lotParId = (id) => lots.find((l) => l.id === id);
  const facturesDuLot = (lot) => factures.filter((f) => f.lotId === lot.id);

  function creerFacture(d, lotId = null) {
    const f = { id: nouvelId(), statut: "brouillon", numero: null, lotId, creee: Date.now(), maj: Date.now(), data: d };
    factures.push(f);
    return f;
  }

  // Garde la trace des brouillons/lots supprimés, pour qu'ils ne reviennent pas depuis un autre ordinateur
  function noterSuppression(ids) {
    store.set("facture.supprimees", [...store.get("facture.supprimees", []), ...ids].slice(-2000));
  }

  const estVide = (f) =>
    f.statut === "brouillon" && !nomComplet(f.data) && !f.data.commande?.numero && !(f.data.articles || []).some((a) => a.description);

  // Reprise de l'ancien format (un seul brouillon)
  (function migrer() {
    const ancien = store.get("facture.brouillon", null);
    if (ancien && !factures.length) {
      delete ancien.budget;
      if (ancien.facture) delete ancien.facture.numero;
      (ancien.articles || []).forEach((a) => delete a.auto);
      const f = creerFacture(ancien);
      store.set("facture.courante", f.id);
      sauverFactures();
    }
    store.del("facture.brouillon");
  })();

  let courante = factureParId(store.get("facture.courante", null)) || null;
  if (!courante) {
    courante = creerFacture(vide());
    sauverFactures();
  }
  let data = courante.data;
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

    const articles = d.articles && d.articles.length ? d.articles : [{}];
    articles.forEach((_, i) => {
      const n = articles.length > 1 ? ` ${i + 1}/${articles.length}` : "";
      liste.push(
        q(`articles.${i}.description`, `Produit${n} : nom / description ?`, {
          choix: produitsDejaFactures(d).map((p) => p.description),
          appliquer: (d, v) => {
            const a = d.articles[i];
            // Produit déjà facturé : on propose sa référence et son dernier prix (à confirmer ou changer)
            const p = a.description === v ? null : produitsDejaFactures(d).find((x) => x.description === v);
            a.description = v;
            if (p) {
              if (!a.reference && p.reference) a.reference = p.reference;
              if (a.prix == null && p.prix != null) Object.assign(a, { prix: p.prix, base: p.base, tvaSaisie: undefined });
            }
          },
        }),
        q(`articles.${i}.reference`, `Produit${n} : référence (${P.libelleReference}) ? (facultatif)`, { optionnel: true }),
        q(`articles.${i}.quantite`, `Produit${n} : quantité ?`, {
          defaut: () => "1",
          valider: (v) => (/^\d+([.,]\d+)?$/.test(String(v).trim()) && parseFloat(String(v).replace(",", ".")) > 0 ? "" : "Mets un nombre (ex : 1)."),
          transformer: (v) => parseFloat(String(v).replace(",", ".")),
        }),
        {
          id: `articles.${i}.prix`,
          question:
            `Produit${n} : prix unitaire réel ? Tape le montant suivi de « ttc », « ht » ou « tva » ` +
            `(ex : 49,90 ttc · 41,58 ht · 8,32 tva). Sans précision = ${P.prixSaisisEn}.`,
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
            const ligne = `= HT ${euros(l.totalHT)} · TVA ${euros(l.totalTVA)} · TTC ${euros(l.totalTTC)}${unite}`;
            const lot = lotParId(courante.lotId);
            return lot?.budget ? `${ligne}\n${texteBilanLot(lot)}` : ligne;
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

    liste.push({ id: "fin", fin: true });
  }

  // Produits déjà présents dans tes autres factures (les plus récents d'abord), pour ne pas les retaper.
  function produitsDejaFactures(d) {
    const vus = new Map();
    const deja = new Set((d.articles || []).map((a) => a.description).filter(Boolean));
    for (const f of [...factures].sort((a, b) => b.maj - a.maj)) {
      if (f.data === d) continue;
      for (const a of f.data.articles || []) {
        if (a.description && a.prix != null && !vus.has(a.description) && !deja.has(a.description)) vus.set(a.description, a);
      }
    }
    return [...vus.values()].slice(0, 6);
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

  // ---------- Lots : plusieurs factures pour un même client ----------
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  // Totaux cumulés des factures du lot et comparaison avec le budget (simple contrôle).
  function bilanLot(lot) {
    const fs = facturesDuLot(lot);
    const tot = { ht: 0, tva: 0, ttc: 0, nb: fs.length, validees: 0, completes: 0 };
    for (const f of fs) {
      const t = window.Facture.calculer(f.data, P);
      tot.ht += t.totalHT;
      tot.tva += t.totalTVA;
      tot.ttc += t.totalTTC;
      if (f.statut === "validee") tot.validees++;
      if (!manquesFacture(f).length) tot.completes++;
    }
    tot.ht = r2(tot.ht);
    tot.tva = r2(tot.tva);
    tot.ttc = r2(tot.ttc);
    if (lot.budget) {
      tot.compare = lot.budget.type === "HT" ? tot.ht : tot.ttc;
      tot.ecart = r2(lot.budget.montant - tot.compare); // > 0 : reste ; < 0 : dépassement
      tot.etat = tot.ecart < 0 ? "depasse" : tot.ecart > 0 ? "sous" : "pile";
    }
    return tot;
  }

  function texteBilanLot(lot) {
    const b = bilanLot(lot);
    const base = `Lot (${b.nb} factures) : HT ${euros(b.ht)} · TVA ${euros(b.tva)} · TTC ${euros(b.ttc)}`;
    if (!lot.budget) return base;
    const budget = `budget max ${euros(lot.budget.montant)} ${lot.budget.type}`;
    if (b.etat === "depasse") return `${base}\n⚠ Dépassement : ${euros(-b.ecart)} au-dessus du ${budget}.`;
    if (b.etat === "sous") return `${base}\nℹ Sous le budget : il reste ${euros(b.ecart)} sur le ${budget}.`;
    return `${base}\n✔ Exactement le ${budget}.`;
  }

  // nom, budget : réglages du lot ; infos : client (ou null = nouveau client à saisir dans la 1re facture)
  function creerLot({ nombre, budget, nom }, infos) {
    const lot = { id: nouvelId(), nom: nom || "", clientInfos: infos, clientSource: null, budget, creee: Date.now() };
    lots.push(lot);
    for (let i = 0; i < nombre; i++) {
      const d = vide();
      if (infos) Object.assign(d, JSON.parse(JSON.stringify(infos)), { clientConnu: true, sansChoixClient: true });
      else if (i > 0) Object.assign(d, { clientConnu: true, sansChoixClient: true });
      else d.sansChoixClient = true;
      const f = creerFacture(d, lot.id);
      if (!infos && i === 0) lot.clientSource = f.id;
    }
    sauverFactures();
    return lot;
  }

  // Quand le client du lot est saisi dans la 1re facture, il est recopié dans les autres brouillons du lot.
  function propagerClientDuLot() {
    const lot = lotParId(courante.lotId);
    if (!lot || lot.clientSource !== courante.id) return;
    lot.clientInfos = infosClient(data);
    lot.maj = Date.now();
    for (const f of facturesDuLot(lot)) {
      if (f.id !== courante.id && f.statut === "brouillon") Object.assign(f.data, JSON.parse(JSON.stringify(lot.clientInfos)));
    }
  }

  // Ce qui manque pour pouvoir valider une facture
  function manquesFacture(f) {
    const d = f.data;
    const m = [];
    if (!nomComplet(d)) m.push("le client");
    if (!d.commande?.numero) m.push("le numéro de commande");
    const arts = d.articles || [];
    if (!arts.length || arts.some((a) => !a.description || a.prix == null)) m.push("les produits et leurs prix");
    return m;
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
    feuille.innerHTML = window.Facture.rendre(data, P);
    if (courante.statut === "brouillon") {
      courante.data = data;
      courante.maj = Date.now();
      propagerClientDuLot();
    }
    store.set("facture.courante", courante.id);
    sauverFactures();
    majBoutonPDF();
    ajusterApercu();
  }

  function majBoutonPDF() {
    $("#btn-pdf").textContent = courante.statut === "validee" ? "Télécharger le PDF" : "Valider et télécharger le PDF";
    const lot = lotParId(courante.lotId);
    const fs = lot ? facturesDuLot(lot) : [];
    $("#etat-facture").textContent =
      (courante.statut === "validee" ? `Facture ${courante.numero} (validée)` : "Brouillon") +
      (lot ? ` · ${lot.nom || libelleClient(lot.clientInfos || data) || "Lot"} — facture ${fs.indexOf(courante) + 1}/${fs.length}` : "");
  }

  function valeurProposee(etape) {
    const v = etape.valeur(data);
    if (v != null && String(v).trim() !== "") return String(v);
    return etape.defaut ? etape.defaut(data) || "" : "";
  }

  function bloquerSaisie(texte) {
    champ.value = "";
    champ.disabled = true;
    champ.placeholder = texte;
  }

  function puceSuivanteDuLot() {
    const lot = lotParId(courante.lotId);
    if (!lot) return;
    const fs = facturesDuLot(lot);
    const suivante = fs.find((f) => f.statut === "brouillon" && f.id !== courante.id && manquesFacture(f).length);
    if (suivante) ajouterPuce(`➡ Préparer la facture ${fs.indexOf(suivante) + 1}/${fs.length} du lot`, () => ouvrirFacture(suivante.id));
    ajouterPuce("📁 Voir le lot", () => ouvrirFactures(lot.id));
  }

  function poser() {
    zoneSuggestions.innerHTML = "";
    $("#btn-retour").disabled = historique.length === 0 || courante.statut === "validee";

    if (courante.statut === "validee") {
      bulle(`🔒 Facture ${courante.numero} validée : elle ne peut plus être modifiée (pour corriger, fais un avoir).`, "ia");
      bloquerSaisie("Facture validée");
      ajouterPuce("Télécharger le PDF", () => telechargerFacture(courante));
      puceSuivanteDuLot();
      ajouterPuce("Nouvelle facture", () => nouvelle());
      return;
    }

    const etape = etapes(data)[pos];
    if (etape.fin) {
      const t = window.Facture.calculer(data, P);
      const lot = lotParId(courante.lotId);
      bulle(
        `✅ Facture prête !\nTotal HT : ${euros(t.totalHT)}\nTVA : ${euros(t.totalTVA)}\nTotal TTC : ${euros(t.totalTTC)}` +
          (lot ? `\n\n${texteBilanLot(lot)}` : "") +
          "\n\nC'est encore un brouillon : tu peux le modifier. « Valider et télécharger le PDF » lui donne son numéro définitif.",
        "ia"
      );
      bloquerSaisie("Brouillon terminé");
      if (enregistrerClient(data)) bulle(`👤 Client enregistré : ${libelleClient(data)}`, "ia");
      ajouterPuce("✏ Modifier les produits", () => allerA("nbArticles"));
      ajouterPuce("Valider et télécharger le PDF", () => telechargerFacture(courante));
      if (lot) puceSuivanteDuLot();
      else {
        ajouterPuce("Nouvelle facture pour le même client", () => nouvelle(infosClient(data)));
        ajouterPuce("Nouvelle facture", () => nouvelle());
      }
      return;
    }

    champ.disabled = false;
    champ.placeholder = "Ta réponse… (Entrée pour valider)";
    bulle(etape.question, "ia", valeurProposee(etape));
    (etape.choix || []).forEach((c) => ajouterPuce(c, () => repondre(c)));
    if (preRempli) {
      ajouterPuce("✔ Valider tout ce qui est pré-rempli", toutValider);
      const ids = etapes(data).map((e) => e.id);
      if (ids.includes("commande.numero") && etape.id !== "commande.numero") ajouterPuce("✏ Commande", () => allerA("commande.numero"));
      if (etape.id !== "nbArticles") ajouterPuce("✏ Produits", () => allerA("nbArticles"));
    }
    champ.value = "";
    champ.focus();
  }

  // Saute directement à une question (ex : modifier les produits d'un brouillon)
  function allerA(id) {
    if (courante.statut !== "brouillon") return;
    const i = etapes(data).findIndex((e) => e.id === id);
    if (i < 0) return;
    historique.push({ data: JSON.parse(JSON.stringify(data)), pos });
    pos = i;
    preRempli = true;
    poser();
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
    bulle("↩ Retour à la question précédente", "moi");
    rafraichir();
    poser();
  }

  // Supprime le brouillon courant s'il est resté complètement vide (évite d'accumuler des brouillons vides)
  function nettoyerCourante() {
    if (courante && !courante.lotId && estVide(courante)) {
      factures = factures.filter((f) => f !== courante);
      noterSuppression([courante.id]);
    }
  }

  function activer(f) {
    courante = f;
    data = f.data;
    pos = 0;
    historique = [];
    fil.innerHTML = "";
  }

  // infos : client à reprendre (facture pour le même client), sinon facture vierge
  function nouvelle(infos) {
    nettoyerCourante();
    const d = vide();
    if (infos) Object.assign(d, JSON.parse(JSON.stringify(infos)), { clientConnu: true, sansChoixClient: true });
    activer(creerFacture(d));
    preRempli = false;
    rafraichir();
    bulle(
      infos
        ? `Nouvelle facture pour ${libelleClient(data)} : ses adresses sont déjà remplies. On passe directement à la commande et aux produits.`
        : "Nouvelle facture. Réponds aux questions une par une, l'aperçu se met à jour en direct.",
      "ia"
    );
    poser();
  }

  function ouvrirFacture(id, intro) {
    const f = factureParId(id);
    if (!f) return;
    if (f !== courante) nettoyerCourante();
    activer(f);
    preRempli = f.statut === "brouillon" && !estVide(f);
    rafraichir();
    const lot = lotParId(f.lotId);
    const fs = lot ? facturesDuLot(lot) : [];
    if (intro) bulle(intro, "ia");
    else if (f.statut === "brouillon") {
      bulle(
        (lot ? `Facture ${fs.indexOf(f) + 1}/${fs.length} du lot ${lot.nom || libelleClient(lot.clientInfos || f.data)}. ` : "") +
          (preRempli
            ? "Je reprends ce brouillon : Entrée pour garder chaque valeur, ou « ✏ Produits » pour aller directement aux produits."
            : "Réponds aux questions une par une."),
        "ia"
      );
    }
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

  // Crée le fichier PDF d'une facture validée et le télécharge directement (sans imprimante).
  async function genererPDF(f) {
    const zone = document.createElement("div");
    zone.style.cssText = "position:fixed;left:-10000px;top:0;";
    const page = document.createElement("div");
    page.className = "page-a4 pour-pdf";
    page.innerHTML = window.Facture.rendre(f.data, P);
    zone.appendChild(page);
    document.body.appendChild(zone);
    try {
      await chargerScript("assets/vendor/html2pdf.bundle.min.js");
      await Promise.all(
        [...page.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((ok) => (img.onload = img.onerror = ok))))
      );
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
      pdf.save(`Facture ${f.numero}`.replace(/[\\/:*?"<>|]/g, "-") + ".pdf");
    } finally {
      zone.remove();
    }
  }

  // Valide un brouillon : lui attribue le numéro suivant (unique, sans trou) et le verrouille.
  function validerFacture(f) {
    if (f.statut === "validee") return "";
    const manque = manquesFacture(f);
    if (manque.length) return `Il manque ${manque.join(", ")}.`;
    const { n, numero } = numeroSuivant();
    f.numero = numero;
    f.statut = "validee";
    f.valideeLe = Date.now();
    f.data.facture = { ...(f.data.facture || {}), numero };
    if (!f.data.facture.date) f.data.facture.date = aujourdhui();
    store.set("facture.compteur", n);
    sauverFactures();
    enregistrerClient(f.data);
    return "";
  }

  // Valide des brouillons en garantissant des numéros uniques, même avec plusieurs ordinateurs :
  // 1. récupère la dernière version en ligne ; 2. attribue les numéros ; 3. enregistre en ligne.
  // Si un autre ordinateur a validé entre-temps, on annule, on fusionne et on recommence avec les numéros suivants.
  async function validerEnLigne(ids) {
    for (let essai = 0; essai < 4; essai++) {
      if (Synchro.actif()) {
        await Synchro.tirer();
        if (Synchro.etat().etat !== "ok") {
          alert("Connexion nécessaire pour valider (pour garantir un numéro unique entre tes ordinateurs). Réessaie quand tu es en ligne.");
          return false;
        }
        rechargerDepuisStockage();
      }
      const aValider = ids.map(factureParId).filter((f) => f && f.statut === "brouillon" && !manquesFacture(f).length);
      if (!aValider.length) return true;
      const avant = { factures: JSON.parse(JSON.stringify(factures)), compteur: compteur() };
      aValider.forEach(validerFacture);
      if (!Synchro.actif()) return true;
      const r = await Synchro.envoyerMaintenant({ fusion: false });
      if (r.resultat === "ok") return true;
      // Annule la validation locale avant de fusionner avec la version en ligne
      factures = avant.factures;
      store.set("facture.compteur", avant.compteur);
      sauverFactures();
      if (r.resultat === "erreur") {
        rechargerDepuisStockage();
        alert("La validation n'a pas pu être enregistrée en ligne. Vérifie ta connexion puis réessaie.");
        return false;
      }
      Synchro.integrerServeur(r.serveur);
    }
    alert("Trop de validations en même temps sur plusieurs ordinateurs. Réessaie dans un instant.");
    return false;
  }

  // Relit les données (après une fusion avec un autre ordinateur) sans perdre la question en cours.
  function rechargerDepuisStockage() {
    factures = store.get("facture.factures", []);
    lots = store.get("facture.lots", []);
    P = fusionner(profilParDefaut(), store.get("facture.profil", {}), true);
    const ancienStatut = courante.statut;
    const meme = factureParId(courante.id);
    courante = meme || factures.filter((f) => f.statut === "brouillon").at(-1) || creerFacture(vide());
    data = courante.data;
    feuille.innerHTML = window.Facture.rendre(data, P);
    majBoutonPDF();
    ajusterApercu();
    if (!meme || courante.statut !== ancienStatut) {
      pos = 0;
      historique = [];
      fil.innerHTML = "";
      poser();
    }
  }

  // Bouton « Valider et télécharger » / « Télécharger le PDF » d'une facture
  async function telechargerFacture(f) {
    if (f.statut === "brouillon") {
      const manque = manquesFacture(f);
      if (manque.length) return alert(`Impossible de valider ce brouillon : il manque ${manque.join(", ")}.`);
      if (!confirm("Valider cette facture ? Elle recevra le prochain numéro et ne pourra plus être modifiée.")) return;
      const id = f.id;
      if (!(await validerEnLigne([id]))) return;
      f = factureParId(id);
      if (!f || f.statut !== "validee") return;
      if (f.id === courante.id) {
        courante = f;
        data = f.data;
        rafraichir();
        poser();
      }
    }
    const btn = $("#btn-pdf");
    btn.disabled = true;
    const texte = btn.textContent;
    btn.textContent = "Création du PDF…";
    try {
      await genererPDF(f);
    } catch (e) {
      alert(`Le PDF n'a pas pu être créé : ${e.message || e}`);
    } finally {
      btn.disabled = false;
      btn.textContent = texte;
      majBoutonPDF();
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
      if (courante.statut === "validee") {
        nettoyerCourante();
        activer(creerFacture(vide()));
      }
      const nouvelles = fusionner(vide(), extrait);
      const lot = lotParId(courante.lotId);
      if (lot?.clientInfos && lot.clientSource !== courante.id)
        Object.assign(nouvelles, JSON.parse(JSON.stringify(lot.clientInfos)), { clientConnu: true, sansChoixClient: true });
      else if (lot) nouvelles.sansChoixClient = true;
      if (!nouvelles.articles.length) nouvelles.articles = [{}];
      data = courante.data = nouvelles;
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
    $("#p-prochain").value = numeroSuivant().n;
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
    const nouveau = Object.assign(store.get("facture.profil", {}), modifs, { maj: Date.now() });
    const ok = store.set("facture.profil", nouveau);
    P = fusionner(profilParDefaut(), nouveau, true);
    return ok;
  }

  function enregistrerProfil() {
    const nouveau = { ...store.get("facture.profil", {}), logo: logoBrouillon, maj: Date.now() };
    for (const [id, chemin] of Object.entries(champsProfil)) set(nouveau, chemin, $("#" + id).value.trim());
    if (!store.set("facture.profil", nouveau)) {
      $("#erreur-profil").textContent = "Impossible d'enregistrer (logo trop lourd ou stockage bloqué par le navigateur).";
      $("#erreur-profil").hidden = false;
      return;
    }
    P = fusionner(profilParDefaut(), nouveau, true);
    const prochain = parseInt($("#p-prochain").value, 10);
    if (prochain >= 1 && prochain - 1 !== compteur()) {
      if (prochain - 1 < compteur() && factures.some((f) => f.numero)) {
        $("#erreur-profil").textContent = `Le prochain numéro ne peut pas revenir en arrière (déjà utilisé jusqu'à ${formatNumero(compteur())}).`;
        $("#erreur-profil").hidden = false;
        return;
      }
      store.set("facture.compteur", prochain - 1);
    }
    $("#dlg-profil").close();
    rafraichir();
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
    const contenu = { version: 3, profil: store.get("facture.profil", {}), compteur: compteur(), clients: listeClients(), factures, lots };
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
      if (Array.isArray(json.factures)) factures = json.factures;
      if (Array.isArray(json.lots)) lots = json.lots;
      sauverFactures();
      remplirFormProfil(P);
      if (!factures.includes(courante)) activer(factures[factures.length - 1] || creerFacture(vide()));
      rafraichir();
      poser();
      $("#etat-profil").textContent = "✔ Réglages, clients et factures restaurés.";
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
      const lot = document.createElement("button");
      lot.type = "button";
      lot.className = "btn btn-secondaire";
      lot.textContent = "Plusieurs factures";
      lot.onclick = () => {
        $("#dlg-clients").close();
        ouvrirCreationLot(c.cle);
      };
      li.append(infos, facturer, lot, suppr);
      ul.appendChild(li);
    }
  }

  // ---------- Fenêtre « Plusieurs factures pour un même client » ----------
  function el(tag, props = {}, ...enfants) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "onclick") e.onclick = v;
      else if (k === "class") e.className = v;
      else e[k] = v;
    }
    for (const c of enfants.flat()) if (c != null) e.append(c);
    return e;
  }
  const bouton = (texte, action, classe = "btn btn-secondaire") => el("button", { type: "button", class: classe, textContent: texte, onclick: action });

  function ouvrirCreationLot(cleClient) {
    const sel = $("#lot-client");
    sel.innerHTML = "";
    for (const c of listeClients()) sel.append(el("option", { value: c.cle, textContent: c.libelle }));
    sel.append(el("option", { value: "__nouveau", textContent: "➕ Nouveau client (ses infos seront demandées dans la 1re facture)" }));
    if (cleClient && listeClients().some((c) => c.cle === cleClient)) sel.value = cleClient;
    $("#lot-nombre").value = 5;
    $("#lot-nom").value = "";
    $("#lot-budget").value = "";
    $("#lot-budget-type").value = "TTC";
    $("#erreur-lot").hidden = true;
    $("#dlg-lot").showModal();
  }

  function creerLotDepuisFenetre() {
    const erreur = $("#erreur-lot");
    erreur.hidden = true;
    const nombre = parseInt($("#lot-nombre").value, 10);
    if (!(nombre >= 1 && nombre <= 50)) {
      erreur.textContent = "Choisis entre 1 et 50 factures.";
      return (erreur.hidden = false);
    }
    const texteBudget = $("#lot-budget").value.trim();
    const budget = texteBudget ? lireBudget(texteBudget, $("#lot-budget-type").value) : null;
    if (texteBudget && !budget) {
      erreur.textContent = "Je n'ai pas compris le budget (ex : 17 000 ou 17000,50).";
      return (erreur.hidden = false);
    }
    const choix = $("#lot-client").value;
    const client = listeClients().find((c) => c.cle === choix);
    nettoyerCourante();
    const lot = creerLot({ nombre, budget, nom: $("#lot-nom").value.trim() }, client ? client.infos : null);
    $("#dlg-lot").close();
    const premiere = facturesDuLot(lot)[0];
    ouvrirFacture(
      premiere.id,
      `🗂 ${nombre} factures créées${client ? ` pour ${client.libelle}` : ""}` +
        (budget ? `, budget maximum ${euros(budget.montant)} ${budget.type} (contrôle seulement)` : "") +
        `. On commence par la facture 1/${nombre}` +
        (client ? " : les adresses sont déjà remplies." : " : d'abord les infos du client, elles seront reprises sur toutes les factures du lot.")
    );
  }

  // ---------- Fenêtre « Mes factures » ----------
  function ligneFacture(f, index) {
    const t = window.Facture.calculer(f.data, P);
    const manque = manquesFacture(f);
    const statut =
      f.statut === "validee"
        ? el("span", { class: "statut validee", textContent: "Validée" })
        : el("span", { class: `statut ${manque.length ? "incomplet" : ""}`, textContent: manque.length ? "Brouillon incomplet" : "Brouillon prêt" });
    const nbProduits = (f.data.articles || []).filter((a) => a.description).length;
    const actions = el(
      "div",
      { class: "actions" },
      bouton(f.statut === "validee" ? "Voir" : "Préparer", () => {
        $("#dlg-factures").close();
        ouvrirFacture(f.id);
      }),
      bouton(f.statut === "validee" ? "PDF" : "Valider + PDF", async () => {
        await telechargerFacture(f);
        afficherFactures();
      }),
      f.statut === "brouillon"
        ? bouton("Supprimer", () => {
            if (!confirm("Supprimer ce brouillon ?")) return;
            factures = factures.filter((x) => x !== f);
            noterSuppression([f.id]);
            if (f === courante) activer(creerFacture(vide()));
            sauverFactures();
            rafraichir();
            afficherFactures();
          })
        : null
    );
    return el(
      "tr",
      {},
      el("td", { textContent: index != null ? String(index + 1) : "" }),
      el("td", {}, statut),
      el("td", { textContent: f.numero || "—" }),
      el("td", { textContent: f.data.commande?.numero || "—" }),
      el("td", { textContent: f.lotId ? "" : libelleClient(f.data) || "—" }),
      el("td", { class: "num", textContent: String(nbProduits) }),
      el("td", { class: "num", textContent: euros(t.totalHT) }),
      el("td", { class: "num", textContent: euros(t.totalTVA) }),
      el("td", { class: "num", textContent: euros(t.totalTTC) }),
      el("td", {}, actions)
    );
  }

  function tableFactures(fs, avecIndex, totaux) {
    const entete = ["#", "Statut", "N° facture", "N° commande", "Client", "Produits", "HT", "TVA", "TTC", ""];
    return el(
      "div",
      { class: "defile" },
      el(
        "table",
        { class: "table-factures" },
        el("thead", {}, el("tr", {}, entete.map((h, i) => el("th", { class: i >= 5 && i <= 8 ? "num" : "", textContent: h })))),
        el("tbody", {}, fs.map((f, i) => ligneFacture(f, avecIndex ? i : null))),
        totaux
          ? el(
              "tfoot",
              {},
              el(
                "tr",
                {},
                el("td", { colSpan: 6, textContent: "Total cumulé" }),
                el("td", { class: "num", textContent: euros(totaux.ht) }),
                el("td", { class: "num", textContent: euros(totaux.tva) }),
                el("td", { class: "num", textContent: euros(totaux.ttc) }),
                el("td")
              )
            )
          : null
      )
    );
  }

  async function validerEtTelechargerLot(lot, etat) {
    const fs = facturesDuLot(lot);
    const prets = fs.filter((f) => f.statut === "brouillon" && !manquesFacture(f).length);
    const incomplets = fs.filter((f) => f.statut === "brouillon" && manquesFacture(f).length);
    if (prets.length) {
      const msg =
        `Valider ${prets.length} brouillon(s) ? Ils recevront les prochains numéros, à la suite, et ne seront plus modifiables.` +
        (incomplets.length ? `\n\n${incomplets.length} brouillon(s) incomplet(s) seront laissés de côté.` : "");
      if (!confirm(msg)) return;
      if (!(await validerEnLigne(prets.map((f) => f.id)))) return;
      lot = lotParId(lot.id) || lot;
    } else if (incomplets.length && !fs.some((f) => f.statut === "validee")) {
      return alert("Aucune facture prête : complète d'abord les brouillons (client, n° de commande, produits et prix).");
    }
    const validees = facturesDuLot(lot).filter((f) => f.statut === "validee");
    for (let i = 0; i < validees.length; i++) {
      etat.textContent = `Téléchargement ${i + 1}/${validees.length}…`;
      await genererPDF(validees[i]);
      await new Promise((ok) => setTimeout(ok, 400));
    }
    etat.textContent = `✔ ${validees.length} PDF téléchargé(s).` + (incomplets.length ? ` ${incomplets.length} brouillon(s) à terminer.` : "");
    if (factures.includes(courante)) {
      rafraichir();
      poser();
    }
  }

  function blocLot(lot) {
    const fs = facturesDuLot(lot);
    const b = bilanLot(lot);
    const client = libelleClient(lot.clientInfos || fs[0]?.data || {}) || "Client à saisir";
    const etat = el("span", { class: "etat" });
    const bilan = el("div", { class: `bilan ${b.etat || ""}`, textContent: texteBilanLot(lot) });
    return el(
      "div",
      { class: "bloc-lot", id: `lot-${lot.id}` },
      el("h3", { textContent: `🗂 ${lot.nom || client}` }),
      el("div", {
        class: "sous-titre",
        textContent:
          `${client} · ${fs.length} factures · ${b.validees} validée(s), ${b.completes - b.validees} brouillon(s) prêt(s)` +
          (lot.budget ? ` · budget max ${euros(lot.budget.montant)} ${lot.budget.type}` : ""),
      }),
      bilan,
      tableFactures(fs, true, b),
      el(
        "div",
        { class: "actions-lot" },
        bouton("+ Ajouter une facture au lot", () => {
          const d = vide();
          if (lot.clientInfos) Object.assign(d, JSON.parse(JSON.stringify(lot.clientInfos)));
          Object.assign(d, { clientConnu: true, sansChoixClient: true });
          creerFacture(d, lot.id);
          sauverFactures();
          afficherFactures(lot.id);
        }),
        bouton("Valider et télécharger tout le lot", () => validerEtTelechargerLot(lot, etat).then(() => afficherFactures(lot.id)), "btn btn-principal"),
        fs.some((f) => f.statut === "validee")
          ? null
          : bouton("Supprimer le lot", () => {
              if (!confirm("Supprimer ce lot et tous ses brouillons ?")) return;
              noterSuppression([lot.id, ...facturesDuLot(lot).map((f) => f.id)]);
              factures = factures.filter((f) => f.lotId !== lot.id);
              lots = lots.filter((l) => l !== lot);
              if (!factures.includes(courante)) activer(creerFacture(vide()));
              sauverFactures();
              rafraichir();
              poser();
              afficherFactures();
            }),
        etat
      )
    );
  }

  function afficherFactures(lotId) {
    const zone = $("#liste-factures");
    zone.innerHTML = "";
    const lesLots = [...lots].sort((a, b) => b.creee - a.creee);
    for (const lot of lesLots) zone.append(blocLot(lot));
    const seules = factures.filter((f) => !f.lotId && (!estVide(f) || f === courante)).sort((a, b) => b.maj - a.maj);
    if (seules.length) zone.append(el("div", { class: "bloc-lot" }, el("h3", { textContent: "Factures seules" }), tableFactures(seules, false)));
    if (!lesLots.length && !seules.length) zone.append(el("p", { textContent: "Aucune facture pour l'instant." }));
    if (lotId) document.getElementById(`lot-${lotId}`)?.scrollIntoView({ block: "start" });
  }

  function ouvrirFactures(lotId) {
    afficherFactures(lotId);
    if (!$("#dlg-factures").open) $("#dlg-factures").showModal();
  }

  // ---------- Synchronisation : fenêtre et indicateur ----------
  const LIBELLES_SYNCHRO = {
    inactif: "☁ Synchroniser",
    ok: "☁ Synchronisé",
    envoi: "☁ Envoi…",
    "hors-ligne": "☁ Hors ligne",
    erreur: "☁ Erreur",
    "non-configure": "☁ Synchroniser",
  };
  function majIndicateurSynchro() {
    const { etat, message } = Synchro.etat();
    const b = $("#btn-synchro");
    b.textContent = Synchro.actif() ? LIBELLES_SYNCHRO[etat] || "☁" : "☁ Synchroniser";
    b.title = message || "Retrouver tes données sur tous tes ordinateurs";
    $("#etat-synchro").textContent = Synchro.actif()
      ? `Cet ordinateur est connecté. ${message || ""}`
      : "Cet ordinateur n'est pas connecté : tes données restent seulement dans ce navigateur.";
    $("#bloc-code").hidden = Synchro.actif();
    $("#btn-synchro-deco").hidden = !Synchro.actif();
    $("#btn-synchro-ok").hidden = Synchro.actif();
  }
  Synchro.surChangement(majIndicateurSynchro);
  window.addEventListener("synchro:fusion", () => rechargerDepuisStockage());

  async function connecterSynchro() {
    const valeur = $("#code-acces").value.trim();
    const erreur = $("#erreur-synchro");
    erreur.hidden = true;
    if (!valeur) return;
    const btn = $("#btn-synchro-ok");
    btn.disabled = true;
    try {
      const r = await Synchro.connecter(valeur);
      if (!r.ok) {
        erreur.textContent = r.message || Synchro.etat().message;
        erreur.hidden = false;
        return;
      }
      if (r.recharge) {
        alert(
          "Connecté ✔ Je charge tes données enregistrées en ligne (fusionnées avec celles de cet ordinateur, rien n'est perdu)." +
            (r.doublons?.length
              ? `\n\n⚠ Attention : ${r.doublons.length} facture(s) validée(s) sur cet ordinateur avant la synchronisation ont le même numéro ` +
                `qu'une facture déjà en ligne : ${r.doublons.join(", ")}. Les deux sont conservées ; les prochains numéros seront bien uniques. ` +
                "Vérifie ces factures avec ton comptable (un avoir + une nouvelle facture si besoin)."
              : "")
        );
        location.reload();
        return;
      }
      majIndicateurSynchro();
      $("#etat-synchro").textContent = "Connecté ✔ Les données de cet ordinateur ont été enregistrées en ligne.";
    } finally {
      btn.disabled = false;
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
  $("#btn-nouvelle").addEventListener("click", () => nouvelle());
  $("#btn-pdf").addEventListener("click", () => telechargerFacture(courante));
  $("#btn-factures").addEventListener("click", () => ouvrirFactures(courante.lotId));
  $("#btn-lot").addEventListener("click", () => ouvrirCreationLot(nomComplet(data) ? cleClient(data) : null));
  $("#btn-factures-lot").addEventListener("click", () => {
    $("#dlg-factures").close();
    ouvrirCreationLot();
  });
  $("#btn-lot-ok").addEventListener("click", (e) => {
    e.preventDefault();
    creerLotDepuisFenetre();
  });

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
      rafraichir();
      etat.textContent = "✔ Marges vides enlevées : le logo prend maintenant toute la place.";
    } catch (e) {
      etat.textContent = e.message;
    }
  });

  $("#btn-synchro").addEventListener("click", () => {
    $("#code-acces").value = "";
    $("#erreur-synchro").hidden = true;
    majIndicateurSynchro();
    $("#dlg-synchro").showModal();
  });
  $("#btn-synchro-ok").addEventListener("click", (e) => {
    e.preventDefault();
    connecterSynchro();
  });
  $("#btn-synchro-deco").addEventListener("click", () => {
    if (!confirm("Déconnecter cet ordinateur ? Tes données restent en ligne et dans ce navigateur, mais ne seront plus synchronisées ici.")) return;
    Synchro.deconnecter();
    majIndicateurSynchro();
  });
  majIndicateurSynchro();
  // Récupère les changements faits sur un autre ordinateur quand on revient sur la page, et toutes les minutes
  const actualiser = () => Synchro.actif() && document.visibilityState === "visible" && Synchro.tirer();
  window.addEventListener("focus", actualiser);
  document.addEventListener("visibilitychange", actualiser);
  setInterval(actualiser, 60000);

  window.addEventListener("resize", ajusterApercu);
  feuille.addEventListener("load", ajusterApercu, true); // logo chargé

  // ---------- Démarrage ----------
  rafraichir();
  if (courante.statut === "brouillon" && !estVide(courante)) {
    bulle("Je reprends ton brouillon en cours : Entrée pour garder chaque valeur, ou « ✏ Produits » pour aller directement aux produits.", "ia");
    preRempli = true;
  } else if (courante.statut === "brouillon") {
    bulle(
      "Bonjour 👋 Je vais te poser les questions une par une pour remplir la facture. L'aperçu se met à jour en direct.\n\n" +
        "Plusieurs factures pour un même client ? Clique sur « 🗂 Plusieurs factures ».\n" +
        "Première fois ? Clique d'abord sur « ⚙ Mon entreprise » pour mettre ton logo et tes infos.",
      "ia"
    );
  }
  poser();
})();
