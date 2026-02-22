import { LanguageCode, PlantResult } from "../types";

type BackendIdentifyResponse = {
  classification: PlantResult["classification"];
  knowledge: PlantResult["knowledge"];
  narrative: PlantResult["narrative"];
};

export const runPlantPipeline = async (
  imageUri: string,
  allowNetwork: boolean,
  language: LanguageCode
): Promise<PlantResult> => {
  if (!allowNetwork) {
    throw new Error("Offline: backend plant identification requires internet.");
  }

  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    throw new Error("Missing EXPO_PUBLIC_BACKEND_URL. Set backend URL in .env.");
  }

  const formData = new FormData();
  formData.append(
    "image",
    {
      uri: imageUri,
      name: "plant-upload.jpg",
      type: "image/jpeg"
    } as any
  );
  formData.append("language", language);

  const normalizedBackendUrl = backendUrl.endsWith("/")
    ? backendUrl.slice(0, -1)
    : backendUrl;

  const response = await fetch(`${normalizedBackendUrl}/identify`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error || `Backend error ${response.status}`);
    }
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text.slice(0, 180)}`);
  }

  const payload = (await response.json()) as BackendIdentifyResponse;

  return {
    imageUri,
    classifiedAt: new Date().toISOString(),
    language,
    classification: payload.classification,
    knowledge: payload.knowledge,
    narrative: payload.narrative
  };
};
