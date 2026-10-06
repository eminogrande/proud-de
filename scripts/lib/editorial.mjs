// Editorial data layer: printed credits, people registry, verified facts and static page copy.
// Honesty rule: everything rendered from here must come from the credits JSON, facts.json or config/*.json.
// Nothing is inferred: no bios, no titles, no contact data unless a file provides it.
import fs from "node:fs/promises";
import path from "node:path";

export const DNB_URL = "https://d-nb.info/992028108";
export const ISSUU_URL = "https://issuu.com/proud";
export const ZDB_ID = "2473146-8";
export const DNB_SHELF = "Z 2009 B 1863";
// Current status, supplied by the owner on 2026-10-06 (facts.json id "publisher-today", SELF-REPORTED):
// publisher today and operator of this website = Emin Mahrt, natural person (no company).
export const CURRENT_PUBLISHER = "Emin Mahrt";

// Single verified DFJV mention (facts.json id "dfjv-newsletter-2009-05"). Original mail held by the publisher;
// no public copy, so no link. Wording fixed by the owner; never "recognised" or "awarded".
export function dfjvMentionMarkdown(locale) {
  return locale === "en"
    ? "> The German professional journalists' association DFJV featured proud in its newsletter DFJV-News of 7 May 2009: “bunt, aufregend, frisch und eben anders” (colourful, exciting, fresh and simply different).\n\n— *DFJV-News, May 2009 (newsletter of the Deutscher Fachjournalisten-Verband, 7 May 2009)*"
    : "> Der Deutsche Fachjournalisten-Verband stellte proud im Newsletter DFJV-News vom 7. Mai 2009 vor: „bunt, aufregend, frisch und eben anders.“\n\n— *DFJV-News, Mai 2009 (Newsletter des Deutschen Fachjournalisten-Verbands, 7. Mai 2009)*";
}

// Printed-name variants that the masthead spells differently. The byline keeps the printed form;
// the author page uses the masthead form and says how the article printed it.
const NAME_ALIASES = new Map([
  ["Ron WIlson", "Ron Wilson"],
  ["Pumpa Peta", "Peta Pumpa"],
]);

// Credits that are image sources or brands, not people.
const NON_PERSON_RE = /(\.com\b|^www\.|flickr|\.de\b)/i;
const NON_PERSON_NAMES = new Set(["Rouge Bunny Rouge"]);

// Masthead roles (issue 01, page 6) as printed, with a German label.
export const MASTHEAD_ROLES = [
  ["publisher", "Publisher", "Herausgeber"],
  ["textEditor", "Text Editor", "Textredaktion"],
  ["fashionEditor", "Fashion Editor", "Moderedaktion"],
  ["eventManager", "Event Manager", "Eventmanagement"],
  ["advertisingManager", "Advertising Manager", "Anzeigen"],
  ["production", "Production", "Produktion"],
  ["cover", "Cover", "Cover"],
];

const LIST_ROLES = [
  ["regularContributors", "Regular Contributors", "Ständige Mitarbeit"],
  ["contributors", "Contributors", "Mitarbeit"],
  ["correction", "Correction", "Korrektur"],
  ["specialThanksTo", "Special Thanks To", "Besonderer Dank"],
];

export function slugifyName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[»«"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isPersonCredit(credit) {
  const name = String(credit?.name ?? "").trim();
  return Boolean(name) && !NON_PERSON_RE.test(name) && !NON_PERSON_NAMES.has(name);
}

export function canonicalPersonName(printedName) {
  return NAME_ALIASES.get(printedName) ?? printedName;
}

function creditRoleLabel(credit, locale) {
  const en = locale === "en";
  switch (credit.role) {
    case "text":
      return /gast/i.test(credit.printedLabel ?? "") ? (en ? "Guest author" : "Gastautor") : (en ? "Text" : "Text");
    case "photo":
      return en ? "Photo" : "Foto";
    case "layout":
      return "Layout";
    default:
      return credit.printedLabel ?? (en ? "Credit" : "Credit");
  }
}

export async function loadEditorialData(projectRoot) {
  const read = async (relative, fallback = null) => {
    try {
      return JSON.parse(await fs.readFile(path.join(projectRoot, relative), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  };
  const creditFiles = await fs.readdir(path.join(projectRoot, "data/input/credits")).catch(() => []);
  const creditsByMagazine = new Map();
  for (const file of creditFiles.filter((name) => name.endsWith(".json"))) {
    const payload = await read(path.join("data/input/credits", file));
    if (payload?.issue?.magazineSlug) creditsByMagazine.set(payload.issue.magazineSlug, payload);
  }
  return {
    creditsByMagazine,
    facts: (await read("data/input/facts.json", [])) ?? [],
    contact: normalizeConfig(await read("config/contact.json", {})),
    legal: normalizeConfig(await read("config/legal.json", {})),
  };
}

function normalizeConfig(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (key.startsWith("_")) continue;
    out[key] = typeof entry === "string" ? entry.trim() : entry;
  }
  return out;
}

export function legalIsComplete(legal) {
  return ["operatorName", "responsibleEditor", "street", "postalCode", "city", "email"].every((key) => Boolean(legal?.[key]));
}

export function articleCredits(editorial, article) {
  const issue = editorial.creditsByMagazine.get(article.magazineSlug);
  const entry = issue?.articles?.[article.slug];
  if (!entry) return { credits: [], confidence: null };
  return { credits: entry.credits ?? [], confidence: entry.confidence ?? null };
}

// Build the people registry from printed article credits plus the issue masthead roles.
export function buildPeople(editorial, articles) {
  const people = new Map();
  const listRoles = [];
  const ensure = (name) => {
    const canonical = canonicalPersonName(name);
    const slug = slugifyName(canonical);
    if (!people.has(slug)) {
      people.set(slug, { slug, name: canonical, printedAs: new Set(), mastheadRoles: [], credits: [], bio: null, bioSource: null, issues: new Set() });
    }
    const person = people.get(slug);
    if (name !== canonical) person.printedAs.add(name);
    return person;
  };

  for (const [magazineSlug, payload] of editorial.creditsByMagazine) {
    const masthead = payload.issue?.masthead ?? {};
    for (const [key, labelEn, labelDe] of MASTHEAD_ROLES) {
      for (const name of masthead[key] ?? []) {
        const person = ensure(name);
        person.mastheadRoles.push({ magazineSlug, key, en: labelEn, de: labelDe, page: masthead.sourcePage ?? null });
        person.issues.add(magazineSlug);
      }
    }
    for (const [key, labelEn, labelDe] of LIST_ROLES) {
      for (const name of masthead[key] ?? []) {
        listRoles.push({ slug: slugifyName(canonicalPersonName(name)), role: { magazineSlug, key, en: labelEn, de: labelDe, page: masthead.sourcePage ?? null } });
      }
    }
    for (const contributor of payload.issue?.contributors ?? []) {
      if (!contributor.bioText) continue;
      const slug = slugifyName(canonicalPersonName(contributor.name));
      const person = people.get(slug) ?? ensure(contributor.name);
      person.bio = contributor.bioText;
      person.bioSource = { magazineSlug, page: contributor.sourcePage ?? null };
    }
  }

  const articleBySlug = new Map(articles.map((article) => [article.slug, article]));
  for (const [magazineSlug, payload] of editorial.creditsByMagazine) {
    for (const [slug, entry] of Object.entries(payload.articles ?? {})) {
      if (entry.confidence === "low" || !articleBySlug.has(slug)) continue;
      for (const credit of entry.credits ?? []) {
        if (!isPersonCredit(credit)) continue;
        const person = ensure(credit.name);
        person.credits.push({ articleSlug: slug, magazineSlug, role: credit.role, printedLabel: credit.printedLabel, printedName: credit.name });
        person.issues.add(magazineSlug);
      }
    }
  }

  // List roles (regular contributors, correction ...) are added only to people who already have a page.
  for (const { slug, role } of listRoles) {
    const person = people.get(slug);
    if (person && !person.mastheadRoles.some((entry) => entry.key === role.key)) person.mastheadRoles.push(role);
  }

  // Only people with an article credit, a masthead role or a printed bio get a page.
  return [...people.values()]
    .filter((person) => person.credits.length || person.mastheadRoles.length || person.bio)
    .map((person) => ({ ...person, printedAs: [...person.printedAs], issues: [...person.issues] }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function personRoleLabels(person, locale) {
  const labels = [];
  for (const role of person.mastheadRoles) labels.push(locale === "en" ? role.en : role.de);
  for (const credit of person.credits) {
    labels.push(creditRoleLabel(credit, locale));
  }
  return [...new Set(labels)];
}

// Byline model for one article: text authors first, then secondary credits, all as printed.
export function bylineFor(editorial, article, peopleBySlug, locale) {
  const { credits, confidence } = articleCredits(editorial, article);
  const linked = (credit) => {
    const slug = slugifyName(canonicalPersonName(credit.name));
    return isPersonCredit(credit) && confidence !== "low" && peopleBySlug.has(slug) ? slug : null;
  };
  const authors = credits.filter((credit) => credit.role === "text").map((credit) => ({
    name: credit.name,
    slug: linked(credit),
    label: creditRoleLabel(credit, locale),
    guest: /gast/i.test(credit.printedLabel ?? ""),
  }));
  const secondary = credits.filter((credit) => credit.role !== "text").map((credit) => ({
    name: credit.name,
    slug: linked(credit),
    label: creditRoleLabel(credit, locale),
    role: credit.role,
  }));
  return { authors, secondary, confidence };
}

export function factById(editorial, id) {
  return editorial.facts.find((fact) => fact.id === id) ?? null;
}

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(isoMonth, locale) {
  const [year, month] = String(isoMonth ?? "").split("-");
  if (!month) return year ?? "";
  return `${(locale === "en" ? MONTHS_EN : MONTHS_DE)[Number(month) - 1]} ${year}`;
}

// ---------- Static page copy (Markdown; the same text feeds the HTML page and the Markdown twin) ----------

export const STATIC_PAGES = ["about", "masthead", "standards", "press", "corrections", "archive-guide"];

export function staticPageTitle(key, locale) {
  const en = locale === "en";
  return {
    about: en ? "About proud" : "Über proud",
    masthead: en ? "Masthead" : "Redaktion",
    standards: en ? "Editorial standards and archive policy" : "Redaktionelle Grundsätze und Archivregeln",
    press: en ? "Press" : "Presse",
    corrections: en ? "Corrections and rights requests" : "Korrekturen und Rechteanfragen",
    "archive-guide": en ? "Archive guide" : "Archiv-Leitfaden",
    authors: en ? "Authors" : "Autor:innen",
    impressum: en ? "Legal notice" : "Impressum",
    datenschutz: en ? "Privacy" : "Datenschutz",
  }[key];
}

export function staticPageDescription(key, locale) {
  const en = locale === "en";
  return {
    about: en
      ? "What proud magazine Berlin was, how this archive republishes it, and where the printed issues are held."
      : "Was proud magazine Berlin war, wie dieses Archiv die Hefte neu veröffentlicht und wo die gedruckten Ausgaben liegen.",
    masthead: en
      ? "The masthead of proud issue 01 (January 2009), reproduced as printed on page 6."
      : "Das Impressum von proud Heft 01 (Januar 2009), so wiedergegeben wie auf Seite 6 gedruckt.",
    standards: en
      ? "How the proud archive republishes printed articles, what is changed, and how errors are handled."
      : "Wie das proud-Archiv gedruckte Artikel neu veröffentlicht, was verändert wird und wie Fehler behandelt werden.",
    press: en
      ? "Verified facts about proud magazine Berlin for journalists, with sources."
      : "Belegte Fakten über proud magazine Berlin für Journalist:innen, mit Quellen.",
    corrections: en
      ? "How to report errors in the proud archive and how rights holders can ask for changes."
      : "Wie man Fehler im proud-Archiv meldet und wie Rechteinhaber Änderungen anfragen.",
    "archive-guide": en
      ? "How to read, search and cite the proud archive, for people and for software agents."
      : "Wie man das proud-Archiv liest, durchsucht und zitiert, für Menschen und für Software-Agenten.",
    authors: en
      ? "Everyone credited in print in the published proud issues, with roles and articles."
      : "Alle Personen mit gedrucktem Credit in den veröffentlichten proud-Heften, mit Rollen und Artikeln.",
    impressum: en ? "Legal notice of this website." : "Impressum dieser Website.",
    datenschutz: en ? "Privacy information for this website." : "Datenschutzhinweise dieser Website.",
  }[key];
}

function dnbLine(locale) {
  return locale === "en"
    ? `The German National Library (Deutsche Nationalbibliothek) holds proud in Frankfurt am Main and Leipzig: shelf mark ${DNB_SHELF}, holdings 2009 to 6.2014, ZDB ID ${ZDB_ID}. Catalogue record: [d-nb.info/992028108](${DNB_URL}).`
    : `Die Deutsche Nationalbibliothek führt proud in Frankfurt am Main und Leipzig: Signatur ${DNB_SHELF}, Bestand 2009 bis 6.2014, ZDB-ID ${ZDB_ID}. Katalogeintrag: [d-nb.info/992028108](${DNB_URL}).`;
}

function contactBlock(contact, key, locale) {
  const email = contact?.[key] || contact?.email || "";
  if (!email) {
    return locale === "en"
      ? "A contact address will be published here once it is set."
      : "Eine Kontaktadresse wird hier veröffentlicht, sobald sie feststeht.";
  }
  return `${locale === "en" ? "E-mail" : "E-Mail"}: [${email}](mailto:${email})`;
}

export function staticPageMarkdown(key, locale, context) {
  return staticPageMarkdownRaw(key, locale, context).replace("@@DFJV_QUOTE@@", dfjvMentionMarkdown(locale));
}

// HTML for the DFJV mention: plain blockquote + cite, no URL (no public copy exists).
export function dfjvMentionHtml(locale) {
  return locale === "en"
    ? `<figure class="press-quote"><blockquote><p>The German professional journalists' association DFJV featured proud in its newsletter DFJV-News of 7 May 2009: <q lang="de">bunt, aufregend, frisch und eben anders</q> (colourful, exciting, fresh and simply different).</p></blockquote><figcaption>— <cite>DFJV-News, May 2009</cite>, newsletter of the Deutscher Fachjournalisten-Verband, <time datetime="2009-05-07">7 May 2009</time></figcaption></figure>`
    : `<figure class="press-quote"><blockquote><p>Der Deutsche Fachjournalisten-Verband stellte proud im Newsletter DFJV-News vom 7. Mai 2009 vor: „bunt, aufregend, frisch und eben anders.“</p></blockquote><figcaption>— <cite>DFJV-News, Mai 2009</cite>, Newsletter des Deutschen Fachjournalisten-Verbands, <time datetime="2009-05-07">7. Mai 2009</time></figcaption></figure>`;
}

export function staticPageMarkdownWithMarker(key, locale, context) {
  return staticPageMarkdownRaw(key, locale, context);
}

function staticPageMarkdownRaw(key, locale, { editorial, site, routes, publishedIssues, articleCount, authorCount }) {
  const en = locale === "en";
  const issue01 = editorial.creditsByMagazine.values().next().value;
  const masthead = issue01?.issue?.masthead ?? {};
  switch (key) {
    case "about":
      return en
        ? [
            "proud was an independent monthly magazine from Berlin about music, city life, nightlife, style and art.",
            "The first issue appeared in January 2009. A dummy issue #00 had been produced in 2008. The German National Library records the magazine as monthly, 2009 to 2014, with issue #32 as the final issue (catalogue wording: \"Ausgabe #32 ; damit Erscheinen eingestellt\").",
            "## Publisher",
            `Publisher today: ${CURRENT_PUBLISHER}. He runs this archive as a private person.`,
            "Issue 01 (2009): publishers according to the masthead, Richard Kirschstein and Emin Henri Mahrt. According to the German National Library catalogue, the magazine was published over the years by Kirschstein & Mahrt GbR, Proud GbR and Proud Works GmbH, Berlin. None of these entities operates this website.",
            "## Library record",
            dnbLine(locale),
            "## Press mention",
            "@@DFJV_QUOTE@@",
            "## This archive",
            `This website republishes the printed issues as a reading edition. Each article keeps a link to the scanned original pages. So far ${publishedIssues} issue is online with ${articleCount} articles. More issues follow once their text has been checked.`,
            `Read how the republication works in the [editorial standards](${routes.standards}), see who made issue 01 in the [masthead](${routes.masthead}), or browse the [authors](${routes.authors}).`,
          ].join("\n\n")
        : [
            "proud war ein unabhängiges Monatsmagazin aus Berlin über Musik, Stadt, Nachtleben, Stil und Kunst.",
            "Die erste Ausgabe erschien im Januar 2009. Davor gab es 2008 ein Dummy-Heft #00. Die Deutsche Nationalbibliothek verzeichnet das Magazin als monatlich, 2009 bis 2014, mit Ausgabe #32 als letztem Heft (Katalogtext: „Ausgabe #32 ; damit Erscheinen eingestellt“).",
            "## Herausgeber",
            `Herausgeber heute: ${CURRENT_PUBLISHER}. Er betreibt dieses Archiv als Privatperson.`,
            "Heft 01 (2009): Herausgeber laut Impressum Richard Kirschstein und Emin Henri Mahrt. Laut Katalog der Deutschen Nationalbibliothek erschien das Magazin im Lauf der Jahre bei der Kirschstein & Mahrt GbR, der Proud GbR und der Proud Works GmbH, Berlin. Keine dieser Gesellschaften betreibt diese Website.",
            "## Bibliotheksnachweis",
            dnbLine(locale),
            "## Presse",
            "@@DFJV_QUOTE@@",
            "## Dieses Archiv",
            `Diese Website veröffentlicht die gedruckten Hefte als Leseausgabe neu. Jeder Artikel verlinkt auf die gescannten Originalseiten. Bisher ist ${publishedIssues} Heft mit ${articleCount} Artikeln online. Weitere Hefte folgen, sobald ihr Text geprüft ist.`,
            `Wie die Neuveröffentlichung funktioniert, steht in den [Grundsätzen](${routes.standards}). Wer Heft 01 gemacht hat, zeigt die [Redaktion](${routes.masthead}). Alle Beteiligten mit Credit: [Autor:innen](${routes.authors}).`,
          ].join("\n\n");
    case "masthead": {
      const lines = [];
      lines.push(en
        ? `Publisher today: ${CURRENT_PUBLISHER}, who also runs this archive as a private person. Below is the historical masthead of issue 01 (January 2009), exactly as printed on page ${masthead.sourcePage ?? 6}. Role names are kept in the original English.`
        : `Herausgeber heute: ${CURRENT_PUBLISHER}, der dieses Archiv als Privatperson betreibt. Darunter steht das historische Impressum von Heft 01 (Januar 2009), genau wie auf Seite ${masthead.sourcePage ?? 6} gedruckt. Die Rollen stehen im englischen Original.`);
      lines.push(`## ${en ? "Masthead of issue 01 (January 2009)" : "Redaktion Heft 01 (Januar 2009)"}`);
      for (const [roleKey, labelEn] of MASTHEAD_ROLES) {
        const names = masthead[roleKey] ?? [];
        if (!names.length) continue;
        lines.push(`- **${labelEn}:** ${names.map((name) => `[${name}](${routes.author(slugifyName(canonicalPersonName(name)))})`).join(", ")}`);
      }
      for (const [roleKey, labelEn] of LIST_ROLES) {
        const names = masthead[roleKey] ?? [];
        if (!names.length) continue;
        lines.push(`- **${labelEn}:** ${names.join(", ")}`);
      }
      if (masthead.publisherEntity) {
        lines.push(`- **${en ? "Publishing entity" : "Verlag"}:** ${masthead.publisherEntity}, Berlin`);
      }
      lines.push(`## ${en ? "Notes" : "Hinweise"}`);
      lines.push(en
        ? "- As printed in the masthead of issue 01. The roles describe 2009, not today.\n- Not printed in issue 01: print run, printer, person responsible under press law.\n- The contact details printed in the issue are not reproduced here.\n- Before issue 01 a dummy issue #00 appeared in 2008.\n- Source: scan of issue 01, page 6. Full data: `data/input/credits/01-proud-issuu-output.json` in the public repository."
        : "- So gedruckt im Impressum von Heft 01. Die Rollen beschreiben 2009, nicht heute.\n- Nicht in Heft 01 gedruckt: Auflage, Druckerei, V.i.S.d.P.\n- Die im Heft gedruckten Kontaktdaten werden hier nicht wiedergegeben.\n- Vor Heft 01 erschien 2008 ein Dummy-Heft #00.\n- Quelle: Scan von Heft 01, Seite 6. Vollständige Daten: `data/input/credits/01-proud-issuu-output.json` im öffentlichen Repository.");
      return lines.join("\n\n");
    }
    case "standards":
      return en
        ? [
            "## What this archive is",
            "A faithful republication of articles that were printed in proud between 2009 and 2014. The printed issue is the reference. New articles are not written here.",
            "## What stays as printed",
            "- Headlines, rubrics, article text and credits are taken from the printed page.\n- Names are spelled as printed. Where the masthead spells a name differently, the author page says so.\n- Every article links to the scanned original pages, so readers can check the text against print.",
            "## What is added or changed",
            "- The text was read from the scans by OCR and then cleaned. OCR errors can remain.\n- Short decks and English versions are machine-generated. English pages say so and link to the German original.\n- Image cutouts on article pages are crops of the printed pages, marked \"From the magazine\". Photo credits are shown only where they are printed.\n- Bylines appear only where the issue printed a credit. Articles without a printed credit show no author.",
            "## Errors and rights",
            `Factual or transcription errors are corrected against the printed page. How to report one, and how rights holders can ask for changes or removal: [corrections and rights requests](${routes.corrections}).`,
          ].join("\n\n")
        : [
            "## Was dieses Archiv ist",
            "Eine originalgetreue Neuveröffentlichung von Artikeln, die zwischen 2009 und 2014 in proud gedruckt wurden. Maßstab ist das gedruckte Heft. Hier entstehen keine neuen Artikel.",
            "## Was bleibt wie gedruckt",
            "- Überschriften, Rubriken, Artikeltext und Credits stammen von der gedruckten Seite.\n- Namen stehen so, wie sie gedruckt wurden. Wo das Impressum einen Namen anders schreibt, steht das auf der Autorenseite.\n- Jeder Artikel verlinkt die gescannten Originalseiten. So lässt sich der Text mit dem Druck vergleichen.",
            "## Was ergänzt oder verändert wird",
            "- Der Text wurde per OCR aus den Scans gelesen und bereinigt. OCR-Fehler sind möglich.\n- Kurzfassungen und englische Fassungen sind maschinell erstellt. Englische Seiten sagen das und verlinken das deutsche Original.\n- Bildausschnitte auf Artikelseiten sind Ausschnitte der gedruckten Seiten, markiert mit „Aus dem Heft“. Fotocredits stehen nur dort, wo sie gedruckt sind.\n- Eine Autorenzeile gibt es nur, wenn das Heft einen Credit gedruckt hat. Artikel ohne gedruckten Credit zeigen keine Autor:innen.",
            "## Fehler und Rechte",
            `Sach- und Übertragungsfehler werden anhand der gedruckten Seite korrigiert. Wie man einen Fehler meldet und wie Rechteinhaber Änderung oder Entfernung anfragen: [Korrekturen und Rechteanfragen](${routes.corrections}).`,
          ].join("\n\n");
    case "press": {
      const printRun = factById(editorial, "print-run-20000");
      const secondary = ["yuja-wang", "wikipedia-soundcloud", "wikipedia-independent", "third-party-reprint"]
        .map((id) => factById(editorial, id))
        .filter((fact) => fact && /^VERIFIED/.test(fact.status));
      const lines = [];
      lines.push(`## ${en ? "Facts" : "Fakten"}`);
      lines.push((en
        ? [
            "- Name: proud magazine Berlin",
            "- Frequency: monthly, 2009 to 2014 (German National Library)",
            "- First issue: 01, January 2009. Dummy issue #00: 2008",
            "- Final issue: #32",
            `- Publisher today: ${CURRENT_PUBLISHER} (private person; also operates this archive)`,
            "- Issue 01 (2009): publishers according to the masthead, Richard Kirschstein and Emin Henri Mahrt",
            `- Library: German National Library, shelf mark ${DNB_SHELF}, ZDB ID ${ZDB_ID}, [catalogue record](${DNB_URL})`,
          ]
        : [
            "- Name: proud magazine Berlin",
            "- Erscheinungsweise: monatlich, 2009 bis 2014 (Deutsche Nationalbibliothek)",
            "- Erstes Heft: 01, Januar 2009. Dummy-Heft #00: 2008",
            "- Letztes Heft: #32",
            `- Herausgeber heute: ${CURRENT_PUBLISHER} (Privatperson; betreibt auch dieses Archiv)`,
            "- Heft 01 (2009): Herausgeber laut Impressum Richard Kirschstein und Emin Henri Mahrt",
            `- Bibliothek: Deutsche Nationalbibliothek, Signatur ${DNB_SHELF}, ZDB-ID ${ZDB_ID}, [Katalogeintrag](${DNB_URL})`,
          ]).join("\n"));
      if (printRun) {
        lines.push(en
          ? "According to the publishers, each issue had a print run of 20,000 copies. This figure is not independently verified."
          : "Nach Angaben der Herausgeber erschien jedes Heft in einer Auflage von 20.000 Exemplaren. Unabhängig belegt ist diese Zahl nicht.");
      }
      lines.push(`## ${en ? "Press mention 2009" : "Erwähnung 2009"}`);
      lines.push("@@DFJV_QUOTE@@");
      if (secondary.length) {
        lines.push(`## ${en ? "Mentions with sources" : "Erwähnungen mit Quellen"}`);
        lines.push(secondary.map((fact) => `- ${en ? fact.claim_en : fact.claim_de} [${en ? "Source" : "Quelle"}](${fact.sources[0].url})`).join("\n"));
      }
      lines.push(`## ${en ? "Press contact" : "Pressekontakt"}`);
      lines.push(contactBlock(editorial.contact, "pressEmail", locale));
      lines.push(`## ${en ? "More" : "Mehr"}`);
      lines.push(en
        ? `- [About proud](${routes.about})\n- [Masthead of issue 01](${routes.masthead})\n- [Editorial standards](${routes.standards})`
        : `- [Über proud](${routes.about})\n- [Redaktion Heft 01](${routes.masthead})\n- [Grundsätze](${routes.standards})`);
      return lines.join("\n\n");
    }
    case "corrections":
      return en
        ? [
            "## Report an error",
            "If an article in this archive differs from the printed page, or a name or credit is wrong, please tell us. Name the article URL and the page number.",
            "## Rights requests",
            "If you hold rights in a text or image in this archive and want it credited differently, changed or removed, please write to us with the article URL.",
            "## Contact",
            contactBlock(editorial.contact, "correctionsEmail", locale),
            "## How corrections are shown",
            `Corrections are made against the printed page. See the [editorial standards](${routes.standards}).`,
          ].join("\n\n")
        : [
            "## Fehler melden",
            "Wenn ein Artikel in diesem Archiv von der gedruckten Seite abweicht oder ein Name oder Credit falsch ist, sagen Sie uns bitte Bescheid. Nennen Sie die Artikel-URL und die Seitenzahl.",
            "## Rechteanfragen",
            "Wenn Sie Rechte an einem Text oder Bild in diesem Archiv haben und eine andere Nennung, Änderung oder Entfernung wünschen, schreiben Sie uns bitte mit der Artikel-URL.",
            "## Kontakt",
            contactBlock(editorial.contact, "correctionsEmail", locale),
            "## Wie Korrekturen erfolgen",
            `Korrekturen erfolgen anhand der gedruckten Seite. Siehe [Grundsätze](${routes.standards}).`,
          ].join("\n\n");
    case "archive-guide": {
      const base = `https://${site.domain}`;
      return en
        ? [
            "## Reading",
            `- [All articles](${routes.articles}) and [all issues](${routes.issues}).\n- Each article has the reading text, the scanned original pages and links to stories from the same issue.\n- [Authors](${routes.authors}) lists everyone with a printed credit.`,
            "## Citing",
            "Cite title, issue, page range and URL, for example: \"love in berlin\", proud #01, January 2009, pages 22-23, " + `${base}/articles/love-in-berlin/.`,
            "## For software and AI agents",
            `- [llms.txt](${base}/en/llms.txt) and [llms-full.txt](${base}/en/llms-full.txt): reading lists.\n- Every page has a Markdown twin: add \`index.md\` to the URL or send \`Accept: text/markdown\`.\n- JSON: [/api/articles.json](${base}/api/articles.json), [/api/authors.json](${base}/api/authors.json), [OpenAPI](${base}/api/openapi.json).\n- Search: \`${base}/api/search?q=techno\`.\n- MCP: [server card](${base}/.well-known/mcp/server-card.json).\n- All access is read-only and needs no login.`,
          ].join("\n\n")
        : [
            "## Lesen",
            `- [Alle Artikel](${routes.articles}) und [alle Ausgaben](${routes.issues}).\n- Jeder Artikel hat den Lesetext, die gescannten Originalseiten und Links zu Geschichten aus demselben Heft.\n- [Autor:innen](${routes.authors}) listet alle Personen mit gedrucktem Credit.`,
            "## Zitieren",
            "Titel, Heft, Seiten und URL nennen, zum Beispiel: „love in berlin“, proud #01, Januar 2009, Seiten 22-23, " + `${base}/articles/love-in-berlin/.`,
            "## Für Software und KI-Agenten",
            `- [llms.txt](${base}/llms.txt) und [llms-full.txt](${base}/llms-full.txt): Leselisten.\n- Jede Seite hat einen Markdown-Zwilling: \`index.md\` an die URL hängen oder \`Accept: text/markdown\` senden.\n- JSON: [/api/articles.json](${base}/api/articles.json), [/api/authors.json](${base}/api/authors.json), [OpenAPI](${base}/api/openapi.json).\n- Suche: \`${base}/api/search?q=techno\`.\n- MCP: [Server Card](${base}/.well-known/mcp/server-card.json).\n- Alles ist nur lesend und ohne Login nutzbar.`,
          ].join("\n\n");
    }
    case "impressum": {
      const legal = editorial.legal;
      // Operator is a natural person (no company, no register number).
      const address = `${legal.operatorName}  \n${legal.street}  \n${legal.postalCode} ${legal.city}`;
      return [
        `## ${en ? "Operator" : "Anbieter"}`,
        address.replace(/ {2}\n/g, "\n\n"),
        `${en ? "E-mail" : "E-Mail"}: [${legal.email}](mailto:${legal.email})${legal.phone ? `\n\n${en ? "Phone" : "Telefon"}: ${legal.phone}` : ""}${legal.vatId ? `\n\n${en ? "VAT ID" : "USt-IdNr."}: ${legal.vatId}` : ""}`,
        `## ${en ? "Responsible for content under § 18 (2) MStV" : "Verantwortlich i. S. d. § 18 Abs. 2 MStV"}`,
        `${legal.responsibleEditor}${legal.responsibleEditorAddress ? `, ${legal.responsibleEditorAddress}` : ""}`,
      ].join("\n\n");
    }
    case "datenschutz": {
      const legal = editorial.legal;
      return en
        ? [
            "## Controller",
            `${legal.operatorName}, ${legal.street}, ${legal.postalCode} ${legal.city}. E-mail: [${legal.email}](mailto:${legal.email})`,
            "## Hosting",
            "This website is served by Cloudflare. When you open a page, your browser sends technical data such as IP address, time and requested URL. The website code itself sets no cookies and loads no tracking scripts.",
            "## Embedded videos",
            "Some articles embed YouTube videos. Loading them sends data to YouTube.",
          ].join("\n\n")
        : [
            "## Verantwortlicher",
            `${legal.operatorName}, ${legal.street}, ${legal.postalCode} ${legal.city}. E-Mail: [${legal.email}](mailto:${legal.email})`,
            "## Hosting",
            "Diese Website wird über Cloudflare ausgeliefert. Beim Aufruf überträgt Ihr Browser technische Daten wie IP-Adresse, Zeitpunkt und aufgerufene URL. Der Code dieser Website setzt keine Cookies und lädt keine Tracking-Skripte.",
            "## Eingebettete Videos",
            "Einige Artikel binden YouTube-Videos ein. Beim Laden werden Daten an YouTube übertragen.",
          ].join("\n\n");
    }
    default:
      return "";
  }
}
