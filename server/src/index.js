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

const ORGAN_CANDIDATES = ["auto", "flower", "leaf"];

const parseJsonSafe = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
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

  const gbifResponse = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(species)}`
  );
  const gbif = gbifResponse.ok ? await gbifResponse.json() : null;

  if (!wiki && !gbif) {
    throw new Error("Knowledge retrieval failed from Wikipedia and GBIF.");
  }

  const scientificName = gbif?.canonicalName || species;

  return {
    species: scientificName,
    commonName: wiki?.title || scientificName,
    scientificName,
    family: gbif?.family || "Unknown",
    genus: gbif?.genus || "Unknown",
    sourceSummary:
      wiki?.extract ||
      `No encyclopedia summary available for ${scientificName}. GBIF metadata was used where available.`,
    sourceLinks: [wiki?.content_urls?.desktop?.page, "https://api.gbif.org/v1/species/match"].filter(Boolean)
  };
};

const fallbackNarrative = (knowledge, language) => {
  if (language === "it") {
    return {
      description: `${knowledge.commonName} (${knowledge.scientificName}) appartiene alla famiglia ${knowledge.family}. ${knowledge.sourceSummary}`,
      history: `Questo profilo si basa su fonti pubbliche e riferimenti tassonomici aggiornati per ${knowledge.scientificName}.`,
      habitat: `Il genere ${knowledge.genus} comprende habitat diversi in base alla specie e al clima.`,
      toxicity: "La tossicita varia per specie e dose; verifica sempre con fonti botaniche o veterinarie affidabili.",
      care: "Fornisci luce adeguata, irrigazione moderata e drenaggio corretto. Adatta la cura alla specie identificata.",
      funFacts: `${knowledge.commonName} e apprezzata per morfologia e adattamento ecologico.`
    };
  }

  if (language === "es") {
    return {
      description: `${knowledge.commonName} (${knowledge.scientificName}) pertenece a la familia ${knowledge.family}. ${knowledge.sourceSummary}`,
      history: `Este perfil se basa en fuentes publicas y referencias taxonomicas actuales para ${knowledge.scientificName}.`,
      habitat: `El genero ${knowledge.genus} abarca habitats distintos segun la especie y el clima.`,
      toxicity: "La toxicidad varia por especie y dosis; confirma con fuentes botanicas o veterinarias fiables.",
      care: "Proporciona luz adecuada, riego moderado y buen drenaje. Ajusta el cuidado a la especie identificada.",
      funFacts: `${knowledge.commonName} es apreciada por su morfologia y adaptacion ecologica.`
    };
  }

  return {
    description: `${knowledge.commonName} (${knowledge.scientificName}) belongs to the ${knowledge.family} family. ${knowledge.sourceSummary}`,
    history: `This profile is based on public sources and current taxonomy references for ${knowledge.scientificName}.`,
    habitat: `The genus ${knowledge.genus} spans different habitats by species and climate range.`,
    toxicity: "Toxicity varies by species and dose; confirm with trusted botanical or veterinary sources.",
    care: "Provide adequate light, moderate irrigation, and proper drainage. Adapt care to the exact species.",
    funFacts: `${knowledge.commonName} is commonly appreciated for its morphology and ecological adaptation traits.`
  };
};

const parseNarrative = (content) => {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  return parseJsonSafe(content.slice(start, end + 1), null);
};

const generateNarrative = async (knowledge, language) => {
  const safeLanguage = ["it", "en", "es"].includes(language) ? language : "en";
  if (!HF_TOKEN || !HF_NARRATIVE_MODEL) return fallbackNarrative(knowledge, safeLanguage);

  const prompt = [
    `Write strictly in ${LANGUAGE_NAME[safeLanguage]}.`,
    "Return JSON only with keys: description, history, habitat, toxicity, care, funFacts.",
    "Keep each field concise and factual (1-2 sentences).",
    "All output fields must be in the requested language.",
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

app.post("/identify", upload.single("image"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ error: "image file is required in multipart field 'image'" });
      return;
    }

    const language = (req.body?.language || "en").toLowerCase();
    const safeLang = ["it", "en", "es"].includes(language) ? language : "en";

    const classification = await classifyPlantNet(req.file.buffer, req.file.mimetype || "image/jpeg");
    classification.disease = await classifyDiseaseHF(req.file.buffer, req.file.mimetype || "image/jpeg");

    const knowledge = await fetchKnowledge(classification.topSpecies, safeLang);
    const narrative = await generateNarrative(knowledge, safeLang);

    res.json({
      classification,
      knowledge,
      narrative
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`plant-discovery-server listening on http://localhost:${PORT}`);
});
