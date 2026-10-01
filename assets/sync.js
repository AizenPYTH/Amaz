// ============================================================
//  SYNCHRONISATION ENTRE ORDINATEURS
//  Tes réglages, ton logo, tes clients et tes factures sont gardés en ligne
//  (fonction /api/donnees) et retrouvés sur n'importe quel ordinateur avec ton code d'accès.
//  Le navigateur garde toujours une copie locale : le site marche aussi hors ligne.
//
//  Si deux ordinateurs enregistrent en même temps, les données sont FUSIONNÉES facture par
//  facture (rien n'est perdu) : une facture validée l'emporte toujours sur un brouillon,
//  et entre deux brouillons c'est le plus récemment modifié qui est gardé.
// ============================================================

(function () {
  const CLES = ["facture.profil", "facture.compteur", "facture.clients", "facture.factures", "facture.lots", "facture.supprimees"];
  const K_CODE = "synchro.code";
  const K_VERSION = "synchro.version";
  const K_EN_ATTENTE = "synchro.enAttente";

  const lire = (k, def = null) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  };
  const ecrire = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  };
  const effacer = (k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  };

  let etat = "inactif"; // inactif | ok | envoi | hors-ligne | erreur | non-configure
  let message = "";
  let minuterie = null;
  let envoiEnCours = null;
  const ecouteurs = [];

  function changerEtat(e, m = "") {
    etat = e;
    message = m;
    ecouteurs.forEach((f) => f(etat, message));
  }

  const code = () => lire(K_CODE, "");
  const actif = () => !!code();

  const collecter = () => Object.fromEntries(CLES.map((k) => [k, lire(k)]));
  const aDesDonnees = () => (lire("facture.factures", []) || []).length > 0 || !!lire("facture.profil");

  function ecrireTout(donnees) {
    for (const k of CLES) {
      if (donnees && donnees[k] != null) ecrire(k, donnees[k]);
      else effacer(k);
    }
  }

  // ---------- Fusion de deux versions (en ligne + cet ordinateur) ----------
  function fusionner(serveur, local) {
    const s = serveur || {};
    const l = local || {};
    const supprimees = [...new Set([...(s["facture.supprimees"] || []), ...(l["facture.supprimees"] || [])])].slice(-2000);
    const suppr = new Set(supprimees);

    // Factures : une validée l'emporte toujours ; sinon la plus récemment modifiée
    const factures = new Map();
    for (const f of s["facture.factures"] || []) if (!suppr.has(f.id)) factures.set(f.id, f);
    for (const f of l["facture.factures"] || []) {
      if (suppr.has(f.id) && f.statut !== "validee") continue;
      const autre = factures.get(f.id);
      if (!autre || (autre.statut !== "validee" && (f.statut === "validee" || (f.maj || 0) > (autre.maj || 0)))) factures.set(f.id, f);
    }

    const plusRecent = (liste1, liste2, cle) => {
      const m = new Map();
      for (const x of [...(liste1 || []), ...(liste2 || [])]) {
        const autre = m.get(x[cle]);
        if (!autre || (x.maj || 0) > (autre.maj || 0)) m.set(x[cle], x);
      }
      return [...m.values()];
    };
    const lots = plusRecent(s["facture.lots"], l["facture.lots"], "id").filter((x) => !suppr.has(x.id));
    const clients = plusRecent(s["facture.clients"], l["facture.clients"], "cle").sort((a, b) => (b.maj || 0) - (a.maj || 0));

    const ps = s["facture.profil"];
    const pl = l["facture.profil"];
    const profil = !ps ? pl : !pl ? ps : (pl.maj || 0) > (ps.maj || 0) ? pl : ps;

    return {
      "facture.profil": profil ?? null,
      "facture.compteur": Math.max(Number(s["facture.compteur"]) || 0, Number(l["facture.compteur"]) || 0),
      "facture.clients": clients,
      "facture.factures": [...factures.values()].sort((a, b) => (a.creee || 0) - (b.creee || 0)),
      "facture.lots": lots,
      "facture.supprimees": supprimees,
    };
  }

  // Intègre la version en ligne aux données de cet ordinateur.
  function integrer(serveur) {
    const enAttente = lire(K_EN_ATTENTE, false);
    ecrireTout(enAttente ? fusionner(serveur.donnees, collecter()) : serveur.donnees);
    ecrire(K_VERSION, serveur.version);
    window.dispatchEvent(new CustomEvent("synchro:fusion"));
    return enAttente;
  }

  async function appel(methode, corps, codeEssai = code(), delai = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), delai);
    try {
      const r = await fetch("/api/donnees", {
        method: methode,
        headers: { "Content-Type": "application/json", "x-code-acces": codeEssai },
        body: corps ? JSON.stringify(corps) : undefined,
        signal: ctrl.signal,
      });
      const json = await r.json().catch(() => ({}));
      return { statut: r.status, json };
    } catch {
      return { statut: 0, json: {} };
    } finally {
      clearTimeout(t);
    }
  }

  function traiterErreur(statut, json) {
    if (statut === 0) changerEtat("hors-ligne", "Pas de connexion : les changements seront envoyés plus tard.");
    else if (statut === 501) changerEtat("non-configure", json.erreur || "Synchronisation non configurée.");
    else if (statut === 401) changerEtat("erreur", "Code d'accès incorrect.");
    else changerEtat("erreur", json.erreur || `Erreur ${statut}`);
  }

  // Récupère la version en ligne si elle est plus récente. Renvoie true si les données locales ont changé.
  async function tirer() {
    if (!actif()) return false;
    const { statut, json } = await appel("GET", null, code(), 6000);
    if (statut !== 200) {
      traiterErreur(statut, json);
      return false;
    }
    changerEtat("ok", "À jour");
    if (json.version > lire(K_VERSION, 0) && json.donnees) {
      if (integrer(json)) planifierEnvoi(300); // il restait des changements locaux : on renvoie la fusion
      return true;
    }
    if (lire(K_EN_ATTENTE, false) || (json.version === 0 && aDesDonnees())) planifierEnvoi(300);
    return false;
  }

  // Envoie les données locales.
  //  - par défaut, en cas de conflit : fusion automatique puis nouvel envoi → "ok" | "erreur"
  //  - avec { fusion: false } : renvoie { resultat: "conflit", serveur } sans rien toucher (utilisé pour la validation)
  async function envoyerMaintenant({ fusion = true } = {}) {
    if (!actif()) return fusion ? "ok" : { resultat: "ok" };
    clearTimeout(minuterie);
    while (envoiEnCours) await envoiEnCours.catch(() => {});
    envoiEnCours = (async () => {
      for (let essai = 0; essai < 3; essai++) {
        changerEtat("envoi", "Enregistrement en ligne…");
        const { statut, json } = await appel("PUT", { baseVersion: lire(K_VERSION, 0), donnees: collecter() });
        if (statut === 200) {
          ecrire(K_VERSION, json.version);
          effacer(K_EN_ATTENTE);
          changerEtat("ok", "Enregistré en ligne");
          return { resultat: "ok" };
        }
        if (statut === 409) {
          if (!fusion) {
            changerEtat("ok", "Mis à jour depuis un autre ordinateur");
            return { resultat: "conflit", serveur: json };
          }
          ecrire(K_EN_ATTENTE, true);
          integrer(json); // fusion, puis on réessaie d'envoyer
          continue;
        }
        traiterErreur(statut, json);
        return { resultat: "erreur" };
      }
      changerEtat("erreur", "Trop de modifications simultanées, réessaie.");
      return { resultat: "erreur" };
    })();
    try {
      const r = await envoiEnCours;
      return fusion ? r.resultat : r;
    } finally {
      envoiEnCours = null;
    }
  }

  function planifierEnvoi(delai = 1500) {
    if (!actif()) return;
    ecrire(K_EN_ATTENTE, true);
    clearTimeout(minuterie);
    minuterie = setTimeout(() => envoyerMaintenant(), delai);
  }

  // Connexion de cet ordinateur avec le code d'accès.
  async function connecter(nouveauCode) {
    const { statut, json } = await appel("GET", null, nouveauCode);
    if (statut !== 200) {
      traiterErreur(statut, json);
      return { ok: false, message };
    }
    ecrire(K_CODE, nouveauCode);
    // Factures validées séparément sur cet ordinateur ET en ligne avec le même numéro (avant la synchronisation)
    const enLigne = new Map(((json.donnees || {})["facture.factures"] || []).filter((f) => f.numero).map((f) => [f.numero, f.id]));
    const doublons = (lire("facture.factures", []) || [])
      .filter((f) => f.numero && enLigne.has(f.numero) && enLigne.get(f.numero) !== f.id)
      .map((f) => f.numero);
    if (json.donnees && json.version > 0) {
      // Données déjà en ligne : on les récupère (fusionnées avec celles de cet ordinateur, rien n'est perdu)
      ecrire(K_EN_ATTENTE, aDesDonnees());
      integrer(json);
      changerEtat("ok", "À jour");
      if (lire(K_EN_ATTENTE, false)) await envoyerMaintenant();
      return { ok: true, recharge: true, doublons };
    }
    // Rien en ligne : on envoie ce qu'il y a sur cet ordinateur.
    ecrire(K_VERSION, 0);
    const r = await envoyerMaintenant();
    return { ok: r !== "erreur", recharge: false, message };
  }

  function deconnecter() {
    effacer(K_CODE);
    effacer(K_VERSION);
    effacer(K_EN_ATTENTE);
    changerEtat("inactif", "");
  }

  // Après un conflit lors d'une validation : intègre la version en ligne (fusion) dans cet ordinateur.
  function integrerServeur(serveur) {
    ecrire(K_EN_ATTENTE, true);
    integrer(serveur);
  }

  window.addEventListener("pagehide", () => {
    if (actif() && lire(K_EN_ATTENTE, false)) envoyerMaintenant();
  });
  window.addEventListener("online", () => actif() && lire(K_EN_ATTENTE, false) && envoyerMaintenant());

  window.Synchro = {
    CLES,
    actif,
    tirer,
    envoyerMaintenant,
    planifierEnvoi,
    connecter,
    deconnecter,
    integrerServeur,
    fusionner,
    etat: () => ({ etat, message }),
    surChangement: (f) => ecouteurs.push(f),
  };
})();
