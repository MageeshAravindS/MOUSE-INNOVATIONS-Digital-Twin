// ====================================
// AI VISIBILITY
// EXP + THEORY + PROJECT
// ====================================

function updateAIVisibility(){

const aiChat =
document.getElementById("aiChat");


const aiPanel =
document.getElementById("aiPanel");


if(!aiChat || !aiPanel){
return;
}


// Allowed AI Pages: available whenever the student/staff is inside the main app
let appEl = document.getElementById("app");
let isLoginPage = document.querySelector(".login-wrap");

if (appEl && !isLoginPage) {
  aiChat.style.display = "block";
} else {
  aiChat.style.display = "none";
  aiPanel.classList.remove("open", "closing");
  aiPanel.style.display = "none";
}

}
// ====================================
// AI TEACHER CHATBOT
// (routed through our own FastAPI backend --
// no third-party API key ever lives in the browser)
// ====================================

// CHANGE: GEMINI_API_KEY constant removed entirely. The browser must
// never hold an LLM provider's API key -- it now talks only to our own
// backend, which holds the Groq key server-side (see llm_client.py).

let _aiCloseTimer = null;

function toggleAI(){
  const panel = document.getElementById("aiPanel");
  if(!panel) return;

  if (_aiCloseTimer) {
    clearTimeout(_aiCloseTimer);
    _aiCloseTimer = null;
  }

  const isOpen = panel.classList.contains("open");

  if(isOpen){
    // Play fluid exit animation
    panel.classList.remove("open");
    panel.classList.add("closing");
    _aiCloseTimer = setTimeout(() => {
      panel.classList.remove("closing");
      panel.style.display = "none";
      _aiCloseTimer = null;
    }, 230);
  } else {
    // Play fluid spring pop-in
    panel.style.display = "flex";
    panel.classList.remove("closing");
    void panel.offsetWidth; // force reflow for smooth transition
    panel.classList.add("open");
    const input = document.getElementById("aiInput");
    if(input) setTimeout(() => input.focus(), 120);
  }
}









// CHANGE: askGemini() removed. Replaced with askAITeacher(), which calls
// our own backend's POST /api/ai-teacher instead of calling Gemini
// directly. The backend already runs the full pipeline internally
// (load_experiment -> analyze_connections -> select mode -> build
// prompt -> Groq), so this file no longer needs to build any prompt
// itself -- it just sends the student's question and reads back
// data.answer.
//
// NOTE: getCurrentExperimentName() reads the student's actual dropdown
// selection (#expSelect) instead of assuming Bridge Rectifier. Today
// only bridge_rectifier.json exists on the backend, so every other
// case will get a clean "Experiment not found" message from
// /api/ai-teacher until those knowledge-base JSON files are added --
// no code change will be needed here when that happens.
function getCurrentExperimentName(){
  // 1. Check if Resistance Bank board is active (Training Kit or Assessment)
  if (window.rbExpRunning || document.getElementById("rb-exp-board-wrap") || document.getElementById("rb-svg") || document.getElementById("l2-svg")) {
    return "resistance_bank";
  }

  // 2. Check Power Converter Assessment
  if (document.getElementById("pc-svg")) {
    const sel = document.getElementById("expSelect");
    if (sel && sel.value === "Full Wave Rectifier") return "full_wave_rectifier";
    return "bridge_rectifier";
  }

  // 3. Check dropdown on Experiments page
  const expSelect = document.getElementById("expSelect");
  if(!expSelect) return "bridge_rectifier";

  switch(expSelect.value){
    case "Half Wave Rectifier": return "half_wave_rectifier";
    case "Full Wave Rectifier": return "full_wave_rectifier";
    case "Bridge Rectifier": return "bridge_rectifier";
    case "Buck Converter": return "power_converter";
    case "Boost Converter": return "power_converter";
    case "Inverter": return "power_converter";
    case "Power Converter Kit": return "power_converter";
    case "Resistance Bank": return "resistance_bank";
    default: return "bridge_rectifier";
  }
}

function currentAITeacherMode(){
  // Map the currently visible page to one of the backend's supported
  // modes ("experiment" | "theory" | "viva").
  if(document.querySelector("#page-experiments.active") || window.rbExpRunning){
    return "experiment";
  }
  if(document.querySelector("#page-assessments.active")){
    return "experiment";
  }
  if(document.querySelector("#page-theory.active")){
    return "theory";
  }
  return "experiment";
}

function getCurrentLiveConnections(){
  try {
    // 1. Resistance Bank Training Kit
    if ((window.rbExpRunning || document.getElementById("rb-exp-board-wrap")) && typeof rbExpCurrentGroups === "function") {
      const groups = rbExpCurrentGroups() || [];
      return groups.map(function(group){ return [...group].map(String); });
    }

    // 2. Resistance Bank Assessment Level 1
    if (document.getElementById("rb-svg") && typeof rbCurrentGroups === "function") {
      const groups = rbCurrentGroups() || [];
      return groups.map(function(group){ return [...group].map(String); });
    }

    // 3. Resistance Bank Assessment Level 2
    if (document.getElementById("l2-svg") && typeof l2CurrentGroups === "function") {
      const groups = l2CurrentGroups() || [];
      return groups.map(function(group){ return [...group].map(String); });
    }

    // 4. Power Converter Assessment
    if (document.getElementById("pc-svg") && typeof pcCurrentGroups === "function") {
      const groups = pcCurrentGroups() || [];
      return groups.map(function(group){ return [...group].map(String); });
    }

    // 5. Power Converter Training / Experiments page
    if (typeof expCurrentGroups === "function") {
      const groups = expCurrentGroups() || [];
      return groups.map(function(group){ return [...group].map(String); });
    }

    return [];
  } catch(error) {
    console.log("Could not read live wiring state:", error);
    return [];
  }
}

function getCurrentExtraContext(){
  const extra = {};
  const nodeA = document.getElementById("rbExpNodeA") || document.getElementById("rb-node-a") || document.getElementById("l2-node-a");
  const nodeB = document.getElementById("rbExpNodeB") || document.getElementById("rb-node-b") || document.getElementById("l2-node-b");
  if(nodeA && nodeA.value) extra.terminal_a = nodeA.value.trim();
  if(nodeB && nodeB.value) extra.terminal_b = nodeB.value.trim();

  const studentAns = document.getElementById("rbExpAnswer") || document.getElementById("rb-calculated-input") || document.getElementById("l2-calculated-input");
  if(studentAns && studentAns.value) extra.student_entered_answer = studentAns.value.trim();

  const expRes = document.getElementById("rbExpResult") || document.getElementById("rb-result");
  if(expRes && expRes.innerText) extra.last_evaluation_banner = expRes.innerText.trim();

  const l2Target = document.getElementById("l2-target-ohms");
  if(l2Target && l2Target.textContent){
    extra.target_ohms = parseFloat(l2Target.textContent) || null;
  }
  return extra;
}

// ====================================
// AI PROVIDER & HARDWARE DIAGNOSTICS
// ====================================

let currentAIProvider = localStorage.getItem("edunexus_ai_provider") || "ollama";

function onAIProviderChange(val){
  currentAIProvider = val || "ollama";
  localStorage.setItem("edunexus_ai_provider", currentAIProvider);
  const sel = document.getElementById("aiProviderSelect");
  if(sel) sel.value = currentAIProvider;
  fetchAIStatus();
}
window.onAIProviderChange = onAIProviderChange;

async function fetchAIStatus(){
  const statusDot = document.getElementById("aiStatusDot");
  const statusText = document.getElementById("aiStatusText");
  const statusBadge = document.getElementById("aiStatusBadge");
  const sel = document.getElementById("aiProviderSelect");
  if(sel && sel.value !== currentAIProvider){
    sel.value = currentAIProvider;
  }
  try {
    const API_BASE = window.EDUNEXUS_API_BASE || "http://127.0.0.1:8123";
    const res = await fetch(API_BASE + "/api/ai-teacher/status");
    if(!res.ok) throw new Error("Status failed");
    const data = await res.json();
    
    if(currentAIProvider === "ollama"){
      const o = data.ollama || {};
      if(o.available && o.target_model_installed){
        if(statusDot) statusDot.className = "ai-status-indicator online";
        if(statusText) statusText.textContent = "Local Qwen3:4B Connected";
        if(statusBadge) statusBadge.textContent = "RTX 2050";
      } else {
        if(statusDot) statusDot.className = "ai-status-indicator warning";
        if(statusText) statusText.textContent = o.error ? "Ollama Error" : "Ollama Offline";
        if(statusBadge) statusBadge.textContent = "Local";
      }
    } else {
      const a = data.api || {};
      if(a.available && a.key_present){
        if(statusDot) statusDot.className = "ai-status-indicator online";
        const provName = (a.provider || "API").toUpperCase();
        if(statusText) statusText.textContent = `Cloud ${provName} (${a.model || "default"})`;
        if(statusBadge) statusBadge.textContent = "Cloud API";
      } else {
        if(statusDot) statusDot.className = "ai-status-indicator warning";
        if(statusText) statusText.textContent = "API Key Missing";
        if(statusBadge) statusBadge.textContent = "Cloud";
      }
    }
  } catch(e){
    if(statusDot) statusDot.className = "ai-status-indicator warning";
    if(statusText) statusText.textContent = "Server Connecting...";
  }
}
window.fetchAIStatus = fetchAIStatus;

function toggleAIDebugDrawer(){
  const drawer = document.getElementById("aiDebugDrawer");
  if(!drawer) return;
  drawer.style.display = drawer.style.display === "none" ? "block" : "none";
}
window.toggleAIDebugDrawer = toggleAIDebugDrawer;

function updateAIDebugInfo(data){
  if(!data) return;
  const p = document.getElementById("aiDebugProvider");
  const m = document.getElementById("aiDebugModel");
  const l = document.getElementById("aiDebugLatency");
  const t = document.getElementById("aiDebugTokens");
  const c = document.getElementById("aiDebugCached");
  const thinkRow = document.getElementById("aiDebugThinkingRow");
  const thinkChars = document.getElementById("aiDebugThinkChars");
  const thinkText = document.getElementById("aiDebugThinkingText");

  if(p) p.textContent = data.provider || currentAIProvider;
  if(m) m.textContent = data.model || "-";
  if(l) l.textContent = data.latency_seconds !== undefined ? `${data.latency_seconds}s` : "-";
  if(t) t.textContent = data.tokens_eval || "-";
  if(c) c.textContent = data.cached ? "Yes (0.001s)" : "No";

  if(data.thinking){
    if(thinkRow) thinkRow.style.display = "block";
    if(thinkChars) thinkChars.textContent = data.thinking.length;
    if(thinkText) thinkText.textContent = data.thinking;
  } else if(thinkRow){
    thinkRow.style.display = "none";
  }
}

// ====================================
// REAL-TIME CIRCUIT GUIDANCE (DEBOUNCED)
// ====================================

let _circuitDebounceTimer = null;
let _lastEvaluatedWiresHash = "";

function dismissCircuitGuidance(){
  const banner = document.getElementById("aiCircuitGuidance");
  if(banner) banner.style.display = "none";
}
window.dismissCircuitGuidance = dismissCircuitGuidance;

function triggerDebouncedCircuitGuidance(){
  // Only run when experiments page is active
  // Run on experiments or assessments pages
  if(!document.querySelector("#page-experiments.active") && !document.querySelector("#page-assessments.active") && !window.rbExpRunning) return;

  if(_circuitDebounceTimer) {
    clearTimeout(_circuitDebounceTimer);
  }

  // 1.8s debounce interval per Section 13
  _circuitDebounceTimer = setTimeout(async () => {
    _circuitDebounceTimer = null;
    const wires = getCurrentLiveConnections();
    const hash = JSON.stringify(wires);
    if(hash === _lastEvaluatedWiresHash) return;
    _lastEvaluatedWiresHash = hash;

    // Call Level 2 Circuit Evaluator endpoint
    try {
      const API_BASE = window.EDUNEXUS_API_BASE || "http://127.0.0.1:8123";
      const res = await fetch(API_BASE + "/api/ai-teacher/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_name: getCurrentExperimentName(),
          student_connections: wires,
          provider: currentAIProvider,
          extra_context: getCurrentExtraContext(),
        })
      });
      const data = await res.json();
      if(data && data.status === "success" && data.answer){
        updateAIDebugInfo(data);
        const banner = document.getElementById("aiCircuitGuidance");
        const content = document.getElementById("aiGuidanceContent");
        if(banner && content){
          const isCorrect = data.answer.includes("Circuit looks correct");
          banner.className = isCorrect ? "ai-circuit-guidance correct" : "ai-circuit-guidance";
          content.innerHTML = escapeHtmlText(data.answer)
            .replace(/⚠️ Problem/g, "<strong style='color:#f59e0b;'>⚠️ Problem</strong>")
            .replace(/Why/g, "<strong>Why</strong>")
            .replace(/Fix/g, "<strong style='color:#10b981;'>Fix</strong>")
            .replace(/✓ Circuit looks correct/g, "<strong style='color:#10b981;'>✓ Circuit looks correct</strong>")
            .replace(/\n/g, "<br>");
          banner.style.display = "block";
        }
      }
    } catch(e){
      console.log("Circuit evaluation error:", e);
    }
  }, 1800);
}
window.triggerDebouncedCircuitGuidance = triggerDebouncedCircuitGuidance;

async function askAITeacher(question){
  try{
    const API_BASE = window.EDUNEXUS_API_BASE || "http://127.0.0.1:8123";
    const response = await fetch(
      API_BASE + "/api/ai-teacher",
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          experiment_name: getCurrentExperimentName(),
          student_connections: getCurrentLiveConnections(),
          student_question: question,
          mode: currentAITeacherMode(),
          provider: currentAIProvider,
          extra_context: getCurrentExtraContext(),
        })
      }
    );

    const data = await response.json();

    if(data.status !== "success"){
      console.warn("AI Teacher API Error:", data);

      const rawMessage = (data.message || "").toLowerCase();

      if(rawMessage.includes("not found") || rawMessage.includes("not available")){
        return (data.message || "Experiment knowledge for this experiment is not available yet.")
          + " You can ask me a general theory question instead while it's being added.";
      }

      if(rawMessage.includes("api key") || rawMessage.includes("invalid") || rawMessage.includes("401") || rawMessage.includes("missing api key") || rawMessage.includes("authentication")){
        return "⚠️ **AI Teacher Setup Required**\n\n"
          + (data.message || "An API key is required to activate the AI Teacher.")
          + "\n\n💡 **Tip:** Switch the provider dropdown to **Local Qwen3:4B (RTX 2050)** for free local inference!";
      }

      return data.message || "The AI Teacher couldn't answer that just now. Please try again in a moment.";
    }

    window._lastAIData = data;
    updateAIDebugInfo(data);
    return data.answer;
  } catch(error) {
    console.log(error);
    return "AI connection error. Check that the backend server is running.";
  }
}

function askQuickPrompt(promptText) {
  const input = document.getElementById("aiInput");
  if (!input) return;
  input.value = promptText;
  sendAI();
}
window.askQuickPrompt = askQuickPrompt;

async function sendAI(){
  const input = document.getElementById("aiInput");
  const messages = document.getElementById("aiMessages");
  if(!input || !messages){
    return;
  }

  const text = input.value.trim();
  if(!text){
    return;
  }

  // Modern Caelestia User Message Bubble
  messages.innerHTML += `
    <div class="ai-msg ai-msg-user">
      <div class="ai-user-bubble">
        ${escapeHtmlText(text)}
      </div>
    </div>
    <div id="thinking" class="ai-msg ai-msg-thinking">
      <div class="ai-thinking-badge">
        <i class="ti ti-sparkles"></i>
      </div>
      <div class="ai-thinking-dots">
        <span>Reasoning</span>
        <span class="ai-dot"></span>
        <span class="ai-dot"></span>
        <span class="ai-dot"></span>
      </div>
    </div>
  `;

  input.value = "";
  messages.scrollTop = messages.scrollHeight;

  let reply = await askAITeacher(text);

  // Remove thinking indicator
  let think = document.getElementById("thinking");
  if(think){
    think.remove();
  }

  // Safety fallback: never allow empty AI responses in the UI
  if(!reply || !reply.trim()){
    reply = "I'm right here in the lab with you! What component or connection would you like help checking?";
  }

  // Format AI Teacher Response
  let formattedReply = (reply || "")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^###\s+(.*$)/gim, "<h4 class='ai-heading'>$1</h4>")
    .replace(/^##\s+(.*$)/gim, "<h3 class='ai-heading'>$1</h3>")
    .replace(/^#\s+(.*$)/gim, "<h3 class='ai-heading'>$1</h3>")
    .replace(/\* (.*?)(?=(\n\* |\n\n|$))/gs, "<li>$1</li>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>");

  let thinkingHtml = "";
  if(window._lastAIData && window._lastAIData.thinking){
    const cleanThinking = escapeHtmlText(window._lastAIData.thinking.trim());
    thinkingHtml = `
      <details class="ai-thought-accordion">
        <summary class="ai-thought-summary">
          <i class="ti ti-brain"></i> <span>View AI Step-by-Step Reasoning (${window._lastAIData.thinking.length} chars)</span>
        </summary>
        <div class="ai-thought-body">${cleanThinking}</div>
      </details>
    `;
  }

  messages.innerHTML += `
    <div class="ai-msg ai-msg-bot">
      <div class="ai-bot-avatar">
        <i class="ti ti-robot"></i>
      </div>
      <div class="ai-bot-bubble">
        ${thinkingHtml}
        <div class="ai-reply-content">${formattedReply}</div>
      </div>
    </div>
  `;

  messages.scrollTop = messages.scrollHeight;
}

function escapeHtmlText(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}









// ====================================
// UPDATE AI WHEN PAGE CHANGES
// ====================================


window.addEventListener(
"load",
()=>{


updateAIVisibility();


});




window.addEventListener("load",()=>{

updateAIVisibility();

});
// =======================
// AI WINDOW DRAGGING
// =======================

let movingAI = false;

let moveX = 0;
let moveY = 0;


document.addEventListener(
"mousedown",
function(e){


const panel =
document.getElementById("aiPanel");


const header = document.querySelector("#aiPanel .ai-panel-header") || document.querySelector("#aiPanel h3");

if(header && (e.target === header || header.contains(e.target)) && !e.target.closest(".ai-tool-btn")){
movingAI = true;
moveX = e.clientX - panel.offsetLeft;
moveY = e.clientY - panel.offsetTop;
}


});




document.addEventListener(
"mousemove",
function(e){


if(!movingAI)
return;



const panel =
document.getElementById(
"aiPanel"
);



panel.style.left =
(e.clientX-moveX)+"px";



panel.style.top =
(e.clientY-moveY)+"px";



panel.style.right =
"auto";


panel.style.bottom =
"auto";


});





document.addEventListener(
"mouseup",
function(){


movingAI=false;


});

// Initialize provider and diagnostics on startup
if(document.readyState === "loading"){
  window.addEventListener("DOMContentLoaded", fetchAIStatus);
} else {
  fetchAIStatus();
}

// Explicit window assignments for HTML onclick handlers
Object.assign(window, {
  toggleAI,
  sendAI,
  askQuickPrompt,
  toggleAIDebugDrawer,
  updateAIVisibility,
  onAIProviderChange,
  fetchAIStatus,
});
