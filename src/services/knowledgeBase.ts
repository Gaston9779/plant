import { LanguageCode, PlantKnowledge } from "../types";

type WikiSummaryResponse = {
  title?: string;
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

type GbifMatchResponse = {
  canonicalName?: string;
  family?: string;
  genus?: string;
};

type WikiSearchResponse = [string, string[], string[], string[]];

const fetchWikipediaSummary = async (
  species: string,
  language: LanguageCode
): Promise<WikiSummaryResponse | null> => {
  const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(species)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as WikiSummaryResponse;
};

const searchWikipediaTitle = async (
  query: string,
  language: LanguageCode
): Promise<string | null> => {
  const url = `https://${language}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
    query
  )}&limit=1&namespace=0&format=json`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = (await response.json()) as WikiSearchResponse;
  const first = data[1]?.[0];
  return first ?? null;
};

const fetchWikipediaSummaryWithSearch = async (
  species: string,
  language: LanguageCode
): Promise<WikiSummaryResponse | null> => {
  const direct = await fetchWikipediaSummary(species, language);
  if (direct) return direct;

  const resolvedTitle = await searchWikipediaTitle(species, language);
  if (!resolvedTitle) return null;
  return fetchWikipediaSummary(resolvedTitle, language);
};

const fetchGbifMatch = async (species: string): Promise<GbifMatchResponse | null> => {
  const url = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(species)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as GbifMatchResponse;
};

export const fetchPlantKnowledge = async (
  species: string,
  allowNetwork: boolean,
  language: LanguageCode
): Promise<PlantKnowledge> => {
  if (!allowNetwork) {
    throw new Error("Offline: unable to fetch botanical knowledge for new species.");
  }

  const [wikiLang, wikiEn, gbif] = await Promise.all([
    fetchWikipediaSummaryWithSearch(species, language),
    language === "en"
      ? Promise.resolve<WikiSummaryResponse | null>(null)
      : fetchWikipediaSummaryWithSearch(species, "en"),
    fetchGbifMatch(species)
  ]);
  const wiki = wikiLang ?? wikiEn;

  if (!wiki && !gbif) {
    throw new Error("Unable to fetch plant knowledge from Wikipedia/GBIF.");
  }

  const scientificName = gbif?.canonicalName ?? species;
  const commonName = wiki?.title ?? scientificName;

  return {
    species: scientificName,
    commonName,
    scientificName,
    family: gbif?.family ?? "Unknown",
    genus: gbif?.genus ?? "Unknown",
    sourceSummary:
      wiki?.extract ??
      `No summary returned by Wikipedia for ${scientificName}. Classification metadata retrieved from GBIF.`,
    sourceLinks: [wiki?.content_urls?.desktop?.page, "https://api.gbif.org/v1/species/match"]
      .filter((item): item is string => Boolean(item))
  };
};
