import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const PORT = Number(process.env.PORT || 8080);
const PLANTNET_API_KEY =
  process.env.PLANTNET_API_KEY || process.env.EXPO_PUBLIC_PLANTNET_API_KEY;
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || process.env.EXPO_PUBLIC_HUGGINGFACE_TOKEN;
const HF_DISEASE_MODEL = process.env.HF_DISEASE_MODEL || process.env.EXPO_PUBLIC_HF_DISEASE_MODEL;
const HF_NARRATIVE_MODEL =
  process.env.HF_NARRATIVE_MODEL ||
  process.env.HF_HISTORY_MODEL ||
  process.env.EXPO_PUBLIC_HF_NARRATIVE_MODEL ||
  process.env.EXPO_PUBLIC_HF_HISTORY_MODEL;
const HF_ROUTER = "https://router.huggingface.co";
const LANGUAGE_NAME = {
  it: "Italian",
  en: "English",
  es: "Spanish"
};
const WIKI_SECTION_ANCHORS = {
  it: {
    description: "Descrizione",
    history: "Storia",
    habitat: "Habitat",
    toxicity: "Tossicità",
    care: "Coltivazione",
    funFacts: "Curiosità"
  },
  en: {
    description: "Description",
    history: "History",
    habitat: "Habitat",
    toxicity: "Toxicity",
    care: "Cultivation",
    funFacts: "Trivia"
  },
  es: {
    description: "Descripción",
    history: "Historia",
    habitat: "Hábitat",
    toxicity: "Toxicidad",
    care: "Cultivo",
    funFacts: "Curiosidades"
  }
};

const ORGAN_CANDIDATES = ["auto", "flower", "leaf"];
const LANGUAGE_FALLBACKS = {
  it: ["ita", "it", "en", "eng"],
  en: ["eng", "en"],
  es: ["spa", "es", "en", "eng"]
};
const WIKI_SECTION_KEYWORDS = {
  it: {
    history: ["storia", "etimologia", "origine"],
    funFacts: ["curiosita", "usi", "cultura", "tradizione", "folklore"]
  },
  en: {
    history: ["history", "etymology", "origin"],
    funFacts: ["trivia", "uses", "culture", "tradition", "folklore"]
  },
  es: {
    history: ["historia", "etimologia", "origen"],
    funFacts: ["curiosidades", "usos", "cultura", "tradicion", "folclore"]
  }
};

const parseJsonSafe = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const fetchJsonOrNull = async (url, options = {}, timeoutMs = 9000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const buildSectionLinks = (wikiPageUrl, scientificName, language, sourceLinks = {}) => {
  const safeLang = ["it", "en", "es"].includes(language) ? language : "en";
  const anchors = WIKI_SECTION_ANCHORS[safeLang];

  const wikiSearchBase = `https://${safeLang}.wikipedia.org/w/index.php?search=${encodeURIComponent(
    scientificName
  )}`;
  const wikiAnchored = wikiPageUrl
    ? Object.entries(anchors).reduce((acc, [key, anchor]) => {
        acc[key] = `${wikiPageUrl}#${encodeURIComponent(anchor)}`;
        return acc;
      }, {})
    : {
        description: `${wikiSearchBase}%20description`,
        history: `${wikiSearchBase}%20history`,
        habitat: `${wikiSearchBase}%20habitat`,
        toxicity: `${wikiSearchBase}%20toxicity`,
        care: `${wikiSearchBase}%20cultivation`,
        funFacts: `${wikiSearchBase}%20facts`
      };

  return {
    description: wikiAnchored.description,
    history: sourceLinks.history || wikiAnchored.history,
    habitat: sourceLinks.habitat || wikiAnchored.habitat,
    toxicity: sourceLinks.toxicity || wikiAnchored.toxicity,
    care: sourceLinks.care || wikiAnchored.care,
    funFacts: sourceLinks.funFacts || wikiAnchored.funFacts
  };
};

const stripHtml = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncateText = (value, maxLen = 260) => {
  const clean = String(value || "").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
};

const splitSentences = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

const regionNameFromCode = (code, language) => {
  try {
    const locale = language === "it" ? "it-IT" : language === "es" ? "es-ES" : "en-US";
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(code) || code;
  } catch {
    return code;
  }
};

const extractHttpError = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await response.json();
    if (typeof body?.error === "string" && typeof body?.message === "string") {
      return `${body.error}: ${body.message}`;
    }
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.message === "string") return body.message;
    return JSON.stringify(body).slice(0, 300);
  }
  const text = await response.text();
  return text.slice(0, 300);
};

const classifyPlantNet = async (buffer, mimeType) => {
  if (!PLANTNET_API_KEY) {
    throw new Error("Server misconfigured: missing PLANTNET_API_KEY.");
  }

  let lastError = "";
  const attemptErrors = [];

  for (const organ of ORGAN_CANDIDATES) {
    const form = new FormData();
    form.append("images", new Blob([buffer], { type: mimeType || "image/jpeg" }), "plant.jpg");
    form.append("organs", organ);

    const response = await fetch(
      `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(
        PLANTNET_API_KEY
      )}&lang=en&no-reject=true`,
      {
        method: "POST",
        body: form
      }
    );

    if (!response.ok) {
      const err = await extractHttpError(response);
      lastError = `organ=${organ} status=${response.status} error=${err}`;
      attemptErrors.push(lastError);
      continue;
    }

    const data = await response.json();
    const results = (data?.results || [])
      .map((item) => ({
        species:
          item?.species?.scientificNameWithoutAuthor || item?.species?.scientificName || "Unknown species",
        confidence: Number(item?.score || 0)
      }))
      .filter((item) => item.species !== "Unknown species")
      .sort((a, b) => b.confidence - a.confidence);

    if (!results.length) {
      lastError = `organ=${organ} returned no species`;
      attemptErrors.push(lastError);
      continue;
    }

    const topSpecies = results[0].species;
    const seen = new Set([topSpecies.toLowerCase()]);
    const alternatives = [];
    for (const item of results.slice(1)) {
      const key = item.species.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      alternatives.push(item);
      if (alternatives.length === 3) break;
    }

    return {
      provider: "plantnet",
      topSpecies,
      confidence: results[0].confidence,
      alternatives,
      disease: null
    };
  }

  throw new Error(
    `PlantNet failed: ${lastError || "unknown error"}; attempts=${attemptErrors.join(" | ")}`
  );
};

const classifyDiseaseHF = async (buffer, mimeType) => {
  if (!HF_TOKEN || !HF_DISEASE_MODEL) return null;

  const response = await fetch(`${HF_ROUTER}/hf-inference/models/${HF_DISEASE_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      "Content-Type": mimeType || "image/jpeg"
    },
    body: buffer
  });

  if (!response.ok) return null;

  const labels = await response.json();
  if (!Array.isArray(labels) || !labels.length) return null;

  const top = [...labels].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  if (!top || !top.label || Number(top.score) < 0.3) return null;

  return {
    label: String(top.label),
    confidence: Number(top.score),
    provider: "huggingface"
  };
};

const fetchWikiSummary = async (species, lang) => {
  const response = await fetch(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(species)}`
  );
  if (!response.ok) return null;
  return response.json();
};

const searchWikiTitle = async (query, lang) => {
  const response = await fetch(
    `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
      query
    )}&limit=1&namespace=0&format=json`
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data?.[1]?.[0] || null;
};

const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isLikelyScientificName = (value, scientificName) => {
  const normalized = normalizeName(value);
  const normalizedScientific = normalizeName(scientificName);
  if (!normalized) return false;
  if (normalized === normalizedScientific) return true;
  return /^[a-z]+ [a-z]+(?: [a-z]+)?$/.test(normalized);
};

const cleanWikiTitle = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeForMatch = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const isLikelyFamilyOnly = (value) => /aceae$/i.test(String(value || "").trim());

const buildAspcaSearchUrl = (commonName, scientificName) => {
  const query = `${commonName || ""} ${scientificName || ""} toxic non-toxic plants`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(
    `site:aspca.org ${query}`
  )}`;
};

const getUnavailableByLanguage = (language, topic) => {
  if (language === "it") {
    return `Dato non disponibile da fonte verificata per ${topic}.`;
  }
  if (language === "es") {
    return `Dato no disponible de una fuente verificada para ${topic}.`;
  }
  return `Verified source data not available for ${topic}.`;
};

const fetchWikidataNames = async (wikibaseItem, language) => {
  if (!wikibaseItem) return null;
  const safeLang = ["it", "en", "es"].includes(language) ? language : "en";
  const langs = [safeLang, "en"].join("|");
  const payload = await fetchJsonOrNull(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
      wikibaseItem
    )}&props=labels|aliases&languages=${langs}&format=json`
  );
  const entity = payload?.entities?.[wikibaseItem];
  const labels = entity?.labels || {};
  const aliasesByLang = entity?.aliases || {};
  const aliases = [
    ...(Array.isArray(aliasesByLang?.[safeLang]) ? aliasesByLang[safeLang] : []),
    ...(Array.isArray(aliasesByLang?.en) ? aliasesByLang.en : [])
  ]
    .map((item) => String(item?.value || "").trim())
    .filter(Boolean);
  return {
    label: labels?.[safeLang]?.value || labels?.en?.value || null,
    aliases
  };
};

const fetchGbifCommonName = async (usageKey, language) => {
  if (!usageKey) return null;
  const payload = await fetchJsonOrNull(
    `https://api.gbif.org/v1/species/${usageKey}/vernacularNames?limit=200`
  );
  if (!payload) return null;
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (!results.length) return null;

  const fallbacks = LANGUAGE_FALLBACKS[language] || LANGUAGE_FALLBACKS.en;
  for (const code of fallbacks) {
    const match = results.find((item) => {
      const lang = String(item?.language || "").toLowerCase();
      return lang === code && typeof item?.vernacularName === "string";
    });
    if (match?.vernacularName) return String(match.vernacularName);
  }

  const first = results.find((item) => typeof item?.vernacularName === "string");
  return first?.vernacularName ? String(first.vernacularName) : null;
};

const fetchLocalizedCommonName = async (scientificName, language) => {
  const safeLang = ["it", "en", "es"].includes(language) ? language : "en";
  const wikiCandidate =
    (await fetchWikiSummary(scientificName, safeLang)) ||
    (await fetchWikiSummary(scientificName, "en"));
  const wikidataNames = await fetchWikidataNames(wikiCandidate?.wikibase_item, safeLang);
  const wikidataAlias = cleanWikiTitle(
    (wikidataNames?.aliases || []).find(
      (alias) =>
        alias &&
        !isLikelyScientificName(alias, scientificName) &&
        !isLikelyFamilyOnly(alias)
    ) || ""
  );
  if (wikidataAlias) return wikidataAlias;

  const wikiLabel = cleanWikiTitle(wikiCandidate?.displaytitle || wikiCandidate?.title || "");
  if (wikiLabel && !isLikelyScientificName(wikiLabel, scientificName) && !isLikelyFamilyOnly(wikiLabel)) {
    return wikiLabel;
  }

  const gbif = await fetchJsonOrNull(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
  );
  const gbifName = await fetchGbifCommonName(gbif?.usageKey, safeLang);
  if (gbifName && !isLikelyScientificName(gbifName, scientificName) && !isLikelyFamilyOnly(gbifName)) {
    return gbifName;
  }
  return null;
};

const fetchGbifHabitatEvidence = async (usageKey, scientificName, language) => {
  if (!usageKey) return null;
  const speciesPage = `https://www.gbif.org/species/${usageKey}`;
  const mapPreviewUrl = `https://api.gbif.org/v2/map/occurrence/density/0/0/0@1x.png?taxonKey=${usageKey}&srs=EPSG:3857&style=classic.point`;
  const [distributions, occurrence] = await Promise.all([
    fetchJsonOrNull(`https://api.gbif.org/v1/species/${usageKey}/distributions?limit=40`),
    fetchJsonOrNull(
      `https://api.gbif.org/v1/occurrence/search?taxonKey=${usageKey}&limit=0&facet=country&facetLimit=8`
    )
  ]);

  const areas = new Set();
  if (distributions) {
    const results = Array.isArray(distributions?.results) ? distributions.results : [];
    for (const item of results) {
      const label = item?.locationId || item?.locality || item?.country || null;
      const text = String(label || "").trim();
      const isCoordinate = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(text);
      if (text && text.length > 1 && !isCoordinate) areas.add(text);
      if (areas.size >= 6) break;
    }
  }

  const countries = [];
  if (occurrence) {
    const counts = occurrence?.facets?.[0]?.counts || [];
    for (const row of counts.slice(0, 6)) {
      const code = String(row?.name || "").toUpperCase();
      if (!code) continue;
      countries.push(regionNameFromCode(code, language));
    }
  }

  if (!areas.size && !countries.length) return null;

  const areaList = [...areas].slice(0, 4).join(", ");
  const countryList = countries.slice(0, 4).join(", ");
  const parts = [];
  if (areaList) parts.push(areaList);
  if (countryList) parts.push(countryList);
  const textBase =
    language === "it"
      ? `Distribuzione documentata GBIF per ${scientificName}: ${parts.join(" | ")}.`
      : language === "es"
      ? `Distribucion documentada en GBIF para ${scientificName}: ${parts.join(" | ")}.`
      : `GBIF documented distribution for ${scientificName}: ${parts.join(" | ")}.`;

  return {
    text: truncateText(textBase, 280),
    sourceUrl: speciesPage,
    mapPreviewUrl
  };
};

const buildWikiSummaryEvidence = (summaryText) => {
  const sentences = splitSentences(stripHtml(summaryText || ""));
  const richSentences = sentences.filter((part) => part.length > 35);
  if (!richSentences.length) return null;
  return {
    historyText: truncateText(richSentences[0], 280),
    funFactsText: truncateText(richSentences[1] || richSentences[0], 240)
  };
};

const buildWikiPageUrl = (title, language) =>
  `https://${language}.wikipedia.org/wiki/${encodeURIComponent(String(title || "").replace(/\s+/g, "_"))}`;

const buildWikiSectionUrl = (pageUrl, sectionTitle) => {
  if (!pageUrl || !sectionTitle) return pageUrl || null;
  return `${pageUrl}#${encodeURIComponent(String(sectionTitle).replace(/\s+/g, "_"))}`;
};

const pickWikiSection = (sections, keywords) => {
  if (!Array.isArray(sections) || !keywords?.length) return null;
  for (const section of sections) {
    const line = normalizeForMatch(stripHtml(section?.line || ""));
    if (!line) continue;
    if (keywords.some((keyword) => line.includes(keyword))) return section;
  }
  return null;
};

const fetchWikiSectionText = async (title, language, sectionIndex) => {
  if (!title || !sectionIndex) return null;
  const payload = await fetchJsonOrNull(
    `https://${language}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
      title
    )}&prop=text&section=${encodeURIComponent(sectionIndex)}&format=json&origin=*`
  );
  const html = payload?.parse?.text?.["*"];
  if (!html) return null;
  const text = truncateText(stripHtml(html), 280);
  return text || null;
};

const fetchWikiSectionEvidence = async (wikiTitle, language, wikiPageUrl) => {
  if (!wikiTitle) return null;
  const safeLanguage = ["it", "en", "es"].includes(language) ? language : "en";
  const keywords = WIKI_SECTION_KEYWORDS[safeLanguage] || WIKI_SECTION_KEYWORDS.en;
  const sectionPayload = await fetchJsonOrNull(
    `https://${safeLanguage}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
      wikiTitle
    )}&prop=sections&format=json&origin=*`
  );
  const sections = sectionPayload?.parse?.sections || [];
  if (!Array.isArray(sections) || !sections.length) return null;

  const historySection = pickWikiSection(sections, keywords.history);
  const funFactsSection = pickWikiSection(sections, keywords.funFacts);
  const pageUrl = wikiPageUrl || buildWikiPageUrl(wikiTitle, safeLanguage);

  const [historyText, funFactsText] = await Promise.all([
    historySection ? fetchWikiSectionText(wikiTitle, safeLanguage, historySection.index) : null,
    funFactsSection ? fetchWikiSectionText(wikiTitle, safeLanguage, funFactsSection.index) : null
  ]);

  if (!historyText && !funFactsText) return null;
  return {
    historyText: historyText || null,
    funFactsText: funFactsText || null,
    historyUrl: historySection ? buildWikiSectionUrl(pageUrl, historySection.line) : pageUrl,
    funFactsUrl: funFactsSection ? buildWikiSectionUrl(pageUrl, funFactsSection.line) : pageUrl
  };
};

const fetchKnowledge = async (species, language) => {
  const wikiPrimary = await fetchWikiSummary(species, language);
  let wiki = wikiPrimary;

  if (!wiki) {
    const titlePrimary = await searchWikiTitle(species, language);
    if (titlePrimary) wiki = await fetchWikiSummary(titlePrimary, language);
  }

  if (!wiki && language !== "en") {
    wiki = await fetchWikiSummary(species, "en");
    if (!wiki) {
      const titleEn = await searchWikiTitle(species, "en");
      if (titleEn) wiki = await fetchWikiSummary(titleEn, "en");
    }
  }

  const gbif = await fetchJsonOrNull(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(species)}`
  );
  let gbifDetails = null;
  if (gbif?.usageKey) {
    gbifDetails = await fetchJsonOrNull(`https://api.gbif.org/v1/species/${gbif.usageKey}`);
  }

  if (!wiki && !gbif) {
    throw new Error("Knowledge retrieval failed from Wikipedia and GBIF.");
  }

  const scientificName = gbif?.canonicalName || species;
  const wikiTitle = cleanWikiTitle(wiki?.displaytitle || wiki?.title || "");
  const wikidataNames = await fetchWikidataNames(wiki?.wikibase_item, language);
  const wikidataLabelRaw = wikidataNames?.label || null;
  const wikidataLabel = cleanWikiTitle(wikidataLabelRaw || "");
  const wikidataAlias = cleanWikiTitle(
    (wikidataNames?.aliases || []).find(
      (alias) =>
        alias &&
        !isLikelyScientificName(alias, scientificName) &&
        !isLikelyFamilyOnly(alias)
    ) || ""
  );
  const gbifCommonName = await fetchGbifCommonName(gbif?.usageKey, language);
  const gbifHabitat = await fetchGbifHabitatEvidence(gbif?.usageKey, scientificName, language);
  const wikiSectionEvidence = await fetchWikiSectionEvidence(
    wiki?.title || scientificName,
    language,
    wiki?.content_urls?.desktop?.page || null
  );
  const wikiSummaryEvidence = buildWikiSummaryEvidence(wiki?.extract || "");
  const wikiLooksScientific = wikiTitle && isLikelyScientificName(wikiTitle, scientificName);
  const wikidataLooksScientific =
    wikidataLabel && isLikelyScientificName(wikidataLabel, scientificName);
  const wikidataLooksFamily = wikidataLabel && isLikelyFamilyOnly(wikidataLabel);
  const gbifLooksScientific = gbifCommonName && isLikelyScientificName(gbifCommonName, scientificName);
  const gbifLooksFamily = gbifCommonName && isLikelyFamilyOnly(gbifCommonName);
  const commonName =
    wikidataAlias ||
    (!wikidataLooksScientific && !wikidataLooksFamily ? wikidataLabel : null) ||
    (!wikiLooksScientific && wikiTitle ? wikiTitle : null) ||
    (!gbifLooksScientific && !gbifLooksFamily ? gbifCommonName : null) ||
    (gbif?.family && gbif.family !== "Unknown" ? gbif.family : scientificName);

  const externalEvidence = {
    habitat: gbifHabitat?.text || null,
    history: wikiSectionEvidence?.historyText || wikiSummaryEvidence?.historyText || null,
    funFacts: wikiSectionEvidence?.funFactsText || wikiSummaryEvidence?.funFactsText || null
  };

  return {
    species: scientificName,
    commonName,
    scientificName,
    family: gbif?.family || "Unknown",
    genus: gbif?.genus || "Unknown",
    imageUrl: wiki?.originalimage?.source || wiki?.thumbnail?.source || null,
    habitatMapPreviewUrl: gbifHabitat?.mapPreviewUrl || null,
    sectionLinks: buildSectionLinks(wiki?.content_urls?.desktop?.page || null, scientificName, language, {
      history: wikiSectionEvidence?.historyUrl || wiki?.content_urls?.desktop?.page || null,
      habitat: gbifHabitat?.sourceUrl || null,
      toxicity: buildAspcaSearchUrl(commonName, scientificName),
      funFacts: wikiSectionEvidence?.funFactsUrl || wiki?.content_urls?.desktop?.page || null
    }),
    externalEvidence,
    publication: gbifDetails?.publishedIn || gbif?.scientificNameAuthorship || "Unknown",
    sourceSummary:
      wiki?.extract ||
      `No encyclopedia summary available for ${scientificName}. GBIF metadata was used where available.`,
    sourceLinks: [
      wiki?.content_urls?.desktop?.page,
      gbifHabitat?.sourceUrl,
      wikiSectionEvidence?.historyUrl,
      wikiSectionEvidence?.funFactsUrl,
      "https://api.gbif.org/v1/species/match"
    ].filter(Boolean)
  };
};

const fallbackNarrative = (knowledge, language) => {
  const evidenceHabitat = knowledge?.externalEvidence?.habitat;
  const evidenceHistory = knowledge?.externalEvidence?.history;
  const evidenceFunFacts = knowledge?.externalEvidence?.funFacts;
  const unavailableHistory = getUnavailableByLanguage(language, "storia");
  const unavailableHabitat = getUnavailableByLanguage(language, "habitat");
  const unavailableFunFacts = getUnavailableByLanguage(language, "curiosità");
  if (language === "it") {
    return {
      description: `${knowledge.commonName} (${knowledge.scientificName}) appartiene alla famiglia ${knowledge.family} e al genere ${knowledge.genus}.`,
      history: evidenceHistory || unavailableHistory,
      habitat: evidenceHabitat || unavailableHabitat,
      toxicity: "La tossicità varia per specie e dose; verifica sempre con fonti botaniche o veterinarie affidabili.",
      care: "Fornisci luce adeguata, irrigazione moderata e drenaggio corretto. Adatta la cura alla specie identificata.",
      funFacts: evidenceFunFacts || unavailableFunFacts
    };
  }

  if (language === "es") {
    return {
      description: `${knowledge.commonName} (${knowledge.scientificName}) pertenece a la familia ${knowledge.family} y al genero ${knowledge.genus}.`,
      history: evidenceHistory || getUnavailableByLanguage(language, "historia"),
      habitat: evidenceHabitat || getUnavailableByLanguage(language, "hábitat"),
      toxicity: "La toxicidad varia por especie y dosis; confirma con fuentes botanicas o veterinarias fiables.",
      care: "Proporciona luz adecuada, riego moderado y buen drenaje. Ajusta el cuidado a la especie identificada.",
      funFacts: evidenceFunFacts || getUnavailableByLanguage(language, "curiosidades")
    };
  }

  return {
    description: `${knowledge.commonName} (${knowledge.scientificName}) belongs to the ${knowledge.family} family and genus ${knowledge.genus}.`,
    history: evidenceHistory || getUnavailableByLanguage(language, "history"),
    habitat: evidenceHabitat || getUnavailableByLanguage(language, "habitat"),
    toxicity: "Toxicity varies by species and dose; confirm with trusted botanical or veterinary sources.",
    care: "Provide adequate light, moderate irrigation, and proper drainage. Adapt care to the exact species.",
    funFacts: evidenceFunFacts || getUnavailableByLanguage(language, "fun facts")
  };
};

const parseNarrative = (content) => {
  const clean = content.replace(/```json|```/g, "").trim();
  const direct = parseJsonSafe(clean, null);
  if (direct) return direct;

  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  return parseJsonSafe(clean.slice(start, end + 1), null);
};

const generateNarrative = async (knowledge, language) => {
  const safeLanguage = ["it", "en", "es"].includes(language) ? language : "en";
  if (!HF_TOKEN || !HF_NARRATIVE_MODEL) return fallbackNarrative(knowledge, safeLanguage);

  const prompt = [
    `Write strictly in ${LANGUAGE_NAME[safeLanguage]}.`,
    "Return JSON only with keys: description, history, habitat, toxicity, care, funFacts.",
    "Keep each field concise and factual (1-2 sentences).",
    "All output fields must be in the requested language only.",
    "If any source sentence is in another language, translate it fully.",
    "Use correct orthography: accents and apostrophes must be preserved when required by the language.",
    "Use source grounding: keep description/history/funFacts from Wikipedia evidence and habitat from GBIF evidence.",
    "If a source field is missing, write a concise 'data not available' sentence instead of inventing details.",
    "Do not include markdown or code fences.",
    `Keep scientific name unchanged: \"${knowledge.scientificName}\".`,
    `Keep common name unchanged: \"${knowledge.commonName}\".`,
    `Source data: ${JSON.stringify(knowledge)}`
  ].join(" ");

  const response = await fetch(`${HF_ROUTER}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: HF_NARRATIVE_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 500
    })
  });

  if (!response.ok) return fallbackNarrative(knowledge, safeLanguage);

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) return fallbackNarrative(knowledge, safeLanguage);

  const parsed = parseNarrative(content);
  if (!parsed) return fallbackNarrative(knowledge, safeLanguage);

  const required = ["description", "history", "habitat", "toxicity", "care", "funFacts"];
  if (!required.every((key) => typeof parsed[key] === "string")) return fallbackNarrative(knowledge, safeLanguage);
  parsed.history =
    knowledge?.externalEvidence?.history && typeof knowledge.externalEvidence.history === "string"
      ? knowledge.externalEvidence.history
      : getUnavailableByLanguage(safeLanguage, safeLanguage === "it" ? "storia" : "history");
  parsed.habitat =
    knowledge?.externalEvidence?.habitat && typeof knowledge.externalEvidence.habitat === "string"
      ? knowledge.externalEvidence.habitat
      : getUnavailableByLanguage(safeLanguage, "habitat");
  parsed.funFacts =
    knowledge?.externalEvidence?.funFacts && typeof knowledge.externalEvidence.funFacts === "string"
      ? knowledge.externalEvidence.funFacts
      : getUnavailableByLanguage(safeLanguage, safeLanguage === "it" ? "curiosità" : "fun facts");
  return parsed;
};

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "plant-discovery-server",
    plantNetConfigured: Boolean(PLANTNET_API_KEY),
    hfConfigured: Boolean(HF_TOKEN)
  });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "plant-discovery-server",
    endpoints: ["/health", "/identify"]
  });
});

app.post(
  "/identify",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "IMAGE", maxCount: 1 }
  ]),
  async (req, res) => {
  let stage = "start";
  try {
    stage = "validate-upload";
    const files = req.files || {};
    const imageFile = files?.image?.[0] || files?.IMAGE?.[0] || null;

    if (!imageFile?.buffer) {
      res
        .status(400)
        .json({ error: "image file is required in multipart field 'image' (or 'IMAGE')." });
      return;
    }

    const language = (req.body?.language || "en").toLowerCase();
    const safeLang = ["it", "en", "es"].includes(language) ? language : "en";

    stage = "classify-species";
    const classification = await classifyPlantNet(imageFile.buffer, imageFile.mimetype || "image/jpeg");
    stage = "localize-alternatives";
    classification.alternatives = await Promise.all(
      (classification.alternatives || []).map(async (item) => {
        const common = await fetchLocalizedCommonName(item.species, safeLang);
        if (!common) return item;
        return {
          ...item,
          species: `${common} (${item.species})`
        };
      })
    );
    stage = "classify-disease";
    classification.disease = await classifyDiseaseHF(imageFile.buffer, imageFile.mimetype || "image/jpeg");

    stage = "knowledge";
    const knowledge = await fetchKnowledge(classification.topSpecies, safeLang);
    stage = "narrative";
    const narrative = await generateNarrative(knowledge, safeLang);

    res.json({
      classification,
      knowledge,
      narrative
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    res.status(500).json({ error: `identify failed at ${stage}: ${message}` });
  }
  }
);

app.listen(PORT, () => {
  console.log(`plant-discovery-server listening on http://localhost:${PORT}`);
});
