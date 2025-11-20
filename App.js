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
const USER_MODEL_PHOTO_KEY = "userModelPhoto";

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
  
  // User model photo state
  const [userModelPhoto, setUserModelPhoto] = useState(null);

  // Load saved count and user model photo at boot
  useEffect(() => {
    (async () => {
      try {
        const arr = await readSaved();
        setSavedCount(arr.length);
        
        // Load user model photo if saved
        const savedPhoto = await AsyncStorage.getItem(USER_MODEL_PHOTO_KEY);
        if (savedPhoto) {
          setUserModelPhoto(savedPhoto);
        }
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
  
  // Delete outfit function
  async function deleteOutfit(outfitId) {
    Alert.alert(
      "Delete Outfit?",
      "This outfit will be permanently deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const outfits = await readOutfits();
              const filtered = outfits.filter(o => o.id !== outfitId);
              await writeOutfits(filtered);
              
              // If deleted outfit was selected, clear selection
              if (selectedOutfit?.id === outfitId) {
                setSelectedOutfit(null);
              }
            } catch (error) {
              console.error("Failed to delete outfit:", error);
              Alert.alert("Error", "Failed to delete outfit.");
            }
          }
        }
      ]
    );
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

  // User model photo functions
  async function captureUserModelPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      return Alert.alert("Permission required", "Camera access is needed to take your model photo.");
    }
    const res = await ImagePicker.launchCameraAsync({ 
      quality: 0.9,
      allowsEditing: true,
      aspect: [3, 4] // Portrait aspect ratio for full body
    });
    if (!res.canceled) {
      await saveUserModelPhoto(res.assets[0].uri);
      Alert.alert("Success", "Your model photo has been saved! It will be used for outfit try-ons.");
    }
  }

  async function pickUserModelPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [3, 4] // Portrait aspect ratio for full body
    });
    if (!res.canceled) {
      await saveUserModelPhoto(res.assets[0].uri);
      Alert.alert("Success", "Your model photo has been saved! It will be used for outfit try-ons.");
    }
  }

  async function saveUserModelPhoto(uri) {
    try {
      await AsyncStorage.setItem(USER_MODEL_PHOTO_KEY, uri);
      setUserModelPhoto(uri);
    } catch (error) {
      console.error("Failed to save user model photo:", error);
      Alert.alert("Error", "Failed to save your model photo.");
    }
  }

  async function removeUserModelPhoto() {
    Alert.alert(
      "Remove Model Photo?",
      "Your saved model photo will be removed. Outfits will use AI-generated models instead.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(USER_MODEL_PHOTO_KEY);
              setUserModelPhoto(null);
              Alert.alert("Removed", "Your model photo has been removed.");
            } catch (error) {
              console.error("Failed to remove user model photo:", error);
            }
          }
        }
      ]
    );
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

  // FASHN API Integration: Generate model image with outfit using Virtual Try-On
  async function generateFashnOutfit(selectedItems, outfitSelection) {
    if (!FASHN_API_KEY) {
      Alert.alert("Missing FASHN API Key", "Set FASHN_API_KEY in .env file.");
      setOutfitBusy(false);
      return;
    }

    try {
      // Convert clothing item images to base64 for FASHN API
      console.log("Converting clothing images to base64...");
      const imagePromises = selectedItems.map(async (item) => {
        try {
          const processed = await ImageManipulator.manipulateAsync(
            item.imageUri,
            [{ resize: { width: 512 } }], // Resize for API efficiency
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          return {
            base64: processed.base64 ? `data:image/jpeg;base64,${processed.base64}` : null,
            item: item
          };
        } catch (error) {
          console.warn(`Failed to process image for item ${item.id}:`, error);
          return { base64: null, item };
        }
      });

      const imageData = (await Promise.all(imagePromises)).filter(img => img.base64 !== null);
      console.log(`Successfully converted ${imageData.length} images to base64`);

      if (imageData.length === 0) {
        throw new Error("No valid clothing images to process");
      }

      // Step 1: Get model image - use user photo if available, otherwise generate one
      let modelImageUrl = null;
      
      if (userModelPhoto) {
        // Use user's photo as model
        console.log("Using user's model photo...");
        // Convert user photo to base64 for API
        try {
          const processed = await ImageManipulator.manipulateAsync(
            userModelPhoto,
            [{ resize: { width: 512 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          modelImageUrl = processed.base64 ? `data:image/jpeg;base64,${processed.base64}` : userModelPhoto;
          console.log("User model photo processed");
        } catch (error) {
          console.warn("Failed to process user photo, using URI directly:", error);
          modelImageUrl = userModelPhoto;
        }
      } else {
        // Generate a base model using model-create
        console.log("Generating base model...");
        const modelPrompt = `A professional fashion model, full body shot, neutral pose, studio lighting, neutral background. ${outfitSelection.style ? `Style: ${outfitSelection.style}` : ""}`;
        
        const modelRes = await fetch("https://api.fashn.ai/v1/run", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FASHN_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model_name: "model-create",
            inputs: {
              prompt: modelPrompt
            }
          }),
        });

        if (!modelRes.ok) {
          const text = await modelRes.text();
          throw new Error(`FASHN model creation error ${modelRes.status}: ${text}`);
        }

        let modelData = await modelRes.json();
        console.log("Model creation response:", JSON.stringify(modelData, null, 2));

        // Poll for model if needed
        if (modelData.id && !modelData.output) {
          const modelId = modelData.id;
          let pollAttempts = 0;
          while (pollAttempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            try {
              const statusRes = await fetch(`https://api.fashn.ai/v1/predictions/${modelId}`, {
                method: "GET",
                headers: {
                  "Authorization": `Bearer ${FASHN_API_KEY}`,
                  "Content-Type": "application/json",
                },
              });
              if (statusRes.ok) {
                modelData = await statusRes.json();
                if (modelData.output) break;
              } else if (statusRes.status === 404) {
                break; // Use initial response
              }
            } catch (e) {
              break;
            }
            pollAttempts++;
          }
        }

        // Extract model image URL
        if (modelData.output) {
          if (Array.isArray(modelData.output) && modelData.output.length > 0) {
            modelImageUrl = typeof modelData.output[0] === 'string' ? modelData.output[0] : modelData.output[0].url || modelData.output[0].image_url;
          } else if (typeof modelData.output === 'string') {
            modelImageUrl = modelData.output;
          } else if (modelData.output.url) {
            modelImageUrl = modelData.output.url;
          } else if (modelData.output.image_url) {
            modelImageUrl = modelData.output.image_url;
          }
        }

        if (!modelImageUrl) {
          throw new Error("Failed to generate base model image");
        }

        console.log("Base model image URL:", modelImageUrl);
      }

      // Step 2: Apply garments using Virtual Try-On
      // For multiple garments, we'll apply them sequentially
      // Start with the first garment, then use the result as the model for the next
      let currentModelImage = modelImageUrl;
      
      // Determine garment categories (tops, bottoms, accessories, etc.)
      const categorizeItem = (item) => {
        const desc = (item.result?.description || "").toLowerCase();
        
        // Clothing items for Virtual Try-On
        if (desc.includes("shirt") || desc.includes("top") || desc.includes("blouse") || desc.includes("sweater") || desc.includes("t-shirt") || desc.includes("jacket") || desc.includes("hoodie")) {
          return "tops";
        } else if (desc.includes("pant") || desc.includes("jean") || desc.includes("trouser") || desc.includes("bottom") || desc.includes("skirt") || desc.includes("short")) {
          return "bottoms";
        } else if (desc.includes("dress")) {
          return "one-pieces";
        }
        // Accessories - will use Product to Model
        else if (desc.includes("hat") || desc.includes("cap") || desc.includes("beanie") || desc.includes("head")) {
          return "accessory-hat";
        } else if (desc.includes("shoe") || desc.includes("sneaker") || desc.includes("boot") || desc.includes("footwear") || desc.includes("sandal")) {
          return "accessory-shoe";
        } else if (desc.includes("bag") || desc.includes("purse") || desc.includes("backpack") || desc.includes("accessory") || desc.includes("jewelry") || desc.includes("watch")) {
          return "accessory-other";
        }
        
        return "tops"; // Default to tops
      };

      // Separate items into try-on items and accessories
      const tryOnItems = imageData.filter(item => {
        const cat = categorizeItem(item.item);
        return cat === "tops" || cat === "bottoms" || cat === "one-pieces";
      });
      
      const accessoryItems = imageData.filter(item => {
        const cat = categorizeItem(item.item);
        return cat.startsWith("accessory-");
      });

      // Sort try-on items: tops first, then bottoms, then one-pieces
      const sortedItems = [...tryOnItems].sort((a, b) => {
        const catA = categorizeItem(a.item);
        const catB = categorizeItem(b.item);
        const order = { "tops": 1, "bottoms": 2, "one-pieces": 3 };
        return (order[catA] || 4) - (order[catB] || 4);
      });
      
      console.log(`Found ${sortedItems.length} clothing items for try-on and ${accessoryItems.length} accessories`);

      console.log(`Applying ${sortedItems.length} garments sequentially...`);

      // Apply each garment sequentially
      for (let i = 0; i < sortedItems.length; i++) {
        const garmentData = sortedItems[i];
        const category = categorizeItem(garmentData.item);
        
        console.log(`Applying garment ${i + 1}/${sortedItems.length} (${category})...`);
        console.log(`Model image type: ${typeof currentModelImage}, starts with data: ${currentModelImage?.startsWith('data:')}`);
        console.log(`Garment image type: ${typeof garmentData.base64}, starts with data: ${garmentData.base64?.startsWith('data:')}`);

        const tryonRes = await fetch("https://api.fashn.ai/v1/run", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FASHN_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model_name: "tryon-v1.6",
            inputs: {
              model_image: currentModelImage,
              garment_image: garmentData.base64,
              category: category
            }
          }),
        });

        if (!tryonRes.ok) {
          const text = await tryonRes.text();
          console.error(`Try-on ${i + 1} failed with status ${tryonRes.status}: ${text}`);
          throw new Error(`Failed to apply garment ${i + 1}: ${text}`);
        }

        let tryonData = await tryonRes.json();
        console.log(`Try-on ${i + 1} initial response:`, JSON.stringify(tryonData, null, 2));

        // Check if result is already in initial response
        const hasOutputInInitial = tryonData.output && (
          (Array.isArray(tryonData.output) && tryonData.output.length > 0) ||
          typeof tryonData.output === 'string' ||
          (tryonData.output && typeof tryonData.output === 'object' && (tryonData.output.url || tryonData.output.image_url))
        );

        // Poll for try-on result if needed (only if we have an ID and no output yet)
        if (tryonData.id && !hasOutputInInitial) {
          const tryonId = tryonData.id;
          console.log(`Polling for try-on result, ID: ${tryonId}`);
          
          // Wait a bit first - API needs time to process (try-on takes 5-17 seconds)
          await new Promise(resolve => setTimeout(resolve, 8000));
          
          let pollAttempts = 0;
          const maxPollAttempts = 20; // Reduced since we wait longer between attempts
          let foundResult = false;
          
          while (pollAttempts < maxPollAttempts && !foundResult) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between polls
            
            try {
              // Try multiple endpoint patterns
              const endpoints = [
                `https://api.fashn.ai/v1/predictions/${tryonId}`,
                `https://api.fashn.ai/v1/run/${tryonId}`,
                `https://api.fashn.ai/v1/status/${tryonId}`,
              ];
              
              let pollResponse = null;
              
              for (const endpoint of endpoints) {
                try {
                  const statusRes = await fetch(endpoint, {
                    method: "GET",
                    headers: {
                      "Authorization": `Bearer ${FASHN_API_KEY}`,
                      "Content-Type": "application/json",
                    },
                  });
                  
                  if (statusRes.ok) {
                    pollResponse = await statusRes.json();
                    console.log(`Poll attempt ${pollAttempts + 1} (${endpoint}):`, JSON.stringify(pollResponse, null, 2));
                    break; // Found working endpoint
                  } else if (statusRes.status !== 404) {
                    console.log(`Endpoint ${endpoint} returned ${statusRes.status}`);
                  }
                } catch (e) {
                  // Try next endpoint
                  continue;
                }
              }
              
              // If no endpoint worked, try POST with ID
              if (!pollResponse) {
                try {
                  const postRes = await fetch("https://api.fashn.ai/v1/run", {
                    method: "POST",
                    headers: {
                      "Authorization": `Bearer ${FASHN_API_KEY}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      id: tryonId
                    }),
                  });
                  
                  if (postRes.ok) {
                    pollResponse = await postRes.json();
                    console.log(`Poll attempt ${pollAttempts + 1} (POST with ID):`, JSON.stringify(pollResponse, null, 2));
                  }
                } catch (e) {
                  console.warn("POST polling failed:", e);
                }
              }
              
              if (pollResponse) {
                // Check if we got output
                if (pollResponse.output && (
                  (Array.isArray(pollResponse.output) && pollResponse.output.length > 0) ||
                  typeof pollResponse.output === 'string' ||
                  (pollResponse.output && typeof pollResponse.output === 'object')
                )) {
                  tryonData = pollResponse;
                  foundResult = true;
                  console.log("✅ Got output from polling!");
                  break;
                }
                
                // Check status
                if (pollResponse.status === 'succeeded' || pollResponse.status === 'completed') {
                  if (pollResponse.output) {
                    tryonData = pollResponse;
                    foundResult = true;
                    break;
                  }
                } else if (pollResponse.status === 'failed' || pollResponse.status === 'error') {
                  throw new Error(`Try-on failed: ${pollResponse.error || 'Unknown error'}`);
                } else if (pollResponse.status === 'processing' || pollResponse.status === 'pending') {
                  console.log(`Still processing... (attempt ${pollAttempts + 1})`);
                  // Continue polling
                }
              } else {
                console.log(`No response from polling endpoints (attempt ${pollAttempts + 1})`);
              }
            } catch (e) {
              console.warn(`Polling error:`, e);
              // Continue trying
            }
            pollAttempts++;
          }
          
          if (!foundResult && pollAttempts >= maxPollAttempts) {
            console.warn(`Polling timeout for garment ${i + 1}, will check initial response structure`);
            // Don't throw error yet - maybe result is in initial response in a different format
          }
        } else if (hasOutputInInitial) {
          console.log("✅ Result found in initial response!");
        }

        // Extract result image URL - try multiple possible structures
        let resultImageUrl = null;
        
        // First, check if output exists and extract it
        if (tryonData.output) {
          if (Array.isArray(tryonData.output)) {
            if (tryonData.output.length > 0) {
              const first = tryonData.output[0];
              if (typeof first === 'string') {
                resultImageUrl = first;
              } else if (first && typeof first === 'object') {
                resultImageUrl = first.url || first.image_url || first.image || first.output || first.result;
              }
            }
          } else if (typeof tryonData.output === 'string') {
            resultImageUrl = tryonData.output;
          } else if (tryonData.output && typeof tryonData.output === 'object') {
            resultImageUrl = tryonData.output.url || tryonData.output.image_url || tryonData.output.image || tryonData.output.output || tryonData.output.result;
          }
        }
        
        // Fallback: check other possible response structures
        if (!resultImageUrl) {
          // Check top-level properties
          if (tryonData.url) resultImageUrl = tryonData.url;
          else if (tryonData.image_url) resultImageUrl = tryonData.image_url;
          else if (tryonData.image) resultImageUrl = tryonData.image;
          else if (tryonData.result) {
            if (Array.isArray(tryonData.result) && tryonData.result.length > 0) {
              const first = tryonData.result[0];
              resultImageUrl = typeof first === 'string' ? first : (first.url || first.image_url || first.image);
            } else if (typeof tryonData.result === 'string') {
              resultImageUrl = tryonData.result;
            } else if (tryonData.result && typeof tryonData.result === 'object') {
              resultImageUrl = tryonData.result.url || tryonData.result.image_url || tryonData.result.image;
            }
          }
          // Check data property
          else if (tryonData.data) {
            if (Array.isArray(tryonData.data) && tryonData.data.length > 0) {
              const first = tryonData.data[0];
              resultImageUrl = typeof first === 'string' ? first : (first.url || first.image_url || first.image);
            } else if (typeof tryonData.data === 'string') {
              resultImageUrl = tryonData.data;
            } else if (tryonData.data && typeof tryonData.data === 'object') {
              resultImageUrl = tryonData.data.url || tryonData.data.image_url || tryonData.data.image;
            }
          }
        }

        // If still no result and we have an ID, try making the original request again
        // Some APIs return the result when you make the same request again after processing
        if (!resultImageUrl && tryonData.id) {
          console.log("No result found in response, waiting longer and retrying original request...");
          await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds for processing
          
          try {
            // Make the same try-on request again - API might return result now
            const retryRes = await fetch("https://api.fashn.ai/v1/run", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${FASHN_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model_name: "tryon-v1.6",
                inputs: {
                  model_image: currentModelImage,
                  garment_image: garmentData.base64,
                  category: category
                }
              }),
            });
            
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              console.log("Retry request response:", JSON.stringify(retryData, null, 2));
              
              // Try extracting from retry response using same logic
              if (retryData.output) {
                if (Array.isArray(retryData.output) && retryData.output.length > 0) {
                  const first = retryData.output[0];
                  resultImageUrl = typeof first === 'string' ? first : (first.url || first.image_url || first.image);
                } else if (typeof retryData.output === 'string') {
                  resultImageUrl = retryData.output;
                } else if (retryData.output && typeof retryData.output === 'object') {
                  resultImageUrl = retryData.output.url || retryData.output.image_url || retryData.output.image;
                }
              }
              
              // Update tryonData if we got a result
              if (resultImageUrl) {
                tryonData = retryData;
              }
            }
          } catch (retryError) {
            console.warn("Retry attempt failed:", retryError);
          }
        }

        if (resultImageUrl) {
          currentModelImage = resultImageUrl; // Use result as model for next garment
          console.log(`✅ Garment ${i + 1} applied successfully! Result URL: ${resultImageUrl.substring(0, 80)}...`);
        } else {
          console.error(`❌ Failed to extract result for garment ${i + 1}.`);
          console.error(`Full response structure:`, JSON.stringify(tryonData, null, 2));
          console.error(`Response keys:`, Object.keys(tryonData));
          throw new Error(`Failed to get result image for garment ${i + 1}. Check console logs for the full API response. The API returned: ${JSON.stringify(tryonData).substring(0, 200)}...`);
        }
      }

      // Step 3: Apply accessories using Product to Model endpoint
      if (accessoryItems.length > 0 && currentModelImage) {
        console.log(`Applying ${accessoryItems.length} accessories using Product to Model...`);
        
        for (let i = 0; i < accessoryItems.length; i++) {
          const accessoryData = accessoryItems[i];
          const accessoryType = categorizeItem(accessoryData.item);
          
          console.log(`Applying accessory ${i + 1}/${accessoryItems.length} (${accessoryType})...`);
          
          try {
            // Use Product to Model in try-on mode to add accessory to existing model
            const productRes = await fetch("https://api.fashn.ai/v1/run", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${FASHN_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model_name: "product-to-model",
                inputs: {
                  product_image: accessoryData.base64,
                  model_image: currentModelImage,
                  mode: "tryon" // Try-on mode adds product to existing model
                }
              }),
            });

            if (!productRes.ok) {
              const text = await productRes.text();
              console.warn(`Product to Model for accessory ${i + 1} failed: ${text}`);
              // Continue with next accessory if one fails
              continue;
            }

            let productData = await productRes.json();
            console.log(`Product to Model ${i + 1} response:`, JSON.stringify(productData, null, 2));

            // Poll for result if needed (similar to try-on)
            if (productData.id && !productData.output) {
              const productId = productData.id;
              let pollAttempts = 0;
              while (pollAttempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                try {
                  const statusRes = await fetch(`https://api.fashn.ai/v1/predictions/${productId}`, {
                    method: "GET",
                    headers: {
                      "Authorization": `Bearer ${FASHN_API_KEY}`,
                      "Content-Type": "application/json",
                    },
                  });
                  if (statusRes.ok) {
                    productData = await statusRes.json();
                    if (productData.output) break;
                  } else if (statusRes.status === 404) {
                    break;
                  }
                } catch (e) {
                  break;
                }
                pollAttempts++;
              }
            }

            // Extract result
            let accessoryResultUrl = null;
            if (productData.output) {
              if (Array.isArray(productData.output) && productData.output.length > 0) {
                const first = productData.output[0];
                accessoryResultUrl = typeof first === 'string' ? first : (first.url || first.image_url || first.image);
              } else if (typeof productData.output === 'string') {
                accessoryResultUrl = productData.output;
              } else if (productData.output && typeof productData.output === 'object') {
                accessoryResultUrl = productData.output.url || productData.output.image_url || productData.output.image;
              }
            }

            if (accessoryResultUrl) {
              currentModelImage = accessoryResultUrl;
              console.log(`✅ Accessory ${i + 1} applied successfully!`);
            } else {
              console.warn(`Failed to get result for accessory ${i + 1}`);
            }
          } catch (accessoryError) {
            console.warn(`Error applying accessory ${i + 1}:`, accessoryError);
            // Continue with next accessory
          }
        }
      }

      const finalImageUrl = currentModelImage;
      console.log("Final outfit image URL:", finalImageUrl);

      if (!finalImageUrl) {
        throw new Error("Failed to generate outfit image");
      }

      // Save the outfit result
      const imageUrl = finalImageUrl;

      // Create outfit object to save
      const outfitData = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        selectedItems,
        outfitSelection,
        modelImageUrl: imageUrl
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
            <View style={{ flexDirection: "row", gap: 8 }}>
              {selectedOutfit && (
                <Pressable
                  onPress={() => deleteOutfit(selectedOutfit.id)}
                  style={[s.btnSmall, { backgroundColor: "rgba(255,0,0,0.4)" }]}
                >
                  <Text style={s.btnText}>🗑️ Delete</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setCurrentView("main")} style={s.btnSmall}>
                <Text style={s.btnText}>Back</Text>
              </Pressable>
            </View>
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
                      <View key={outfit.id} style={[s.card, { marginBottom: 10, opacity: selectedOutfit?.id === outfit.id ? 1 : 0.8 }]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <Pressable 
                            onPress={() => setSelectedOutfit(outfit)}
                            style={{ flex: 1 }}
                          >
                            <Text style={s.cardH}>
                              Outfit {new Date(outfit.createdAt).toLocaleDateString()}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => deleteOutfit(outfit.id)}
                            style={{ padding: 8, backgroundColor: "rgba(255,0,0,0.2)", borderRadius: 6 }}
                          >
                            <Text style={[s.btnText, { color: "#ff6b6b", fontSize: 12 }]}>🗑️ Delete</Text>
                          </Pressable>
                        </View>
                        <Pressable onPress={() => setSelectedOutfit(outfit)}>
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
                      </View>
                    ))}
                  </>
                )}
              </>
            ) : outfitsList.length > 0 ? (
              <>
                <Text style={[s.cardH, { marginBottom: 16 }]}>Select an outfit to view:</Text>
                {outfitsList.map((outfit) => (
                  <View key={outfit.id} style={[s.card, { marginBottom: 10 }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <Pressable 
                        onPress={() => setSelectedOutfit(outfit)}
                        style={{ flex: 1 }}
                      >
                        <Text style={s.cardH}>
                          Outfit {new Date(outfit.createdAt).toLocaleDateString()}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => deleteOutfit(outfit.id)}
                        style={{ padding: 8, backgroundColor: "rgba(255,0,0,0.2)", borderRadius: 6 }}
                      >
                        <Text style={[s.btnText, { color: "#ff6b6b", fontSize: 12 }]}>🗑️ Delete</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={() => setSelectedOutfit(outfit)}>
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
                  </View>
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
    <>
      {/* Full Screen Loading Modal for Outfit Generation */}
      <Modal
        visible={outfitBusy}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}}
      >
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <View style={{ alignItems: "center", padding: 32 }}>
              <ActivityIndicator size="large" color="#fff" style={{ marginBottom: 24 }} />
              <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginBottom: 12, textAlign: "center" }}>
                Creating Your Outfit
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 16, textAlign: "center", marginBottom: 8 }}>
                Analyzing your closet items...
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, textAlign: "center" }}>
                This may take 30-60 seconds
              </Text>
            </View>
          </SafeAreaView>
        </LinearGradient>
      </Modal>

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

          {/* User Model Photo Section */}
          <View style={[s.card, { marginBottom: 16 }]}>
            <Text style={s.cardH}>Your Model Photo</Text>
            <Text style={[s.cardP, { fontSize: 12, opacity: 0.9, marginBottom: 12 }]}>
              {userModelPhoto 
                ? "Your photo will be used for outfit try-ons. Upload a full-body photo for best results."
                : "Add your photo to see how outfits look on you! Otherwise, we'll use an AI-generated model."}
            </Text>
            
            {userModelPhoto ? (
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <Image 
                  source={{ uri: userModelPhoto }} 
                  style={{ width: 120, height: 160, borderRadius: 8, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" }}
                  resizeMode="cover"
                />
              </View>
            ) : null}
            
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {!userModelPhoto ? (
                <>
                  <Pressable onPress={captureUserModelPhoto} style={[s.btnSmall, { flex: 1, minWidth: 120 }]}>
                    <Text style={s.btnText}>📷 Take Photo</Text>
                  </Pressable>
                  <Pressable onPress={pickUserModelPhoto} style={[s.btnSmall, { flex: 1, minWidth: 120 }]}>
                    <Text style={s.btnText}>📁 Upload Photo</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable onPress={captureUserModelPhoto} style={[s.btnSmall, { flex: 1, minWidth: 100 }]}>
                    <Text style={s.btnText}>Change</Text>
                  </Pressable>
                  <Pressable onPress={removeUserModelPhoto} style={[s.btnSmall, { backgroundColor: "rgba(255,0,0,0.4)", flex: 1, minWidth: 100 }]}>
                    <Text style={s.btnText}>Remove</Text>
                  </Pressable>
                </>
              )}
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
                    <Pressable 
                      onPress={() => setSelected(item)} 
                      style={[
                        stylesSaved.cardRow,
                        selected?.id === item.id && { backgroundColor: "rgba(255,255,255,0.6)" } // Much less transparent when selected for better text visibility
                      ]}
                    >
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
    </>
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
    backgroundColor: "rgba(0,0,0,0.85)", // Much less transparent for better text visibility
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
