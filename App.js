import React, { useState } from "react";
import { SafeAreaView, View, Text, Image, Pressable, ActivityIndicator, ScrollView, StyleSheet, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { OPENAI_API_KEY } from "@env";

const GRADIENT = ["#1956a7", "#b764d6"]; // Outfitly brand gradient

export default function App() {
  const [imageUri, setImageUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

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
  "palette": string[],                    // up to 5 HEX colors like "#AABBCC"
  "suggestions": string[]                 // 3 short outfit pairings or styling ideas
}
No markdown, no comments—just JSON.
              `.trim()
            },
            {
              type: "image_url",
              image_url: { url: dataUrl } // <-- FIX: send the data URL here
            }
          ]
        }
      ];

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.3,
          messages
        }),
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

  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.wrap}>
          <Image source={require("./assets/logo.png")} style={s.logo} resizeMode="contain" />
          <Text style={s.title}>Outfitly — MVP</Text>
          <Text style={s.subtitle}>Snap a piece → get AI styling tips</Text>

          <View style={s.previewBox}>
            {imageUri ? <Image source={{ uri: imageUri }} style={s.previewImg} /> : <Text style={s.previewPlaceholder}>No image selected</Text>}
          </View>

          <View style={s.row}>
            <PrimaryButton label="Upload Photo" onPress={pickFromLibrary} />
            <PrimaryButton label="Take Photo" onPress={takePhoto} />
          </View>

          <PrimaryButton label={busy ? "Analyzing…" : "Analyze with AI"} onPress={analyze} big disabled={!imageUri || busy} />

          {busy && <View style={{ marginTop: 16 }}><ActivityIndicator color="#fff" /></View>}

          {result && (
            <View style={s.card}>
              <Text style={s.cardH}>AI Summary</Text>
              <Text style={s.cardP}>{result.description}</Text>

              <Text style={s.cardH}>Aesthetics</Text>
              <View style={s.chips}>{result.aesthetics.map((a, i) => <Text key={i} style={s.chip}>{a}</Text>)}</View>

              {result.palette.length > 0 && (
                <>
                  <Text style={s.cardH}>Palette</Text>
                  <View style={s.swatches}>
                    {result.palette.map((c, i) => <View key={i} style={[s.swatch, { backgroundColor: c }]} />)}
                  </View>
                </>
              )}

              {result.suggestions.length > 0 && (
                <>
                  <Text style={s.cardH}>Suggestions</Text>
                  {result.suggestions.map((sugg, i) => <Text key={i} style={s.cardP}>• {sugg}</Text>)}
                </>
              )}
            </View>
          )}

          <View style={{ height: 36 }} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function PrimaryButton({ label, onPress, big, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, big && s.btnBig, disabled && { opacity: 0.6 }]}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", padding: 20 },
  logo: { width: 120, height: 80, marginTop: 8 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 8 },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginBottom: 14 },
  previewBox: { width: "100%", height: 280, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  previewImg: { width: "100%", height: "100%" },
  previewPlaceholder: { color: "#fff", opacity: 0.8 },
  row: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: { backgroundColor: "rgba(255,255,255,0.25)", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnBig: { width: "100%", marginTop: 12 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  card: { width: "100%", marginTop: 18, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 16, padding: 16 },
  cardH: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 8 },
  cardP: { color: "#fff", marginTop: 6, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { color: "#fff", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.25)" },
  swatches: { flexDirection: "row", gap: 8, marginTop: 8 },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" }
});
