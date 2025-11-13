// server.js
import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* -----------------------------------------------------------
   Helper: parse ingredients from user text
----------------------------------------------------------- */
function parseIngredients(raw) {
  if (!raw) return [];
  raw = raw.toLowerCase().trim();

  if (!raw) return [];

  // If user typed commas, split on commas / "and"
  if (raw.includes(",")) {
    return raw
      .split(/,|\band\b|\n/gi)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Otherwise, treat every word as separate ingredient
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* Basic pantry ingredients that are always allowed */
const BASIC_INGS = new Set([
  "salt",
  "pepper",
  "black pepper",
  "oil",
  "olive oil",
  "vegetable oil",
  "butter",
  "sugar",
  "flour",
  "milk",
  "water",
  "eggs",
  "egg",
  "garlic",
  "onion",
  "herbs",
  "spices",
  "baking powder",
  "baking soda",
  "yeast",
]);

function extractWords(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-zA-Z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function isFoodLike(word) {
  return /^[a-z]+$/.test(word) && word.length > 3;
}

function isForbidden(word, userIngredients) {
  if (userIngredients.includes(word)) return false;
  if (BASIC_INGS.has(word)) return false;

  // Ignore generic words that are not ingredients
  const IGNORE = [
    "best",
    "easy",
    "quick",
    "simple",
    "how",
    "make",
    "recipe",
    "cook",
    "cooking",
    "kitchen",
    "home",
    "style",
    "food",
    "dish",
    "perfect",
    "tasty",
    "delicious",
    "family",
    "healthy",
    "fast",
    "video",
  ];
  if (IGNORE.includes(word)) return false;

  return true;
}

/* -----------------------------------------------------------
   MAIN RECIPE ENDPOINT
----------------------------------------------------------- */
app.post("/getRecipe", async (req, res) => {
  const { ingredients, mealType, prepType, style } = req.body;

  // 1) Parse user ingredients
  const userIngredients = parseIngredients(ingredients);
  if (!userIngredients.length) {
    return res.status(400).json({ error: "No ingredients provided" });
  }

  // 2) Build YouTube search query based on:
  //    - ingredients
  //    - meal type (breakfast, lunch, dinner, snack)
  //    - style (Asian, Italian, Mediterranean, etc.)
  const styleText = style && style.toLowerCase() !== "any" ? style : "";
  const mealText = mealType || "meal";
  const baseQuery = `${styleText} ${mealText} recipe using ${userIngredients.join(
    " "
  )} tutorial`;

  let videoUrl = "";
  let videoTitle = "";
  let videoDescription = "";

  /* -----------------------------------------------------------
     YOUTUBE SEARCH & STRICT INGREDIENT FILTER
  ----------------------------------------------------------- */
  try {
    const yt = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: {
        part: "snippet",
        q: baseQuery,
        key: process.env.YOUTUBE_API_KEY,
        type: "video",
        maxResults: 15,
        videoEmbeddable: true,
      },
    });

    const items = yt.data.items || [];
    let strictMatch = null;
    let looseMatch = null;

    for (let item of items) {
      const title = item.snippet.title || "";
      const desc = item.snippet.description || "";
      const words = [...extractWords(title), ...extractWords(desc)];

      // does it match the food STYLE? (if any)
      let styleOk = true;
      if (styleText) {
        const s = styleText.toLowerCase();
        const inText = (title + " " + desc).toLowerCase();
        styleOk = inText.includes(s);
      }

      if (!styleOk) continue;

      // count ingredient matches
      let matchCount = 0;
      for (let ing of userIngredients) {
        if (words.includes(ing)) matchCount++;
      }

      // MUST contain at least one of the user's ingredients
      if (matchCount < 1) continue;

      // check forbidden ingredients:
      let forbidden = false;
      for (let w of words) {
        if (isFoodLike(w) && isForbidden(w, userIngredients)) {
          forbidden = true;
          break;
        }
      }

      if (!forbidden) {
        strictMatch = item;
        break; // perfect
      }

      // keep a loose candidate in case no strict
      if (!looseMatch) looseMatch = item;
    }

    const chosen = strictMatch || looseMatch;

    if (!chosen) {
      // If nothing fits, we fall back to pure AI custom recipe with no video
      return res.json({
        recipe: `
# 🍽️ CHEF-TI Custom Recipe

No matching YouTube video could be found that respects ALL your rules.
So CHEF-TI created a recipe using ONLY your ingredients.

We will still respect:
- Your meal type: **${mealType}**
- Your style: **${style || "any"}**
- Your prep mode: **${prepType}**

## 🛒 Ingredients  
${userIngredients.map((i) => "- " + i).join("\n")}

## 👨‍🍳 Steps  
1. CHEF-TI will generate a full recipe for you below.
        `,
        videoUrl: "",
      });
    }

    const videoId = chosen.id.videoId;
    videoUrl = `https://www.youtube.com/embed/${videoId}`;
    videoTitle = chosen.snippet.title || "";
    videoDescription = chosen.snippet.description || "";
  } catch (err) {
    console.warn("YouTube error:", err.message);
    return res.status(500).json({ error: "YouTube failed" });
  }

  /* -----------------------------------------------------------
     AI RECIPE GENERATION – STRICT RULES
  ----------------------------------------------------------- */

  const safePrompt = `
You are CHEF-TI, a strict but creative cooking AI.

USER INGREDIENTS (the ONLY non-basic ingredients you may use):
${userIngredients.join(", ")}

BASIC INGREDIENTS YOU MAY ALSO USE:
${Array.from(BASIC_INGS).join(", ")}

MEAL TYPE: ${mealType}  
FOOD STYLE / CUISINE: ${style || "any"}  
PREP MODE: ${prepType} (fresh now, eat tomorrow, or meal prep for several days)

YOUTUBE VIDEO INFO (COOKING APPROACH ONLY – NOT INGREDIENTS):
TITLE: ${videoTitle}
DESCRIPTION: ${videoDescription}

ABSOLUTE RULES:
1. You MUST NOT use any ingredient that is not in:
   - the user ingredient list, OR
   - the basic ingredient list above.
2. RESPECT the food style: if the user says "Asian", the dish should feel Asian.
   If "Mediterranean", it must feel Mediterranean, etc.
3. RESPECT the meal type:
   - breakfast → suitable breakfast dish
   - lunch → normal mid-day meal
   - dinner → main filling meal
   - snack → light, quick snack
4. RESPECT the prep mode:
   - "fresh" → best eaten immediately, small batch
   - "eat tomorrow" → designed to sit in the fridge and reheat well next day
   - "meal prep" → designed to be cooked in larger batch and kept several days,
     include short storage & reheating advice in Tips & Tricks.
5. DO NOT simply repeat the same recipe every time. Be creative and propose a
   different idea when possible.
6. Use the COOKING METHOD inspiration from the YouTube video (e.g., stir-fry,
   baking, pan-frying, etc.) but NEVER copy forbidden ingredients.

OUTPUT FORMAT (Markdown):

# 1️⃣ Big Recipe Title  

## 2️⃣ Ingredient List (table)
Make a Markdown table with columns: Ingredient | Measurement

## 3️⃣ Step-by-step Instructions
Numbered list, clear and simple.

## 4️⃣ Approximate Calories per Serving
Give a realistic calorie estimate.

## 5️⃣ Tips & Tricks
- Include 3–5 bullet points.
- If prep mode is "meal prep" or "eat tomorrow", include storage advice.

## 6️⃣ Cuisine Style Description
Explain briefly how this dish matches the chosen cuisine style and meal type.

## 7️⃣ Matching YouTube Video Title
Write: "Matching video: <video title here>"

Remember: NEVER introduce new non-basic ingredients that the user does not have.
`;

  try {
    const ai = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: "You are CHEF-TI, the strict culinary AI." },
          { role: "user", content: safePrompt },
        ],
        max_tokens: 1300,
        temperature: 0.55, // some creativity, but not crazy
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      recipe: ai.data.choices[0].message.content,
      videoUrl,
    });
  } catch (err) {
    console.error("AI error:", err.message);
    res.status(500).json({ error: "AI generation failed" });
  }
});

/* -----------------------------------------------------------
   START SERVER
----------------------------------------------------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log(`✅ CHEF-TI running on http://localhost:${PORT}`)
);
