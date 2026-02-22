import AsyncStorage from "@react-native-async-storage/async-storage";
import { PlantResult } from "../types";
import { hashString } from "../utils/hash";

const CACHE_KEY = "plant_result_cache_v1";

type CacheStore = Record<string, PlantResult>;

const getCache = async (): Promise<CacheStore> => {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as CacheStore;
  } catch {
    return {};
  }
};

const buildKey = (imageUri: string, language: string): string => hashString(`${language}:${imageUri}`);

export const readCachedResult = async (
  imageUri: string,
  language: string
): Promise<PlantResult | null> => {
  const cache = await getCache();
  const key = buildKey(imageUri, language);
  return cache[key] ?? null;
};

export const saveCachedResult = async (
  imageUri: string,
  language: string,
  result: PlantResult
): Promise<void> => {
  const cache = await getCache();
  const key = buildKey(imageUri, language);
  cache[key] = result;

  const keys = Object.keys(cache);
  if (keys.length > 50) {
    const sortedEntries = Object.entries(cache).sort(
      (a, b) => new Date(b[1].classifiedAt).getTime() - new Date(a[1].classifiedAt).getTime()
    );
    const trimmed = sortedEntries.slice(0, 50).reduce<CacheStore>((acc, [key, item]) => {
      acc[key] = item;
      return acc;
    }, {});

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    return;
  }

  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};
