import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import NetInfo from "@react-native-community/netinfo";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { runPlantPipeline } from "./src/services/pipeline";
import { readCachedResult, saveCachedResult } from "./src/storage/cache";
import { appendHistory, loadHistory, removeHistoryEntry } from "./src/storage/history";
import { HistoryEntry, LanguageCode, PlantResult } from "./src/types";
import { theme } from "./src/theme";

const BUILD_MARKER = "build-2026-02-22-wiki-image-lottie-loader";

const copy: Record<
  LanguageCode,
  {
    appTitle: string;
    appSubtitle: string;
    online: string;
    offline: string;
    capture: string;
    upload: string;
    loading: string;
    confidence: string;
    alternatives: string;
    share: string;
    history: string;
    findPlant: string;
    emptyHistory: string;
    provider: string;
    disease: string;
    dataSources: string;
    deleteRecord: string;
    cameraPermission: string;
    galleryPermission: string;
    genericError: string;
    language: string;
    description: string;
    historySection: string;
    habitat: string;
    toxicity: string;
    care: string;
    funFacts: string;
  }
> = {
  it: {
    appTitle: "Plant Discovery",
    appSubtitle: "Scatta o carica una foto: identificazione reale + narrazione botanica.",
    online: "Online",
    offline: "Offline",
    capture: "Scatta",
    upload: "Carica",
    loading: "Analisi reale della foto in corso...",
    confidence: "Affidabilità",
    alternatives: "Specie alternative",
    share: "Condividi scheda",
    history: "Cronologia ricerche",
    findPlant: "Cerca una pianta",
    emptyHistory: "Le analisi salvate appariranno qui.",
    provider: "Provider CV",
    disease: "Possibile malattia",
    dataSources: "Fonti dati",
    deleteRecord: "Elimina",
    cameraPermission: "Serve il permesso fotocamera.",
    galleryPermission: "Serve il permesso libreria foto.",
    genericError: "Analisi non riuscita.",
    language: "Lingua",
    description: "Descrizione",
    historySection: "Storia",
    habitat: "Habitat",
    toxicity: "Tossicità",
    care: "Cura",
    funFacts: "Curiosità"
  },
  en: {
    appTitle: "Plant Discovery",
    appSubtitle: "Capture or upload a photo: real identification + botanical storytelling.",
    online: "Online",
    offline: "Offline",
    capture: "Capture",
    upload: "Upload",
    loading: "Running real photo analysis...",
    confidence: "Confidence",
    alternatives: "Alternative species",
    share: "Share card",
    history: "Search History",
    findPlant: "Find a plant",
    emptyHistory: "Your saved analyses will appear here.",
    provider: "CV provider",
    disease: "Possible disease",
    dataSources: "Data sources",
    deleteRecord: "Delete",
    cameraPermission: "Camera permission is required.",
    galleryPermission: "Library permission is required.",
    genericError: "Analysis failed.",
    language: "Language",
    description: "Description",
    historySection: "History",
    habitat: "Habitat",
    toxicity: "Toxicity",
    care: "Care",
    funFacts: "Fun facts"
  },
  es: {
    appTitle: "Plant Discovery",
    appSubtitle: "Toma o sube una foto: identificacion real + narrativa botanica.",
    online: "Online",
    offline: "Offline",
    capture: "Camara",
    upload: "Subir",
    loading: "Analisis real de la foto en curso...",
    confidence: "Confianza",
    alternatives: "Especies alternativas",
    share: "Compartir ficha",
    history: "Historial",
    findPlant: "Buscar planta",
    emptyHistory: "Tus analisis guardados apareceran aqui.",
    provider: "Proveedor CV",
    disease: "Posible enfermedad",
    dataSources: "Fuentes",
    deleteRecord: "Eliminar",
    cameraPermission: "Se requiere permiso de camara.",
    galleryPermission: "Se requiere permiso de galeria.",
    genericError: "Fallo del analisis.",
    language: "Idioma",
    description: "Descripcion",
    historySection: "Historia",
    habitat: "Habitat",
    toxicity: "Toxicidad",
    care: "Cuidados",
    funFacts: "Curiosidades"
  }
};

const languageLabel: Record<LanguageCode, string> = {
  it: "IT",
  en: "EN",
  es: "ES"
};

const getConfidenceLabel = (confidence: number): string => `${Math.round(confidence * 100)}%`;

const normalizeImageForAnalysis = async (uri: string): Promise<string> => {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],
    {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: false
    }
  );
  return manipulated.uri;
};

const sharePlantCard = async (result: PlantResult, language: LanguageCode): Promise<void> => {
  const t = copy[language];
  const message = [
    `${result.knowledge.commonName} (${result.knowledge.scientificName})`,
    `${t.confidence}: ${getConfidenceLabel(result.classification.confidence)}`,
    `${t.description}: ${result.narrative.description}`,
    `${t.care}: ${result.narrative.care}`,
    `${t.funFacts}: ${result.narrative.funFacts}`
  ].join("\n\n");

  await Share.share({
    title: `${result.knowledge.commonName} Plant Card`,
    message
  });
};

const SectionCard = ({
  icon,
  title,
  body,
  onPress
}: {
  icon: string;
  title: string;
  body: string;
  onPress?: (() => void) | null;
}) => (
  <Pressable
    style={({ pressed }) => [styles.sectionCard, onPress && styles.sectionCardLink, pressed && onPress && styles.sectionCardPressed]}
    onPress={onPress ?? undefined}
    disabled={!onPress}
  >
    <Text style={styles.sectionTitle}>{`${icon} ${title}`}</Text>
    <Text style={styles.sectionBody}>{body}</Text>
  </Pressable>
);

export default function App() {
  const [language, setLanguage] = useState<LanguageCode>("it");
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorTechnical, setErrorTechnical] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<PlantResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyFilter, setHistoryFilter] = useState("");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const t = copy[language];
  const hfToken = process.env.EXPO_PUBLIC_HUGGINGFACE_TOKEN;
  const hfSpeciesModel =
    process.env.EXPO_PUBLIC_HF_SPECIES_MODEL ??
    process.env.EXPO_PUBLIC_HF_BIO_MODEL ??
    process.env.EXPO_PUBLIC_HUGGINGFACE_MODEL;
  const hfDiseaseModel = process.env.EXPO_PUBLIC_HF_DISEASE_MODEL;
  const hfHistoryModel = process.env.EXPO_PUBLIC_HF_HISTORY_MODEL;
  const hfNarrativeModel = process.env.EXPO_PUBLIC_HF_NARRATIVE_MODEL;
  const plantNetKey = process.env.EXPO_PUBLIC_PLANTNET_API_KEY;
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

  useEffect(() => {
    loadHistory().then(setHistory);

    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(Boolean(state.isConnected));
    });

    return () => unsubscribe();
  }, []);

  const filteredHistory = useMemo(() => {
    if (!historyFilter.trim()) return history;
    const query = historyFilter.trim().toLowerCase();
    return history.filter((item) => item.query.toLowerCase().includes(query));
  }, [history, historyFilter]);

  const identifyImage = async (uri: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setErrorTechnical(null);

    try {
      const cached = await readCachedResult(uri, language);
      if (cached) {
        setCurrentResult(cached);
        setHistory(await appendHistory(cached));
        setIsLoading(false);
        return;
      }

      const result = await runPlantPipeline(uri, isOnline, language);
      setCurrentResult(result);
      await saveCachedResult(uri, language, result);
      setHistory(await appendHistory(result));
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : t.genericError;
      const technical =
        unknownError instanceof Error
          ? `${unknownError.name}: ${unknownError.message}`
          : String(unknownError);
      console.error("[plant-pipeline] failure", unknownError);
      setError(message);
      setErrorTechnical(technical);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCapture = async (): Promise<void> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t.cameraPermission);
      return;
    }

    const captured = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true
    });

    if (!captured.canceled && captured.assets[0]?.uri) {
      try {
        const normalizedUri = await normalizeImageForAnalysis(captured.assets[0].uri);
        await identifyImage(normalizedUri);
      } catch {
        setError("Conversione immagine fallita. Riprova con una nuova foto.");
      }
    }
  };

  const handleUpload = async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t.galleryPermission);
      return;
    }

    const selected = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true
    });

    if (!selected.canceled && selected.assets[0]?.uri) {
      try {
        const normalizedUri = await normalizeImageForAnalysis(selected.assets[0].uri);
        await identifyImage(normalizedUri);
      } catch {
        setError("Conversione immagine fallita. Riprova con una foto diversa.");
      }
    }
  };

  const openSourceLink = async (url: string): Promise<void> => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        setError(`Link non supportato: ${url}`);
        return;
      }
      await Linking.openURL(url);
    } catch {
      setError(`Impossibile aprire il link: ${url}`);
    }
  };

  const handleDeleteHistory = async (id: string): Promise<void> => {
    setHistory(await removeHistoryEntry(id));
  };

  const WebLottie = Platform.OS === "web" ? (require("lottie-react").default as any) : null;
  const sectionLinks = currentResult?.knowledge.sectionLinks;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        {isLoading && (
          <View pointerEvents="none" style={styles.loaderOverlay}>
            <View style={styles.loaderBackdrop} />
            {WebLottie ? (
              <WebLottie
                animationData={require("./src/assets/plant.json")}
                loop
                autoplay
                style={styles.loaderCentered}
              />
            ) : (
              <View style={styles.loaderNativeFallback}>
                <ActivityIndicator size="large" color={theme.colors.cta} />
              </View>
            )}
          </View>
        )}
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{isOnline ? t.online : t.offline}</Text>
            </View>
            <View style={styles.languageWrap}>
              <Text style={styles.languageLabel}>{t.language}</Text>
              <View style={styles.languageRow}>
                {(["it", "en", "es"] as LanguageCode[]).map((code) => (
                  <Pressable
                    key={code}
                    style={[styles.languageButton, language === code && styles.languageButtonActive]}
                    onPress={() => setLanguage(code)}
                  >
                    <Text
                      style={[styles.languageButtonText, language === code && styles.languageButtonTextActive]}
                    >
                      {languageLabel[code]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <Text style={styles.title}>{t.appTitle}</Text>
          <Text style={styles.subtitle}>{t.appSubtitle}</Text>

          <View style={styles.actionsRow}>
            <Pressable style={[styles.primaryAction, isLoading && styles.actionDisabled]} onPress={handleCapture} disabled={isLoading}>
              <Text style={styles.primaryActionText}>{t.capture}</Text>
            </Pressable>
            <Pressable style={[styles.secondaryAction, isLoading && styles.actionDisabled]} onPress={handleUpload} disabled={isLoading}>
              <Text style={styles.secondaryActionText}>{t.upload}</Text>
            </Pressable>
          </View>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}
        {errorTechnical && <Text style={styles.errorDetailText}>{errorTechnical}</Text>}

        <View style={styles.diagnosticsCard}>
          <Pressable
            style={styles.diagnosticsHeader}
            onPress={() => setDiagnosticsOpen((current) => !current)}
          >
            <Text style={styles.diagnosticsTitle}>Diagnostica</Text>
            <Text style={styles.diagnosticsChevron}>{diagnosticsOpen ? "▾" : "▸"}</Text>
          </Pressable>
          {diagnosticsOpen && (
            <View style={styles.diagnosticsBody}>
              <Text style={styles.diagnosticsLine}>{`Build: ${BUILD_MARKER}`}</Text>
              <Text style={styles.diagnosticsLine}>{`Backend URL: ${backendUrl || "mancante"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`Rete: ${isOnline ? "online" : "offline"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`HF token: ${hfToken ? `presente (${hfToken.length} chars)` : "mancante"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`HF species model: ${hfSpeciesModel || "mancante"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`HF disease model: ${hfDiseaseModel || "mancante (opzionale)"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`HF history model: ${hfHistoryModel || "mancante (opzionale, ma consigliato)"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`HF narrative model: ${hfNarrativeModel || "mancante (opzionale)"}`}</Text>
              <Text style={styles.diagnosticsLine}>{`PlantNet key: ${plantNetKey ? "presente" : "mancante (opzionale se usi HF bio)"}`}</Text>
            </View>
          )}
        </View>

        {currentResult && (
          <View style={styles.resultWrap}>
            <View style={styles.summaryCard}>
              {currentResult.knowledge.imageUrl && (
                <Image source={{ uri: currentResult.knowledge.imageUrl }} style={styles.previewImage} />
              )}
              <Text style={styles.plantHeading}>{currentResult.knowledge.scientificName}</Text>
              <Text style={styles.plantSubheading}>
                {currentResult.knowledge.commonName || currentResult.knowledge.family}
              </Text>

              <View style={styles.confidencePill}>
                <Text style={styles.confidenceText}>
                  {t.confidence}: {getConfidenceLabel(currentResult.classification.confidence)}
                </Text>
              </View>

              <Text style={styles.metaInfo}>
                {t.provider}: {currentResult.classification.provider ?? "legacy"}
              </Text>
              {currentResult.classification.disease && (
                <Text style={styles.metaInfo}>
                  {t.disease}: {currentResult.classification.disease.label} (
                  {getConfidenceLabel(currentResult.classification.disease.confidence)})
                </Text>
              )}

              <Text style={styles.altTitle}>{t.alternatives}</Text>
              {currentResult.classification.alternatives.map((item, index) => (
                <Text key={`${item.species}-${index}`} style={styles.altSpecies}>{`• ${item.species} (${getConfidenceLabel(
                  item.confidence
                )})`}</Text>
              ))}

              <Text style={styles.altTitle}>{t.dataSources}</Text>
              {(currentResult.knowledge.sourceLinks ?? []).map((link) => (
                <Pressable key={link} onPress={() => void openSourceLink(link)}>
                  <Text style={styles.sourceLink}>{link}</Text>
                </Pressable>
              ))}

              <Pressable
                style={styles.shareAction}
                onPress={() => {
                  void sharePlantCard(currentResult, language);
                }}
              >
                <Text style={styles.shareActionText}>{t.share}</Text>
              </Pressable>
            </View>

            <SectionCard
              icon="🌿"
              title={t.description}
              body={currentResult.narrative.description}
              onPress={sectionLinks?.description ? () => void openSourceLink(sectionLinks.description!) : null}
            />
            <SectionCard
              icon="📜"
              title={t.historySection}
              body={currentResult.narrative.history}
              onPress={sectionLinks?.history ? () => void openSourceLink(sectionLinks.history!) : null}
            />
            {currentResult.knowledge.habitatMapPreviewUrl && sectionLinks?.habitat ? (
              <Pressable
                style={styles.sectionCard}
                onPress={() => {
                  void openSourceLink(sectionLinks.habitat!);
                }}
              >
                <Text style={styles.sectionTitle}>{`🗺️ ${t.habitat}`}</Text>
                <Image
                  source={{ uri: currentResult.knowledge.habitatMapPreviewUrl }}
                  style={styles.mapPreviewImage}
                />
              </Pressable>
            ) : (
              <SectionCard
                icon="🗺️"
                title={t.habitat}
                body={currentResult.narrative.habitat}
                onPress={sectionLinks?.habitat ? () => void openSourceLink(sectionLinks.habitat!) : null}
              />
            )}
            <SectionCard
              icon="⚠️"
              title={t.toxicity}
              body={currentResult.narrative.toxicity}
              onPress={sectionLinks?.toxicity ? () => void openSourceLink(sectionLinks.toxicity!) : null}
            />
            <SectionCard
              icon="🪴"
              title={t.care}
              body={currentResult.narrative.care}
              onPress={sectionLinks?.care ? () => void openSourceLink(sectionLinks.care!) : null}
            />
            <SectionCard
              icon="✨"
              title={t.funFacts}
              body={currentResult.narrative.funFacts}
              onPress={sectionLinks?.funFacts ? () => void openSourceLink(sectionLinks.funFacts!) : null}
            />
          </View>
        )}

        <View style={styles.historySectionWrap}>
          <Text style={styles.historyHeading}>{t.history}</Text>
          <TextInput
            style={styles.historySearch}
            placeholder={t.findPlant}
            placeholderTextColor={theme.colors.textMuted}
            value={historyFilter}
            onChangeText={setHistoryFilter}
          />

          {filteredHistory.length === 0 ? (
            <Text style={styles.emptyState}>{t.emptyHistory}</Text>
          ) : (
            filteredHistory.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <Pressable
                  style={styles.historyMainArea}
                  onPress={() => {
                    setCurrentResult(item.result);
                  }}
                >
                  <Text style={styles.historyPlant}>{item.result.knowledge.commonName}</Text>
                  <Text style={styles.historyMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
                  <Text style={styles.historyMeta}>
                    {t.confidence}: {getConfidenceLabel(item.result.classification.confidence)}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.deleteHistoryButton}
                  onPress={() => {
                    void handleDeleteHistory(item.id);
                  }}
                >
                  <Text style={styles.deleteHistoryText}>×</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20
  },
  loaderBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11, 21, 16, 0.2)"
  },
  loaderCentered: {
    width: 260,
    height: 260
  },
  loaderNativeFallback: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 251, 243, 0.92)"
  },
  screen: {
    flex: 1
  },
  content: {
    padding: 16,
    paddingBottom: 38,
    gap: 14
  },
  hero: {
    backgroundColor: theme.colors.backgroundAccent,
    borderRadius: theme.radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: 10
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12
  },
  heroBadge: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 30,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder
  },
  heroBadgeText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: "600"
  },
  languageWrap: {
    alignItems: "flex-end",
    gap: 4
  },
  languageLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: "600"
  },
  languageRow: {
    flexDirection: "row",
    gap: 6
  },
  languageButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.card
  },
  languageButtonActive: {
    backgroundColor: theme.colors.cta,
    borderColor: theme.colors.cta
  },
  languageButtonText: {
    color: theme.colors.textMuted,
    fontWeight: "700",
    fontSize: 12
  },
  languageButtonTextActive: {
    color: theme.colors.ctaText
  },
  title: {
    fontSize: 30,
    color: theme.colors.heading,
    fontWeight: "700"
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4
  },
  primaryAction: {
    flex: 1,
    backgroundColor: theme.colors.cta,
    borderRadius: theme.radius.md,
    alignItems: "center",
    paddingVertical: 12
  },
  primaryActionText: {
    color: theme.colors.ctaText,
    fontWeight: "700"
  },
  secondaryAction: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    alignItems: "center",
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder
  },
  secondaryActionText: {
    color: theme.colors.heading,
    fontWeight: "700"
  },
  actionDisabled: {
    opacity: 0.5
  },
  loadingCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontSize: 14
  },
  errorText: {
    color: theme.colors.warning,
    fontWeight: "600"
  },
  errorDetailText: {
    color: theme.colors.warning,
    fontSize: 12
  },
  diagnosticsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10
  },
  diagnosticsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  diagnosticsTitle: {
    color: theme.colors.heading,
    fontWeight: "700"
  },
  diagnosticsChevron: {
    color: theme.colors.textMuted,
    fontSize: 16,
    fontWeight: "700"
  },
  diagnosticsBody: {
    marginTop: 6,
    gap: 3
  },
  diagnosticsLine: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  resultWrap: {
    gap: 10
  },
  summaryCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 12,
    gap: 8
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: theme.radius.md,
    marginBottom: 4
  },
  plantHeading: {
    color: theme.colors.heading,
    fontWeight: "700",
    fontSize: 24
  },
  plantSubheading: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontStyle: "italic"
  },
  confidencePill: {
    alignSelf: "flex-start",
    marginTop: 2,
    backgroundColor: theme.colors.background,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 30
  },
  confidenceText: {
    color: theme.colors.heading,
    fontWeight: "600"
  },
  metaInfo: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  altTitle: {
    marginTop: 4,
    color: theme.colors.heading,
    fontWeight: "700"
  },
  altSpecies: {
    color: theme.colors.textMuted,
    fontSize: 13
  },
  sourceLink: {
    color: theme.colors.cta,
    fontSize: 12,
    textDecorationLine: "underline"
  },
  shareAction: {
    marginTop: 8,
    backgroundColor: theme.colors.cta,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    paddingVertical: 11
  },
  shareActionText: {
    color: theme.colors.ctaText,
    fontWeight: "700"
  },
  sectionCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 12,
    gap: 6
  },
  sectionCardLink: {
    borderColor: theme.colors.cta
  },
  sectionCardPressed: {
    opacity: 0.85
  },
  sectionTitle: {
    color: theme.colors.heading,
    fontSize: 16,
    fontWeight: "700"
  },
  sectionBody: {
    color: theme.colors.textPrimary,
    lineHeight: 21,
    fontSize: 14
  },
  mapPreviewImage: {
    width: "100%",
    height: 120,
    borderRadius: theme.radius.sm,
    backgroundColor: "#152022",
    resizeMode: "contain"
  },
  historySectionWrap: {
    marginTop: 2,
    gap: 8
  },
  historyHeading: {
    color: theme.colors.heading,
    fontWeight: "700",
    fontSize: 20
  },
  historySearch: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: theme.colors.heading
  },
  emptyState: {
    color: theme.colors.textMuted,
    fontSize: 14,
    paddingVertical: 4
  },
  historyCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  historyMainArea: {
    flex: 1,
    gap: 4
  },
  historyPlant: {
    color: theme.colors.heading,
    fontWeight: "700"
  },
  historyMeta: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  deleteHistoryButton: {
    alignSelf: "stretch",
    minWidth: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  deleteHistoryText: {
    color: theme.colors.warning,
    fontSize: 18,
    fontWeight: "700"
  }
});
