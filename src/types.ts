export type LanguageCode = "it" | "en" | "es";

export type AlternativeSpecies = {
  species: string;
  confidence: number;
};

export type ClassificationResult = {
  provider: "plantnet" | "huggingface";
  topSpecies: string;
  confidence: number;
  alternatives: AlternativeSpecies[];
  disease: {
    label: string;
    confidence: number;
    provider: "huggingface";
  } | null;
};

export type PlantKnowledge = {
  species: string;
  commonName: string;
  scientificName: string;
  family: string;
  genus: string;
  imageUrl?: string | null;
  sourceSummary: string;
  sourceLinks: string[];
};

export type PlantNarrative = {
  description: string;
  history: string;
  habitat: string;
  toxicity: string;
  care: string;
  funFacts: string;
};

export type PlantResult = {
  imageUri: string;
  classifiedAt: string;
  language: LanguageCode;
  classification: ClassificationResult;
  knowledge: PlantKnowledge;
  narrative: PlantNarrative;
};

export type HistoryEntry = {
  id: string;
  query: string;
  createdAt: string;
  result: PlantResult;
};
