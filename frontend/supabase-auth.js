import { supabase } from "./supabase.js";

// ======================================
// STORE USER + RELOAD
// ======================================

async function storeUserAndReload(user) {

    // CHANGE: Supabase only authenticates the *browser session* -- it has
    // no idea about our FastAPI backend's own JWT system. Every protected
    // backend route (/students, /stats, /assessments/analytics, etc.)
    // checks for an `Authorization: Bearer <token>` header signed with
    // EDUNEXUS_SECRET_KEY, decoded by get_current_user() in main.py.
    // Without this call, `edunexus_token` was never set, so app.js's
    // api() helper silently sent every request with no auth header at
    // all, and the backend correctly replied 401 Unauthorized -- which is
    // why staff could log in but never see student data.
    //
    // Fix: exchange the Supabase identity for a real backend JWT via the
    // existing /auth/google-login endpoint (it already knows how to
    // assign the "staff" role for STAFF_EMAILS), and persist that token
    // the same way the plain email/password login flow does.
    const API_BASE = window.EDUNEXUS_API_BASE || "http://127.0.0.1:8123";

    const backendName =
        user.user_metadata?.full_name ||
        user.email.split("@")[0];

    const res = await fetch(`${API_BASE}/auth/google-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: user.email,
            name: backendName
        })
    });

    if (!res.ok) {
        showSupabaseError(
            "Signed in, but couldn't reach the app server. Please try again."
        );
        return;
    }

    const { token, user: backendUser } = await res.json();

    localStorage.setItem("edunexus_token", token);

    const role = backendUser.role; // authoritative role, from the backend, not guessed here

    window.currentUser = {
        // Spread the full backend user record first (id, email, role, bio,
        // university, phone, department, graduation_year, completion,
        // skills, ...) so nothing the backend knows about the user is lost.
        // CHANGE: previously this object was built from scratch with only
        // a handful of hardcoded fields and never included `id` at all --
        // any code that needed currentUser.id (e.g. downloading the Final
        // Practical Report) failed with "Could not identify your account"
        // for every Google-login student, forever, since the incomplete
        // object was also what got cached to localStorage and reloaded on
        // every refresh.
        ...backendUser,

        name:
            user.user_metadata?.full_name ||
            backendUser.name ||
            user.email.split("@")[0],

        email: user.email,

        role: role,
    };

    localStorage.setItem(
        "edunexus_google_user",
        JSON.stringify(window.currentUser)
    );

    localStorage.setItem(
        "studentName",
        window.currentUser.name
    );

    localStorage.setItem(
        "edunexus_welcome_role",
        role
    );

    window.location.href = "index.html";
}

// ======================================
// SHOW ERROR
// ======================================

function showSupabaseError(msg) {

    const el =
        document.getElementById("login-error");

    if (el) {

        el.textContent = msg;

        el.style.display = "block";

    } else {

        alert(msg);

    }

}

// ======================================
// GOOGLE LOGIN
// ======================================

window.googleLoginSupabase = async function () {
    const redirectUrl = window.location.origin + window.location.pathname;

    const { error } =
        await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: redirectUrl
            }
        });

    if (error) {

        showSupabaseError(error.message);

    }

};

// ======================================
// EMAIL SIGNUP
// ======================================

window.emailSignup = async function (
    email,
    password
) {

    const { data, error } =
        await supabase.auth.signUp({

            email,

            password

        });

    if (error) {

        showSupabaseError(error.message);

        return;

    }

    if (data.user) {

        await storeUserAndReload(data.user);

    }

};

// ======================================
// EMAIL LOGIN
// ======================================

window.emailLogin = async function (
    email,
    password
) {

    const { data, error } =
        await supabase.auth.signInWithPassword({

            email,

            password

        });

    if (error) {

        showSupabaseError(error.message);

        return;

    }

    if (data.user) {

        await storeUserAndReload(data.user);

    }

};

// ======================================
// PASSWORD RESET
// ======================================

window.resetPassword = async function (
    email
) {

    const { error } =
        await supabase.auth.resetPasswordForEmail(
            email
        );

    if (error) {

        showSupabaseError(error.message);

        return;

    }

    alert(
        "Password reset email sent! Check your inbox."
    );

};

// ======================================
// RESTORE LOGIN AFTER GOOGLE
// ======================================
//
// CHANGE: this used to call storeUserAndReload() (which ends in
// window.location.href = "index.html") on EVERY page load that had a
// live Supabase session -- including a plain refresh, not just a fresh
// login. Since that reload lands back on this exact script, it fired
// again, reloaded again, forever. That reload loop -- racing against
// app.js's own boot() sequence -- is what caused the white page,
// buttons not responding, and the session appearing "lost".
//
// Fix: only treat this as a fresh sign-in (store + one reload) when the
// signed-in email doesn't match what's already cached locally. On a
// normal refresh the cached email matches, so we just sync the
// in-memory user and let app.js's own boot() render the dashboard --
// no reload needed.

const {
    data: { session }
} = await supabase.auth.getSession();

if (session?.user) {
    const cachedRaw =
        localStorage.getItem("edunexus_google_user");

    const cachedEmail =
        cachedRaw ? JSON.parse(cachedRaw).email : null;

    if (cachedEmail !== session.user.email) {
        // Fresh login (or a different account) -- store it and do the
        // one-time reload that hands control to app.js's boot().
        await storeUserAndReload(session.user);
    } else {
        // Same user already cached (e.g. a normal page refresh) --
        // just keep the in-memory copy in sync, no reload.
        window.currentUser = JSON.parse(cachedRaw);
    }
}

// Also listen for real-time OAuth redirect callbacks (e.g. immediately after Google redirects back)
supabase.auth.onAuthStateChange(async (event, currentSession) => {
    if ((event === "SIGNED_IN" || event === "USER_UPDATED") && currentSession?.user) {
        const cachedRaw = localStorage.getItem("edunexus_google_user");
        const cachedEmail = cachedRaw ? JSON.parse(cachedRaw).email : null;
        if (cachedEmail !== currentSession.user.email) {
            await storeUserAndReload(currentSession.user);
        }
    }
});

// ======================================
// LOGOUT
// ======================================


window.logout = async function () {

    await supabase.auth.signOut();

    localStorage.removeItem("edunexus_google_user");
    localStorage.removeItem("studentName");
    localStorage.removeItem("edunexus_welcome_role");
    localStorage.removeItem("edunexus_token");

window.location.href = "index.html";

};