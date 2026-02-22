import { ClassificationResult } from "../types";

type PlantNetResult = {
  score: number;
  species?: {
    scientificNameWithoutAuthor?: string;
    scientificName?: string;
  };
};

type PlantNetResponse = {
  results?: PlantNetResult[];
};

type HuggingFaceLabel = {
  label: string;
  score: number;
};

type ExpoUploadResult = {
  status: number;
  body?: string;
};

const HF_MIN_SPECIES_CONFIDENCE = 0.2;
const HF_MIN_DISEASE_CONFIDENCE = 0.3;
const DEFAULT_HF_SPECIES_MODEL = "microsoft/resnet-50";

const parseSpecies = (value: string): string => value.replace(/[_]+/g, " ").trim();
const looksLikeHfToken = (value: string): boolean => /^hf_[A-Za-z0-9]{20,}$/.test(value);
const PLANTNET_ORGANS = ["flower", "leaf", "auto", "fruit", "bark"] as const;
const inferMimeTypeFromUri = (uri: string): string => {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  return "image/jpeg";
};
const uniqueAlternatives = (items: Array<{ species: string; confidence: number }>, topSpecies: string) => {
  const seen = new Set<string>([topSpecies.toLowerCase()]);
  const deduped: Array<{ species: string; confidence: number }> = [];
  for (const item of items) {
    const key = item.species.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length === 3) break;
  }
  return deduped;
};

const isDiseaseStyleLabel = (label: string): boolean => {
  const lower = label.toLowerCase();
  return (
    lower.includes(" with ") ||
    lower.includes(" blight") ||
    lower.includes("rust") ||
    lower.includes("mildew") ||
    lower.includes("spot") ||
    lower.includes("virus") ||
    lower.includes("disease")
  );
};

const isLikelyBotanicalLabel = (label: string): boolean => {
  const normalized = parseSpecies(label);
  const lower = normalized.toLowerCase();

  // ImageNet-style synonym lists are usually not species names.
  if (normalized.includes(",")) return false;
  if (/[0-9]/.test(normalized)) return false;
  if (isDiseaseStyleLabel(normalized)) return false;

  const blocked = new Set([
    "coil",
    "spiral",
    "volute",
    "whorl",
    "helix",
    "artifact",
    "object"
  ]);
  if (blocked.has(lower)) return false;

  // Accept common short plant names and Latin binomials.
  if (/^[A-Za-z-]+(?: [A-Za-z-]+){0,2}$/.test(normalized)) return true;
  if (/^[A-Z][a-z-]+ [a-z-]+(?: [a-z-]+)?$/.test(normalized)) return true;
  return false;
};

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
      return text.slice(0, 180) || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
};

const uploadPlantNetWithExpoFs = async (
  endpoint: string,
  imageUri: string,
  mime: string,
  organ: string
): Promise<ExpoUploadResult | null> => {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const result = await FileSystem.uploadAsync(endpoint, imageUri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "images",
      mimeType: mime,
      parameters: { organs: organ }
    });

    return {
      status: result.status,
      body: result.body
    };
  } catch (error) {
    console.warn("[classifier] expo-file-system upload failed", error);
    return null;
  }
};


const callHfImageModel = async (
  imageUri: string,
  token: string,
  model: string
): Promise<HuggingFaceLabel[]> => {
  const imageResponse = await fetch(imageUri);
  const blob = await imageResponse.blob();

  const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": blob.type || "application/octet-stream"
    },
    body: blob
  });

  if (!response.ok) {
    const detail = await extractHttpError(response);
    throw new Error(`Hugging Face error ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as HuggingFaceLabel[];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No labels returned by Hugging Face model.");
  }

  return [...data].sort((a, b) => b.score - a.score);
};

const classifySpeciesWithPlantNet = async (imageUri: string, apiKey: string): Promise<ClassificationResult> => {
  const endpoint = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(apiKey)}&lang=en`;
  const mime = inferMimeTypeFromUri(imageUri);
  let response: Response | null = null;
  let primaryError = "";

  const parsePlantNetData = (data: PlantNetResponse): ClassificationResult => {
    const results = (data.results ?? [])
      .map((item) => ({
        species:
          item.species?.scientificNameWithoutAuthor ?? item.species?.scientificName ?? "Unknown species",
        confidence: item.score
      }))
      .filter((item) => item.species !== "Unknown species")
      .sort((a, b) => b.confidence - a.confidence);

    if (results.length === 0) {
      throw new Error("No species detected by PlantNet.");
    }

    const topSpecies = parseSpecies(results[0].species);
    return {
      provider: "plantnet",
      topSpecies,
      confidence: results[0].confidence,
      alternatives: uniqueAlternatives(
        results.slice(1).map((item) => ({
          species: parseSpecies(item.species),
          confidence: item.confidence
        })),
        topSpecies
      ),
      disease: null
    };
  };

  // 0) Preferred on Expo mobile runtimes, with organ retries.
  for (const organ of PLANTNET_ORGANS) {
    const fsUpload = await uploadPlantNetWithExpoFs(endpoint, imageUri, mime, organ);
    if (fsUpload && fsUpload.status >= 200 && fsUpload.status < 300 && fsUpload.body) {
      try {
        const data = JSON.parse(fsUpload.body) as PlantNetResponse;
        return parsePlantNetData(data);
      } catch {
        primaryError = `expo-fs parse fail (${organ}): ${fsUpload.body.slice(0, 120)}`;
      }
    }

    if (fsUpload && (fsUpload.status < 200 || fsUpload.status >= 300)) {
      primaryError = `expo-fs ${organ} status ${fsUpload.status}: ${fsUpload.body?.slice(0, 120) ?? "no body"}`;
    }
  }

  // 1) RN-style multipart upload using file URI (works best on mobile runtimes).
  for (const organ of PLANTNET_ORGANS) {
    try {
      const formData = new FormData();
      formData.append(
        "images",
        {
          uri: imageUri,
          name: "plant-upload.jpg",
          type: mime
        } as any
      );
      formData.append("organs", organ);

      response = await fetch(endpoint, { method: "POST", body: formData });
      if (response.ok) break;
      primaryError = `fetch-uri ${organ}: ${await extractHttpError(response)}`;
    } catch (error) {
      primaryError = error instanceof Error ? `fetch-uri ${organ}: ${error.message}` : "URI multipart failed";
    }
  }

  // 2) Blob fallback for environments where URI form-data is not handled.
  if (!response || !response.ok) {
    try {
      const imageResponse = await fetch(imageUri);
      const blob = await imageResponse.blob();
      for (const organ of PLANTNET_ORGANS) {
        const fallbackForm = new FormData();
        fallbackForm.append("images", blob, "plant-upload.jpg");
        fallbackForm.append("organs", organ);
        response = await fetch(endpoint, { method: "POST", body: fallbackForm });
        if (response.ok) break;
        primaryError = `fetch-blob ${organ}: ${await extractHttpError(response)}`;
      }
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : "Blob multipart failed";
      throw new Error(`PlantNet upload failed. URI mode: ${primaryError}. Blob mode: ${fallbackError}`);
    }
  }

  if (!response.ok) {
    const detail = await extractHttpError(response);
    throw new Error(
      `PlantNet error ${response.status}: ${detail}. Upload mime=${mime}. fsHint=${primaryError || "none"}.`
    );
  }

  const data = (await response.json()) as PlantNetResponse;
  return parsePlantNetData(data);
};

const classifySpeciesWithHf = async (
  imageUri: string,
  token: string,
  model: string
): Promise<ClassificationResult> => {
  const sorted = await callHfImageModel(imageUri, token, model);

  if (sorted[0].score < HF_MIN_SPECIES_CONFIDENCE) {
    throw new Error(
      `HF species confidence too low (${Math.round(sorted[0].score * 100)}%).`
    );
  }

  const firstBotanical = sorted.find((item) => isLikelyBotanicalLabel(item.label));
  if (!firstBotanical) {
    throw new Error(
      "HF species model produced non-botanical labels. Configure EXPO_PUBLIC_HF_SPECIES_MODEL with a real plant species model."
    );
  }

  if (isDiseaseStyleLabel(firstBotanical.label)) {
    throw new Error(
      "HF species model appears to be a disease model. Configure EXPO_PUBLIC_HF_SPECIES_MODEL for plant species."
    );
  }

  const topSpecies = parseSpecies(firstBotanical.label);
  return {
    provider: "huggingface",
    topSpecies,
    confidence: firstBotanical.score,
    alternatives: uniqueAlternatives(
      sorted
        .filter((item) => item.label !== firstBotanical.label)
        .filter((item) => isLikelyBotanicalLabel(item.label))
        .map((item) => ({
        species: parseSpecies(item.label),
        confidence: item.score
      })),
      topSpecies
    ),
    disease: null
  };
};

const analyzeDiseaseWithHf = async (
  imageUri: string,
  token: string,
  model: string
): Promise<ClassificationResult["disease"]> => {
  const sorted = await callHfImageModel(imageUri, token, model);
  const top = sorted[0];
  if (!top || top.score < HF_MIN_DISEASE_CONFIDENCE) return null;

  return {
    label: parseSpecies(top.label),
    confidence: top.score,
    provider: "huggingface"
  };
};

export const classifyPlant = async (imageUri: string, allowNetwork: boolean): Promise<ClassificationResult> => {
  if (!allowNetwork) {
    throw new Error("Offline: unable to classify a new image without internet. Use a cached result.");
  }

  const plantNetApiKey = process.env.EXPO_PUBLIC_PLANTNET_API_KEY;
  const hfToken = process.env.EXPO_PUBLIC_HUGGINGFACE_TOKEN;
  const hfSpeciesModel = process.env.EXPO_PUBLIC_HF_SPECIES_MODEL;
  const hfDiseaseModel = process.env.EXPO_PUBLIC_HF_DISEASE_MODEL;

  const attempts: string[] = [];
  let speciesResult: ClassificationResult | null = null;

  if (plantNetApiKey) {
    try {
      speciesResult = await classifySpeciesWithPlantNet(imageUri, plantNetApiKey);
    } catch (error) {
      console.warn("[classifier] plantnet species failed", error);
      attempts.push(`PlantNet failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (!speciesResult && hfToken) {
    const speciesModels = [hfSpeciesModel, DEFAULT_HF_SPECIES_MODEL].filter(
      (item): item is string => Boolean(item)
    );

    for (const model of speciesModels) {
      if (looksLikeHfToken(model)) {
        attempts.push(`HF species misconfigured: model value looks like token (${model.slice(0, 8)}...).`);
        continue;
      }

      try {
        speciesResult = await classifySpeciesWithHf(imageUri, hfToken, model);
        break;
      } catch (error) {
        console.warn("[classifier] hf species failed", { model, error });
        attempts.push(
          `HF species failed (${model}): ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
  }

  if (!speciesResult) {
    throw new Error(
      [
        "No species classifier succeeded.",
        ...attempts,
        "Configure EXPO_PUBLIC_PLANTNET_API_KEY, or EXPO_PUBLIC_HUGGINGFACE_TOKEN + EXPO_PUBLIC_HF_SPECIES_MODEL."
      ].join(" ")
    );
  }

  if (hfToken && hfDiseaseModel && !looksLikeHfToken(hfDiseaseModel)) {
    try {
      speciesResult.disease = await analyzeDiseaseWithHf(imageUri, hfToken, hfDiseaseModel);
    } catch (error) {
      console.warn("[classifier] hf disease failed", error);
    }
  }

  return speciesResult;
};
