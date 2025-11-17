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
import { OPENAI_API_KEY, FASHN_API_KEY } from "@env";

const GRADIENT = ["#1956a7", "#b764d6"]; // Outfitly brand gradient
const SAVED_KEY = "savedPieces";
const OUTFITS_KEY = "savedOutfits";

export default function App() {
  const [imageUri, setImageUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [savedCount, setSavedCount] = useState(0);

  // Saved modal state
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [selected, setSelected] = useState(null); // selected saved entry

  // Outfit generation state
  const [outfitBusy, setOutfitBusy] = useState(false);
  
  // Navigation state
  const [currentView, setCurrentView] = useState("main"); // "main" or "outfits"
  const [outfitsList, setOutfitsList] = useState([]);
  const [selectedOutfit, setSelectedOutfit] = useState(null);

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
  
  // ---- Helpers: Outfits storage ----
  async function readOutfits() {
    const raw = await AsyncStorage.getItem(OUTFITS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }
  async function writeOutfits(arr) {
    await AsyncStorage.setItem(OUTFITS_KEY, JSON.stringify(arr));
    setOutfitsList(arr);
  }
  
  // Load outfits list
  useEffect(() => {
    if (currentView === "outfits") {
      (async () => {
        try {
          const arr = await readOutfits();
          setOutfitsList(arr);
        } catch {}
      })();
    }
  }, [currentView]);

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

  // AI Outfit Selection: Analyze closet and pick compatible pieces
  async function createOutfit() {
    const items = await readSaved();
    if (items.length < 2) {
      return Alert.alert("Not enough items", "You need at least 2 items in your closet to create an outfit.");
    }
    if (!OPENAI_API_KEY || !OPENAI_API_KEY.startsWith("sk-")) {
      return Alert.alert("Missing API Key", "Set OPENAI_API_KEY in .env and restart with `expo start -c`.");
    }

    try {
      setOutfitBusy(true);

      // Prepare closet data for AI analysis with detailed information
      const closetData = items.map((item, idx) => ({
        id: item.id,
        index: idx + 1,
        description: item.result?.description || "Clothing item",
        aesthetics: item.result?.aesthetics || [],
        palette: item.result?.palette || [],
        suggestions: item.result?.suggestions || [],
        imageUri: item.imageUri
      }));

      // Convert ALL images to base64 for comprehensive visual analysis
      const imagePromises = items.map(async (item, idx) => {
        try {
          const processed = await ImageManipulator.manipulateAsync(
            item.imageUri,
            [{ resize: { width: 512 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          return {
            dataUrl: processed.base64 ? `data:image/jpeg;base64,${processed.base64}` : null,
            itemId: item.id,
            index: idx + 1
          };
        } catch {
          return { dataUrl: null, itemId: item.id, index: idx + 1 };
        }
      });

      const imageData = (await Promise.all(imagePromises)).filter(img => img.dataUrl !== null);

      // Build detailed closet summary with item categorization
      const closetSummary = closetData.map((item) => {
        const colors = item.palette.length > 0 ? item.palette.join(", ") : "not specified";
        const styles = item.aesthetics.length > 0 ? item.aesthetics.join(", ") : "not specified";
        return `Item ${item.index} (ID: ${item.id}): ${item.description}\n  - Colors: ${colors}\n  - Style/Aesthetics: ${styles}`;
      }).join("\n\n");

      // Use OpenAI with vision to analyze images and select matching outfit
      const messages = [
        {
          role: "system",
          content: "You are an expert fashion stylist with deep knowledge of color theory, style matching, and outfit coordination. Analyze clothing items visually and textually to create cohesive, stylish outfits. Always return valid JSON only."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
You are analyzing a digital closet with ${items.length} clothing items. Your task is to select 3-5 items that create a complete, cohesive, and stylish outfit.

CLOSET ITEMS:
${closetSummary}

For each item, you have:
- Visual image (shown below)
- Description
- Color palette
- Style/aesthetic tags

YOUR TASK:
1. Analyze each item's visual appearance, colors, style, and type (top, bottom, outerwear, accessories, shoes, etc.)
2. Select 3-5 items that work together as a complete outfit
3. Ensure the outfit includes: at least one top, at least one bottom, and optionally accessories/outerwear
4. Match items based on:
   - Color harmony (complementary, analogous, or monochromatic schemes)
   - Style consistency (e.g., all casual, all formal, all streetwear)
   - Visual balance and proportion
   - Occasion appropriateness

CRITICAL: You MUST select items ONLY from the list above. Do NOT suggest or include any items that are not explicitly listed in the closet items. Every item in selectedIds must match an exact ID from the list above.

Return ONLY valid JSON with this exact structure:
{
  "selectedIds": ["item_id_1", "item_id_2", "item_id_3"],
  "outfitDescription": "A complete description of how the outfit looks and feels",
  "style": "casual|formal|streetwear|business|sporty|bohemian|minimalist|etc",
  "occasion": "daily|work|evening|party|sports|etc",
  "colorScheme": "description of the color palette and how colors work together",
  "reasoning": "Detailed explanation of why these specific pieces were chosen and how they complement each other"
}

IMPORTANT:
- selectedIds must be exact item IDs from the list above
- Select items that visually and stylistically work together
- Prioritize complete outfits (top + bottom minimum)
- Consider color theory and style matching
- Return ONLY the JSON object, no markdown, no code blocks, no explanations outside the JSON
              `.trim()
            },
            // Include all images for comprehensive visual analysis
            ...imageData.map(img => ({
              type: "image_url",
              image_url: { 
                url: img.dataUrl,
                detail: "high"
              }
            }))
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
          model: "gpt-4o-mini",  // Supports vision for analyzing clothing images
          temperature: 0.7, 
          messages,
          max_tokens: 1000
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI error ${res.status}: ${text}`);
      }

      const json = await res.json();
      let content = json?.choices?.[0]?.message?.content?.trim() || "{}";
      
      // Clean up content if it's wrapped in markdown code blocks
      if (content.startsWith("```")) {
        content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      }
      
      let outfitSelection;
      try {
        outfitSelection = JSON.parse(content);
      } catch (parseError) {
        console.error("Failed to parse outfit selection:", content);
        throw new Error(`Failed to parse outfit selection: ${parseError.message}`);
      }
      
      // Validate the response structure
      if (!outfitSelection.selectedIds || !Array.isArray(outfitSelection.selectedIds)) {
        throw new Error("Invalid outfit selection: missing or invalid selectedIds");
      }

      // Validate that all selected IDs exist in the closet
      const validIds = items.map(item => item.id);
      const invalidIds = outfitSelection.selectedIds.filter(id => !validIds.includes(id));
      if (invalidIds.length > 0) {
        console.warn("OpenAI selected invalid item IDs:", invalidIds);
        // Filter out invalid IDs
        outfitSelection.selectedIds = outfitSelection.selectedIds.filter(id => validIds.includes(id));
      }

      // Get the selected items
      const selectedItems = items.filter(item => 
        outfitSelection.selectedIds?.includes(item.id)
      );

      if (selectedItems.length === 0) {
        throw new Error("No valid items were selected for the outfit");
      }

      if (selectedItems.length !== outfitSelection.selectedIds.length) {
        console.warn(`Selected ${outfitSelection.selectedIds.length} items but only ${selectedItems.length} were found in closet`);
      }

      // Now send to FASHN API
      await generateFashnOutfit(selectedItems, outfitSelection);

    } catch (e) {
      console.error(e);
      Alert.alert("Outfit creation failed", String(e?.message || e));
      setOutfitBusy(false);
    }
  }

  // FASHN API Integration: Generate model image with outfit
  async function generateFashnOutfit(selectedItems, outfitSelection) {
    if (!FASHN_API_KEY) {
      Alert.alert("Missing FASHN API Key", "Set FASHN_API_KEY in .env file.");
      setOutfitBusy(false);
      return;
    }

    try {
      // Build a detailed, explicit prompt for FASHN that ONLY uses the exact items described
      const itemDescriptions = selectedItems.map((item, idx) => {
        const desc = item.result?.description || "clothing item";
        const colors = item.result?.palette?.join(", ") || "";
        const style = item.result?.aesthetics?.join(", ") || "";
        return `Item ${idx + 1}: ${desc}${colors ? ` (Colors: ${colors})` : ""}${style ? ` (Style: ${style})` : ""}`;
      }).join(". ");

      const itemCount = selectedItems.length;
      const prompt = `A professional fashion model wearing EXACTLY ${itemCount} clothing items from the user's personal closet. 

THE EXACT ITEMS TO USE (USE ONLY THESE, NO OTHERS):
${itemDescriptions}

ABSOLUTE REQUIREMENTS - DO NOT VIOLATE:
1. The model must wear EXACTLY these ${itemCount} items listed above
2. DO NOT add any clothing items, accessories, shoes, or garments that are NOT in the list above
3. DO NOT generate, create, or invent any items not explicitly listed
4. DO NOT add hoodies, jackets, or any outerwear unless explicitly listed above
5. If an item is not in the list above, DO NOT include it in the outfit
6. Show ONLY the ${itemCount} items from the list, nothing more, nothing less

Outfit description: ${outfitSelection.outfitDescription || "A cohesive outfit"}
Style: ${outfitSelection.style || "casual"}
Color scheme: ${outfitSelection.colorScheme || "harmonious"}

Photography style: High quality fashion photography, studio lighting, full body shot, neutral background.`;

      // Call FASHN API (using SDK pattern)
      // The API returns an ID, then we need to poll for the result
      const res = await fetch("https://api.fashn.ai/v1/run", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FASHN_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: "model-create",
          inputs: {
            prompt: prompt
          }
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`FASHN API error ${res.status}: ${text}`);
      }

      let data = await res.json();
      
      // Log the full response for debugging
      console.log("FASHN API full response:", JSON.stringify(data, null, 2));
      
      // Check if the response already contains the output (synchronous response)
      const hasOutput = data.output && (
        (Array.isArray(data.output) && data.output.length > 0) ||
        typeof data.output === 'string' ||
        data.output.url ||
        data.output.image_url
      );
      
      // Only poll if we have a prediction ID and no output yet
      if ((data.id || data.prediction_id) && !hasOutput) {
        const predictionId = data.id || data.prediction_id;
        console.log("Polling for prediction result, ID:", predictionId);
        
        // Poll using multiple possible endpoints (SDK pattern)
        let pollAttempts = 0;
        const maxPollAttempts = 60; // 5 minutes max (5 second intervals)
        let pollData = null;
        
        // Try different polling endpoint patterns based on common API patterns
        // The SDK likely uses one of these patterns internally
        const pollingEndpoints = [
          // Most common: predictions endpoint
          `https://api.fashn.ai/v1/predictions/${predictionId}`,
          // Alternative: run endpoint with ID query param
          `https://api.fashn.ai/v1/run?id=${predictionId}`,
          // Alternative: status endpoint
          `https://api.fashn.ai/v1/status/${predictionId}`,
          // Alternative: GET on run with ID in path
          `https://api.fashn.ai/v1/run/${predictionId}`,
        ];
        
        while (pollAttempts < maxPollAttempts) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
          
          let lastError = null;
          
          // Try each endpoint pattern
          for (const endpoint of pollingEndpoints) {
            try {
              const statusRes = await fetch(endpoint, {
                method: "GET",
                headers: {
                  "Authorization": `Bearer ${FASHN_API_KEY}`,
                  "Content-Type": "application/json",
                },
              });
              
              if (statusRes.ok) {
                pollData = await statusRes.json();
                console.log(`Poll attempt ${pollAttempts + 1} (${endpoint}):`, JSON.stringify(pollData, null, 2));
                
                // Check if completed
                if (pollData.output && (
                  (Array.isArray(pollData.output) && pollData.output.length > 0) ||
                  typeof pollData.output === 'string' ||
                  pollData.output.url ||
                  pollData.output.image_url
                )) {
                  data = pollData;
                  console.log("Polling successful, got output!");
                  break;
                } else if (pollData.status === 'succeeded' || pollData.status === 'completed') {
                  // Status says succeeded, check for output
                  if (pollData.output) {
                    data = pollData;
                    break;
                  }
                } else if (pollData.status === 'failed' || pollData.status === 'error') {
                  throw new Error(`FASHN generation failed: ${pollData.error || 'Unknown error'}`);
                } else if (pollData.status === 'processing' || pollData.status === 'pending') {
                  // Still processing, continue polling
                  break;
                }
              } else if (statusRes.status !== 404) {
                // 404 is expected for wrong endpoint, but other errors might be informative
                console.log(`Endpoint ${endpoint} returned ${statusRes.status}`);
              }
            } catch (pollError) {
              lastError = pollError;
              // Continue to next endpoint
            }
          }
          
          // If we got output, break out of polling loop
          if (data.output && (
            (Array.isArray(data.output) && data.output.length > 0) ||
            typeof data.output === 'string' ||
            data.output.url ||
            data.output.image_url
          )) {
            break;
          }
          
          pollAttempts++;
        }
        
        if (pollAttempts >= maxPollAttempts && !pollData) {
          throw new Error("FASHN API polling timeout - generation took too long. The API may be experiencing delays.");
        }
        
        // If we still don't have output after polling, try making another POST request
        // Some APIs require you to check status by making the same request again
        if (!data.output || (
          !(Array.isArray(data.output) && data.output.length > 0) &&
          typeof data.output !== 'string' &&
          !data.output.url &&
          !data.output.image_url
        )) {
          console.log("Attempting status check via POST with ID...");
          try {
            // Try POST with ID in body (some APIs work this way)
            const statusRes = await fetch(`https://api.fashn.ai/v1/run`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${FASHN_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                id: predictionId,
                model_name: "model-create"
              }),
            });
            
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              console.log("Status check response:", JSON.stringify(statusData, null, 2));
              if (statusData.output) {
                data = statusData;
              }
            }
          } catch (e) {
            console.warn("Status check POST failed:", e);
          }
        }
      }
      
      // FASHN API response structure: output is an array of URLs
      let imageUrl = null;
      
      // According to docs: "The output array contains URLs to your generated fashion model image"
      if (data.output) {
        if (Array.isArray(data.output)) {
          // Array of URLs (strings) or array of objects with url/image_url
          if (data.output.length > 0) {
            const firstOutput = data.output[0];
            if (typeof firstOutput === 'string') {
              imageUrl = firstOutput;
            } else if (firstOutput.url) {
              imageUrl = firstOutput.url;
            } else if (firstOutput.image_url) {
              imageUrl = firstOutput.image_url;
            } else if (firstOutput.image) {
              imageUrl = firstOutput.image;
            }
          }
        } else if (typeof data.output === 'string') {
          imageUrl = data.output;
        } else if (data.output.url) {
          imageUrl = data.output.url;
        } else if (data.output.image_url) {
          imageUrl = data.output.image_url;
        }
      }
      
      // Fallback: check other possible structures
      if (!imageUrl) {
        if (Array.isArray(data) && data.length > 0) {
          const first = data[0];
          imageUrl = typeof first === 'string' ? first : (first.url || first.image_url || first.image);
        } else if (data.image_url) {
          imageUrl = data.image_url;
        } else if (data.url) {
          imageUrl = data.url;
        } else if (data.image) {
          imageUrl = data.image;
        } else if (data.result) {
          if (Array.isArray(data.result) && data.result.length > 0) {
            const first = data.result[0];
            imageUrl = typeof first === 'string' ? first : (first.url || first.image_url);
          } else if (typeof data.result === 'string') {
            imageUrl = data.result;
          } else {
            imageUrl = data.result.url || data.result.image_url;
          }
        } else if (typeof data === 'string') {
          imageUrl = data;
        }
      }

      if (!imageUrl) {
        console.error("FASHN API response structure:", JSON.stringify(data, null, 2));
        Alert.alert(
          "Image URL not found", 
          "The FASHN API returned a response but the image URL couldn't be found. Check the console logs for the full response structure."
        );
        throw new Error("FASHN API did not return an image. Check console for response structure.");
      }
      
      console.log("Extracted image URL:", imageUrl);

      // Create outfit object to save
      const outfitData = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        selectedItems,
        outfitSelection,
        modelImageUrl: imageUrl,
        prompt,
        fashnInputs: {
          prompt: prompt,
          model_name: "model-create"
        }
      };

      // Save outfit to storage
      const outfits = await readOutfits();
      outfits.unshift(outfitData); // Add to beginning
      await writeOutfits(outfits);

      // Navigate to outfits page and show the new outfit
      setSelectedOutfit(outfitData);
      setOutfitBusy(false);
      setCurrentView("outfits");

    } catch (e) {
      console.error(e);
      Alert.alert("FASHN generation failed", String(e?.message || e));
      setOutfitBusy(false);
    }
  }

  // Render Outfits Screen
  if (currentView === "outfits") {
    return (
      <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>My Outfits</Text>
            <Pressable onPress={() => setCurrentView("main")} style={s.btnSmall}>
              <Text style={s.btnText}>Back</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {selectedOutfit ? (
              <>
                {/* Generated Model Image */}
                {selectedOutfit.modelImageUrl && (
                  <View style={s.previewBox}>
                    {selectedOutfit.modelImageUrl.startsWith("data:") || selectedOutfit.modelImageUrl.startsWith("http") ? (
                      <Image
                        source={{ uri: selectedOutfit.modelImageUrl }}
                        style={s.previewImg}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={s.previewPlaceholder}>Image URL: {selectedOutfit.modelImageUrl}</Text>
                    )}
                  </View>
                )}

                {/* FASHN API Input Details */}
                <View style={s.card}>
                  <Text style={s.cardH}>FASHN API Input</Text>
                  <Text style={[s.cardP, { fontSize: 12, opacity: 0.9, marginTop: 4 }]}>
                    Model: {selectedOutfit.fashnInputs?.model_name || "model-create"}
                  </Text>
                  <Text style={[s.cardP, { fontSize: 12, opacity: 0.9, marginTop: 8 }]}>
                    Prompt:
                  </Text>
                  <Text style={[s.cardP, { fontSize: 11, opacity: 0.8, marginTop: 4, fontFamily: "monospace" }]}>
                    {selectedOutfit.prompt || selectedOutfit.fashnInputs?.prompt || "N/A"}
                  </Text>
                </View>

                {/* Outfit Details */}
                {selectedOutfit.outfitSelection && (
                  <View style={s.card}>
                    <Text style={s.cardH}>Outfit Details</Text>
                    {selectedOutfit.outfitSelection.outfitDescription && (
                      <>
                        <Text style={[s.cardH, { fontSize: 16, marginTop: 8 }]}>Description</Text>
                        <Text style={s.cardP}>{selectedOutfit.outfitSelection.outfitDescription}</Text>
                      </>
                    )}
                    {selectedOutfit.outfitSelection.style && (
                      <>
                        <Text style={[s.cardH, { fontSize: 16, marginTop: 8 }]}>Style</Text>
                        <Text style={s.cardP}>{selectedOutfit.outfitSelection.style}</Text>
                      </>
                    )}
                    {selectedOutfit.outfitSelection.occasion && (
                      <>
                        <Text style={[s.cardH, { fontSize: 16, marginTop: 8 }]}>Occasion</Text>
                        <Text style={s.cardP}>{selectedOutfit.outfitSelection.occasion}</Text>
                      </>
                    )}
                    {selectedOutfit.outfitSelection.colorScheme && (
                      <>
                        <Text style={[s.cardH, { fontSize: 16, marginTop: 8 }]}>Color Scheme</Text>
                        <Text style={s.cardP}>{selectedOutfit.outfitSelection.colorScheme}</Text>
                      </>
                    )}
                    {selectedOutfit.outfitSelection.reasoning && (
                      <>
                        <Text style={[s.cardH, { fontSize: 16, marginTop: 8 }]}>Why This Works</Text>
                        <Text style={s.cardP}>{selectedOutfit.outfitSelection.reasoning}</Text>
                      </>
                    )}
                  </View>
                )}

                {/* Selected Items from Closet */}
                <View style={s.card}>
                  <Text style={s.cardH}>Selected Items ({selectedOutfit.selectedItems?.length || 0})</Text>
                  <Text style={[s.cardP, { fontSize: 12, opacity: 0.9, marginTop: 4 }]}>
                    These are the exact items from your closet that were used:
                  </Text>
                </View>

                {selectedOutfit.selectedItems?.map((item, idx) => (
                  <View key={item.id || idx} style={[stylesSaved.cardRow, { marginBottom: 10 }]}>
                    <Image source={{ uri: item.imageUri }} style={stylesSaved.thumb} />
                    <View style={{ flex: 1 }}>
                      <Text style={stylesSaved.title} numberOfLines={2}>
                        {item.result?.description || "Clothing item"}
                      </Text>
                      {Array.isArray(item.result?.aesthetics) && item.result.aesthetics.length > 0 && (
                        <Text style={stylesSaved.meta} numberOfLines={1}>
                          {item.result.aesthetics.join(" · ")}
                        </Text>
                      )}
                      {Array.isArray(item.result?.palette) && item.result.palette.length > 0 && (
                        <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
                          {item.result.palette.slice(0, 3).map((c, i) => (
                            <View key={i} style={[s.swatch, { backgroundColor: c, width: 20, height: 20 }]} />
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))}

                {/* Outfits List */}
                {outfitsList.length > 1 && (
                  <>
                    <View style={s.card}>
                      <Text style={s.cardH}>All Outfits ({outfitsList.length})</Text>
                    </View>
                    {outfitsList.map((outfit) => (
                      <Pressable
                        key={outfit.id}
                        onPress={() => setSelectedOutfit(outfit)}
                        style={[s.card, { marginBottom: 10, opacity: selectedOutfit?.id === outfit.id ? 1 : 0.8 }]}
                      >
                        <Text style={s.cardH}>
                          Outfit {new Date(outfit.createdAt).toLocaleDateString()}
                        </Text>
                        {outfit.modelImageUrl && (
                          <Image
                            source={{ uri: outfit.modelImageUrl }}
                            style={{ width: "100%", height: 200, borderRadius: 8, marginTop: 8 }}
                            resizeMode="cover"
                          />
                        )}
                        <Text style={[s.cardP, { fontSize: 12, marginTop: 8 }]}>
                          {outfit.selectedItems?.length || 0} items
                        </Text>
                      </Pressable>
                    ))}
                  </>
                )}
              </>
            ) : outfitsList.length > 0 ? (
              <>
                <Text style={[s.cardH, { marginBottom: 16 }]}>Select an outfit to view:</Text>
                {outfitsList.map((outfit) => (
                  <Pressable
                    key={outfit.id}
                    onPress={() => setSelectedOutfit(outfit)}
                    style={[s.card, { marginBottom: 10 }]}
                  >
                    <Text style={s.cardH}>
                      Outfit {new Date(outfit.createdAt).toLocaleDateString()}
                    </Text>
                    {outfit.modelImageUrl && (
                      <Image
                        source={{ uri: outfit.modelImageUrl }}
                        style={{ width: "100%", height: 200, borderRadius: 8, marginTop: 8 }}
                        resizeMode="cover"
                      />
                    )}
                    <Text style={[s.cardP, { fontSize: 12, marginTop: 8 }]}>
                      {outfit.selectedItems?.length || 0} items
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <View style={s.card}>
                <Text style={s.cardP}>No outfits yet. Create one from your closet!</Text>
                <Pressable onPress={() => setCurrentView("main")} style={[s.btnBig, { marginTop: 16 }]}>
                  <Text style={s.btnText}>Go Back</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // Main Screen
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
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => setCurrentView("outfits")} style={s.btnSmall}>
                <Text style={s.btnText}>Outfits</Text>
              </Pressable>
              <Pressable onPress={openSaved} style={s.btnSmall}>
                <Text style={s.btnText}>View Saved</Text>
              </Pressable>
            </View>
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

            {/* Create Outfit Button */}
            {savedList.length >= 2 && (
              <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                <Pressable
                  onPress={createOutfit}
                  disabled={outfitBusy}
                  style={[
                    s.btnBig,
                    {
                      backgroundColor: "rgba(255,255,255,0.35)",
                      opacity: outfitBusy ? 0.6 : 1
                    }
                  ]}
                >
                  {outfitBusy ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={s.btnText}>Creating Outfit...</Text>
                    </View>
                  ) : (
                    <Text style={[s.btnText, { fontSize: 18 }]}>✨ Create Outfit with AI</Text>
                  )}
                </Pressable>
              </View>
            )}

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
