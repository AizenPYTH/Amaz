// ============================================================
//  DOCUMENTS DE PAIEMENT ÉMIS PAR MA SOCIÉTÉ
//  - Avis de paiement : paiement EFFECTUÉ par ma société (émetteur = un de mes comptes)
//  - Reçu de paiement : paiement REÇU par ma société (bénéficiaire = un de mes comptes)
//  Ma société est toujours l'une des deux parties, et chaque document indique
//  qu'il est émis par elle et ne constitue pas une attestation bancaire.
// ============================================================

(function () {
  const $ = (s) => document.querySelector(s);

  // ---------- Stockage local ----------
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
  };
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let parametres = store.get("paiement.parametres", { logoTaille: 12, comptes: [] });
  if (!Array.isArray(parametres.comptes)) parametres.comptes = [];
  let contacts = store.get("paiement.contacts", []);
  let historique = store.get("paiement.historique", []);
  const sauverParametres = () => store.set("paiement.parametres", parametres);
  const sauverContacts = () => store.set("paiement.contacts", contacts);
  const sauverHistorique = () => store.set("paiement.historique", historique);

  // ---------- Mise en forme ----------
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const aujourdhuiISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dateFR = (iso) => {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  };
  function lireMontant(v) {
    let n = String(v || "").replace(/[^0-9,.\-]/g, "");
    if (n.includes(",")) n = n.replace(/\./g, "").replace(",", ".");
    const x = parseFloat(n);
    return isNaN(x) || x <= 0 ? null : Math.round(x * 100) / 100;
  }
  function formatMontant(montant, devise) {
    try {
      return new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise, currencyDisplay: "code" })
        .format(montant)
        .replace(/ | /g, " ");
    } catch {
      return `${montant.toFixed(2)} ${devise}`;
    }
  }
  const nettoyerIBAN = (v) => String(v || "").replace(/\s+/g, "").toUpperCase();
  function ibanValide(iban) {
    const s = nettoyerIBAN(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    let reste = 0;
    for (const ch of r) reste = (reste * 10 + Number(ch)) % 97;
    return reste === 1;
  }
  // IBAN affiché : collé comme sur le modèle s'il tient sur une ligne (jusqu'à 27 caractères, ex : IBAN français),
  // sinon par blocs de 4 pour passer proprement à la ligne sans jamais dépasser.
  const ibanAffiche = (v) => {
    const s = nettoyerIBAN(v);
    return s.length > 27 ? s.replace(/(.{4})(?=.)/g, "$1 ") : s;
  };
  const banqueTexte = (p) => [p.banque, p.bic ? nettoyerIBAN(p.bic) : ""].filter(Boolean).join(" · ");

  const TYPES = {
    avis: { titre: "Avis de paiement", en: "Payment advice", prefixe: "AP" },
    recu: { titre: "Reçu de paiement", en: "Payment receipt", prefixe: "RP" },
  };

  // ---------- Rendu du document (aperçu et PDF identiques) ----------
  function el(tag, props = {}, ...enfants) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else e[k] = v;
    }
    for (const c of enfants.flat()) if (c != null && c !== false) e.append(c);
    return e;
  }

  // ---------- Mise en page enregistrée (positions en mm sur la page A4) ----------
  const MISE_EN_PAGE_DEFAUT = {
    logo: { x: 27, y: 30 },
    titre: { x: 27, y: 74 },
    lignes: { x: 27, y: 99 },
    pied: { x: 20, y: 262 },
    interligne: 13,
    colonne: 91,
  };
  const copie = (o) => JSON.parse(JSON.stringify(o));
  const miseEnPage = () => ({ ...copie(MISE_EN_PAGE_DEFAUT), ...copie(parametres.miseEnPage || {}) });
  const placer = (e, pos) => {
    e.style.left = `${pos.x}mm`;
    e.style.top = `${pos.y}mm`;
    return e;
  };

  function rendreDocument(doc, cible) {
    const mp = { ...copie(MISE_EN_PAGE_DEFAUT), ...copie(doc.miseEnPage || {}) };
    const t = TYPES[doc.type] || TYPES.avis;
    const s = doc.societe || {};
    const emetteur = doc.type === "recu" ? doc.contact : doc.moi;
    const beneficiaire = doc.type === "recu" ? doc.moi : doc.contact;
    // champ : nom de la donnée modifiable directement sur la feuille (null = non modifiable ici)
    const ligne = (fr, en, valeur, champ = null) => {
      const v = el("div", { class: `d-valeur${valeur ? "" : " vide"}`, textContent: valeur || "—" });
      if (champ) v.dataset.champ = champ;
      return el("div", { class: "d-ligne" }, el("div", { class: "d-libelle" }, el("b", { textContent: fr }), el("span", { textContent: en })), v);
    };
    // Côté contact (modifiable) : bénéficiaire pour un avis, émetteur pour un reçu ; ma société se règle dans Paramètres
    const cE = doc.type === "recu" ? "contact-" : null;
    const cB = doc.type === "recu" ? null : "contact-";

    const contactSociete = [s.email, s.tel].filter(Boolean).join(" · ");
    cible.style.setProperty("--interligne", `${mp.interligne}mm`);
    cible.style.setProperty("--colonne", `${mp.colonne}mm`);
    cible.replaceChildren(
      placer(
        el(
          "div",
          { class: "d-bloc-logo" },
          s.logo
            ? el("img", { class: "d-logo", src: s.logo, alt: "", draggable: false, style: `height:${Number(s.logoTaille) || 12}mm` })
            : el("div", { class: "d-nom-logo", textContent: s.nom || "" })
        ),
        mp.logo
      ),
      el(
        "div",
        { class: "d-titre" },
        el("h1", { textContent: t.titre }),
        el("div", { class: "en", textContent: t.en }),
        doc.numero ? el("div", { class: "numero", textContent: `N° ${doc.numero}` }) : null
      ),
      el(
        "div",
        { class: "d-lignes" },
        ligne("Date", "Date", dateFR(doc.date), "date"),
        ligne("Montant", "Amount", doc.montant != null ? formatMontant(doc.montant, doc.devise) : "", "montant"),
        ligne("Émetteur", "Sender", emetteur?.nom, cE && cE + "nom"),
        ligne("IBAN de l'émetteur", "Sender's IBAN", ibanAffiche(emetteur?.iban), cE && cE + "iban"),
        ligne("Banque de l'émetteur", "Sender's bank", banqueTexte(emetteur || {}), cE && cE + "banque"),
        ligne("Bénéficiaire", "Beneficiary", beneficiaire?.nom, cB && cB + "nom"),
        ligne("IBAN du bénéficiaire", "Beneficiary's IBAN", ibanAffiche(beneficiaire?.iban), cB && cB + "iban"),
        ligne("Banque du bénéficiaire", "Beneficiary's bank", banqueTexte(beneficiaire || {}), cB && cB + "banque"),
        ligne("Référence", "Reference", doc.reference, "reference")
      ),
      el(
        "div",
        { class: "d-pied" },
        s.nom ? el("div", { textContent: [s.nom, s.adresse].filter(Boolean).join(" — ") }) : null,
        s.siren || contactSociete ? el("div", { textContent: [s.siren ? `SIREN/SIRET ${s.siren}` : "", contactSociete].filter(Boolean).join(" · ") }) : null,
        s.pied ? el("div", { textContent: s.pied }) : null
      ),
      el("div", {
        class: "d-mention",
        textContent:
          `Document généré par ${s.nom || "ma société"} — ne constitue pas une attestation bancaire. ` +
          `Issued by ${s.nom || "the company"} — not a bank statement.`,
      })
    );
    // Blocs déplaçables : positions de la mise en page
    const blocs = { logo: ".d-bloc-logo", titre: ".d-titre", lignes: ".d-lignes", pied: ".d-pied" };
    for (const [nom, sel] of Object.entries(blocs)) {
      const e = cible.querySelector(sel);
      e.dataset.bloc = nom;
      placer(e, mp[nom]);
    }
  }

  // ---------- Formulaire ----------
  const champs = ["d-type", "d-mon-compte", "d-contact", "d-c-nom", "d-c-iban", "d-c-banque", "d-c-bic", "d-date", "d-devise", "d-montant", "d-reference"];
  let dernierGenere = null; // document généré (avec numéro), téléchargeable tant que le formulaire n'a pas changé

  function documentDuFormulaire() {
    const compte = parametres.comptes.find((c) => c.id === $("#d-mon-compte").value);
    return {
      type: $("#d-type").value,
      date: $("#d-date").value,
      devise: $("#d-devise").value,
      montant: lireMontant($("#d-montant").value),
      reference: $("#d-reference").value.trim(),
      moi: compte ? { nom: parametres.nom || "", iban: compte.iban, banque: compte.banque, bic: compte.bic } : { nom: parametres.nom || "" },
      contact: {
        nom: $("#d-c-nom").value.trim(),
        iban: $("#d-c-iban").value.trim(),
        banque: $("#d-c-banque").value.trim(),
        bic: $("#d-c-bic").value.trim(),
      },
      miseEnPage: miseEnPage(),
      societe: {
        nom: parametres.nom || "",
        adresse: parametres.adresse || "",
        siren: parametres.siren || "",
        email: parametres.email || "",
        tel: parametres.tel || "",
        pied: parametres.pied || "",
        logo: parametres.logo || "",
        logoTaille: parametres.logoTaille || 12,
      },
    };
  }

  function remplirSelects() {
    const mc = $("#d-mon-compte");
    const ancien = mc.value;
    mc.replaceChildren(
      ...(parametres.comptes.length
        ? parametres.comptes.map((c) => el("option", { value: c.id, textContent: `${c.libelle} — ${nettoyerIBAN(c.iban)}` }))
        : [el("option", { value: "", textContent: "Aucun compte : ajoute-en un dans Paramètres" })])
    );
    if (parametres.comptes.some((c) => c.id === ancien)) mc.value = ancien;

    const sc = $("#d-contact");
    const ancienC = sc.value;
    sc.replaceChildren(
      el("option", { value: "", textContent: contacts.length ? "— Choisir un contact —" : "Aucun contact enregistré" }),
      ...contacts.map((c) => el("option", { value: c.id, textContent: c.nom }))
    );
    if (contacts.some((c) => c.id === ancienC)) sc.value = ancienC;
    $("#alerte-parametres").hidden = !!(parametres.nom && parametres.comptes.length);
  }

  function majLegendes() {
    const recu = $("#d-type").value === "recu";
    $("#legende-ma-societe").textContent = recu ? "Bénéficiaire : ma société" : "Émetteur : ma société";
    $("#legende-contact").textContent = recu ? "Émetteur (qui t'a payé)" : "Bénéficiaire (que tu as payé)";
  }

  function choisirContact() {
    const c = contacts.find((x) => x.id === $("#d-contact").value);
    if (!c) return;
    $("#d-c-nom").value = c.nom || "";
    $("#d-c-iban").value = c.iban || "";
    $("#d-c-banque").value = c.banque || "";
    $("#d-c-bic").value = c.bic || "";
  }

  function sauverBrouillon() {
    store.set("paiement.brouillon", Object.fromEntries(champs.map((id) => [id, $("#" + id).value])));
  }
  function chargerBrouillon() {
    const b = store.get("paiement.brouillon", null);
    if (b) for (const id of champs) if (b[id] != null && $("#" + id)) $("#" + id).value = b[id];
    if (!$("#d-date").value) $("#d-date").value = aujourdhuiISO();
  }

  // ---------- Aperçu ----------
  const feuille = $("#feuille");
  const cadre = $("#cadre");
  function ajusterApercu() {
    if ($("#onglet-document").hidden) return;
    feuille.style.transform = "none";
    const dispo = cadre.parentElement.clientWidth - (window.innerWidth <= 900 ? 32 : 48);
    const e = Math.min(1, dispo / feuille.offsetWidth);
    feuille.style.transform = `scale(${e})`;
    cadre.style.width = `${feuille.offsetWidth * e}px`;
    cadre.style.height = `${feuille.offsetHeight * e}px`;
  }
  function majApercu() {
    majLegendes();
    rendreDocument(dernierGenere || documentDuFormulaire(), feuille);
    ajusterApercu();
  }

  function surModification() {
    if (dernierGenere) {
      dernierGenere = null;
      $("#btn-telecharger").disabled = true;
      $("#etat-document").textContent = "";
    }
    sauverBrouillon();
    majApercu();
  }

  // ---------- Modifier le texte directement sur la feuille ----------
  // Clic sur une valeur → on la modifie ; Entrée ou clic ailleurs → le formulaire est mis à jour.
  function appliquerTexte(champ, texte) {
    const t = texte.replace(/\s+/g, " ").trim();
    const vide = t === "" || t === "—";
    switch (champ) {
      case "date": {
        const m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
        if (!m) return "Date au format JJ/MM/AAAA.";
        const a = m[3].length === 2 ? "20" + m[3] : m[3];
        $("#d-date").value = `${a}-${pad(m[2])}-${pad(m[1])}`;
        break;
      }
      case "montant": {
        const devise = (t.toUpperCase().match(/\b([A-Z]{3})\b/) || [])[1];
        if (devise && [...$("#d-devise").options].some((o) => o.value === devise)) $("#d-devise").value = devise;
        if (!lireMontant(t)) return "Montant non reconnu (ex : 7 550,00 EUR).";
        $("#d-montant").value = String(lireMontant(t)).replace(".", ",");
        break;
      }
      case "reference":
        $("#d-reference").value = vide ? "" : t;
        break;
      case "contact-nom":
        $("#d-c-nom").value = vide ? "" : t;
        break;
      case "contact-iban":
        $("#d-c-iban").value = vide ? "" : nettoyerIBAN(t);
        break;
      case "contact-banque": {
        const [banque, bic] = vide ? ["", ""] : t.split("·").map((x) => x.trim());
        $("#d-c-banque").value = banque || "";
        $("#d-c-bic").value = bic || "";
        break;
      }
    }
    return "";
  }

  let texteEnCours = null;
  feuille.addEventListener("click", (e) => {
    if (enEdition) return;
    let v = e.target.closest("[data-champ]");
    if (v && !v.isConnected) v = feuille.querySelector(`[data-champ="${v.dataset.champ}"]`); // feuille redessinée entre-temps
    if (!v || v === texteEnCours) return;
    texteEnCours = v;
    v.contentEditable = "true";
    v.classList.remove("vide");
    if (v.textContent === "—") v.textContent = "";
    v.focus();
    const r = document.createRange();
    r.selectNodeContents(v);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  feuille.addEventListener("keydown", (e) => {
    if (!texteEnCours) return;
    if (e.key === "Enter") {
      e.preventDefault();
      texteEnCours.blur();
    }
    if (e.key === "Escape") {
      const v = texteEnCours;
      texteEnCours = null;
      v.blur();
      majApercu();
    }
  });
  feuille.addEventListener(
    "blur",
    (e) => {
      const v = e.target;
      if (v !== texteEnCours) return;
      texteEnCours = null;
      const erreur = appliquerTexte(v.dataset.champ, v.textContent);
      $("#erreur-document").textContent = erreur;
      $("#erreur-document").hidden = !erreur;
      if (v.dataset.champ.startsWith("contact-")) $("#d-contact").value = ""; // modifié à la main : plus le contact enregistré tel quel
      surModification();
    },
    true
  );

  // ---------- Modifier la mise en page (glisser les blocs) ----------
  const PX_PAR_MM = 96 / 25.4;
  let enEdition = false;
  let glisse = null;

  function majOutilsEdition() {
    const mp = miseEnPage();
    $("#r-interligne").value = mp.interligne;
    $("#r-colonne").value = mp.colonne;
    $("#outils-edition").hidden = !enEdition;
    $("#aide-edition").hidden = !enEdition;
    $("#aide-texte").hidden = enEdition;
    $("#btn-edition").hidden = enEdition;
    feuille.classList.toggle("edition", enEdition);
  }

  function changerMiseEnPage(modifs) {
    parametres.miseEnPage = { ...miseEnPage(), ...modifs };
    sauverParametres();
  }

  function demarrerEdition() {
    enEdition = true;
    surModification(); // l'aperçu montre le formulaire (et non un document déjà généré)
    majOutilsEdition();
  }

  feuille.addEventListener("pointerdown", (e) => {
    if (!enEdition) return;
    const bloc = e.target.closest("[data-bloc]");
    if (!bloc) return;
    e.preventDefault();
    const echelle = feuille.getBoundingClientRect().width / feuille.offsetWidth;
    const pos = miseEnPage()[bloc.dataset.bloc];
    glisse = { bloc, nom: bloc.dataset.bloc, x0: e.clientX, y0: e.clientY, px: pos.x, py: pos.y, k: PX_PAR_MM * echelle };
    bloc.setPointerCapture(e.pointerId);
  });
  feuille.addEventListener("pointermove", (e) => {
    if (!glisse) return;
    const largeur = glisse.bloc.offsetWidth / PX_PAR_MM;
    const hauteur = glisse.bloc.offsetHeight / PX_PAR_MM;
    const r = (v) => Math.round(v * 2) / 2;
    // Reste dans la page, au-dessus de la mention du bas
    const x = Math.min(Math.max(r(glisse.px + (e.clientX - glisse.x0) / glisse.k), 0), Math.max(0, 210 - largeur));
    const y = Math.min(Math.max(r(glisse.py + (e.clientY - glisse.y0) / glisse.k), 0), Math.max(0, 283 - hauteur));
    placer(glisse.bloc, { x, y });
    glisse.pos = { x, y };
  });
  const finGlisse = () => {
    if (glisse?.pos) changerMiseEnPage({ [glisse.nom]: glisse.pos });
    glisse = null;
  };
  feuille.addEventListener("pointerup", finGlisse);
  feuille.addEventListener("pointercancel", finGlisse);

  // ---------- PDF ----------
  function chargerScript(src) {
    return new Promise((ok, ko) => {
      if (window.html2pdf) return ok();
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => ko(new Error("Impossible de charger le générateur de PDF."));
      document.head.appendChild(s);
    });
  }

  async function telechargerPDF(doc) {
    const zone = el("div", { style: "position:fixed;left:-10000px;top:0;" });
    const page = el("div", { class: "doc-a4" });
    zone.append(page);
    document.body.append(zone);
    try {
      rendreDocument(doc, page);
      await chargerScript("assets/vendor/html2pdf.bundle.min.js");
      await Promise.all([...page.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((ok) => (i.onload = i.onerror = ok)))));
      const pdf = await window
        .html2pdf()
        .set({
          margin: 0,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(page)
        .toPdf()
        .get("pdf");
      while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages());
      const nom = `${TYPES[doc.type].titre} ${doc.numero}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      pdf.save(nom.replace(/[\\/:*?"<>|]/g, "-") + ".pdf");
    } finally {
      zone.remove();
    }
  }

  function prochainNumero(type) {
    const annee = new Date().getFullYear();
    const compteurs = store.get("paiement.compteurs", {});
    const cle = `${type}-${annee}`;
    const n = (compteurs[cle] || 0) + 1;
    compteurs[cle] = n;
    store.set("paiement.compteurs", compteurs);
    return `${TYPES[type].prefixe}-${annee}-${pad(n, 4)}`;
  }

  function erreursDocument(doc) {
    const e = [];
    if (!parametres.nom) e.push("le nom de ta société (Paramètres)");
    if (!parametres.comptes.length || !doc.moi.iban) e.push("ton compte (Paramètres → Mes comptes)");
    if (!doc.contact.nom) e.push(doc.type === "recu" ? "l'émetteur" : "le bénéficiaire");
    if (!doc.date) e.push("la date");
    if (doc.montant == null) e.push("le montant");
    return e;
  }

  async function generer() {
    const erreur = $("#erreur-document");
    erreur.hidden = true;
    const doc = documentDuFormulaire();
    const manque = erreursDocument(doc);
    if (manque.length) {
      erreur.textContent = `Il manque ${manque.join(", ")}.`;
      erreur.hidden = false;
      return;
    }
    if (doc.contact.iban && !ibanValide(doc.contact.iban) && !confirm("L'IBAN du contact semble incorrect (clé de contrôle). Générer quand même ?")) return;
    doc.numero = prochainNumero(doc.type);
    doc.cree = Date.now();
    historique.unshift({ id: nouvelId(), ...doc });
    sauverHistorique();
    dernierGenere = doc;
    $("#btn-telecharger").disabled = false;
    $("#etat-document").textContent = `✔ ${TYPES[doc.type].titre} ${doc.numero} généré et enregistré dans l'historique.`;
    majApercu();
    await telechargerPDF(doc);
  }

  // ---------- Contacts ----------
  function afficherContacts() {
    const tb = $("#liste-contacts");
    tb.replaceChildren();
    if (!contacts.length) return tb.append(el("tr", { class: "vide" }, el("td", { colSpan: 5, textContent: "Aucun contact pour l'instant." })));
    for (const c of contacts) {
      tb.append(
        el(
          "tr",
          {},
          el("td", {}, el("b", { textContent: c.nom }), c.adresse ? el("div", { class: "aide", textContent: c.adresse }) : null),
          el("td", { class: "iban", textContent: nettoyerIBAN(c.iban) || "—" }),
          el("td", { textContent: c.banque || "—" }),
          el("td", { textContent: c.bic || "—" }),
          el(
            "td",
            {},
            el(
              "div",
              { class: "actions-ligne" },
              el("button", { type: "button", class: "btn btn-secondaire", textContent: "Modifier", onclick: () => editerContact(c) }),
              el("button", {
                type: "button",
                class: "btn btn-secondaire",
                textContent: "Supprimer",
                onclick: () => {
                  if (!confirm(`Supprimer ${c.nom} ?`)) return;
                  contacts = contacts.filter((x) => x !== c);
                  sauverContacts();
                  afficherContacts();
                  remplirSelects();
                },
              })
            )
          )
        )
      );
    }
  }

  function editerContact(c) {
    $("#c-id").value = c.id;
    for (const k of ["nom", "iban", "banque", "bic", "adresse"]) $("#c-" + k).value = c[k] || "";
    $("#btn-contact-ok").textContent = "Enregistrer les modifications";
    $("#btn-contact-annuler").hidden = false;
    $("#c-nom").focus();
  }

  function viderFormContact() {
    $("#form-contact").reset();
    $("#c-id").value = "";
    $("#btn-contact-ok").textContent = "Ajouter le contact";
    $("#btn-contact-annuler").hidden = true;
  }

  function enregistrerContact(e) {
    e.preventDefault();
    const erreur = $("#erreur-contact");
    erreur.hidden = true;
    const c = {
      id: $("#c-id").value || nouvelId(),
      nom: $("#c-nom").value.trim(),
      iban: nettoyerIBAN($("#c-iban").value),
      banque: $("#c-banque").value.trim(),
      bic: nettoyerIBAN($("#c-bic").value),
      adresse: $("#c-adresse").value.trim(),
    };
    if (!c.nom) return;
    if (c.iban && !ibanValide(c.iban)) {
      erreur.textContent = "Cet IBAN semble incorrect (clé de contrôle) : vérifie-le.";
      erreur.hidden = false;
      return;
    }
    const i = contacts.findIndex((x) => x.id === c.id);
    if (i >= 0) contacts[i] = c;
    else contacts.push(c);
    contacts.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    sauverContacts();
    viderFormContact();
    afficherContacts();
    remplirSelects();
  }

  // ---------- Paramètres : ma société et mes comptes ----------
  const champsParam = { "p-nom": "nom", "p-adresse": "adresse", "p-siren": "siren", "p-email": "email", "p-tel": "tel", "p-pied": "pied", "p-logo-taille": "logoTaille" };

  function afficherParametres() {
    for (const [id, k] of Object.entries(champsParam)) $("#" + id).value = parametres[k] ?? "";
    $("#p-apercu-logo").src = parametres.logo || "";
    afficherComptes();
  }

  function enregistrerChampParam() {
    for (const [id, k] of Object.entries(champsParam)) parametres[k] = k === "logoTaille" ? Number($("#" + id).value) || 12 : $("#" + id).value.trim();
    sauverParametres();
    remplirSelects();
    $("#etat-parametres").textContent = "✔ Enregistré";
  }

  function afficherComptes() {
    const tb = $("#liste-comptes");
    tb.replaceChildren();
    if (!parametres.comptes.length) return tb.append(el("tr", { class: "vide" }, el("td", { colSpan: 5, textContent: "Aucun compte pour l'instant." })));
    for (const c of parametres.comptes) {
      tb.append(
        el(
          "tr",
          {},
          el("td", {}, el("b", { textContent: c.libelle })),
          el("td", { class: "iban", textContent: nettoyerIBAN(c.iban) }),
          el("td", { textContent: c.banque || "—" }),
          el("td", { textContent: c.bic || "—" }),
          el(
            "td",
            {},
            el(
              "div",
              { class: "actions-ligne" },
              el("button", {
                type: "button",
                class: "btn btn-secondaire",
                textContent: "Modifier",
                onclick: () => {
                  $("#m-id").value = c.id;
                  for (const k of ["libelle", "iban", "banque", "bic"]) $("#m-" + k).value = c[k] || "";
                  $("#btn-compte-ok").textContent = "Enregistrer les modifications";
                  $("#btn-compte-annuler").hidden = false;
                },
              }),
              el("button", {
                type: "button",
                class: "btn btn-secondaire",
                textContent: "Supprimer",
                onclick: () => {
                  if (!confirm(`Supprimer le compte « ${c.libelle} » ?`)) return;
                  parametres.comptes = parametres.comptes.filter((x) => x !== c);
                  sauverParametres();
                  afficherComptes();
                  remplirSelects();
                },
              })
            )
          )
        )
      );
    }
  }

  function viderFormCompte() {
    $("#form-compte").reset();
    $("#m-id").value = "";
    $("#btn-compte-ok").textContent = "Ajouter le compte";
    $("#btn-compte-annuler").hidden = true;
  }

  function enregistrerCompte(e) {
    e.preventDefault();
    const erreur = $("#erreur-compte");
    erreur.hidden = true;
    const c = {
      id: $("#m-id").value || nouvelId(),
      libelle: $("#m-libelle").value.trim(),
      iban: nettoyerIBAN($("#m-iban").value),
      banque: $("#m-banque").value.trim(),
      bic: nettoyerIBAN($("#m-bic").value),
    };
    if (!c.libelle || !c.iban) return;
    if (!ibanValide(c.iban)) {
      erreur.textContent = "Cet IBAN semble incorrect (clé de contrôle) : vérifie-le.";
      erreur.hidden = false;
      return;
    }
    const i = parametres.comptes.findIndex((x) => x.id === c.id);
    if (i >= 0) parametres.comptes[i] = c;
    else parametres.comptes.push(c);
    sauverParametres();
    viderFormCompte();
    afficherComptes();
    remplirSelects();
  }

  // Logo : redimensionné pour tenir dans le stockage du navigateur
  async function lireLogo(f) {
    const url = await new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => ko(new Error("Fichier illisible."));
      r.readAsDataURL(f);
    });
    if (f.type === "image/svg+xml") return url;
    const img = new Image();
    await new Promise((ok, ko) => ((img.onload = ok), (img.onerror = () => ko(new Error("Image illisible."))), (img.src = url)));
    const e = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = el("canvas", { width: Math.round(img.width * e), height: Math.round(img.height * e) });
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }

  function reprendreDepuisFactures() {
    const p = store.get("facture.profil", null);
    if (!p) return alert("Aucune info dans « Mon entreprise » (factures) sur ce navigateur.");
    const v = p.vendeur || {};
    parametres.nom = v.nom || parametres.nom;
    parametres.adresse = [v.adresse, [v.cp, v.ville].filter(Boolean).join(" "), v.pays].filter(Boolean).join(", ") || parametres.adresse;
    if (p.logo) parametres.logo = p.logo;
    sauverParametres();
    afficherParametres();
    remplirSelects();
    $("#etat-parametres").textContent = "✔ Infos reprises depuis tes factures (vérifie et complète SIREN, email, téléphone).";
  }

  // ---------- Historique ----------
  function afficherHistorique() {
    const tb = $("#liste-historique");
    tb.replaceChildren();
    if (!historique.length) return tb.append(el("tr", { class: "vide" }, el("td", { colSpan: 8, textContent: "Aucun document généré pour l'instant." })));
    for (const h of historique) {
      const emetteur = h.type === "recu" ? h.contact : h.moi;
      const beneficiaire = h.type === "recu" ? h.moi : h.contact;
      tb.append(
        el(
          "tr",
          {},
          el("td", { textContent: h.numero }),
          el("td", { textContent: TYPES[h.type].titre }),
          el("td", { textContent: dateFR(h.date) }),
          el("td", { class: "num", textContent: formatMontant(h.montant, h.devise) }),
          el("td", { textContent: emetteur?.nom || "—" }),
          el("td", { textContent: beneficiaire?.nom || "—" }),
          el("td", { textContent: h.reference || "—" }),
          el(
            "td",
            {},
            el(
              "div",
              { class: "actions-ligne" },
              el("button", { type: "button", class: "btn btn-secondaire", textContent: "Regénérer", onclick: () => regenerer(h) }),
              el("button", { type: "button", class: "btn btn-secondaire", textContent: "Télécharger", onclick: () => telechargerPDF(h) })
            )
          )
        )
      );
    }
  }

  // Recharge un document de l'historique dans le formulaire (un nouveau numéro sera attribué à la génération)
  function regenerer(h) {
    $("#d-type").value = h.type;
    const compte = parametres.comptes.find((c) => nettoyerIBAN(c.iban) === nettoyerIBAN(h.moi?.iban));
    if (compte) $("#d-mon-compte").value = compte.id;
    const contact = contacts.find((c) => nettoyerIBAN(c.iban) === nettoyerIBAN(h.contact?.iban) && c.nom === h.contact?.nom);
    $("#d-contact").value = contact ? contact.id : "";
    $("#d-c-nom").value = h.contact?.nom || "";
    $("#d-c-iban").value = h.contact?.iban || "";
    $("#d-c-banque").value = h.contact?.banque || "";
    $("#d-c-bic").value = h.contact?.bic || "";
    $("#d-date").value = h.date;
    $("#d-devise").value = h.devise;
    $("#d-montant").value = String(h.montant).replace(".", ",");
    $("#d-reference").value = h.reference || "";
    allerA("document");
    surModification();
    $("#etat-document").textContent = `Document ${h.numero} rechargé : modifie si besoin, puis « Générer le PDF ».`;
  }

  // ---------- Onglets ----------
  function allerA(nom) {
    for (const b of document.querySelectorAll(".onglet")) b.classList.toggle("actif", b.dataset.onglet === nom);
    for (const p of document.querySelectorAll(".page")) p.hidden = p.id !== `onglet-${nom}`;
    if (nom === "contacts") afficherContacts();
    if (nom === "historique") afficherHistorique();
    if (nom === "parametres") afficherParametres();
    if (nom === "document") {
      remplirSelects();
      majApercu();
    }
    try {
      history.replaceState(null, "", `#${nom}`);
    } catch {}
  }

  // ---------- Événements ----------
  for (const b of document.querySelectorAll(".onglet")) b.addEventListener("click", () => allerA(b.dataset.onglet));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-aller]");
    if (a) {
      e.preventDefault();
      allerA(a.dataset.aller);
    }
  });
  // « input » suffit (champs texte, date et listes) : « change » redessinerait la feuille au moment
  // où l'on clique dessus pour modifier un texte.
  for (const id of champs) if (id !== "d-contact") $("#" + id).addEventListener("input", surModification);
  $("#d-contact").addEventListener("change", () => {
    choisirContact();
    surModification();
  });
  $("#btn-generer").addEventListener("click", generer);
  $("#btn-edition").addEventListener("click", demarrerEdition);
  $("#btn-edition-fin").addEventListener("click", () => {
    enEdition = false;
    majOutilsEdition();
  });
  $("#btn-edition-reset").addEventListener("click", () => {
    if (!confirm("Remettre la mise en page d'origine ?")) return;
    parametres.miseEnPage = {};
    sauverParametres();
    majOutilsEdition();
    majApercu();
  });
  $("#r-interligne").addEventListener("input", (e) => {
    changerMiseEnPage({ interligne: Number(e.target.value) });
    majApercu();
  });
  $("#r-colonne").addEventListener("input", (e) => {
    changerMiseEnPage({ colonne: Number(e.target.value) });
    majApercu();
  });
  $("#btn-telecharger").addEventListener("click", () => dernierGenere && telechargerPDF(dernierGenere));

  $("#form-contact").addEventListener("submit", enregistrerContact);
  $("#btn-contact-annuler").addEventListener("click", viderFormContact);
  $("#form-compte").addEventListener("submit", enregistrerCompte);
  $("#btn-compte-annuler").addEventListener("click", viderFormCompte);
  for (const id of Object.keys(champsParam)) $("#" + id).addEventListener("input", enregistrerChampParam);
  $("#form-parametres").addEventListener("submit", (e) => e.preventDefault());
  $("#p-logo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      parametres.logo = await lireLogo(f);
      if (!sauverParametres()) throw new Error("Logo trop lourd pour le stockage du navigateur.");
      $("#p-apercu-logo").src = parametres.logo;
      $("#etat-parametres").textContent = "✔ Logo enregistré";
    } catch (err) {
      $("#etat-parametres").textContent = err.message;
    }
  });
  $("#btn-logo-factures").addEventListener("click", () => {
    const logo = store.get("facture.profil", {})?.logo;
    if (!logo) return alert("Aucun logo dans « Mon entreprise » (factures) sur ce navigateur.");
    parametres.logo = logo;
    sauverParametres();
    afficherParametres();
  });
  $("#btn-logo-retirer").addEventListener("click", () => {
    parametres.logo = "";
    sauverParametres();
    afficherParametres();
  });
  $("#btn-reprendre-factures").addEventListener("click", reprendreDepuisFactures);
  window.addEventListener("resize", ajusterApercu);
  feuille.addEventListener("load", ajusterApercu, true);

  // ---------- Démarrage ----------
  remplirSelects();
  chargerBrouillon();
  const depart = (location.hash || "").slice(1);
  allerA(["document", "contacts", "historique", "parametres"].includes(depart) ? depart : !parametres.nom || !parametres.comptes.length ? "parametres" : "document");
})();
