import AsyncStorage from "@react-native-async-storage/async-storage";
import { HistoryEntry, PlantResult } from "../types";

const HISTORY_KEY = "plant_search_history_v1";

export const loadHistory = async (): Promise<HistoryEntry[]> => {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];

  try {
    const list = JSON.parse(raw) as HistoryEntry[];
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
};

export const appendHistory = async (result: PlantResult): Promise<HistoryEntry[]> => {
  const current = await loadHistory();

  const entry: HistoryEntry = {
    id: `${Date.now()}`,
    query: result.knowledge.commonName,
    createdAt: new Date().toISOString(),
    result
  };

  const next = [entry, ...current].slice(0, 40);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
};

export const removeHistoryEntry = async (id: string): Promise<HistoryEntry[]> => {
  const current = await loadHistory();
  const next = current.filter((item) => item.id !== id);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
};
