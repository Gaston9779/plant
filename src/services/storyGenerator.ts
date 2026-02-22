import { LanguageCode, PlantKnowledge, PlantNarrative } from "../types";

const languageName: Record<LanguageCode, string> = {
  it: "Italian",
  en: "English",
  es: "Spanish"
};

const fallbackByLanguage = (knowledge: PlantKnowledge, language: LanguageCode): PlantNarrative => {
  if (language === "it") {
    return {
      description: `${knowledge.commonName} (${knowledge.scientificName}) appartiene alla famiglia ${knowledge.family}. ${knowledge.sourceSummary}`,
      history: `Specie analizzata con fonti reali pubbliche (Wikipedia e GBIF). Diffusione storica dettagliata disponibile nel link sorgente.`,
      habitat: `Il genere ${knowledge.genus} cresce in habitat che variano in base alla specie. Consulta la fonte Wikipedia per il contesto ecologico preciso.`,
      toxicity: "Tossicita specifica non determinata automaticamente dalle fonti base. Verifica sempre con fonti veterinarie o botaniche affidabili.",
      care: "Mantieni luce adeguata, irrigazione moderata e drenaggio corretto. Adatta il piano di cura alla specie confermata.",
      funFacts: `Curiosita: classificazione reale ottenuta da provider CV, con dati tassonomici aggiornati tramite GBIF.`
    };
  }

  if (language === "es") {
    return {
      description: `${knowledge.commonName} (${knowledge.scientificName}) pertenece a la familia ${knowledge.family}. ${knowledge.sourceSummary}`,
      history: "La especie se obtuvo de fuentes reales (Wikipedia y GBIF). La historia detallada puede verse en los enlaces de referencia.",
      habitat: `El genero ${knowledge.genus} aparece en habitats distintos segun la especie. Revisa la fuente de Wikipedia para el detalle ecologico.`,
      toxicity: "La toxicidad exacta no se puede confirmar automaticamente con las fuentes base. Verifica con fuentes botanicas o veterinarias fiables.",
      care: "Usa luz adecuada, riego moderado y buen drenaje. Ajusta el cuidado a la especie confirmada.",
      funFacts: "Dato curioso: la clasificacion viene de un modelo de vision real y la taxonomia de GBIF."
    };
  }

  return {
    description: `${knowledge.commonName} (${knowledge.scientificName}) belongs to the ${knowledge.family} family. ${knowledge.sourceSummary}`,
    history: "This species profile is grounded on real public sources (Wikipedia and GBIF).",
    habitat: `The genus ${knowledge.genus} spans different habitats by species. Check the linked source for exact ecological context.`,
    toxicity:
      "Exact toxicity cannot be safely inferred from baseline sources alone. Confirm with trusted botanical or veterinary references.",
    care: "Provide suitable light, moderate watering, and proper drainage. Tailor care to the confirmed species.",
    funFacts: "Fun fact: this card combines live CV identification with real taxonomy metadata from GBIF."
  };
};

const parseNarrativeResponse = (content: string): PlantNarrative | null => {
  try {
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < 0) return null;
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as PlantNarrative;

    const required = ["description", "history", "habitat", "toxicity", "care", "funFacts"];
    if (required.every((key) => typeof parsed[key as keyof PlantNarrative] === "string")) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
};

const looksLikeHfToken = (value: string): boolean => /^hf_[A-Za-z0-9]{20,}$/.test(value);

const extractHttpError = async (response: Response): Promise<string> => {
  try {
    const json = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof json.error === "string") return json.error;
    if (typeof json.message === "string") return json.message;
    if (json.error) return JSON.stringify(json.error).slice(0, 220);
    if (json.message) return JSON.stringify(json.message).slice(0, 220);
    return `HTTP ${response.status}`;
  } catch {
    try {
      const text = await response.text();
      return text.slice(0, 220) || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
};

const generateNarrativeWithHf = async (
  token: string,
  model: string,
  knowledge: PlantKnowledge,
  language: LanguageCode
): Promise<PlantNarrative> => {
  const prompt = [
    `Write in ${languageName[language]}.`,
    "Return JSON only with keys: description, history, habitat, toxicity, care, funFacts.",
    "Each field must be concise and factual (1-2 sentences).",
    `Keep scientific name exactly unchanged: \"${knowledge.scientificName}\".`,
    `Keep common name exactly unchanged: \"${knowledge.commonName}\".`,
    "Do not translate, transliterate, or alter plant names.",
    "Use only provided source data. Do not invent unsupported claims.",
    `Source data: ${JSON.stringify(knowledge)}`
  ].join(" ");

  const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const detail = await extractHttpError(response);
    throw new Error(`HF narrative error ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("HF narrative returned empty content.");
  }

  const parsed = parseNarrativeResponse(content);
  if (!parsed) {
    throw new Error("HF narrative did not return valid JSON narrative.");
  }

  return parsed;
};

export const generatePlantNarrative = async (
  knowledge: PlantKnowledge,
  allowNetwork: boolean,
  language: LanguageCode
): Promise<PlantNarrative> => {
  const hfToken = process.env.EXPO_PUBLIC_HUGGINGFACE_TOKEN;
  const hfNarrativeModel =
    process.env.EXPO_PUBLIC_HF_NARRATIVE_MODEL ?? process.env.EXPO_PUBLIC_HF_HISTORY_MODEL;

  if (allowNetwork && hfToken && hfNarrativeModel && !looksLikeHfToken(hfNarrativeModel)) {
    try {
      return await generateNarrativeWithHf(hfToken, hfNarrativeModel, knowledge, language);
    } catch (error) {
      console.warn("[story-generator] hf narrative fallback", error);
    }
  }

  return fallbackByLanguage(knowledge, language);
};
