console.log("CHEF-TI script loaded");

const ingredientsInput = document.getElementById("ingredients");
const mealTypeSelect = document.getElementById("mealType");
const prepTypeSelect = document.getElementById("prepType");
const styleSelect = document.getElementById("styleSelect");
const styleCustom = document.getElementById("styleCustom");

const generateBtn = document.getElementById("generateBtn");
const generateNewBtn = document.getElementById("generateNewBtn");
const saveBtn = document.getElementById("saveBtn");
const voiceBtn = document.getElementById("voiceBtn");

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const videoWrapper = document.getElementById("videoWrapper");
const videoFrame = document.getElementById("videoFrame");
const savedList = document.getElementById("savedList");

let lastRecipe = "";
let lastVideoUrl = "";

let isListening = false;
let recognition = null;

/* -----------------------------------------------------------
   Speech recognition (Chrome / Edge)
----------------------------------------------------------- */
(function setupSpeech() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn("Speech recognition not supported in this browser.");
    voiceBtn.textContent = "🎙️ Speak (not supported)";
    voiceBtn.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;

  recognition.onstart = () => {
    console.log("Speech started");
    isListening = true;
    voiceBtn.textContent = "🛑 Stop Listening";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log("Heard:", transcript);

    // Append to existing ingredients
    const current = ingredientsInput.value.trim();
    ingredientsInput.value = current
      ? `${current} ${transcript}`
      : transcript;
  };

  recognition.onerror = (event) => {
    console.error("Speech error:", event.error);
    statusEl.textContent = "🎤 Speech error. Try again or type your ingredients.";
    statusEl.className = "status error";
  };

  recognition.onend = () => {
    console.log("Speech ended");
    isListening = false;
    voiceBtn.textContent = "🎙️ Speak Ingredients";
  };

  voiceBtn.addEventListener("click", () => {
    if (!recognition) return;

    if (!isListening) {
      try {
        recognition.start();
      } catch (e) {
        console.warn("recognition.start error:", e);
      }
    } else {
      recognition.stop();
    }
  });
})();

/* -----------------------------------------------------------
   Helper: render markdown-ish text (simple)
----------------------------------------------------------- */
function renderMarkdown(md) {
  if (!md) return "";

  let html = md;

  // headings
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");

  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // bullet lists
  html = html.replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

  // numbered lists
  html = html.replace(/^\s*\d+\.\s+(.*)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gs, "<ol>$1</ol>");

  // newlines
  html = html.replace(/\n{2,}/g, "<br><br>");

  return html;
}

/* -----------------------------------------------------------
   Call backend /getRecipe
----------------------------------------------------------- */
async function fetchRecipe() {
  const ingredients = ingredientsInput.value.trim();
  if (!ingredients) {
    statusEl.textContent = "⚠️ Please enter or speak your ingredients first.";
    statusEl.className = "status error";
    return;
  }

  const mealType = mealTypeSelect.value;
  const prepType = prepTypeSelect.value;

  let style = styleSelect.value;
  if (style === "custom") {
    const custom = styleCustom.value.trim();
    style = custom || "any";
  }

  statusEl.textContent = "🍳 Thinking of the perfect recipe...";
  statusEl.className = "status";
  outputEl.innerHTML = "";
  videoWrapper.style.display = "none";
  lastRecipe = "";
  lastVideoUrl = "";

  try {
    const res = await fetch("/getRecipe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ingredients, mealType, prepType, style }),
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();

    if (!data.recipe) {
      throw new Error("No recipe received from server");
    }

    lastRecipe = data.recipe;
    lastVideoUrl = data.videoUrl || "";

    outputEl.innerHTML = renderMarkdown(lastRecipe);

    if (data.videoUrl) {
      videoFrame.src = data.videoUrl;
      videoWrapper.style.display = "block";
    } else {
      videoFrame.src = "";
      videoWrapper.style.display = "none";
    }

    statusEl.textContent = "✅ Recipe ready!";
    statusEl.className = "status success";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "❌ Failed to generate recipe. Check console for details.";
    statusEl.className = "status error";
  }
}

/* -----------------------------------------------------------
   Save recipes to localStorage
----------------------------------------------------------- */
function loadSavedRecipes() {
  const raw = localStorage.getItem("chefti_saved_recipes");
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function storeSavedRecipes(list) {
  localStorage.setItem("chefti_saved_recipes", JSON.stringify(list));
}

function recipeTitleFromMarkdown(md) {
  if (!md) return "Untitled recipe";
  const lines = md.split("\n");
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("#")) {
      return line.replace(/^#+\s*/, "");
    }
  }
  // fallback: first 40 chars
  return md.slice(0, 40) + (md.length > 40 ? "…" : "");
}

function renderSavedList() {
  const saved = loadSavedRecipes();
  savedList.innerHTML = "";

  if (!saved.length) {
    savedList.innerHTML = "<div style='font-size:0.8rem;color:#777;'>No recipes saved yet.</div>";
    return;
  }

  for (let item of saved) {
    const div = document.createElement("div");
    div.className = "saved-item";

    const title = document.createElement("div");
    title.className = "saved-item-title";
    title.textContent = recipeTitleFromMarkdown(item.recipe);

    const viewBtn = document.createElement("button");
    viewBtn.className = "small-btn";
    viewBtn.textContent = "View";
    viewBtn.onclick = () => {
      lastRecipe = item.recipe;
      lastVideoUrl = item.videoUrl || "";
      outputEl.innerHTML = renderMarkdown(lastRecipe);
      if (lastVideoUrl) {
        videoFrame.src = lastVideoUrl;
        videoWrapper.style.display = "block";
      } else {
        videoWrapper.style.display = "none";
      }
      statusEl.textContent = "📖 Loaded saved recipe.";
      statusEl.className = "status";
    };

    const copyBtn = document.createElement("button");
    copyBtn.className = "small-btn";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(item.recipe).then(
        () => {
          statusEl.textContent = "📋 Recipe copied to clipboard!";
          statusEl.className = "status success";
        },
        () => {
          statusEl.textContent = "⚠️ Could not copy to clipboard.";
          statusEl.className = "status error";
        }
      );
    };

    div.appendChild(title);
    div.appendChild(viewBtn);
    div.appendChild(copyBtn);
    savedList.appendChild(div);
  }
}

/* -----------------------------------------------------------
   Event handlers
----------------------------------------------------------- */
generateBtn.addEventListener("click", () => {
  fetchRecipe();
});

generateNewBtn.addEventListener("click", () => {
  // Same call again – AI has randomness so you get a new idea
  fetchRecipe();
});

saveBtn.addEventListener("click", () => {
  if (!lastRecipe) {
    statusEl.textContent = "⚠️ No recipe to save yet. Generate one first.";
    statusEl.className = "status error";
    return;
  }

  const saved = loadSavedRecipes();
  saved.unshift({
    id: Date.now(),
    recipe: lastRecipe,
    videoUrl: lastVideoUrl,
  });

  // limit number stored
  if (saved.length > 30) saved.length = 30;

  storeSavedRecipes(saved);
  renderSavedList();

  statusEl.textContent = "💾 Recipe saved locally on this device.";
  statusEl.className = "status success";
});

/* -----------------------------------------------------------
   Init
----------------------------------------------------------- */
renderSavedList();
