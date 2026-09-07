/**
 * EduNexus Live Classroom & Real-Time Circuit Synchronization
 * Allows students to broadcast their live circuit changes in real time
 * and teachers to monitor online students' circuits live on a Digital Twin board.
 */

// ============================================================================
// STUDENT CLIENT: LiveCircuitSync
// ============================================================================

const LiveCircuitSync = (function () {
  let ws = null;
  let currentSession = null;
  let updateTimer = null;
  let reconnectTimer = null;
  let isConnected = false;

  function getWsUrl() {
    const apiBase = window.EDUNEXUS_API_BASE || (window.location.protocol + "//" + window.location.host);
    const isSecure = apiBase.startsWith("https") || window.location.protocol === "https:";
    const cleanHost = apiBase.replace(/^https?:\/\//, "");
    return `${isSecure ? "wss:" : "ws:"}//${cleanHost}/ws/live-circuit`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(getWsUrl());

      ws.onopen = function () {
        isConnected = true;
        clearTimeout(reconnectTimer);
        // If we have an active session, send hello
        if (currentSession) {
          sendHello();
        }
      };

      ws.onmessage = function (event) {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "teacher_hint") {
            showTeacherHintToast(data.teacher_name, data.hint);
          }
        } catch (e) {
          console.warn("[LiveSync] Message parse error:", e);
        }
      };

      ws.onclose = function () {
        isConnected = false;
        ws = null;
        // Auto-reconnect if session is active
        if (currentSession) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = function () {
        isConnected = false;
      };
    } catch (err) {
      isConnected = false;
    }
  }

  function sendHello() {
    if (!currentSession) return;
    const u = window.currentUser || {};
    const payload = {
      type: "student_hello",
      student_id: u.id || "guest",
      student_name: u.name || u.email || "Student",
      student_email: u.email || "",
      ...currentSession,
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      // REST fallback
      fallbackPost(payload);
    }
  }

  function fallbackPost(payload) {
    if (typeof api === "function") {
      api("/api/live-classroom/circuit-state", {
        method: "POST",
        body: payload,
      }).catch(() => {});
    }
  }

  function startSession(sessionInfo) {
    currentSession = {
      assignment_id: sessionInfo.assignment_id || "lab_session",
      assignment_title: sessionInfo.assignment_title || "Laboratory Assessment",
      kit_id: sessionInfo.kit_id || "resistance_bank",
      wires: sessionInfo.wires || [],
      node_a: sessionInfo.node_a || "",
      node_b: sessionInfo.node_b || "",
      student_answer: sessionInfo.student_answer || "",
      mode: sessionInfo.mode || "manual",
      status: "wiring",
    };
    connect();
    if (isConnected) {
      sendHello();
    }
  }

  function updateCircuit(delta) {
    if (!currentSession) return;
    Object.assign(currentSession, delta);

    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      const u = window.currentUser || {};
      const payload = {
        type: "circuit_update",
        student_id: u.id || "guest",
        student_name: u.name || u.email || "Student",
        student_email: u.email || "",
        ...currentSession,
      };

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      } else {
        fallbackPost(payload);
      }
    }, 80); // Debounce 80ms for ultra-responsive live sync
  }

  function leaveSession() {
    if (!currentSession) return;
    const u = window.currentUser || {};
    const sid = u.id || "guest";

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "student_leave", student_id: sid }));
      try { ws.close(); } catch (e) {}
    } else if (typeof api === "function") {
      api("/api/live-classroom/leave", {
        method: "POST",
        body: { student_id: sid },
      }).catch(() => {});
    }

    currentSession = null;
    clearTimeout(updateTimer);
    clearTimeout(reconnectTimer);
  }

  function showTeacherHintToast(teacherName, hint) {
    const toastEl = document.getElementById("toast");
    if (!toastEl) return;
    
    // Create animated live instructor hint banner
    const banner = document.createElement("div");
    banner.className = "live-teacher-hint-banner";
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:28px;height:28px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;">
          <i class="ti ti-message-dots"></i>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:.6px;">Instructor Live Note</div>
          <div style="font-size:13px;font-weight:700;color:#ffffff;">${escapeHtml(teacherName || "Teacher")}</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:16px;">&times;</button>
      </div>
      <div style="font-size:13px;color:#f8fafc;line-height:1.5;">${escapeHtml(hint)}</div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => {
      if (banner.parentNode) banner.remove();
    }, 9000);
  }

  return {
    startSession,
    updateCircuit,
    leaveSession,
    showTeacherHintToast,
  };
})();


// ============================================================================
// TEACHER STUDIO: renderLiveClassroom
// ============================================================================

let liveClassroomWs = null;
let liveStudents = [];
let selectedStudentId = null;
let liveClassroomPollHandle = null;

async function renderLiveClassroom() {
  const root = document.getElementById("page-live-classroom");
  if (!root) return;

  const isStaff = currentUser && currentUser.role === "staff";
  if (!isStaff) {
    root.innerHTML = `
      <div class="card" style="padding:40px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">🔒</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">Faculty Access Required</div>
        <div style="font-size:13px;color:var(--text-secondary);">The Live Classroom Circuit Monitor is restricted to faculty instructors.</div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <!-- TOP STUDIO BANNER -->
    <div class="exp-header-banner" style="margin-bottom:20px;">
      <div class="exp-title-group">
        <div class="exp-icon-gem" style="background:linear-gradient(135deg,rgba(239,68,68,.25),rgba(245,158,11,.25));border-color:rgba(239,68,68,.4);color:#ef4444;">
          <i class="ti ti-broadcast"></i>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="live-pulse-badge">🔴 LIVE LAB MONITOR</span>
            <span class="exp-badge" style="background:rgba(99,102,241,.15);color:#818cf8;border-color:rgba(99,102,241,.3);">Real-Time Digital Twin</span>
          </div>
          <h1 class="exp-heading">Active Student Laboratory Proctor</h1>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="live-counter-pill" id="liveOnlineCounter">
          <span class="pulse-dot"></span>
          <span id="liveActiveCount">0 Online</span>
        </div>
        <button class="btn btn-sm" onclick="fetchLiveStudentsRest()" title="Refresh List">
          <i class="ti ti-refresh"></i> Refresh
        </button>
        <button class="btn btn-sm" onclick="goto('assessment');renderAssessmentDashboard()">
          ← Assessment Center
        </button>
      </div>
    </div>

    <!-- MAIN STUDIO SPLIT VIEW -->
    <div class="live-studio-grid">
      <!-- LEFT: ACTIVE ONLINE STUDENTS LIST -->
      <div class="live-students-sidebar card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span>Active Students</span>
          <span style="font-size:11px;color:var(--text-tertiary);" id="liveSidebarMeta">Waiting for activity...</span>
        </div>
        <div id="liveStudentsList" class="live-students-scroll">
          <div class="empty-state" style="padding:24px 10px;">
            <div style="font-size:24px;margin-bottom:8px;">📡</div>
            <div>No students currently in lab assessments.</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">When a student enters an assessment or connects wires, they appear here live.</div>
          </div>
        </div>
      </div>

      <!-- CENTER: LIVE DIGITAL TWIN CIRCUIT BOARD -->
      <div class="live-board-panel card">
        <div class="live-board-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span id="liveSelectedBadge" class="exp-badge" style="background:rgba(14,165,233,.15);color:#38bdf8;">Select a Student</span>
              <span id="liveActiveBoardMode" style="font-size:11px;color:var(--text-tertiary);"></span>
            </div>
            <h2 id="liveSelectedStudentName" style="font-size:18px;font-weight:700;color:var(--text-primary);margin-top:4px;">No Student Selected</h2>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" onclick="zoomLiveBoard(-0.15)" title="Zoom Out"><i class="ti ti-minus"></i></button>
            <button class="btn btn-sm" onclick="resetLiveBoardZoom()" id="liveBoardZoomLabel" title="Reset Zoom">100%</button>
            <button class="btn btn-sm" onclick="zoomLiveBoard(0.15)" title="Zoom In"><i class="ti ti-plus"></i></button>
            <button class="btn btn-primary btn-sm" onclick="fullscreenLiveBoard()"><i class="ti ti-maximize"></i> Fullscreen</button>
          </div>
        </div>

        <!-- BOARD SVG CANVAS WRAPPER -->
        <div class="live-canvas-container" id="liveCanvasWrap">
          <div id="liveCanvasPlaceholder" class="empty-state" style="padding:80px 20px;">
            <div class="live-radar-ping" style="margin:0 auto 16px;"></div>
            <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">Digital Twin Standby</div>
            <div style="font-size:13px;color:var(--text-secondary);max-width:400px;margin:0 auto;">
              Select an active student from the left panel to watch their circuit connections, measurements, and jumper placements update in real time.
            </div>
          </div>
          <div id="liveSvgRoot" style="display:none;width:100%;height:100%;"></div>
        </div>

        <div style="font-size:11px;color:var(--text-tertiary);margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
          <span id="liveBoardHint">Watching student live workspace · Powered by Nodal Laplacian Digital Twin solver</span>
          <span id="liveLastSyncTime" style="font-family:var(--font-mono);font-size:10px;">Sync: Active</span>
        </div>
      </div>

      <!-- RIGHT: TELEMETRY & LIVE INSTRUCTOR COACHING -->
      <div class="live-telemetry-sidebar card">
        <div class="card-title"><i class="ti ti-cpu"></i> Live Circuit Telemetry</div>
        
        <div class="live-telemetry-grid">
          <div class="telemetry-box">
            <span class="telemetry-label">Terminal A</span>
            <span class="telemetry-val pin-a" id="telNodeA">—</span>
          </div>
          <div class="telemetry-box">
            <span class="telemetry-label">Terminal B</span>
            <span class="telemetry-val pin-b" id="telNodeB">—</span>
          </div>
          <div class="telemetry-box" style="grid-column: span 2;">
            <span class="telemetry-label">Student Calculated Rth</span>
            <span class="telemetry-val" id="telStudentAns" style="color:var(--accent-secondary);">—</span>
          </div>
          <div class="telemetry-box" style="grid-column: span 2;">
            <span class="telemetry-label">Nodal Solver (Ground Truth)</span>
            <span class="telemetry-val" id="telExactRth" style="color:#22c55e;">—</span>
          </div>
        </div>

        <!-- JUMPERS LIST -->
        <div class="card-title" style="margin-top:16px;font-size:12px;"><i class="ti ti-git-fork"></i> Active Jumpers (<span id="telWireCount">0</span>)</div>
        <div id="telWireList" class="live-wire-stream">
          <p class="empty-state" style="padding:10px;font-size:11px;">No jumpers placed yet.</p>
        </div>

        <!-- LIVE ACTIVITY STREAM -->
        <div class="card-title" style="margin-top:16px;font-size:12px;"><i class="ti ti-timeline"></i> Student Activity Stream</div>
        <div id="telActivityFeed" class="live-activity-feed">
          <div class="empty-state" style="padding:10px;font-size:11px;">No events recorded.</div>
        </div>

        <!-- INSTRUCTOR LIVE HINT SENDER -->
        <div class="live-hint-drawer" style="margin-top:18px;">
          <div class="card-title" style="font-size:12px;margin-bottom:8px;"><i class="ti ti-message-share"></i> Send Student Live Hint</div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="liveHintInput" class="form-input" placeholder="e.g. Check resistor 47R sockets..." style="font-size:12px;padding:8px 10px;">
            <button class="btn btn-primary btn-sm" onclick="sendTeacherHint()" style="white-space:nowrap;">
              <i class="ti ti-send"></i> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Start WebSocket connection as teacher
  connectTeacherWs();
  // Fetch initial REST snapshot
  fetchLiveStudentsRest();

  // Background polling backup every 2.5s
  clearInterval(liveClassroomPollHandle);
  liveClassroomPollHandle = setInterval(fetchLiveStudentsRest, 2500);
}

function connectTeacherWs() {
  const apiBase = window.EDUNEXUS_API_BASE || (window.location.protocol + "//" + window.location.host);
  const isSecure = apiBase.startsWith("https") || window.location.protocol === "https:";
  const cleanHost = apiBase.replace(/^https?:\/\//, "");
  const wsUrl = `${isSecure ? "wss:" : "ws:"}//${cleanHost}/ws/live-circuit`;

  if (liveClassroomWs) {
    try { liveClassroomWs.close(); } catch (e) {}
  }

  try {
    liveClassroomWs = new WebSocket(wsUrl);

    liveClassroomWs.onopen = function () {
      liveClassroomWs.send(JSON.stringify({ type: "teacher_join" }));
    };

    liveClassroomWs.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "initial_state") {
          updateLiveStudentsList(data.students || []);
        } else if (data.type === "student_circuit_changed") {
          onStudentCircuitChanged(data.student);
        } else if (data.type === "student_left") {
          onStudentLeft(data.student_id);
        } else if (data.type === "hint_sent_ack") {
          if (data.success) {
            toast("✅ Live hint delivered to student!");
          } else {
            toast("ℹ️ Student received hint via message log.");
          }
        }
      } catch (e) {
        console.warn("[LiveClassroom] WS error:", e);
      }
    };

    liveClassroomWs.onclose = function () {
      // Will be backed up by REST polling
    };
  } catch (err) {
    console.warn("[LiveClassroom] WS connection failed, using REST polling:", err);
  }
}

async function fetchLiveStudentsRest() {
  try {
    const res = await api("/api/live-classroom/students");
    if (res && Array.isArray(res.students)) {
      updateLiveStudentsList(res.students);
    }
  } catch (e) {
    // Non-fatal
  }
}

function updateLiveStudentsList(students) {
  liveStudents = students;
  const countEl = document.getElementById("liveActiveCount");
  const navBadge = document.getElementById("live-students-count");
  if (countEl) countEl.textContent = `${students.length} Online`;
  if (navBadge) {
    navBadge.textContent = students.length;
    navBadge.style.display = students.length > 0 ? "inline-block" : "none";
  }

  const listEl = document.getElementById("liveStudentsList");
  const metaEl = document.getElementById("liveSidebarMeta");
  if (!listEl) return;

  if (students.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:24px 10px;">
        <div style="font-size:24px;margin-bottom:8px;">📡</div>
        <div>No students currently in lab assessments.</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">When a student enters an assessment or connects wires, they appear here live.</div>
      </div>`;
    if (metaEl) metaEl.textContent = "0 Active";
    return;
  }

  if (metaEl) metaEl.textContent = `${students.length} Active Now`;

  listEl.innerHTML = students.map(s => {
    const isSel = String(s.student_id) === String(selectedStudentId);
    const wireCount = (s.wires || []).length;
    const initials = (s.student_name || "S").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const timeAgo = Math.max(0, Math.floor(Date.now() / 1000 - (s.last_active || 0)));

    return `
      <div class="live-student-card ${isSel ? "active" : ""}" onclick="selectLiveStudent('${s.student_id}')">
        <div class="live-student-av">${initials}</div>
        <div class="live-student-info">
          <div class="live-student-name">${escapeHtml(s.student_name)}</div>
          <div class="live-student-sub">${escapeHtml(s.assignment_title || "Lab Assessment")}</div>
          <div class="live-student-stats">
            <span class="badge-mini"><i class="ti ti-vector"></i> ${wireCount} wires</span>
            <span class="badge-mini"><i class="ti ti-clock"></i> ${timeAgo < 5 ? "Just now" : timeAgo + "s ago"}</span>
          </div>
        </div>
        <div class="live-active-indicator"></div>
      </div>
    `;
  }).join("");

  // If no student selected yet, auto-select first one
  if (!selectedStudentId && students.length > 0) {
    selectLiveStudent(students[0].student_id);
  } else if (selectedStudentId) {
    const curr = students.find(s => String(s.student_id) === String(selectedStudentId));
    if (curr) {
      renderSelectedStudentBoard(curr);
    }
  }
}

function onStudentCircuitChanged(student) {
  if (!student) return;
  const idx = liveStudents.findIndex(s => String(s.student_id) === String(student.student_id));
  if (idx >= 0) {
    liveStudents[idx] = student;
  } else {
    liveStudents.unshift(student);
  }
  updateLiveStudentsList(liveStudents);

  if (String(selectedStudentId) === String(student.student_id)) {
    renderSelectedStudentBoard(student);
  }
}

function onStudentLeft(studentId) {
  liveStudents = liveStudents.filter(s => String(s.student_id) !== String(studentId));
  updateLiveStudentsList(liveStudents);
  if (String(selectedStudentId) === String(studentId)) {
    selectedStudentId = liveStudents.length > 0 ? liveStudents[0].student_id : null;
    if (selectedStudentId) {
      const s = liveStudents.find(x => String(x.student_id) === String(selectedStudentId));
      if (s) renderSelectedStudentBoard(s);
    } else {
      clearLiveBoard();
    }
  }
}

function selectLiveStudent(studentId) {
  selectedStudentId = studentId;
  updateLiveStudentsList(liveStudents);
  const s = liveStudents.find(x => String(x.student_id) === String(studentId));
  if (s) {
    renderSelectedStudentBoard(s);
  }
}

let liveBoardZoom = 1;

function zoomLiveBoard(delta) {
  liveBoardZoom = Math.min(2.2, Math.max(0.6, liveBoardZoom + delta));
  const svg = document.querySelector("#liveSvgRoot svg");
  if (svg) {
    svg.style.transform = `scale(${liveBoardZoom})`;
    svg.style.transformOrigin = "top center";
  }
  const lbl = document.getElementById("liveBoardZoomLabel");
  if (lbl) lbl.textContent = Math.round(liveBoardZoom * 100) + "%";
}

function resetLiveBoardZoom() {
  liveBoardZoom = 1;
  const svg = document.querySelector("#liveSvgRoot svg");
  if (svg) {
    svg.style.transform = "scale(1)";
  }
  const lbl = document.getElementById("liveBoardZoomLabel");
  if (lbl) lbl.textContent = "100%";
}

function fullscreenLiveBoard() {
  const el = document.getElementById("liveCanvasWrap");
  if (!el) return;
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function clearLiveBoard() {
  const ph = document.getElementById("liveCanvasPlaceholder");
  const svgRoot = document.getElementById("liveSvgRoot");
  if (ph) ph.style.display = "block";
  if (svgRoot) {
    svgRoot.style.display = "none";
    svgRoot.innerHTML = "";
  }
  const nameEl = document.getElementById("liveSelectedStudentName");
  if (nameEl) nameEl.textContent = "No Student Selected";
  const badgeEl = document.getElementById("liveSelectedBadge");
  if (badgeEl) badgeEl.textContent = "Standby";
}

function renderSelectedStudentBoard(student) {
  const ph = document.getElementById("liveCanvasPlaceholder");
  const svgRoot = document.getElementById("liveSvgRoot");
  if (ph) ph.style.display = "none";
  if (svgRoot) svgRoot.style.display = "block";

  // Update header info
  const nameEl = document.getElementById("liveSelectedStudentName");
  if (nameEl) nameEl.textContent = student.student_name || "Student";
  const badgeEl = document.getElementById("liveSelectedBadge");
  if (badgeEl) badgeEl.textContent = student.assignment_title || "Laboratory Assessment";
  const modeEl = document.getElementById("liveActiveBoardMode");
  if (modeEl) modeEl.textContent = `[${(student.mode || "manual").toUpperCase()} MODE]`;

  const syncTimeEl = document.getElementById("liveLastSyncTime");
  if (syncTimeEl) syncTimeEl.textContent = "Live · " + new Date().toLocaleTimeString();

  // Telemetry updates
  const telNodeA = document.getElementById("telNodeA");
  const telNodeB = document.getElementById("telNodeB");
  const telStudentAns = document.getElementById("telStudentAns");
  const telExactRth = document.getElementById("telExactRth");
  const telWireCount = document.getElementById("telWireCount");

  if (telNodeA) telNodeA.textContent = student.node_a || "—";
  if (telNodeB) telNodeB.textContent = student.node_b || "—";
  if (telStudentAns) telStudentAns.textContent = student.student_answer ? student.student_answer + " Ω" : "—";
  if (telWireCount) telWireCount.textContent = (student.wires || []).length;

  // Calculate ground truth using Nodal Laplacian solver if available
  const isRB = student.kit_id === "resistance_bank" || !student.kit_id;
  if (isRB && typeof calculateResistanceBankCircuit === "function" && student.node_a && student.node_b) {
    try {
      const solverRes = calculateResistanceBankCircuit(student.wires || [], student.node_a, student.node_b);
      if (telExactRth) {
        if (solverRes && solverRes.rth !== null && isFinite(solverRes.rth)) {
          telExactRth.textContent = solverRes.rth.toFixed(1) + " Ω";
        } else {
          telExactRth.textContent = "Open Circuit (∞)";
        }
      }
    } catch (e) {
      if (telExactRth) telExactRth.textContent = "Calculating…";
    }
  } else if (telExactRth) {
    telExactRth.textContent = isRB ? "Set Terminals A & B" : "Verified";
  }

  // Wires list
  const wireListEl = document.getElementById("telWireList");
  if (wireListEl) {
    const wires = student.wires || [];
    if (wires.length === 0) {
      wireListEl.innerHTML = `<p class="empty-state" style="padding:10px;font-size:11px;">No jumpers placed yet.</p>`;
    } else {
      wireListEl.innerHTML = wires.map(([a, b], i) => `
        <div class="live-wire-item">
          <span class="live-wire-idx">#${i + 1}</span>
          <span class="live-wire-sockets">${a} ↔ ${b}</span>
          <span class="live-wire-badge">JUMPER</span>
        </div>
      `).join("");
    }
  }

  // Activity feed
  const feedEl = document.getElementById("telActivityFeed");
  if (feedEl) {
    const hist = student.history || [];
    if (hist.length === 0) {
      feedEl.innerHTML = `<div class="empty-state" style="padding:10px;font-size:11px;">Active in workspace.</div>`;
    } else {
      feedEl.innerHTML = hist.slice().reverse().map(h => `
        <div class="live-activity-item">
          <span class="activity-time">${new Date(h.time * 1000).toLocaleTimeString()}</span>
          <span class="activity-msg">${escapeHtml(h.msg)}</span>
        </div>
      `).join("");
    }
  }

  // Render the SVG Digital Twin Board!
  renderLiveBoardSvg(student, svgRoot);
}

// Self-contained coordinates so teacher proctoring board never depends on external script loading order
const LIVE_RB_SOCKETS = {
  "1":[84,210],   "2":[87,381],   "3":[84,555],   "4":[298,735],  "5":[84,731],
  "6":[84,898],   "7":[300,210],  "8":[511,206],  "9":[303,557],  "10":[512,384],
  "11":[512,555], "12":[715,737], "13":[300,905], "14":[511,899], "15":[719,210],
  "16":[929,209], "17":[717,555], "18":[928,382], "19":[717,903], "20":[928,905],
  "21":[1148,210],"22":[1355,210],"23":[1145,499],"24":[1355,325],"25":[903,566],
  "26":[1102,758],"27":[1353,564],"28":[1355,732],"29":[1143,905],"30":[1352,905]
};

const LIVE_PC_SOCKETS = {
  "1": [78.3,413.8],  "2": [79.9,266.0],  "3": [421.6,108.4], "4": [683.0,350.6], "5": [422.5,618.2],
  "6": [153.7,352.2], "7": [615.0,145.3], "8": [651.1,188.9], "9": [648.6,538.6], "10":[614.2,579.6],
  "11":[231.5,582.9], "12":[195.5,538.6], "13":[193.0,190.5], "14":[231.5,149.5], "15":[697.8,145.3],
  "16":[748.6,145.3], "17":[386.4,663.3], "18":[452.0,663.3], "19":[243.0,745.4], "20":[293.0,747.1],
  "21":[542.1,746.2], "22":[596.2,743.0], "23":[71.7,675.7],  "24":[147.1,675.7], "25":[71.7,739.7],
  "26":[150.4,738.9], "27":[709.3,642.0], "28":[707.6,588.6], "29":[710.9,539.4], "30":[366.7,310.3],
  "31":[474.9,309.5], "32":[366.7,421.2], "33":[473.3,422.8]
};

window.LIVE_RB_SOCKETS = LIVE_RB_SOCKETS;
window.LIVE_PC_SOCKETS = LIVE_PC_SOCKETS;

function renderLiveBoardSvg(student, container) {
  const isRB = student.kit_id === "resistance_bank" || !student.kit_id;
  const BOARD_IMAGE = isRB ? "assets/resistance_bank_board.png" : "assets/power_converter_board.png";
  const BOARD_VIEWBOX = isRB ? "0 0 1438 1094" : "0 0 842 838";
  const imgWidth = isRB ? 1438 : 842;
  const imgHeight = isRB ? 1094 : 838;
  const SOCKETS = isRB ? (window.RB_SOCKETS || LIVE_RB_SOCKETS) : (window.PC_SOCKETS || LIVE_PC_SOCKETS);

  const wires = student.wires || [];
  const nodeA = String(student.node_a || "").trim();
  const nodeB = String(student.node_b || "").trim();

  // Wire paths
  const wireColors = ["#38bdf8", "#f59e0b", "#a855f7", "#ec4899", "#10b981", "#06b6d4"];
  const wiresSvg = wires.map(([a, b], idx) => {
    const sA = SOCKETS[String(a)];
    const sB = SOCKETS[String(b)];
    if (!sA || !sB) return "";
    const [x1, y1] = sA;
    const [x2, y2] = sB;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - 28; // Arch curve
    const color = wireColors[idx % wireColors.length];

    return `
      <g class="live-svg-wire">
        <!-- Glow outline -->
        <path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.45" filter="drop-shadow(0 0 4px ${color})"/>
        <!-- Solid core wire -->
        <path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.95"/>
        <!-- Specular center highlight -->
        <path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.75"/>
      </g>`;
  }).join("");

  // Sockets with terminal highlights and labels
  const socketsSvg = Object.entries(SOCKETS).map(([id, [x, y]]) => {
    const isA = nodeA && id === nodeA;
    const isB = nodeB && id === nodeB;
    const strokeColor = isA ? "#ef4444" : isB ? "#3b82f6" : "red";
    const strokeWidth = (isA || isB) ? "4" : "3";
    const r = (isA || isB) ? 15 : 13;

    return `
      <g class="live-socket-group" data-socket-id="${id}">
        <!-- Node socket ring -->
        <circle cx="${x}" cy="${y}" r="${r}" fill="#0a0f1d" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
        ${isA ? `
          <!-- Pulsing terminal A badge -->
          <circle cx="${x}" cy="${y}" r="22" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="4,2" opacity="0.85"/>
          <circle cx="${x}" cy="${y}" r="11" fill="#ef4444"/>
          <text x="${x}" y="${y + 4.5}" fill="#ffffff" font-size="12" font-weight="900" font-family="system-ui, sans-serif" text-anchor="middle">A</text>
        ` : isB ? `
          <!-- Pulsing terminal B badge -->
          <circle cx="${x}" cy="${y}" r="22" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="4,2" opacity="0.85"/>
          <circle cx="${x}" cy="${y}" r="11" fill="#3b82f6"/>
          <text x="${x}" y="${y + 4.5}" fill="#ffffff" font-size="12" font-weight="900" font-family="system-ui, sans-serif" text-anchor="middle">B</text>
        ` : `
          <!-- Center socket hole -->
          <circle cx="${x}" cy="${y}" r="4" fill="#333"/>
        `}
        <!-- Green socket number label -->
        <text x="${Number(x) + 15}" y="${Number(y) - 9}" fill="#39FF6A" font-size="12" font-weight="bold" font-family="monospace" paint-order="stroke" stroke="#000000" stroke-width="3">${id}</text>
      </g>`;
  }).join("");

  const currentZoom = typeof liveBoardZoom !== "undefined" ? liveBoardZoom : 1;

  container.innerHTML = `
    <svg viewBox="${BOARD_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;max-height:560px;transform:scale(${currentZoom});transform-origin:top center;transition:transform .2s var(--ease-spring);">
      <image href="${BOARD_IMAGE}" x="0" y="0" width="${imgWidth}" height="${imgHeight}" preserveAspectRatio="xMidYMid meet"/>
      <g id="live-board-wires">${wiresSvg}</g>
      <g id="live-board-sockets">${socketsSvg}</g>
    </svg>`;
}

async function sendTeacherHint() {
  const input = document.getElementById("liveHintInput");
  if (!input || !input.value.trim()) {
    toast("Please enter a hint or note.");
    return;
  }
  if (!selectedStudentId) {
    toast("No student currently selected.");
    return;
  }

  const hint = input.value.trim();
  const u = window.currentUser || {};
  const teacherName = u.name || "Faculty Instructor";

  if (liveClassroomWs && liveClassroomWs.readyState === WebSocket.OPEN) {
    liveClassroomWs.send(JSON.stringify({
      type: "teacher_hint",
      student_id: selectedStudentId,
      hint: hint,
      teacher_name: teacherName,
    }));
  } else {
    // REST fallback
    await api("/api/live-classroom/send-hint", {
      method: "POST",
      body: {
        student_id: selectedStudentId,
        hint: hint,
      },
    });
    toast("✅ Live hint sent via secure channel.");
  }

  input.value = "";
}

// Export functions to global scope
Object.assign(window, {
  LiveCircuitSync,
  renderLiveClassroom,
  selectLiveStudent,
  zoomLiveBoard,
  resetLiveBoardZoom,
  fullscreenLiveBoard,
  sendTeacherHint,
  fetchLiveStudentsRest,
});
