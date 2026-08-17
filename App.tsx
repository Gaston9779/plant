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
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import NetInfo from "@react-native-community/netinfo";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { runPlantPipeline } from "./src/services/pipeline";
import { readCachedResult, saveCachedResult } from "./src/storage/cache";
import { appendHistory, loadHistory, removeHistoryEntry } from "./src/storage/history";
import { HistoryEntry, LanguageCode, PlantResult } from "./src/types";
import { theme } from "./src/theme";

const BUILD_MARKER = "build-2026-02-22-common-name-map-cache-v2";
const HABITAT_BASEMAP_URL =
  "https://basemaps.cartocdn.com/light_all/0/0/0.png";

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
    analysisText: string;
    confidence: string;
    alternatives: string;
    share: string;
    history: string;
    findPlant: string;
    emptyHistory: string;
    emptyHistorySubtitle: string;
    provider: string;
    disease: string;
    dataSources: string;
    deleteRecord: string;
    cameraPermission: string;
    galleryPermission: string;
    genericError: string;
    language: string;
    description: string;
    botanicalProfile: string;
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
    analysisText: "Riconosciamo forme, venature e dettagli unici della tua pianta per offrirti l’identificazione più accurata.",
    confidence: "Affidabilità",
    alternatives: "Specie alternative",
    share: "Condividi scheda",
    history: "Cronologia ricerche",
    findPlant: "Cerca una pianta",
    emptyHistory: "Le analisi salvate appariranno qui.",
    emptyHistorySubtitle: "Identifica la tua prima pianta per iniziare il tuo piccolo erbario digitale.",
    provider: "Provider CV",
    disease: "Possibile malattia",
    dataSources: "Fonti dati",
    deleteRecord: "Elimina",
    cameraPermission: "Serve il permesso fotocamera.",
    galleryPermission: "Serve il permesso libreria foto.",
    genericError: "Analisi non riuscita.",
    language: "Lingua",
    description: "Descrizione",
    botanicalProfile: "Profilo botanico",
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
    analysisText: "We’re recognising shapes, veins and the unique details of your plant to offer the most accurate identification.",
    confidence: "Confidence",
    alternatives: "Alternative species",
    share: "Share card",
    history: "Search History",
    findPlant: "Find a plant",
    emptyHistory: "Your saved analyses will appear here.",
    emptyHistorySubtitle: "Identify your first plant to start building your small digital herbarium.",
    provider: "CV provider",
    disease: "Possible disease",
    dataSources: "Data sources",
    deleteRecord: "Delete",
    cameraPermission: "Camera permission is required.",
    galleryPermission: "Library permission is required.",
    genericError: "Analysis failed.",
    language: "Language",
    description: "Description",
    botanicalProfile: "Botanical profile",
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
    analysisText: "Reconocemos formas, venas y detalles únicos de tu planta para ofrecerte la identificación más precisa.",
    confidence: "Confianza",
    alternatives: "Especies alternativas",
    share: "Compartir ficha",
    history: "Historial",
    findPlant: "Buscar planta",
    emptyHistory: "Tus analisis guardados apareceran aqui.",
    emptyHistorySubtitle: "Identifica tu primera planta para empezar tu pequeño herbario digital.",
    provider: "Proveedor CV",
    disease: "Posible enfermedad",
    dataSources: "Fuentes",
    deleteRecord: "Eliminar",
    cameraPermission: "Se requiere permiso de camara.",
    galleryPermission: "Se requiere permiso de galeria.",
    genericError: "Fallo del analisis.",
    language: "Idioma",
    description: "Descripcion",
    botanicalProfile: "Perfil botanico",
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
  warning = false,
  onPress
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  body: string;
  warning?: boolean;
  onPress?: (() => void) | null;
}) => (
  <Pressable
    style={({ pressed }) => [styles.sectionCard, onPress && styles.sectionCardLink, pressed && onPress && styles.sectionCardPressed]}
    onPress={onPress ?? undefined}
    disabled={!onPress}
  >
    <View style={styles.sectionHeader}>
      <MaterialCommunityIcons name={icon} size={21} color={warning ? theme.colors.warning : theme.colors.cta} />
      <Text style={[styles.sectionTitle, warning && styles.warningTitle]}>{title}</Text>
      {onPress && <MaterialCommunityIcons name="chevron-down" size={20} color={warning ? theme.colors.warning : theme.colors.cta} />}
    </View>
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
  const [lastAnalyzedUri, setLastAnalyzedUri] = useState<string | null>(null);
  const [curiosityBySpecies, setCuriosityBySpecies] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!lastAnalyzedUri || !currentResult) return;
    if (isLoading) return;
    if (currentResult.language === language) return;
    void identifyImage(lastAnalyzedUri);
  }, [language, lastAnalyzedUri, currentResult, isLoading]);

  const filteredHistory = useMemo(() => {
    if (!historyFilter.trim()) return history;
    const query = historyFilter.trim().toLowerCase();
    return history.filter((item) =>
      [item.query, item.result.knowledge.scientificName, item.result.knowledge.commonName]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [history, historyFilter]);

  const identifyImage = async (uri: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setErrorTechnical(null);

    try {
      const cached = await readCachedResult(uri, language);
      if (cached) {
        setLastAnalyzedUri(uri);
        setCurrentResult(cached);
        setHistory(await appendHistory(cached));
        setIsLoading(false);
        return;
      }

      const result = await runPlantPipeline(uri, isOnline, language);
      setLastAnalyzedUri(uri);
      setCurrentResult(result);
      await saveCachedResult(uri, language, result);
      setHistory(await appendHistory(result));
    } catch (unknownError) {
      const technical =
        unknownError instanceof Error
          ? `${unknownError.name}: ${unknownError.message}`
          : String(unknownError);
      console.error("[plant-pipeline] failure", unknownError);
      setError(t.genericError);
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

  const handleLanguageChange = (code: LanguageCode): void => {
    setLanguage(code);
  };

  useEffect(() => {
    const species = currentResult?.knowledge?.scientificName || currentResult?.knowledge?.commonName;
    if (!species || !backendUrl) return;
    const cacheKey = `${species.trim().toLowerCase()}|${language}`;
    if (curiosityBySpecies[cacheKey]) return;

    const normalizedBackendUrl = backendUrl.endsWith("/") ? backendUrl.slice(0, -1) : backendUrl;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `${normalizedBackendUrl}/plants/${encodeURIComponent(species)}/curiosity?lang=${encodeURIComponent(
            language
          )}`
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { curiosity?: string };
        const curiosity = String(payload?.curiosity || "").trim();
        if (!curiosity || cancelled) return;
        setCuriosityBySpecies((prev) => ({
          ...prev,
          [cacheKey]: curiosity
        }));
      } catch (error) {
        console.error("[curiosity] failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentResult?.knowledge?.scientificName, currentResult?.knowledge?.commonName, backendUrl, curiosityBySpecies, language]);

  const WebLottie = Platform.OS === "web" ? (require("lottie-react").default as any) : null;
  const sectionLinks = currentResult?.knowledge.sectionLinks;
  const botanicalProfileBody = useMemo(() => {
    if (!currentResult) return "";
    if (language === "it") {
      return `Famiglia: ${currentResult.knowledge.family}. Genere: ${currentResult.knowledge.genus}. ${t.provider}: ${currentResult.classification.provider}. ${t.confidence}: ${getConfidenceLabel(currentResult.classification.confidence)}.`;
    }
    if (language === "es") {
      return `Familia: ${currentResult.knowledge.family}. Genero: ${currentResult.knowledge.genus}. ${t.provider}: ${currentResult.classification.provider}. ${t.confidence}: ${getConfidenceLabel(currentResult.classification.confidence)}.`;
    }
    return `Family: ${currentResult.knowledge.family}. Genus: ${currentResult.knowledge.genus}. ${t.provider}: ${currentResult.classification.provider}. ${t.confidence}: ${getConfidenceLabel(currentResult.classification.confidence)}.`;
  }, [currentResult, language, t.provider, t.confidence]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        {isLoading && (
          <View style={styles.loaderOverlay}>
            <View style={styles.loaderBackdrop} />
            <View style={styles.analysisCard} accessibilityViewIsModal>
              <View style={styles.analysisArt}>
                {WebLottie ? <WebLottie animationData={require("./src/assets/plant.json")} loop autoplay style={styles.loaderCentered} /> : <MaterialCommunityIcons name="leaf" size={86} color={theme.colors.sage} />}
              </View>
              <MaterialCommunityIcons name="sprout" size={25} color={theme.colors.cta} />
              <Text style={styles.analysisTitle}>{t.loading.replace("reale ", "")}</Text>
              <Text style={styles.analysisText}>{t.analysisText}</Text>
              <View style={styles.analysisDots}><View style={styles.analysisDotActive} /><View style={styles.analysisDot} /><View style={styles.analysisDot} /></View>
            </View>
          </View>
        )}
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
        >
        <View style={styles.appHeader}>
          <View style={styles.logoWrap}>
            <MaterialCommunityIcons name="sprout" size={28} color={theme.colors.cta} />
            <Text style={styles.logoText}>Plant{"\n"}Discovery</Text>
          </View>
          <View style={styles.languageRow} accessibilityLabel={t.language}>
            {(["it", "en", "es"] as LanguageCode[]).map((code) => (
              <Pressable key={code} hitSlop={6} style={[styles.languageButton, language === code && styles.languageButtonActive]} onPress={() => handleLanguageChange(code)}>
                <Text style={[styles.languageButtonText, language === code && styles.languageButtonTextActive]}>{languageLabel[code]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroBadge}>
              <View style={styles.onlineDot} /><Text style={styles.heroBadgeText}>{isOnline ? t.online : t.offline}</Text>
            </View>
          </View>
          <View style={styles.heroLeafGhost}><MaterialCommunityIcons name="leaf" size={182} color={theme.colors.sage} /></View>
          <Text style={styles.title}>Plant{"\n"}Discovery</Text>
          <Text style={styles.subtitle}>{t.appSubtitle}</Text>
        </View>
        <View style={styles.actionsStack}>
          <Pressable style={[styles.primaryAction, isLoading && styles.actionDisabled]} onPress={handleCapture} disabled={isLoading}><MaterialCommunityIcons name="camera-outline" size={20} color={theme.colors.ctaText} /><Text style={styles.primaryActionText}>{t.capture}</Text></Pressable>
          <Pressable style={[styles.secondaryAction, isLoading && styles.actionDisabled]} onPress={handleUpload} disabled={isLoading}><MaterialCommunityIcons name="upload-outline" size={20} color={theme.colors.cta} /><Text style={styles.secondaryActionText}>{t.upload}</Text></Pressable>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {currentResult && (
          <View style={styles.resultWrap}>
            <View style={styles.summaryCard}>
              {(currentResult.imageUri || currentResult.knowledge.imageUrl) && <Image source={{ uri: currentResult.imageUri || currentResult.knowledge.imageUrl! }} style={styles.previewImage} />}
              <Text style={styles.plantHeading}>{currentResult.knowledge.scientificName}</Text>
              <Text style={styles.plantSubheading}>
                {currentResult.knowledge.commonName || currentResult.knowledge.family}
              </Text>
              <View style={styles.quickFactsRow}>
                <View style={styles.quickFactPill}>
                  <Text style={styles.quickFactText}>{`Family · ${currentResult.knowledge.family}`}</Text>
                </View>
                <View style={styles.quickFactPill}>
                  <Text style={styles.quickFactText}>{`Genus · ${currentResult.knowledge.genus}`}</Text>
                </View>
              </View>

              <View style={styles.confidencePill}>
                <View style={styles.confidenceTop}><MaterialCommunityIcons name="shield-check" size={20} color={theme.colors.cta} /><Text style={styles.confidenceText}>{t.confidence}</Text><Text style={styles.confidencePercent}>{getConfidenceLabel(currentResult.classification.confidence)}</Text></View>
                <View style={styles.confidenceTrack}><View style={[styles.confidenceFill, { width: `${Math.round(currentResult.classification.confidence * 100)}%` }]} /></View>
              </View>
              {currentResult.classification.alternatives.length > 0 && <><Text style={styles.altTitle}>{t.alternatives}</Text><View style={styles.alternativesWrap}>{currentResult.classification.alternatives.map((item, index) => (<View key={`${item.species}-${index}`} style={styles.alternativePill}><Text numberOfLines={1} style={styles.altSpecies}>{item.species}</Text><Text style={styles.altPercent}>{getConfidenceLabel(item.confidence)}</Text></View>))}</View></>}

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
              icon="shield-check-outline"
              title={t.botanicalProfile}
              body={botanicalProfileBody}
            />
            <SectionCard
              icon="sprout"
              title={t.description}
              body={currentResult.narrative.description}
              onPress={sectionLinks?.description ? () => void openSourceLink(sectionLinks.description!) : null}
            />
            <SectionCard
              icon="book-open-variant-outline"
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
                <View style={styles.sectionHeader}><MaterialCommunityIcons name="map-marker-outline" size={21} color={theme.colors.cta} /><Text style={styles.sectionTitle}>{t.habitat}</Text><MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.cta} /></View>
                <View style={styles.mapLayerWrap}>
                  <Image source={{ uri: HABITAT_BASEMAP_URL }} style={styles.mapPreviewImage} />
                  <Image
                    source={{ uri: currentResult.knowledge.habitatMapPreviewUrl }}
                    style={styles.mapOverlayImage}
                  />
                </View>
              </Pressable>
            ) : (
              <SectionCard
                icon="map-marker-outline"
                title={t.habitat}
                body={currentResult.narrative.habitat}
                onPress={sectionLinks?.habitat ? () => void openSourceLink(sectionLinks.habitat!) : null}
              />
            )}
            <SectionCard
              icon="alert-outline"
              title={t.toxicity}
              body={currentResult.narrative.toxicity}
              warning
              onPress={sectionLinks?.toxicity ? () => void openSourceLink(sectionLinks.toxicity!) : null}
            />
            <SectionCard icon="watering-can-outline" title={t.care} body={currentResult.narrative.care} />
            <SectionCard
              icon="lightbulb-on-outline"
              title={t.funFacts}
              body={
                curiosityBySpecies[
                  `${(currentResult.knowledge.scientificName || currentResult.knowledge.commonName || "")
                    .trim()
                    .toLowerCase()}|${language}`
                ] || currentResult.narrative.funFacts
              }
              onPress={sectionLinks?.funFacts ? () => void openSourceLink(sectionLinks.funFacts!) : null}
            />
          </View>
        )}

        <View style={styles.historySectionWrap}>
          <View style={styles.historyTitleRow}><MaterialCommunityIcons name="history" size={24} color={theme.colors.cta} /><Text style={styles.historyHeading}>{t.history}</Text></View>
          <View style={styles.historySearchWrap}><TextInput style={styles.historySearch} placeholder={t.findPlant} placeholderTextColor={theme.colors.textFaint} value={historyFilter} onChangeText={setHistoryFilter} /><MaterialCommunityIcons name="magnify" size={21} color={theme.colors.cta} /></View>

          {filteredHistory.length === 0 ? (
            <View style={styles.emptyStateWrap}><MaterialCommunityIcons name="sprout-outline" size={42} color={theme.colors.sage} /><Text style={styles.emptyState}>{t.emptyHistory}{"\n"}{t.emptyHistorySubtitle}</Text></View>
          ) : (
            filteredHistory.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <Pressable
                  style={styles.historyMainArea}
                  onPress={() => {
                    setCurrentResult(item.result);
                  }}
                >
                  {item.result.imageUri || item.result.knowledge.imageUrl ? <Image source={{ uri: item.result.imageUri || item.result.knowledge.imageUrl! }} style={styles.historyImage} /> : <View style={styles.historyImageFallback}><MaterialCommunityIcons name="leaf" size={25} color={theme.colors.sage} /></View>}
                  <View style={styles.historyCopy}><Text style={styles.historyPlant}>{item.result.knowledge.scientificName || item.result.knowledge.commonName}</Text><Text style={styles.historyCommon}>{item.result.knowledge.commonName}</Text><Text style={styles.historyMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text></View>
                  <Text style={styles.historyConfidence}>{getConfidenceLabel(item.result.classification.confidence)}</Text><MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.cta} />
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

const baseStyles = StyleSheet.create({
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
    padding: 18,
    paddingBottom: 46,
    gap: 16
  },
  hero: {
    backgroundColor: theme.colors.backgroundAccent,
    borderRadius: theme.radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: 10,
    shadowColor: "#1f2b1d",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
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
    lineHeight: 23
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
    gap: 8,
    shadowColor: "#1f2b1d",
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2
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
  quickFactsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  quickFactPill: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  quickFactText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: "600"
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
  sourceLinkChip: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.background
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
    gap: 6,
    shadowColor: "#1f2b1d",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
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
    resizeMode: "cover"
  },
  mapLayerWrap: {
    width: "100%",
    height: 120,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    backgroundColor: "#152022"
  },
  mapOverlayImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    resizeMode: "cover"
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

const styles = StyleSheet.create({
  ...baseStyles,
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 480, alignSelf: "center", paddingHorizontal: 22, paddingTop: 18, paddingBottom: 42, gap: 14 },
  appHeader: { minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  logoWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  logoText: { color: theme.colors.heading, fontFamily: theme.font.display, fontSize: 15, fontWeight: "700", lineHeight: 14 },
  languageRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  languageButton: { minWidth: 30, minHeight: 30, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  languageButtonActive: { backgroundColor: theme.colors.cta },
  languageButtonText: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted },
  languageButtonTextActive: { color: theme.colors.ctaText },
  hero: { minHeight: 368, overflow: "hidden", padding: 25, justifyContent: "flex-end", backgroundColor: theme.colors.cardWhite, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.cardBorder, ...theme.shadow },
  heroTopRow: { position: "absolute", top: 20, left: 22 },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 5, paddingHorizontal: 0 },
  onlineDot: { width: 9, height: 9, borderRadius: 9, backgroundColor: "#559361" },
  heroBadgeText: { color: theme.colors.cta, fontWeight: "600", fontSize: 13 },
  heroLeafGhost: { position: "absolute", right: -28, top: 22, opacity: 0.16, transform: [{ rotate: "-19deg" }] },
  title: { color: theme.colors.heading, fontFamily: theme.font.display, fontSize: 41, letterSpacing: -1.5, lineHeight: 42, fontWeight: "700", marginBottom: 18 },
  subtitle: { maxWidth: "66%", color: theme.colors.textPrimary, fontSize: 14, lineHeight: 21 },
  actionsStack: { gap: 11, marginTop: 4 },
  primaryAction: { height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cta, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, ...theme.shadow },
  primaryActionText: { color: theme.colors.ctaText, fontSize: 15, fontWeight: "800" },
  secondaryAction: { height: 55, borderRadius: theme.radius.pill, backgroundColor: theme.colors.cardWhite, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, borderWidth: 1, borderColor: theme.colors.cardBorder, ...theme.shadow },
  secondaryActionText: { color: theme.colors.heading, fontSize: 15, fontWeight: "800" },
  actionDisabled: { opacity: 0.55 },
  errorText: { backgroundColor: "#FFF4F0", borderRadius: theme.radius.md, padding: 14, color: theme.colors.warning, fontWeight: "600", lineHeight: 20 },
  loaderOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 20, padding: 24 },
  loaderBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(17, 38, 24, 0.70)" },
  analysisCard: { width: "100%", maxWidth: 330, minHeight: 450, borderRadius: theme.radius.xl, backgroundColor: theme.colors.cardWhite, alignItems: "center", justifyContent: "center", padding: 29, gap: 14, ...theme.shadow },
  analysisArt: { width: 170, height: 170, alignItems: "center", justifyContent: "center", borderRadius: 85, backgroundColor: "#F6F5EC" },
  loaderCentered: { width: 164, height: 164 },
  analysisTitle: { color: theme.colors.heading, fontFamily: theme.font.display, textAlign: "center", fontSize: 26, lineHeight: 30, fontWeight: "700" },
  analysisText: { color: theme.colors.textPrimary, textAlign: "center", fontSize: 13, lineHeight: 20 },
  analysisDots: { flexDirection: "row", gap: 7, marginTop: 4 },
  analysisDotActive: { width: 7, height: 7, borderRadius: 7, backgroundColor: theme.colors.sage },
  analysisDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: "#D2DACB" },
  resultWrap: { gap: 12, marginTop: 4 },
  summaryCard: { padding: 0, gap: 10, backgroundColor: "transparent", borderWidth: 0, shadowOpacity: 0 },
  previewImage: { width: "100%", height: undefined, aspectRatio: 1, borderRadius: theme.radius.lg, marginBottom: 10, backgroundColor: theme.colors.sage },
  plantHeading: { color: theme.colors.heading, fontFamily: theme.font.display, fontSize: 30, lineHeight: 35, fontWeight: "700" },
  plantSubheading: { color: theme.colors.cta, fontSize: 15, fontStyle: "normal", fontWeight: "600" },
  quickFactsRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 2 },
  quickFactPill: { backgroundColor: theme.colors.backgroundAccent, borderWidth: 0, borderRadius: theme.radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  quickFactText: { color: theme.colors.heading, fontSize: 11, fontWeight: "700" },
  confidencePill: { alignSelf: "stretch", backgroundColor: theme.colors.cardWhite, padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, marginTop: 5, gap: 9, ...theme.shadow },
  confidenceTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  confidenceText: { color: theme.colors.textPrimary, flex: 1, fontSize: 13, fontWeight: "700" },
  confidencePercent: { color: theme.colors.cta, fontSize: 18, fontWeight: "800" },
  confidenceTrack: { height: 4, width: "100%", overflow: "hidden", borderRadius: 99, backgroundColor: theme.colors.backgroundAccent },
  confidenceFill: { height: "100%", borderRadius: 99, backgroundColor: theme.colors.cta },
  altTitle: { color: theme.colors.heading, marginTop: 8, fontSize: 13, fontWeight: "800" },
  alternativesWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  alternativePill: { maxWidth: "100%", flexDirection: "row", gap: 9, paddingVertical: 7, paddingHorizontal: 10, borderRadius: theme.radius.pill, backgroundColor: theme.colors.backgroundAccent },
  altSpecies: { color: theme.colors.cta, fontSize: 11, fontWeight: "600" }, altPercent: { color: theme.colors.heading, fontSize: 11, fontWeight: "800" },
  shareAction: { height: 53, marginTop: 8, backgroundColor: theme.colors.cta, borderRadius: theme.radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", ...theme.shadow },
  shareActionText: { color: theme.colors.ctaText, fontWeight: "800", fontSize: 14 },
  sectionCard: { backgroundColor: theme.colors.cardWhite, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: 16, gap: 10, ...theme.shadow },
  sectionCardLink: { borderColor: theme.colors.cardBorder }, sectionCardPressed: { opacity: 0.9 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { flex: 1, color: theme.colors.heading, fontSize: 15, fontWeight: "800" }, warningTitle: { color: theme.colors.warning },
  sectionBody: { color: theme.colors.textPrimary, fontSize: 13, lineHeight: 20 },
  mapLayerWrap: { height: 125, borderRadius: theme.radius.sm, overflow: "hidden", backgroundColor: theme.colors.backgroundAccent },
  mapPreviewImage: { width: "100%", height: 125, resizeMode: "cover", opacity: 0.45 }, mapOverlayImage: { position: "absolute", width: "100%", height: 125, resizeMode: "cover" },
  historySectionWrap: { marginTop: 14, gap: 10 }, historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  historyHeading: { color: theme.colors.heading, fontFamily: theme.font.display, fontWeight: "700", fontSize: 23 },
  historySearchWrap: { height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: "#E7EBDD" },
  historySearch: { flex: 1, color: theme.colors.heading, fontSize: 13, paddingVertical: 0 },
  emptyStateWrap: { alignItems: "center", gap: 9, paddingVertical: 25 }, emptyState: { color: theme.colors.textMuted, textAlign: "center", fontSize: 13, lineHeight: 20 },
  historyCard: { backgroundColor: theme.colors.cardWhite, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: 6, flexDirection: "row", ...theme.shadow },
  historyMainArea: { flex: 1, minHeight: 61, flexDirection: "row", alignItems: "center", gap: 10 },
  historyImage: { width: 51, height: 51, borderRadius: 11, backgroundColor: theme.colors.backgroundAccent }, historyImageFallback: { width: 51, height: 51, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.backgroundAccent },
  historyCopy: { flex: 1, gap: 2 }, historyPlant: { color: theme.colors.heading, fontWeight: "800", fontSize: 13 }, historyCommon: { color: theme.colors.cta, fontSize: 11 }, historyMeta: { color: theme.colors.textFaint, fontSize: 10 }, historyConfidence: { color: theme.colors.heading, fontSize: 12, fontWeight: "800" },
  deleteHistoryButton: { width: 34, minWidth: 34, alignSelf: "stretch", borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0 }, deleteHistoryText: { color: theme.colors.warning, fontSize: 17 }
});
