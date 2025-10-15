import React, { useState, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  FlatList
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OPENAI_API_KEY } from "@env";

const GRADIENT = ["#1956a7", "#b764d6"]; // Outfitly brand gradient
const SAVED_KEY = "savedPieces";

export default function App() {
  const [imageUri, setImageUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [savedCount, setSavedCount] = useState(0);

  // Saved modal state
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [selected, setSelected] = useState(null); // selected saved entry

  // Load saved count at boot
  useEffect(() => {
    (async () => {
      try {
        const arr = await readSaved();
        setSavedCount(arr.length);
      } catch {}
    })();
  }, []);

  // ---- Helpers: Saved storage ----
  async function readSaved() {
    const raw = await AsyncStorage.getItem(SAVED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }
  async function writeSaved(arr) {
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(arr));
    setSavedCount(arr.length);
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled) {
      setResult(null);
      setImageUri(res.assets[0].uri);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      return Alert.alert("Permission required", "Camera access is needed to take a photo.");
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!res.canceled) {
      setResult(null);
      setImageUri(res.assets[0].uri);
    }
  }

  async function analyze() {
    if (!imageUri) return;
    if (!OPENAI_API_KEY || !OPENAI_API_KEY.startsWith("sk-")) {
      return Alert.alert("Missing API Key", "Set OPENAI_API_KEY in .env and restart with `expo start -c`.");
    }

    try {
      setBusy(true);
      setResult(null);

      // Resize + compress and return BASE64 directly
      const processed = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 900 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!processed.base64) throw new Error("Could not generate base64 from image.");

      const dataUrl = `data:image/jpeg;base64,${processed.base64}`;

      // Chat Completions expects "text" and "image_url" parts
      const messages = [
        { role: "system", content: "You are a helpful fashion assistant. Reply with compact, structured JSON only." },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Analyze the clothing in the image and return ONLY valid JSON:
{
  "description": string,                  // 1 short sentence
  "aesthetics": string[],                 // 3-5 vibes (e.g., minimal, streetwear)
  "palette": string[],                    // up to 5 complementary HEX colors like "#AABBCC"
  "suggestions": string[]                 // 5 short outfit pairings or styling ideas
}
No markdown, no comments—just JSON.
              `.trim()
            },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ];

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.3, messages }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${text}`);
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content?.trim() || "{}";
      let parsed;
      try { parsed = JSON.parse(content); } catch { parsed = { description: content }; }
      setResult(normalize(parsed));

    } catch (e) {
      console.error(e);
      Alert.alert("Analysis failed", String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function normalize(data) {
    const HEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    const out = {
      description: typeof data?.description === "string" ? data.description : "Clothing analysis",
      aesthetics: Array.isArray(data?.aesthetics) ? data.aesthetics.filter((s) => typeof s === "string").slice(0, 6) : [],
      palette: Array.isArray(data?.palette) ? data.palette.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 5) : [],
      suggestions: Array.isArray(data?.suggestions) ? data.suggestions.filter((s) => typeof s === "string").slice(0, 5) : [],
    };
    if (out.aesthetics.length === 0) out.aesthetics = ["minimal"];
    return out;
  }

  // SAVE BUTTON: persist current image + result locally
  async function savePiece() {
    if (!imageUri || !result) {
      return Alert.alert("Nothing to save", "Take or upload a photo and run Analyze first.");
    }
    try {
      const arr = await readSaved();
      const entry = {
        id: String(Date.now()),
        createdAt: new Date().toISOString(),
        imageUri,
        result,
      };
      arr.unshift(entry);
      await writeSaved(arr);
      Alert.alert("Saved", "Piece saved to your project.");
    } catch (e) {
      console.error(e);
      Alert.alert("Save failed", String(e?.message || e));
    }
  }

  // Open saved modal and load items
  async function openSaved() {
    try {
      const arr = await readSaved();
      setSavedList(arr);
      setSavedVisible(true);
      setSelected(null);
    } catch (e) {
      console.error(e);
      Alert.alert("Load failed", String(e?.message || e));
    }
  }

  async function deleteOne(id) {
    const arr = await readSaved();
    const next = arr.filter((x) => x.id !== id);
    await writeSaved(next);
    setSavedList(next);
    if (selected?.id === id) setSelected(null);
  }

  async function clearAll() {
    Alert.alert("Clear all saved?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: async () => {
        await writeSaved([]);
        setSavedList([]);
        setSelected(null);
      }}
    ]);
  }

  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.wrap}>
          {/* Logo */}
          <Image source={require("./assets/logo.png")} style={s.logo} resizeMode="contain" />

          {/* Title + Saved */}
          <Text style={s.title}>Outfitly — MVP</Text>
          <Text style={s.subtitle}>Snap a piece → get AI styling tips</Text>

          <View style={s.savedRow}>
            <Text style={s.savedBadge}>Saved: {savedCount}</Text>
            <Pressable onPress={openSaved} style={s.btnSmall}>
              <Text style={s.btnText}>View Saved</Text>
            </Pressable>
          </View>

          {/* Preview */}
          <View style={s.previewBox}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={s.previewImg} />
            ) : (
              <Text style={s.previewPlaceholder}>No image selected</Text>
            )}
          </View>

          {/* Buttons */}
          <View style={s.row}>
            <PrimaryButton label="Upload Photo" onPress={pickFromLibrary} />
            <PrimaryButton label="Take Photo" onPress={takePhoto} />
          </View>

          <PrimaryButton
            label={busy ? "Analyzing…" : "Analyze with AI"}
            onPress={analyze}
            big
            disabled={!imageUri || busy}
          />

          {/* NEW: Save to Project button */}
          <PrimaryButton
            label="Save piece to closet"
            onPress={savePiece}
            big
            disabled={!imageUri || !result || busy}
          />

          {/* Results */}
          {busy && (
            <View style={{ marginTop: 16 }}>
              <ActivityIndicator color="#fff" />
            </View>
          )}

          {result && (
            <View style={s.card}>
              <Text style={s.cardH}>AI Summary</Text>
              <Text style={s.cardP}>{result.description}</Text>

              <Text style={s.cardH}>Aesthetics</Text>
              <View style={s.chips}>
                {result.aesthetics.map((a, idx) => (
                  <Text key={idx} style={s.chip}>{a}</Text>
                ))}
              </View>

              {result.palette.length > 0 && (
                <>
                  <Text style={s.cardH}>Palette</Text>
                  <View style={s.swatches}>
                    {result.palette.map((c, idx) => (
                      <View key={idx} style={[s.swatch, { backgroundColor: c }]} />
                    ))}
                  </View>
                </>
              )}

              {result.suggestions.length > 0 && (
                <>
                  <Text style={s.cardH}>Suggestions</Text>
                  {result.suggestions.map((sugg, idx) => (
                    <Text key={idx} style={s.cardP}>• {sugg}</Text>
                  ))}
                </>
              )}
            </View>
          )}

          <View style={{ height: 36 }} />
        </ScrollView>
      </SafeAreaView>

      {/* SAVED MODAL */}
      <Modal visible={savedVisible} animationType="slide" onRequestClose={() => setSavedVisible(false)}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={{ padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>Saved Pieces</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={clearAll} style={[s.btnSmall, { backgroundColor: "rgba(255,0,0,0.4)" }]}>
                  <Text style={s.btnText}>Clear All</Text>
                </Pressable>
                <Pressable onPress={() => setSavedVisible(false)} style={s.btnSmall}>
                  <Text style={s.btnText}>Close</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              {savedList.length === 0 ? (
                <Text style={{ color: "#fff", opacity: 0.9, textAlign: "center", marginTop: 20 }}>
                  Nothing saved yet.
                </Text>
              ) : (
                <FlatList
                  data={savedList}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => setSelected(item)} style={stylesSaved.cardRow}>
                      <Image source={{ uri: item.imageUri }} style={stylesSaved.thumb} />
                      <View style={{ flex: 1 }}>
                        <Text style={stylesSaved.title} numberOfLines={1}>
                          {item.result?.description || "Saved piece"}
                        </Text>
                        <Text style={stylesSaved.meta}>
                          {new Date(item.createdAt).toLocaleString()}
                        </Text>
                        {Array.isArray(item.result?.aesthetics) && item.result.aesthetics.length > 0 && (
                          <Text style={stylesSaved.meta} numberOfLines={1}>
                            {item.result.aesthetics.join(" · ")}
                          </Text>
                        )}
                      </View>
                      <Pressable onPress={() => deleteOne(item.id)} style={stylesSaved.deleteBtn}>
                        <Text style={{ color: "#fff", fontWeight: "700" }}>×</Text>
                      </Pressable>
                    </Pressable>
                  )}
                />
              )}
            </View>

            {/* Detail bottom sheet-ish */}
            {selected && (
              <View style={stylesSaved.detail}>
                <View style={stylesSaved.detailBar} />
                <Text style={stylesSaved.detailTitle}>
                  {selected.result?.description || "Saved piece"}
                </Text>
                {Array.isArray(selected.result?.aesthetics) && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    {selected.result.aesthetics.map((a, i) => (
                      <Text key={i} style={s.chip}>{a}</Text>
                    ))}
                  </View>
                )}
                {Array.isArray(selected.result?.palette) && selected.result.palette.length > 0 && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    {selected.result.palette.map((c, i) => (
                      <View key={i} style={[s.swatch, { backgroundColor: c }]} />
                    ))}
                  </View>
                )}
                {Array.isArray(selected.result?.suggestions) && selected.result.suggestions.length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    {selected.result.suggestions.map((sg, i) => (
                      <Text key={i} style={s.cardP}>• {sg}</Text>
                    ))}
                  </View>
                )}
                <Pressable onPress={() => setSelected(null)} style={[s.btnSmall, { alignSelf: "center", marginTop: 12 }]}>
                  <Text style={s.btnText}>Close</Text>
                </Pressable>
              </View>
            )}
          </SafeAreaView>
        </LinearGradient>
      </Modal>
    </LinearGradient>
  );
}

// Reusable button
function PrimaryButton({ label, onPress, big, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        s.btn,
        big && s.btnBig,
        disabled && { opacity: 0.6 }
      ]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", padding: 20 },
  logo: { width: 120, height: 80, marginTop: 8 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 8 },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginBottom: 6 },
  savedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 8 },
  savedBadge: { color: "#fff", opacity: 0.9 },
  previewBox: {
    width: "100%", height: 280, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center", overflow: "hidden"
  },
  previewImg: { width: "100%", height: "100%" },
  previewPlaceholder: { color: "#fff", opacity: 0.8 },
  row: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: {
    backgroundColor: "rgba(255,255,255,0.25)", paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, alignItems: "center", justifyContent: "center"
  },
  btnSmall: {
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10,
  },
  btnBig: { width: "100%", marginTop: 12 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  card: {
    width: "100%", marginTop: 18, backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 16, padding: 16
  },
  cardH: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 8 },
  cardP: { color: "#fff", marginTop: 6, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { color: "#fff", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.25)" },
  swatches: { flexDirection: "row", gap: 8, marginTop: 8 },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" },
});

const stylesSaved = StyleSheet.create({
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.25)",
    padding: 10,
    borderRadius: 12,
    marginBottom: 10
  },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: "#222" },
  title: { color: "#fff", fontWeight: "700" },
  meta: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  deleteBtn: {
    width: 28, height: 28, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,0,0,0.5)", borderRadius: 8
  },
  detail: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },
  detailBar: {
    alignSelf: "center",
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.7)", marginBottom: 8
  },
  detailTitle: { color: "#fff", fontSize: 18, fontWeight: "800", textAlign: "center" },
});
