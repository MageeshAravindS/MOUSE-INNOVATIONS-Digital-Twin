
// CHANGE: app.js is loaded as type="module" (see index.html), so it can
// import the same Supabase client supabase-auth.js uses. This is needed
// so doSignOut() can end the real Supabase session -- without this,
// logging out only cleared localStorage, and the next page load would
// find the still-live Supabase session and silently log the user back in.
import { supabase } from "./supabase.js";

// ====== CONFIG ======
// Point this at your backend. For local dev with the included backend, leave as-is.
// When you deploy the backend (e.g. to Render), change this to that URL.
const API_BASE = (window.EDUNEXUS_API_BASE) || 'http://127.0.0.1:8123';

// ====== STATE ======
let token = localStorage.getItem('edunexus_token') || null;
let currentUser =
  JSON.parse(
    localStorage.getItem('edunexus_google_user')
  ) || {
    name: "",
    email: "",
    role: "student",
    completion: 100,
    skills: []
  };

window.currentUser = currentUser;
window.token = token;
let loginMode = 'login'; // 'login' | 'signup'

// ====== API HELPER ======
async function api(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Could not reach the server. Is the backend running at ' + API_BASE + '?');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    const msg = (data && data.detail) ? data.detail : `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

// app.js runs as a module (see comment above), so its top-level bindings
// (api, API_BASE) are NOT automatically visible to the classic <script>
// files (assessment.js, experiment.js, report.js, ai.js). Expose them here
// so those files can keep using the bare identifiers they already rely on.
window.api = api;
window.API_BASE = API_BASE;

// ====== RELAY / WEB SERIAL PORT HANDOFF ======
// The relay (backend, via a dedicated pyserial connection) and the
// wiring/resistance-bank scanner (this browser tab, via Web Serial) can
// both need the SAME physical COM port on the SAME Arduino — a COM port
// can only be held open by one process at a time. Right before this tab
// requests a new Web Serial connection, it calls this to ask the backend
// to release its hold on that port (e.g. left open after a prior staff
// approval/rejection cycle), so the browser doesn't hit an "Access is
// denied" error. Best-effort: if the backend isn't reachable or has
// nothing open, this is a harmless no-op — connect proceeds either way.
async function releaseRelayPort() {
  try {
    await api('/relay/release', { method: 'POST' });
    console.log('[Relay handoff] Backend released the relay COM port.');
  } catch (e) {
    console.warn('[Relay handoff] Could not reach backend to release relay port (continuing anyway):', e.message);
  }
}
window.releaseRelayPort = releaseRelayPort;

// ====== TOAST ======
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2600);
}

// ====== WELCOME MODAL (shown once, right after login) ======
function showWelcomeModal(role, email, name) {
  const isStaff = role === 'staff';
  const displayName = name || email.split('@')[0];
  const firstName = escapeHtml(displayName.split(' ')[0]);
  const initials = getInitials(displayName);

  // CHANGE: one-time <style> injection for the welcome modal's avatar
  // pop-in animation. Guarded by id so it's only ever appended once, even
  // though showWelcomeModal() can run again on a later login.
  if (!document.getElementById('welcome-modal-anim-style')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'welcome-modal-anim-style';
    styleTag.textContent = `
      @keyframes welcomeAvatarPop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
      .welcome-modal-avatar{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:22px;font-weight:600;color:#fff;letter-spacing:.02em;animation:welcomeAvatarPop .45s cubic-bezier(.34,1.56,.64,1)}
    `;
    document.head.appendChild(styleTag);
  }

const logo =
    role === "staff"
        ? "assets/sidebar_logo_staff.png"
        : "assets/sidebar_logo_student.png";

const overlay = document.createElement("div");

overlay.className = "welcome-modal-overlay";

overlay.innerHTML = `
<div class="welcome-modal-card">

    <div class="welcome-modal-banner ${isStaff ? "staff" : "student"}">

        <img
            src="${logo}"
            style="
                width:120px;
                border-radius:15px;
                margin-bottom:15px;
            ">

        <div class="welcome-modal-role">
            ${
                isStaff
                ? "👨‍🏫 Staff Portal"
                : "🎓 Student Portal"
            }
        </div>

        <div class="welcome-modal-title">
            Welcome Back,
            ${firstName}!
        </div>

    </div>

    <div class="welcome-modal-body">

        <div class="welcome-modal-email">
            ${escapeHtml(email)}
        </div>

        <button
            class="btn btn-primary"
            style="width:100%"
            id="welcome-modal-continue">

            Continue

        </button>

    </div>

</div>
`;

document.body.appendChild(overlay);

  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#welcome-modal-continue').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  requestAnimationFrame(() => overlay.classList.add('show'));
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
}

// ====== AUTH ======
async function doSignup(email, password, name) {
  try {
    const data = await api('/auth/signup', { method: 'POST', auth: false, body: { email, password, role: loginRole, name } });
    onAuthSuccess(data);
  } catch (e) {
    showLoginError(e.message);
  }
}

async function doLogin(email, password) {
  try {
    const data = await api('/auth/login', { method: 'POST', auth: false, body: { email, password } });
    onAuthSuccess(data);
  } catch (e) {
    showLoginError(e.message);
  }
}

function onAuthSuccess(data) {

    token = data.token;
    window.token = token;
    currentUser = data.user;
    window.currentUser = currentUser;

    localStorage.setItem("edunexus_token", token);

    localStorage.setItem(
        "edunexus_google_user",
        JSON.stringify(currentUser)
    );

    renderApp();
  
  // ====== AI VISIBILITY CONTROL ======
  updateAIVisibility();
}

async function tryAutoLogin() {

  // Path 1: FastAPI-backend email/password login (JWT in edunexus_token).
  if (token) {
    try {
      currentUser = await api('/auth/me');
      window.currentUser = currentUser;
      return true;
    } catch (e) {
      token = null;
      window.token = null;
      localStorage.removeItem('edunexus_token');
      // fall through and also check the Supabase path below, in case
      // both happen to be present.
    }
  }

  // Path 2: Supabase-authenticated user (Google OAuth, or Supabase
  // email/password via supabase-auth.js). These never get an
  // edunexus_token, so without this check boot() always fell back to
  // renderLogin() and the user appeared logged out after every refresh.
  const googleUser = localStorage.getItem('edunexus_google_user');
  if (googleUser) {
    try {
      currentUser = JSON.parse(googleUser);
      window.currentUser = currentUser;
      return true;
    } catch (e) {
      localStorage.removeItem('edunexus_google_user');
    }
  }

  return false;
}

async function doSignOut() {
  token = null;
  window.token = null;
  currentUser = null;
  window.currentUser = null;

  localStorage.removeItem('edunexus_token');
  localStorage.removeItem('edunexus_google_user');

  // CHANGE: also end the actual Supabase session. Previously this only
  // cleared localStorage, so a Google-authenticated user who clicked
  // "Sign out" would be logged straight back in on the next refresh --
  // the Supabase session cookie/token was still valid, and
  // supabase-auth.js would find it and repopulate everything.
  try {
    await supabase.auth.signOut();
  } catch (e) {
    // no active Supabase session, or network hiccup -- safe to ignore,
    // localStorage is already cleared above.
  }

  // ====== AI VISIBILITY CONTROL ======
  updateAIVisibility();

  window.location.reload();
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ====== NAV ======
function goto(page) {


if(
window.expRunning
&&
page !== "experiments"
){

showExperimentExitPopup(page);

return;

}



if(
window.assessmentRunning
&&
page !== "assessment"
){

showAssessmentExitPopup(page);

return;

}
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  const pc = document.getElementById('page-' + page);
  if (pc) pc.classList.add('active');
  const nav = document.getElementById('nav-' + page);
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', projects: 'Projects', theory: 'Theory', experiments: 'Experiments', assessment: 'Smart Laboratory Assessment Center', 'live-classroom': 'Live Lab Classroom & Circuit Monitor', profile: 'My Profile', students: 'All Students', announce: 'Announcements' };
  const tt = document.getElementById('topbar-title');
  if (tt) tt.textContent = titles[page] || page;
  const pages = document.querySelector('.pages');
  if (pages) pages.scrollTop = 0;

  // CHANGE: remember the page so a refresh doesn't always dump the user
  // back on the dashboard (see restore logic in renderApp()). Experiments
  // and assessment are excluded since they have their own running-state
  // start flow that a plain goto() on reload can't safely reconstruct.
  if (page !== 'experiments' && page !== 'assessment') {
    localStorage.setItem('edunexus_last_page', page);
  }

 if(page==="theory"){
 showTheory();
 }
 if(page==="announce"){
 loadAnnouncements();
 }
 if(page==="live-classroom" && typeof renderLiveClassroom === "function"){
 renderLiveClassroom();
 }


// ====== AI VISIBILITY CONTROL ======
updateAIVisibility();

}

// ====== PROFILE ======
async function saveProfile() {
  const btn = document.getElementById('save-profile-btn');
  const data = {
    name: document.getElementById('f-name')?.value || '',
    bio: document.getElementById('f-bio')?.value || '',
    university: document.getElementById('f-university')?.value || '',
    phone: document.getElementById('f-phone')?.value || '',
    department: document.getElementById('f-dept')?.value || '',
    graduation_year: document.getElementById('f-grad')?.value || '',
    subject: document.getElementById('f-subject')?.value || '',
  };
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }
  try {
    currentUser = await api('/profile', { method: 'PUT', body: data });
    window.currentUser = currentUser;
    refreshProfileUI();
    toast('Profile saved to server!');
  } catch (e) {
    toast('Could not save: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy" aria-hidden="true"></i> Save'; }
  }
}

function refreshProfileUI() {
  const name = currentUser.name || currentUser.email;
  const pct = currentUser.completion;
  document.getElementById('p-name-display') && (document.getElementById('p-name-display').textContent = name);
  document.getElementById('p-bio-display') && (document.getElementById('p-bio-display').textContent = currentUser.bio || 'No bio added yet.');
  document.getElementById('sb-uname') && (document.getElementById('sb-uname').textContent = name);
  document.getElementById('p-avatar') && (document.getElementById('p-avatar').textContent = getInitials(name));
  const fill = document.getElementById('p-prog-fill');
  const pctEl = document.getElementById('p-completion-pct');
  const stat = document.getElementById('completion-stat');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (stat) stat.textContent = pct + '%';
}

function renderSkills(skills) {
  const wrap = document.getElementById('skills-wrap');
  if (!wrap) return;
  wrap.innerHTML = skills.map((s, i) =>
    `<span class="skill-tag">${escapeHtml(s)}<button class="skill-rm" onclick="removeSkill(${i})" aria-label="Remove ${escapeHtml(s)}">×</button></span>`
  ).join('');
  const stat = document.getElementById('skill-count-stat');
  if (stat) stat.textContent = skills.length;
}

async function addSkill() {
  const inp = document.getElementById('skill-input');
  const val = inp.value.trim();
  if (!val) return;
  try {
    const data = await api('/profile/skills', { method: 'POST', body: { skill: val } });
    currentUser.skills = data.skills;
    renderSkills(currentUser.skills);
    inp.value = '';
    currentUser.completion = computeLocalCompletion();
    refreshProfileUI();
    toast('Skill saved!');
  } catch (e) {
    toast(e.message);
  }
}

async function removeSkill(idx) {
  try {
    const data = await api('/profile/skills/' + idx, { method: 'DELETE' });
    currentUser.skills = data.skills;
    renderSkills(currentUser.skills);
    currentUser.completion = computeLocalCompletion();
    refreshProfileUI();
    toast('Skill removed.');
  } catch (e) {
    toast(e.message);
  }
}

function computeLocalCompletion() {
  const fields = [currentUser.name, currentUser.bio, currentUser.university, currentUser.phone];
  const filled = fields.filter(f => f && f.trim()).length;
  const hasSkills = (currentUser.skills || []).length > 0 ? 1 : 0;
  return Math.round(((filled + hasSkills) / (fields.length + 1)) * 100);
}

// ====== STUDENTS (staff) ======
async function loadStudents() {
  const wrap = document.getElementById('students-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-state">Loading students…</div>';
  try {
    const students = await api('/students');
    document.getElementById('total-students-stat') && (document.getElementById('total-students-stat').textContent = students.length);
    document.getElementById('student-count-badge') && (document.getElementById('student-count-badge').textContent = students.length);
    if (students.length === 0) {
      wrap.innerHTML = '<p class="empty-state">No students have registered yet.</p>';
      return;
    }
    wrap.innerHTML = `<table class="students-table">
      <thead><tr><th>Student</th><th>Email</th><th>University</th><th>Skills</th><th>Completion</th></tr></thead>
      <tbody>${students.map(s => `<tr>
        <td><span class="s-mini-av">${getInitials(s.name)}</span>${escapeHtml(s.name || '—')}</td>
        <td style="color:var(--color-text-secondary)">${escapeHtml(s.email)}</td>
        <td style="color:var(--color-text-secondary)">${escapeHtml(s.university || '—')}</td>
        <td><span class="skill-pill">${(s.skills || []).length} skills</span></td>
        <td>${s.completion}%</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (e) {
    wrap.innerHTML = `<p class="empty-state">Couldn't load students: ${escapeHtml(e.message)}</p>`;
  }
}





// ====== PROJECTS ======
let appliedProjectIds = new Set();

async function loadProjects() {
  const grid = document.getElementById('proj-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty-state">Loading projects…</div>';
  try {
    const [projects, myApps] = await Promise.all([
      api('/projects', { auth: false }),
      currentUser ? api('/projects/applications/me').catch(() => ({ project_ids: [] })) : Promise.resolve({ project_ids: [] }),
    ]);
    appliedProjectIds = new Set(myApps.project_ids || []);
    grid.innerHTML = projects.map(p => {
      const applied = appliedProjectIds.has(p.id);
      const diffClass = 'diff-' + (p.difficulty || 'Intermediate').toLowerCase();
      return `<div class="proj-card">
        <div class="proj-head"><div class="proj-ico" style="background:${p.icon_bg}">${p.icon}</div><div><div class="proj-title">${escapeHtml(p.title)}</div><div class="proj-co">${escapeHtml(p.company)} · ${escapeHtml(p.location)}</div></div></div>
        <div class="proj-desc">${escapeHtml(p.description)}</div>
        <div class="proj-skills">${(p.skills || []).map(s => `<span class="skill-pill">${escapeHtml(s)}</span>`).join('')}</div>
        <div class="proj-footer">
          <span class="diff ${diffClass}">${escapeHtml(p.difficulty)}</span>
          <button class="btn btn-primary btn-sm" ${applied ? 'disabled' : ''} onclick="applyToProject(${p.id}, this)">${applied ? 'Applied ✓' : 'Apply'}</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<p class="empty-state">Couldn't load projects: ${escapeHtml(e.message)}</p>`;
  }
}

async function applyToProject(id, btnEl) {
  if (!currentUser) { toast('Please sign in first.'); return; }
  try {
    await api(`/projects/${id}/apply`, { method: 'POST' });
    appliedProjectIds.add(id);
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Applied ✓'; }
    toast('Application submitted!');
  } catch (e) {
    toast(e.message);
  }
}




// ====== STATS ======
async function loadStats() {
  try {
    const stats = await api('/stats');
    if ((currentUser?.role || 'student') === 'staff') {
      document.getElementById('total-students-stat') && (document.getElementById('total-students-stat').textContent = stats.total_students);
      document.getElementById('annc-count-stat') && (document.getElementById('annc-count-stat').textContent = stats.announcements_posted);
      document.getElementById('active-projects-stat') && (document.getElementById('active-projects-stat').textContent = stats.active_projects);
      document.getElementById('avg-completion-stat') && (document.getElementById('avg-completion-stat').textContent = stats.avg_completion + '%');
      document.getElementById('dash-avg-fill') && (document.getElementById('dash-avg-fill').style.width = stats.avg_completion + '%');
    } else {
      document.getElementById('completion-stat') && (document.getElementById('completion-stat').textContent = stats.completion + '%');
      document.getElementById('skill-count-stat') && (document.getElementById('skill-count-stat').textContent = stats.skills);
      document.getElementById('projects-applied-stat') && (document.getElementById('projects-applied-stat').textContent = stats.projects_applied);
      document.getElementById('dash-completion-fill') && (document.getElementById('dash-completion-fill').style.width = stats.completion + '%');
    }
  } catch (e) { /* non-fatal */ }
}




// ====== UTIL ======
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}




// ====== LOGIN / SIGNUP SCREEN ======
function setLoginMode(mode) {
  loginMode = mode;
  document.querySelectorAll('.login-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + mode)?.classList.add('active');
  const submitBtn = document.getElementById('auth-submit-btn');
  if (submitBtn) submitBtn.textContent = mode === 'signup' ? 'Create Account' : 'Login';
  document.getElementById('login-error').style.display = 'none';
}

function submitAuthForm() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !email.includes('@')) { showLoginError('Please enter a valid email address.'); return; }
  if (!password || password.length < 6) { showLoginError('Password must be at least 6 characters.'); return; }
if (loginMode === "signup") {
    doSignup(email, password);
} else {
    doLogin(email, password);
}
}

function renderLogin() {
  document.getElementById('root').innerHTML = `
  <div class="login-wrap">
    <div class="login-card">

<div class="login-logo">
    <div class="login-logo-icon">M</div>
    <div class="login-logo-text">MOUSE INNOVATION</div>
</div>
      <div class="login-title">Welcome Back</div>

      <!-- Sign In / Create Account tabs -->
      <div class="login-tabs" style="margin-bottom:18px">
        <button id="tab-login" class="login-tab active" onclick="setLoginMode('login')">Sign In</button>
        <button id="tab-signup" class="login-tab" onclick="setLoginMode('signup')">Create Account</button>
      </div>

      <!-- Email -->
      <div class="login-section">
        <input id="auth-email" class="login-input" type="email" placeholder="Email">
      </div>

      <!-- Password -->
      <div class="login-section">
        <input id="auth-password" class="login-input" type="password" placeholder="Password">
      </div>

      <!-- Submit button -->
      <button id="auth-submit-btn" class="login-btn student-btn" onclick="submitAuthForm()">
        Login
      </button>

      <div class="login-divider"><span>or continue with</span></div>

      <!-- Google login -->
      <button class="login-btn login-btn-google" onclick="googleLoginSupabase()">
        <svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v8.51h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.14z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.16C6.51 42.62 14.62 48 24 48z"/><path fill="#FBBC05" d="M10.53 28.59c-.5-1.45-.79-3-.79-4.59s.29-3.14.79-4.59l-7.98-6.16C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.75l7.97-6.16z"/><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.16C12.43 13.72 17.74 9.5 24 9.5z"/></svg>
        Continue with Google
      </button>

      <!-- Forgot password -->
      <button class="login-forgot-btn" onclick="forgotPassword()">
        Forgot Password?
      </button>

      <div id="login-error" class="login-error"></div>

    </div>
  </div>`;
}

// ====== MAIN APP RENDER ======
// CHANGE: dashboard "Recent Activity" card content. Reads the same
// localStorage("announcements") data announcements.js already writes, so
// this reflects real activity instead of placeholder/fake content.
function getDashboardActivityHTML(){
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem('announcements') || '[]');
  } catch (e) {
    items = [];
  }

  items = items.slice().sort((a, b) => b.id - a.id).slice(0, 3);

  if (items.length === 0) {
    return `<p class="empty-state">No recent activity yet.</p>`;
  }

  return items.map(a => `
    <div class="annc-item">
      <div class="annc-title">${escapeHtml(a.title)}</div>
      <div class="annc-meta">${escapeHtml(a.created || '')}</div>
    </div>
  `).join('');
}

function getExperimentHubHtml() {
  return `
  <div class="exp-header-banner" style="margin-bottom:24px;">
    <div class="exp-title-group">
      <div class="exp-icon-gem" style="background: linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(99, 102, 241, 0.25)); border-color: rgba(99, 102, 241, 0.4); color: #38bdf8;">
        <i class="ti ti-flask"></i>
      </div>
      <div>
        <div class="exp-badge">Interactive Digital Twin Laboratories · AI Supervised</div>
        <h1 class="exp-heading">Virtual & Hardware Laboratory Modules</h1>
      </div>
    </div>
  </div>

  <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:20px;">
    <!-- POWER ELECTRONICS CARD -->
    <div class="card" style="display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden; border: 1px solid var(--border-glass-bright); background: var(--bg-surface-glass); backdrop-filter: blur(24px);">
      <div style="position:absolute; top:-30px; right:-30px; width:120px; height:120px; background:radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%); pointer-events:none;"></div>
      <div>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <div style="width:40px; height:40px; border-radius:12px; background:rgba(245, 158, 11, 0.15); border:1px solid rgba(245, 158, 11, 0.3); color:#f59e0b; display:flex; align-items:center; justify-content:center; font-size:20px;">
            <i class="ti ti-bolt"></i>
          </div>
          <div>
            <span class="exp-badge" style="background:rgba(245, 158, 11, 0.12); color:#f59e0b; border-color:rgba(245, 158, 11, 0.25);">Hardware + Virtual CRO</span>
            <h2 style="font-size:17px; font-weight:700; color:var(--text-primary); margin-top:2px;">Power Electronics Trainer</h2>
          </div>
        </div>
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.6; margin-bottom:16px;">
          Explore half-wave, full-wave, bridge rectifiers, and DC-DC converters. Wire components interactively, monitor live waveforms on the digital CRO, and verify with hardware in the loop.
        </p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px;">
          <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-tertiary);">Rectifiers</span>
          <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-tertiary);">Buck & Boost</span>
          <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-tertiary);">Inverter DC/AC</span>
        </div>
      </div>
      <div>
        <button class="btn btn-primary" style="width:100%; padding:10px 16px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="loadPowerExperiment()">
          <span>Launch Power Converter Kit</span>
          <i class="ti ti-arrow-right"></i>
        </button>
        <div id="experiment-area" style="margin-top:16px"></div>
      </div>
    </div>

    <!-- RESISTANCE BANK CARD -->
    <div class="card" style="display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden; border: 1px solid var(--border-glass-bright); background: var(--bg-surface-glass); backdrop-filter: blur(24px);">
      <div style="position:absolute; top:-30px; right:-30px; width:120px; height:120px; background:radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%); pointer-events:none;"></div>
      <div>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <div style="width:40px; height:40px; border-radius:12px; background:rgba(99, 102, 241, 0.15); border:1px solid rgba(99, 102, 241, 0.3); color:#818cf8; display:flex; align-items:center; justify-content:center; font-size:20px;">
            <i class="ti ti-circuit-resistor"></i>
          </div>
          <div>
            <span class="exp-badge" style="background:rgba(99, 102, 241, 0.12); color:#818cf8; border-color:rgba(99, 102, 241, 0.25);">Nodal Laplacian Solver</span>
            <h2 style="font-size:17px; font-weight:700; color:var(--text-primary); margin-top:2px;">Resistance Bank Trainer</h2>
          </div>
        </div>
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.6; margin-bottom:16px;">
          Jumper resistors in complex series, parallel, and delta-wye configurations. Calculate equivalent Thevenin resistance (Rth) with zero tolerance grading and AI assistance.
        </p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px;">
          <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-tertiary);">Graph Union-Find</span>
          <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-tertiary);">Linear Systems (AX=B)</span>
          <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:var(--text-tertiary);">Live Web Serial</span>
        </div>
      </div>
      <div>
        <button class="btn btn-primary" style="width:100%; padding:10px 16px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="loadResistanceBankExperiment()">
          <span>Launch Resistance Bank Kit</span>
          <i class="ti ti-arrow-right"></i>
        </button>
        <div id="rb-experiment-area" style="margin-top:16px"></div>
      </div>
    </div>
  </div>
  `;
}

function renderExperimentHub() {
  const page = document.getElementById("page-experiments");
  if (page) {
    page.innerHTML = getExperimentHubHtml();
  }
}

function renderApp() {

  // Ensure the in-memory token is always in sync with localStorage.
  // This matters when renderApp() is called after a Google login reload.
  if (!token) {
    const t = localStorage.getItem('edunexus_token');
    if (t) token = t;
  }
  window.token = token;

  currentUser =
    JSON.parse(
      localStorage.getItem('edunexus_google_user')
    ) || currentUser;

  // CHANGE: keep window.currentUser in sync. assessment.js and
  // announcements.js are plain (non-module) scripts that read
  // currentUser as a global -- without this, they'd see a stale or
  // undefined value even though app.js's own module-scoped copy is
  // correct.
  window.currentUser = currentUser;

  const profile = currentUser;
  const role = profile.role;
  const name = profile.name || profile.email;
  const initials = getInitials(name);
  const pct = profile.completion;
  const skills = profile.skills || [];

  // Show the role-based welcome popup once, right after a fresh login.
  const pendingWelcome = localStorage.getItem('edunexus_welcome_role');
  if (pendingWelcome) {
    localStorage.removeItem('edunexus_welcome_role');
    setTimeout(() => showWelcomeModal(role, profile.email, profile.name), 400);
  }
document.getElementById("root").innerHTML = `

<div id="app">

    <div id="sideBar" class="sidebar">

      <!-- SLEEK COMPACT BRAND LOCKUP (Replaces bulky card) -->
      <div class="sb-brand-lockup" title="Mouse Innovations · Digital Twin Lab">
        <div class="sb-brand-icon-wrap">
          <img
            class="sb-brand-icon"
            src="assets/app_logo_icon.png"
            alt="EduNexus Robot"
            onerror="this.src='assets/robot_student.png'">
        </div>
        <div class="sb-brand-info">
          <div class="sb-brand-title">MOUSE INNOVATIONS</div>
          <div class="sb-brand-sub">
            <span class="sb-role-badge ${role === 'staff' ? 'staff' : 'student'}">
              <i class="ti ${role === 'staff' ? 'ti-school' : 'ti-user-check'}"></i>
              ${role === 'staff' ? 'Staff / Teacher' : 'Student'}
            </span>
          </div>
        </div>
      </div>

      <div class="sb-sect">Main</div>
      <div class="sb-item active" id="nav-dashboard" onclick="goto('dashboard');loadStats()"><i class="ti ti-layout-dashboard" aria-hidden="true"></i> Dashboard</div>
      <div class="sb-item" id="nav-projects" onclick="goto('projects');loadProjects()"><i class="ti ti-folder" aria-hidden="true"></i> Projects</div>
      <div class="sb-item" id="nav-theory" onclick="goto('theory')"><i class="ti ti-book" aria-hidden="true"></i> Theory</div>
      <div class="sb-item" id="nav-experiments" onclick="goto('experiments')"><i class="ti ti-flask" aria-hidden="true"></i> Experiments</div>
      <div class="sb-item" id="nav-assessment" onclick="goto('assessment');renderAssessmentDashboard()"><i class="ti ti-clipboard-check" aria-hidden="true"></i> Assessment</div>

      ${role === 'student' ? `
      <div class="sb-sect">Personal</div>


<div
class="sb-item"
id="nav-announce"
onclick="goto('announce')">

<i class="ti ti-bell"></i>

Announcements

</div>



<div
class="sb-item"
id="nav-profile"
onclick="goto('profile')">

<i class="ti ti-user"></i>

My Profile

</div>
      ` : `
      <div class="sb-sect">Management</div>
      <div class="sb-item" id="nav-live-classroom" onclick="goto('live-classroom');if(typeof renderLiveClassroom==='function')renderLiveClassroom()"><i class="ti ti-broadcast" style="color:#ef4444;" aria-hidden="true"></i> Live Lab Monitor <span class="sb-badge live-badge" id="live-students-count" style="display:none;background:#ef4444;color:#fff;">0</span></div>
      <div class="sb-item" id="nav-students" onclick="goto('students');loadStudents()"><i class="ti ti-users" aria-hidden="true"></i> Students <span class="sb-badge" id="student-count-badge">—</span></div>
      <div class="sb-item" id="nav-announce" onclick="goto('announce')"><i class="ti ti-bell" aria-hidden="true"></i> Announcements</div>
      <div class="sb-item" id="nav-profile" onclick="goto('profile')"><i class="ti ti-user" aria-hidden="true"></i> My Profile</div>
      `}

      <div class="sb-footer">
        <div class="sb-user">
          <div class="sb-av">${initials}</div>
          <div>
            <div class="sb-uname" id="sb-uname">${escapeHtml(name)}</div>
            <div class="sb-urole">${role === 'staff' ? 'Staff / Teacher' : 'Student'}</div>
          </div>
        </div>
      </div>
</div>

<button class="sidebar-toggle" onclick="toggleSideBar()" title="Collapse sidebar">
    <i class="ti ti-chevron-left" aria-hidden="true"></i>
</button>

<div class="main">
      <div class="topbar">
        <span class="topbar-title" id="topbar-title">Dashboard</span>
        <div class="tb-right">
          <!-- THEME TOGGLE (Daybreak Light / Cosmic Dark) -->
          <button class="theme-toggle-btn" onclick="toggleTheme()" id="themeToggleBtn" title="Toggle Light / Dark Mode" aria-label="Toggle theme">
            <i class="ti ti-sun" id="themeIcon"></i>
            <span class="theme-label" id="themeLabel">Light Mode</span>
          </button>
          <span class="cloud-tag"><i class="ti ti-cloud" aria-hidden="true"></i> Connected to server</span>
          <button class="btn-signout" onclick="doSignOut()">Sign out</button>
        </div>
      </div>

      <div class="pages">

        <!-- DASHBOARD -->
        <div class="page active" id="page-dashboard">
          <div class="welcome-banner${role === 'staff' ? ' staff' : ''}">
            <div>
              <div class="wb-title">Welcome back, ${escapeHtml(name.split(' ')[0])}! <i class="ti ti-hand-stop" aria-hidden="true"></i></div>
              <div class="wb-sub">${role === 'staff' ? 'Manage students and post announcements.' : 'Your profile is synced to the server. Keep it updated!'}</div>
            </div>
            <button class="btn-wb" onclick="goto('profile')">${role === 'staff' ? 'Edit my profile' : 'Update profile'}</button>
          </div>

          ${role === 'student' ? `
          <div class="stat-grid">
            <div class="stat-card">
              <div class="stat-label">Profile complete</div>
              <div class="stat-val" id="completion-stat">${pct}%</div>
              <div class="prog-bar-wrap" style="margin-top:8px"><div class="prog-bar-fill" id="dash-completion-fill" style="width:${pct}%"></div></div>
            </div>
            <div class="stat-card"><div class="stat-label">Skills</div><div class="stat-val" id="skill-count-stat">${skills.length}</div><div class="stat-sub">from your profile</div></div>
            <div class="stat-card"><div class="stat-label">Projects applied</div><div class="stat-val" id="projects-applied-stat">—</div><div class="stat-sub">This semester</div></div>
            <div class="stat-card"><div class="stat-label">Certifications</div><div class="stat-val">0</div><div class="stat-sub">Coming soon</div></div>
          </div>
          <div class="card">
            <div class="card-title">Quick actions</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primary" onclick="goto('profile')"><i class="ti ti-edit" aria-hidden="true"></i> Edit profile</button>
              <button class="btn" onclick="goto('projects');loadProjects()"><i class="ti ti-rocket" aria-hidden="true"></i> Browse projects</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Recent Activity <button class="btn" style="padding:4px 10px;font-size:11px" onclick="goto('announce')">View all</button></div>
            ${getDashboardActivityHTML()}
          </div>
          ` : `
          <div class="stat-grid">
            <div class="stat-card"><div class="stat-label">Total students</div><div class="stat-val" id="total-students-stat">—</div><div class="stat-sub">Registered</div></div>
            <div class="stat-card"><div class="stat-label">Announcements</div><div class="stat-val" id="annc-count-stat">0</div><div class="stat-sub">Posted by you</div></div>
            <div class="stat-card"><div class="stat-label">Active projects</div><div class="stat-val" id="active-projects-stat">—</div><div class="stat-sub">This semester</div></div>
            <div class="stat-card">
              <div class="stat-label">Avg completion</div>
              <div class="stat-val" id="avg-completion-stat">—</div>
              <div class="prog-bar-wrap" style="margin-top:8px"><div class="prog-bar-fill" id="dash-avg-fill" style="width:0%"></div></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Quick actions</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-green" onclick="goto('students');loadStudents()"><i class="ti ti-users" aria-hidden="true"></i> View all students</button>
              <button class="btn btn-primary" onclick="goto('announce')"><i class="ti ti-bell" aria-hidden="true"></i> Post announcement</button>
              <button class="btn" onclick="goto('profile')"><i class="ti ti-edit" aria-hidden="true"></i> Edit my profile</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Recent Activity <button class="btn" style="padding:4px 10px;font-size:11px" onclick="goto('announce')">View all</button></div>
            ${getDashboardActivityHTML()}
          </div>
          `}
        </div>

        <!-- PROJECTS -->
        <div class="page" id="page-projects">
          <div class="welcome-banner">
            <div>
              <div class="wb-title">Project Marketplace</div>
              <div class="wb-sub">Real-world industry projects. Apply and build your portfolio.</div>
            </div>
          </div>
          <div class="proj-grid" id="proj-grid"><div class="empty-state">Loading projects…</div></div>
        </div>

<!-- THEORY -->
<div class="page" id="page-theory">


<div class="welcome-banner">

<div>

<div class="wb-title">
Theory Library
</div>


<div class="wb-sub">
Concept notes and references for every lab kit
</div>


</div>


${
role==="staff"
?
`

<button
class="btn-wb"
onclick="addTheory()">

+ Add Theory

</button>

`
:
""
}


</div>



<div id="theoryList">

</div>


</div>

       <!-- EXPERIMENTS -->
        <div class="page" id="page-experiments">
          ${getExperimentHubHtml()}
        </div>

        <!-- ASSESSMENT -->
        <div class="page" id="page-assessment"></div>

        <!-- LIVE LAB CLASSROOM / REAL-TIME CIRCUIT MONITOR (Teacher/Staff) -->
        <div class="page" id="page-live-classroom"></div>

        <!-- LEVEL 2: TARGET RESISTANCE CHALLENGE -->
        <div class="page" id="page-level2"></div>

        <!-- PROFILE -->
        <div class="page" id="page-profile">
          <div class="p-layout">
            <div class="p-card">
              <div class="p-av" id="p-avatar">${initials}</div>
              <div class="p-name" id="p-name-display">${escapeHtml(name)}</div>
              <div class="p-email">${escapeHtml(currentUser.email)}</div>
              <div class="role-pill${role === 'staff' ? ' staff' : ''}">${role === 'staff' ? 'Staff / Teacher' : 'Student'}</div>
              <div class="p-bio" id="p-bio-display">${escapeHtml(profile.bio) || 'No bio added yet.'}</div>
              <div style="text-align:left;margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:500;color:var(--color-text-secondary);margin-bottom:4px"><span>Profile completeness</span><span id="p-completion-pct">${pct}%</span></div>
                <div class="prog-bar-wrap"><div class="prog-bar-fill" id="p-prog-fill" style="width:${pct}%"></div></div>
              </div>
              <button class="p-action danger" onclick="doSignOut()"><i class="ti ti-logout" aria-hidden="true"></i> Sign out</button>
            </div>
            <div>
              <div class="card">
                <div class="card-title">Personal information <button class="btn btn-primary btn-sm" id="save-profile-btn" onclick="saveProfile()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Save</button></div>
                <div class="form-row">
                  <div class="form-group"><label class="form-label">Full name</label><input class="form-input" id="f-name" value="${escapeHtml(profile.name || '')}" placeholder="Your full name"></div>
                  <div class="form-group"><label class="form-label">Email (login)</label><input class="form-input" id="f-email" value="${escapeHtml(currentUser.email)}" readonly></div>
                </div>
                <div class="form-row">
                  <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="f-phone" value="${escapeHtml(profile.phone || '')}" placeholder="+91 9876543210"></div>
                  <div class="form-group"><label class="form-label">${role === 'staff' ? 'Employee ID' : 'Graduation year'}</label><input class="form-input" id="f-grad" value="${escapeHtml(profile.graduation_year || '')}" placeholder="${role === 'staff' ? 'EMP001' : '2026'}"></div>
                </div>
                <div class="form-row">
                  <div class="form-group"><label class="form-label">${role === 'staff' ? 'Institution' : 'University'}</label><input class="form-input" id="f-university" value="${escapeHtml(profile.university || '')}" placeholder="${role === 'staff' ? 'Your institution' : 'BITS Pilani'}"></div>
                  <div class="form-group"><label class="form-label">Department</label><input class="form-input" id="f-dept" value="${escapeHtml(profile.department || '')}" placeholder="Computer Science"></div>
                </div>
                ${role === 'staff' ? `<div class="form-group"><label class="form-label">Subject taught</label><input class="form-input" id="f-subject" value="${escapeHtml(profile.subject || '')}" placeholder="Data Structures"></div>` : '<input type="hidden" id="f-subject">'}
                <div class="form-group"><label class="form-label">Bio</label><textarea class="form-input" id="f-bio" placeholder="Tell others about yourself…">${escapeHtml(profile.bio || '')}</textarea></div>
              </div>
              <div class="card">
                <div class="card-title">Skills</div>
                <div class="skills-wrap" id="skills-wrap"></div>
                <div class="skill-add-row">
                  <input id="skill-input" placeholder="Add skill (e.g. React, Python…)" onkeydown="if(event.key==='Enter')addSkill()">
                  <button class="btn btn-primary btn-sm" onclick="addSkill()">+ Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- STUDENTS (staff) -->
        <div class="page" id="page-students">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div>
              <div style="font-size:17px;font-weight:600;color:var(--color-text-primary)">All Students</div>
              <div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">Live student records from the database</div>
            </div>
            <button class="btn btn-green" onclick="loadStudents()"><i class="ti ti-refresh" aria-hidden="true"></i> Refresh</button>
          </div>
          <div class="card" style="padding:0;overflow:hidden">
            <div id="students-table-wrap" style="padding:16px"><p class="empty-state">Click Refresh to load student records.</p></div>
          </div>
        </div>

       

<!-- ANNOUNCEMENTS -->
<div class="page" id="page-announce">


</div>

      </div>
    </div>
  </div>`;

renderSkills(skills);
loadStats();
updateAIVisibility();

// CHANGE: page memory. Only restore a page that actually has a sidebar
// entry for this user's role (e.g. a student will never have "nav-students"),
// otherwise silently keep the dashboard that's already active by default.
// Also exclude 'assessment' and 'experiments' here -- goto() already
// refuses to *save* those two (see the comment there: they have their own
// running-state start flow a plain goto() on reload can't reconstruct),
// but a value saved before that exclusion existed (or synced from another
// tab) could still be sitting in localStorage. Without this check, that
// stale value silently sent every fresh login straight to the assessment
// or experiments page instead of the dashboard.
const lastPage = localStorage.getItem('edunexus_last_page');
const restorablePages = ['experiments', 'assessment'];
const restorableNav = lastPage && !restorablePages.includes(lastPage) && document.getElementById('nav-' + lastPage);
if (restorableNav) {
  goto(lastPage);
  if (lastPage === 'projects') loadProjects();
  if (lastPage === 'students') loadStudents();
}

  // Update theme toggle button state to match current theme
  updateThemeToggleUI();
}

// ==========================================================================
// THEME SWITCHER SYSTEM (Caelestia Cosmic Dark / Daybreak Light)
// ==========================================================================
function applyTheme(theme) {
  const isLight = theme === 'light';
  if (isLight) {
    document.body.classList.add('light-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.classList.add('light-theme');
    localStorage.setItem('edunexus_theme', 'light');
  } else {
    document.body.classList.remove('light-theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.remove('light-theme');
    localStorage.setItem('edunexus_theme', 'dark');
  }
  updateThemeToggleUI();
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-theme') || document.documentElement.getAttribute('data-theme') === 'light';
  applyTheme(isLight ? 'dark' : 'light');
}

function updateThemeToggleUI() {
  const isLight = document.body.classList.contains('light-theme') || document.documentElement.getAttribute('data-theme') === 'light';
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon) {
    icon.className = isLight ? 'ti ti-moon' : 'ti ti-sun';
  }
  if (label) {
    label.textContent = isLight ? 'Dark Mode' : 'Light Mode';
  }
}

window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.updateThemeToggleUI = updateThemeToggleUI;

// Auto-sync initial theme on load
(function initThemeRuntime() {
  const saved = localStorage.getItem('edunexus_theme') || 'dark';
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (document.body) document.body.classList.add('light-theme');
  }
})();

// CHANGE: renderApp() runs more than once per session (fresh login, and
// again whenever an experiment/assessment exit popup is confirmed - see
// the renderApp() calls that follow confirmExperimentClose/
// confirmAssessmentClose below). Each call used to kick off a brand new
// animate() loop without stopping the previous one, so after a couple of
// renders you'd have several loops fighting over the same two text
// nodes -- that's the "logo typing" glitch. These three module-level
// timer handles let startLogoAnimation() clear out any loop left running
// from an earlier call before starting a fresh one.
let logoAnimationTimer1 = null;
let logoAnimationTimer2 = null;
let logoAnimationLoopTimer = null;

function startLogoAnimation(){

    const line1 = document.getElementById("logoLine1");
    const line2 = document.getElementById("logoLine2");

    if(!line1 || !line2) return;

    clearInterval(logoAnimationTimer1);
    clearInterval(logoAnimationTimer2);
    clearTimeout(logoAnimationLoopTimer);

    const first = "MOUSE ";
    const second = "INNOVATIONS";

    function animate(){

        line1.textContent = "";
        line2.textContent = "";

        let i = 0;
        let j = 0;

        logoAnimationTimer1 = setInterval(() => {

            line1.textContent += first[i];
            i++;

            if(i >= first.length){

                clearInterval(logoAnimationTimer1);

                logoAnimationTimer2 = setInterval(() => {

                    line2.textContent += second[j];
                    j++;

                    if(j >= second.length){

                        clearInterval(logoAnimationTimer2);

                        logoAnimationLoopTimer = setTimeout(animate,7000);

                    }

                },120);

            }

        },120);

    }

    animate();

}






window.loginUser = async function () {

  const email =
    document.getElementById("auth-email").value;

  const password =
    document.getElementById("auth-password").value;

  if (!email || !password) {
    showLoginError("Enter email and password");
    return;
  }

  await emailLogin(email, password);
};

window.signupUser = async function () {

  const email =
    document.getElementById("auth-email").value;

  const password =
    document.getElementById("auth-password").value;

  if (!email || !password) {
    showLoginError("Enter email and password");
    return;
  }

  if (password.length < 6) {
    showLoginError(
      "Password must be at least 6 characters"
    );
    return;
  }

  await emailSignup(email, password);
};

window.forgotPassword = async function () {

  const email =
    document.getElementById("auth-email").value;

  if (!email) {
    showLoginError(
      "Enter email first"
    );
    return;
  }

  await resetPassword(email);
};

// ================================
// EXPERIMENT EXIT CENTER POPUP
// ================================

function showExperimentExitPopup(nextPage){


let old =
document.getElementById(
"experimentExitPopup"
);


if(old){
old.remove();
}



let box =
document.createElement(
"div"
);



box.id =
"experimentExitPopup";



box.className =
"welcome-modal-overlay show";



box.innerHTML = `


<div class="welcome-modal-card">


<div class="welcome-modal-banner student">


<div class="welcome-modal-emoji">
⚡
</div>


<div class="welcome-modal-role">

Experiment Running

</div>


<div class="welcome-modal-title">

Close Virtual Lab?

</div>


</div>



<div class="welcome-modal-body">


<div 
style="
font-size:13px;
color:#64748b;
margin-bottom:20px;
line-height:1.6;
">


Your current experiment session will be closed.


</div>



<button 
class="btn btn-primary"
style="width:100%;justify-content:center"
onclick="confirmExperimentClose('${nextPage}')">

Yes, Close Experiment

</button>


<br><br>


<button
class="btn"
style="width:100%;justify-content:center"
onclick="cancelExperimentClose()">

Continue Experiment

</button>



</div>


</div>


`;



document.body.appendChild(
box
);



}




function confirmExperimentClose(page){
  let pop = document.getElementById("experimentExitPopup");
  if(pop){
    pop.remove();
  }

  // RESET EXPERIMENT RUNNING FLAGS
  window.expRunning = false;
  window.expKitOpen = false;
  window.rbExpRunning = false;

  if (typeof expDisconnectHardware === "function") {
    try { expDisconnectHardware(); } catch(e){}
  }
  if (typeof rbExpDisconnectHardware === "function") {
    try { rbExpDisconnectHardware(); } catch(e){}
  }
  if (typeof expStopMotor === "function") {
    try { expStopMotor(); } catch(e){}
  }

  renderExperimentHub();
  goto(page || 'experiments');
  if (typeof updateAIVisibility === "function") {
    updateAIVisibility();
  }
}




function cancelExperimentClose(){


let pop =
document.getElementById(
"experimentExitPopup"
);


if(pop){

pop.remove();

}


}

// ================================
// THEORY MANAGEMENT
// ================================


function addTheory(){


let popup =
document.createElement("div");


popup.className =
"welcome-modal-overlay show";


popup.id =
"theoryPopup";


popup.innerHTML=`

<div class="welcome-modal-card"
style="width:450px;text-align:left">


<div class="welcome-modal-banner staff">

<div class="welcome-modal-emoji">
📚
</div>

<div class="welcome-modal-role">
Theory Material
</div>

<div class="welcome-modal-title">
Add Learning Content
</div>

</div>



<div class="welcome-modal-body">


<label class="form-label">
Topic Title
</label>

<input
id="th-title"
class="form-input"
placeholder="Eg: Bridge Rectifier">



<label class="form-label">
Description
</label>

<textarea
id="th-desc"
class="form-input"
style="height:90px"
placeholder="Short explanation">
</textarea>



<label class="form-label">
Google Drive Link
</label>


<input
id="th-link"
class="form-input"
placeholder="Paste PDF / Drive link">



<br>


<button
class="btn btn-primary"
style="width:100%;justify-content:center"
onclick="saveTheory()">

Save Content

</button>


<br><br>


<button
class="btn"
style="width:100%;justify-content:center"
onclick="document.getElementById('theoryPopup').remove()">

Cancel

</button>


</div>


</div>


`;


document.body.appendChild(popup);


}





function saveTheory(){


let title =
document.getElementById("th-title").value;


let desc =
document.getElementById("th-desc").value;


let link =
document.getElementById("th-link").value;



if(!title || !link){

toast("Fill required details");

return;

}



let data =
JSON.parse(
localStorage.getItem("theoryData")
||
"[]"
);



data.push({

title:title,

desc:desc,

link:link

});



localStorage.setItem(
"theoryData",
JSON.stringify(data)
);



document
.getElementById("theoryPopup")
.remove();



showTheory();


}






function showTheory(){



let box =
document.getElementById("theoryList");


if(!box)return;



let role =
currentUser.role;



let data =
JSON.parse(
localStorage.getItem("theoryData")
||
"[]"
);




box.innerHTML =
data.map((x,i)=>`

<div class="card">


<h2>
📘 ${x.title}
</h2>


<br>


<p style="
color:#64748B;
line-height:1.7">

${x.desc}

</p>



<br>


<a
href="${x.link}"
target="_blank"
style="text-decoration:none"
>

<button
class="btn btn-primary">

📂 Open Material

</button>

</a>

${
role==="staff"
?
`

<button
class="btn btn-primary"
onclick="editTheory(${i})">

✏️ Edit

</button>


<button
class="btn btn-danger"
onclick="deleteTheory(${i})">

Delete

</button>

`
:
""
}


</div>


`).join("");



}

function openTheoryMaterial(i){


let box =
document.getElementById(
"material-"+i
);


if(box){

box.style.display="block";

}


}





function closeTheoryMaterial(i){


let box =
document.getElementById(
"material-"+i
);


if(box){

box.style.display="none";

}


}



function editTheory(i){


let data =
JSON.parse(
localStorage.getItem("theoryData")
);


let item =
data[i];



document
.getElementById("th-title")
?.remove();



let popup =
document.createElement("div");


popup.className =
"welcome-modal-overlay show";


popup.id =
"editTheoryPopup";


popup.innerHTML=`

<div class="welcome-modal-card"
style="width:450px;text-align:left">


<div class="welcome-modal-banner staff">


<div class="welcome-modal-emoji">
✏️
</div>


<div class="welcome-modal-role">
Edit Theory
</div>


<div class="welcome-modal-title">
Update Material
</div>


</div>



<div class="welcome-modal-body">


<label class="form-label">
Topic Title
</label>


<input
id="edit-title"
class="form-input"
value="${item.title}">



<label class="form-label">
Description
</label>


<textarea
id="edit-desc"
class="form-input"
style="height:90px">${item.desc}</textarea>




<label class="form-label">

Drive Link

</label>


<input
id="edit-link"
class="form-input"
value="${item.link}">



<br>


<button
class="btn btn-primary"
style="width:100%;justify-content:center"
onclick="saveEditTheory(${i})">

Save Changes

</button>


<br><br>


<button
class="btn"
style="width:100%;justify-content:center"
onclick="document.getElementById('editTheoryPopup').remove()">

Cancel

</button>


</div>


</div>

`;


document.body.appendChild(popup);


}





function saveEditTheory(i){



let data =
JSON.parse(
localStorage.getItem("theoryData")
);



data[i].title =
document.getElementById("edit-title").value;



data[i].desc =
document.getElementById("edit-desc").value;



data[i].link =
document.getElementById("edit-link").value;




localStorage.setItem(
"theoryData",
JSON.stringify(data)
);



document
.getElementById("editTheoryPopup")
.remove();



showTheory();


}





function deleteTheory(i){


let pop =
document.createElement("div");


pop.id =
"deleteTheoryPopup";


pop.className =
"welcome-modal-overlay show";


pop.innerHTML=`

<div class="welcome-modal-card">


<div class="welcome-modal-banner staff">


<div class="welcome-modal-emoji">
🗑️
</div>


<div class="welcome-modal-role">
Delete Theory
</div>


<div class="welcome-modal-title">
Are you sure?
</div>


</div>



<div class="welcome-modal-body">


<div style="
font-size:13px;
color:#64748b;
line-height:1.7;
margin-bottom:20px">

This theory material will be removed permanently.

</div>



<button
class="btn btn-danger"
style="width:100%;justify-content:center"
onclick="confirmDeleteTheory(${i})">

Delete Material

</button>



<br><br>


<button
class="btn"
style="width:100%;justify-content:center"
onclick="document.getElementById('deleteTheoryPopup').remove()">

Cancel

</button>



</div>


</div>

`;


document.body.appendChild(pop);


}




function confirmDeleteTheory(i){



let data =
JSON.parse(
localStorage.getItem("theoryData")
);



data.splice(i,1);



localStorage.setItem(
"theoryData",
JSON.stringify(data)
);



document
.getElementById("deleteTheoryPopup")
.remove();



showTheory();


}
// ================================
// ASSESSMENT EXIT CENTER POPUP
// ================================

function showAssessmentExitPopup(nextPage){


let old =
document.getElementById(
"assessmentExitPopup"
);


if(old){
old.remove();
}



let box =
document.createElement(
"div"
);


box.id =
"assessmentExitPopup";


box.className =
"welcome-modal-overlay show";


box.innerHTML = `


<div class="welcome-modal-card">


<div class="welcome-modal-banner student">


<div class="welcome-modal-emoji">
🧪
</div>


<div class="welcome-modal-role">

Assessment Running

</div>


<div class="welcome-modal-title">

Close Assessment?

</div>


</div>


<div class="welcome-modal-body">


<div style="
font-size:13px;
color:#64748b;
margin-bottom:20px;
line-height:1.6;
">


Your current assessment progress will be closed.


</div>


<button
class="btn btn-primary"
style="width:100%;justify-content:center"
onclick="confirmAssessmentClose('${nextPage}')">

Yes, Close Assessment

</button>


<br><br>


<button
class="btn"
style="width:100%;justify-content:center"
onclick="cancelAssessmentClose()">

Continue Assessment

</button>


</div>


</div>

`;


document.body.appendChild(box);


}




function confirmAssessmentClose(page){


let pop =
document.getElementById(
"assessmentExitPopup"
);


if(pop){

pop.remove();

}



// RESET ASSESSMENT

window.assessmentRunning=false;




if(
typeof renderAssessmentDashboard==="function"
){

renderAssessmentDashboard();

}


goto(page);


}




function cancelAssessmentClose(){


let pop =
document.getElementById(
"assessmentExitPopup"
);


if(pop){

pop.remove();

}


}


// =================================
// PASTE ASSESSMENT POPUP CODE HERE
// =================================

// ======================================
// EXPOSE TO WINDOW FOR INLINE onclick=""
// ======================================
//
// CHANGE: app.js is loaded with <script type="module">, which scopes
// every top-level `function foo(){}` declaration to the MODULE, not to
// `window`. But every piece of dynamically-generated HTML in this file
// (the sidebar, buttons, popups, etc.) wires up interactivity with
// inline onclick="goto('dashboard')" style attributes -- and those
// attributes execute in the plain global/window scope. Without this
// block, none of these were ever reachable from the rendered HTML,
// which is why goto/doSignOut/toggleSideBar (and anything else you
// click) threw "is not defined" as soon as the dashboard rendered.
//
// (Functions in assessment.js, experiment.js, announcements.js, ai.js,
// and report.js don't need this -- those files are plain, non-module
// <script> tags, so their top-level functions are already global.)
Object.assign(window, {
  api,
  toast,
  escapeHtml,
  goto,
  toggleSideBar,
  sideSpaceClick,
  doSignOut,
  setLoginMode,
  submitAuthForm,
  saveProfile,
  addSkill,
  removeSkill,
  loadStudents,
  loadProjects,
  applyToProject,
  loadStats,
  showExperimentExitPopup,
  confirmExperimentClose,
  cancelExperimentClose,
  addTheory,
  saveTheory,
  showTheory,
  openTheoryMaterial,
  closeTheoryMaterial,
  editTheory,
  saveEditTheory,
  deleteTheory,
  confirmDeleteTheory,
  showAssessmentExitPopup,
  confirmAssessmentClose,
  cancelAssessmentClose,
  getExperimentHubHtml,
  renderExperimentHub,
});

// ====== BOOT ======
(async function boot() {

    const ok = await tryAutoLogin();

    if (ok) {

        renderApp();

    } else {

        renderLogin();

    }

})();

  
// ==========================
// SIDEBAR OPEN CLOSE
// ==========================


function toggleSideBar(){
  const side = document.getElementById("sideBar");
  const btn = document.querySelector(".sidebar-toggle");
  if (!side) return;

  side.classList.toggle("closed");
  const isClosed = side.classList.contains("closed");
  localStorage.setItem("edunexus_sidebar_closed", isClosed);

  if (btn) {
    btn.title = isClosed ? "Expand sidebar" : "Collapse sidebar";
  }
}



// click empty sidebar space

function sideSpaceClick(e){


if(
e.target.id === "sideBar"
||
e.target.className === "sb-logo"
){

toggleSideBar();

}


}
