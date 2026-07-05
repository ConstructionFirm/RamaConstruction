// ── SUPABASE CREDENTIALS ──
const SUPABASE_URL = "https://olylorarbaizpogbbjmb.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9seWxvcmFyYmFpenBvZ2Jiam1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODEzMjIsImV4cCI6MjA4OTA1NzMyMn0.ESovUr-sRcrrFyLRY9g6dFeW-opcJUf0qyw_CbKBDVA";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let editId = null,
    currentUserId = null,
    currentRole = null;
let allowedSiteIds = null; // null = no restriction (admin/accountant)

// ── SITE ACCESS FILTER ──
async function loadAllowedSites(user) {
    if (currentRole === "admin" || currentRole === "accountant") {
        allowedSiteIds = null;
        return;
    }
    const uid = user.id;
    const userName = (
        (user.user_metadata && user.user_metadata.fullname) ||
        (user.user_metadata && user.user_metadata.full_name) ||
        user.email.split("@")[0]
    )
        .toLowerCase()
        .trim();

    // Fetch ALL sites (bypass allowedSiteIds filter) to calculate access
    const { data: sites } = await sb
        .from("sites")
        .select("id, supervisor, supervisorid, engineerids");
    if (!sites || sites.length === 0) {
        allowedSiteIds = [];
        return;
    }

    if (currentRole === "supervisor") {
        allowedSiteIds = sites
            .filter((s) => {
                // Match by UUID (new sites)
                if (s.supervisorid && s.supervisorid === uid) return true;
                // Fallback: match by supervisor name text (old sites)
                if (
                    s.supervisor &&
                    s.supervisor.toLowerCase().trim() === userName
                )
                    return true;
                return false;
            })
            .map((s) => s.id);
    } else if (currentRole === "engineer") {
        allowedSiteIds = sites
            .filter((s) => {
                // Match by UUID array (new sites)
                if (Array.isArray(s.engineerids) && s.engineerids.includes(uid))
                    return true;
                return false;
            })
            .map((s) => s.id);
    } else {
        allowedSiteIds = null;
    }

    // If still no sites found, warn but don't lock out completely
    // (admin should assign sites to this user)
    if (allowedSiteIds !== null && allowedSiteIds.length === 0) {
        console.warn("No sites assigned to this user:", userName, uid);
    }
}
let labChart2, siteChart2, trendChart2;

// ── DATE HELPER (IST-safe, no UTC offset bug) ──
function getToday() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

// ── PERMISSIONS ──
const PERMISSIONS = {
    admin: {
        canAddSite: true,
        canEditSite: true,
        canDeleteSite: true,
        canAddWorker: true,
        canEditWorker: true,
        canDeleteWorker: true,
        canAddMaterial: true,
        canEditMaterial: true,
        canDeleteMaterial: true,
        canAddAttendance: true,
        canEditAttendance: true,
        canDeleteAttendance: true,
        canAddMatEntry: true,
        canEditMatEntry: true,
        canDeleteMatEntry: true,
        canAddCash: true,
        canEditCash: true,
        canDeleteCash: true,
    },
    supervisor: {
        canAddSite: false,
        canEditSite: false,
        canDeleteSite: false,
        canAddWorker: true,
        canEditWorker: true,
        canDeleteWorker: true,
        canAddMaterial: false,
        canEditMaterial: false,
        canDeleteMaterial: false,
        canAddAttendance: true,
        canEditAttendance: true,
        canDeleteAttendance: false,
        canAddMatEntry: true,
        canEditMatEntry: true,
        canDeleteMatEntry: false,
        canAddCash: false,
        canEditCash: false,
        canDeleteCash: false,
    },
    engineer: {
        canAddSite: false,
        canEditSite: false,
        canDeleteSite: false,
        canAddWorker: false,
        canEditWorker: false,
        canDeleteWorker: false,
        canAddMaterial: false,
        canEditMaterial: false,
        canDeleteMaterial: false,
        canAddAttendance: true,
        canEditAttendance: false,
        canDeleteAttendance: false,
        canAddMatEntry: true,
        canEditMatEntry: false,
        canDeleteMatEntry: false,
        canAddCash: false,
        canEditCash: false,
        canDeleteCash: false,
    },
    accountant: {
        canAddSite: false,
        canEditSite: false,
        canDeleteSite: false,
        canAddWorker: false,
        canEditWorker: false,
        canDeleteWorker: false,
        canAddMaterial: false,
        canEditMaterial: false,
        canDeleteMaterial: false,
        canAddAttendance: false,
        canEditAttendance: false,
        canDeleteAttendance: false,
        canAddMatEntry: false,
        canEditMatEntry: false,
        canDeleteMatEntry: false,
        canAddCash: true,
        canEditCash: true,
        canDeleteCash: false,
    },
};
function can(action) {
    const p = PERMISSIONS[currentRole];
    return p ? p[action] : true;
}
function guard(action, label) {
    if (!can(action)) {
        toast(label + " — Permission denied for your role", false);
        return false;
    }
    return true;
}

// ── PAST DATE GUARDS ──
function isToday(dateStr) {
    const today = getToday(); // ✅ correctly called with ()
    return dateStr >= today;
}
function guardPastDate(dateStr, action) {
    if (currentRole === "admin") return true;
    if (!isToday(dateStr)) {
        toast(
            "⛔ Cannot " + action + " past date records — contact Admin",
            false,
        );
        return false;
    }
    return true;
}

// ── AUTH ──
function switchAuthTab(tab) {
    const isLogin = tab === "login";
    document.getElementById("loginForm").style.display = isLogin
        ? "flex"
        : "none";
    document.getElementById("signupForm").style.display = isLogin
        ? "none"
        : "flex";
    document.getElementById("tabLogin").classList.toggle("active", isLogin);
    document
        .getElementById("tabSignup")
        .classList.toggle("active", !isLogin);
    document.getElementById("li_err").textContent = "";

    // BUG-017: the Create Account form is taller than the phone screen. When
    // switching to it, auto-scroll to the TOP of the signup form so the user
    // starts at the first field (Select Role) and can scroll down through it.
    if (!isLogin) {
        // wait for the form to become visible before measuring/scrolling
        requestAnimationFrame(() => {
            const form = document.getElementById("signupForm");
            if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }
}
async function doLogin() {
    const email = document.getElementById("li_email").value.trim();
    const pass = document.getElementById("li_pass").value;
    const btn = document.getElementById("loginBtn");
    const err = document.getElementById("li_err");
    if (!email || !pass) {
        err.className = "auth-err err";
        err.textContent = "Enter email and password";
        return;
    }
    btn.innerHTML = '<span class="loading"></span>Signing in...';
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({
        email,
        password: pass,
    });
    btn.innerHTML = "Sign In";
    btn.disabled = false;
    if (error) {
        err.className = "auth-err err";
        err.textContent = error.message;
        return;
    }
    currentUserId = data.user.id;
    showApp(data.user);
}
async function doSignup() {
    const name = document.getElementById("su_name").value.trim();
    const email = document.getElementById("su_email").value.trim();
    const pass = document.getElementById("su_pass").value;
    const role = document.getElementById("su_role").value;
    const btn = document.getElementById("signupBtn");
    const err = document.getElementById("li_err");
    if (!name || !email || !pass || !role) {
        err.className = "auth-err err";
        err.textContent = "All fields are required";
        return;
    }
    if (pass.length < 6) {
        err.className = "auth-err err";
        err.textContent = "Password must be at least 6 characters";
        return;
    }
    btn.innerHTML = '<span class="loading"></span>Creating...';
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
        email,
        password: pass,
        options: { data: { full_name: name, role } },
    });
    btn.innerHTML = "Create Account";
    btn.disabled = false;
    if (error) {
        err.className = "auth-err err";
        err.textContent = error.message;
        return;
    }
    // Save profile so we can look up users by role later
    if (data.user) {
        await sb.from("profiles").upsert({
            id: data.user.id,
            full_name: name,
            role: role,
            email: email,
        });
    }
    err.className = "auth-err ok";
    err.textContent = "Account created! You can now login.";
    switchAuthTab("login");
    document.getElementById("li_email").value = email;
}
async function doLogout() {
    await sb.auth.signOut();
    currentUserId = null;
    currentRole = null;
    document.getElementById("appWrapper").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
    document.body.classList.remove("logged-in"); // BUG-015: hide bottom nav on login
    document.getElementById("li_err").textContent = "";
    document.getElementById("li_email").value = "";
    document.getElementById("li_pass").value = "";
    // Hide AI FAB on logout
    const fab = document.querySelector(".ai-chat-fab");
    if (fab) fab.style.display = "none";
    // Close chat panel if open
    const panel = document.getElementById("aiChatPanel");
    if (panel) panel.classList.remove("active");
}
async function showApp(user) {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("appWrapper").style.display = "flex";
    document.body.classList.add("logged-in"); // BUG-015: reveal bottom nav after login
    // Show AI assistant FAB now that user is authenticated
    const fab = document.querySelector(".ai-chat-fab");
    if (fab) fab.style.display = "flex";
    currentRole =
        (user.user_metadata && user.user_metadata.role) || "supervisor";
    const name =
        (user.user_metadata && user.user_metadata.full_name) ||
        user.email.split("@")[0];
    document.getElementById("userEmail").textContent = name;
    document.getElementById("userRoleLbl").textContent = currentRole;
    document.getElementById("userAv").textContent = name[0].toUpperCase();
    const tAv = document.getElementById("topAv");
    if(tAv) tAv.textContent = name[0].toUpperCase() + (name.split(" ")[1] || name[0])[0].toUpperCase();
    applyRoleVisibility();
    await loadAllowedSites(user);
    // Auto-create profile entry if missing (handles pre-profiles-table users)
    sb.from("profiles")
        .upsert(
            {
                id: user.id,
                full_name: name,
                role: currentRole,
                email: user.email,
            },
            { onConflict: "id" },
        )
        .then(() => { });
    initDashboard();
}

// ── ROLE VISIBILITY ──
function applyRoleVisibility() {
    const r = currentRole;
    document.getElementById("navOverview").style.display = "flex";
    document.getElementById("navLabour").style.display = (r === "accountant") ? "none" : "flex";
    document.getElementById("navMaterials").style.display = (r === "accountant") ? "none" : "flex";
    document.getElementById("navCashbook").style.display = (r === "engineer") ? "none" : "flex";
    
    // Dedicated Sites/Workers visibility
    const nSi = document.getElementById("navSites");
    if(nSi) nSi.style.display = (r === "admin" || r === "supervisor") ? "flex" : "none";
    const nWo = document.getElementById("navWorkers");
    if(nWo) nWo.style.display = (r === "admin" || r === "supervisor") ? "flex" : "none";

    const btnMap = [
        ["btnAddSite", "canAddSite"],
        ["btnAddWorker", "canAddWorker"],
        ["btnAddWorkerLab", "canAddWorker"], // BUG-019: Add Worker btn on Labour page
        ["btnAddAttend", "canAddAttendance"],
        ["btnAddMatEntry", "canAddMatEntry"],
        ["btnAddCash", "canAddCash"],
    ];
    btnMap.forEach(([id, perm]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = can(perm) ? "inline-block" : "none";
    });
    const tdEl = document.getElementById("todayDate");
    if (tdEl) tdEl.textContent = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const phEl = document.getElementById("pageHeaderDate");
    const phInput = document.getElementById("headerDateInput");
    const todayStr = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    if (phEl) phEl.textContent = todayStr;
    if (phInput) {
        // Set hidden input to today's value (YYYY-MM-DD format required by input[type=date])
        const now = new Date();
        phInput.value = now.toISOString().split('T')[0];
    }
}

// ── DATE PICKER HANDLER ──
function onHeaderDateChange(val) {
    if (!val) return;
    const d = new Date(val + 'T00:00:00');
    const formatted = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const phEl = document.getElementById("pageHeaderDate");
    if (phEl) phEl.textContent = formatted;
    // Optionally re-render data filtered to chosen date
    // renderAll(); // Uncomment if you want date-based filtering
}

// ── INIT ──
function initDashboard() {
    document.getElementById("todayDate").textContent =
        new Date().toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    const td = getToday();
    ["labDate", "me_date", "l_date", "c_date"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = td;
    });
    // Show warning if supervisor/engineer has no assigned sites
    const existing = document.getElementById("noSiteBanner");
    if (allowedSiteIds !== null && allowedSiteIds.length === 0) {
        if (!existing) {
            const banner = document.createElement("div");
            banner.id = "noSiteBanner";
            banner.style.cssText =
                "background:#fef3c7;color:#92400e;padding:10px 20px;" +
                "font-size:13px;font-weight:600;text-align:center;" +
                "border-bottom:2px solid #f59e0b;flex-shrink:0;";
            banner.textContent =
                "⚠️ You have not been assigned to any site yet. Ask your Admin to assign you via Masters → Sites → Edit.";
            const main = document.querySelector(".main");
            if (main) main.prepend(banner);
        }
    } else if (existing) {
        existing.remove();
    }
    populateAllDropdowns();
    renderAll();
}
function renderAll() {
    renderOverview();
    renderLabour();
    renderMaterials();
    renderCash();
    renderSites();
    renderWorkers();
    renderMatMaster();
}

// ── DB HELPERS ──
async function dbGet(table) {
    let query = sb
        .from(table)
        .select("*")
        .order("created_at", { ascending: false });
    // Apply site-level access filter for supervisor / engineer
    if (
        allowedSiteIds !== null &&
        ["attendance", "material_entries", "cashbook"].includes(table)
    ) {
        if (allowedSiteIds.length === 0) return [];
        query = query.in("site_id", allowedSiteIds);
    }
    if (allowedSiteIds !== null && table === "sites") {
        if (allowedSiteIds.length === 0) return [];
        query = query.in("id", allowedSiteIds);
    }
    if (allowedSiteIds !== null && table === "workers") {
        if (allowedSiteIds.length === 0) return [];
        query = query.in("site_id", allowedSiteIds);
    }
    const { data, error } = await query;
    if (error) {
        console.error(table, error.message);
        return [];
    }
    return data || [];
}
async function dbInsert(table, obj) {
    obj.user_id = currentUserId;
    const { data, error } = await sb
        .from(table)
        .insert(obj)
        .select()
        .single();
    if (error) throw error;
    return data;
}
async function dbUpdate(table, id, obj) {
    const { error } = await sb.from(table).update(obj).eq("id", id);
    if (error) throw error;
}
async function dbDelete(table, id) {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
}

// ── DROPDOWNS ──
async function populateSiteUserDropdowns() {
    const { data: profiles, error } = await sb
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["supervisor", "engineer"]);
    const list = profiles || [];
    const supervisors = list.filter((p) => p.role === "supervisor");
    const engineers = list.filter((p) => p.role === "engineer");
    const supEl = document.getElementById("s_sup");
    if (supEl) {
        if (supervisors.length === 0) {
            supEl.innerHTML = `<option value="">-- No supervisors registered yet --</option>`;
        } else {
            supEl.innerHTML =
                `<option value="">-- Select Supervisor --</option>` +
                supervisors
                    .map((u) => `<option value="${u.id}">${u.full_name}</option>`)
                    .join("");
        }
    }
    const engEl = document.getElementById("s_engineers");
    if (engEl) {
        if (engineers.length === 0) {
            engEl.innerHTML = `<option value="" disabled>No engineers registered yet</option>`;
        } else {
            engEl.innerHTML = engineers
                .map((u) => `<option value="${u.id}">${u.full_name}</option>`)
                .join("");
        }
    }
}

// BUG-021: the currently-selected global site, kept uniform across all pages.
// populateAllDropdowns() rebuilds the option lists (wiping selection), so we
// restore this value afterward instead of resetting to "All Sites".
let globalSiteVal = "";
async function populateAllDropdowns() {
    const sites = await dbGet("sites");
    const sOpts = sites
        .map((s) => `<option value="${s.id}">${s.name}</option>`)
        .join("");
    const all = `<option value="">All Sites</option>`;
    const sel = `<option value="">-- Select Site --</option>`;
    ["labSite", "matSite", "cashSite", "gSite", "wfSite"].forEach((id) => {
        const e = document.getElementById(id);
        if (e) {
            e.innerHTML = all + sOpts;
            e.value = globalSiteVal; // BUG-021: keep the chosen site across pages
        }
    });
    ["l_site", "me_site", "c_site", "w_site"].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.innerHTML = sel + sOpts;
    });
    const mats = await dbGet("materials_master");
    const mn = document.getElementById("matName");
    if (mn)
        mn.innerHTML =
            `<option value="">All Materials</option>` +
            mats
                .map((m) => `<option value="${m.name}">${m.name}</option>`)
                .join("");
    const mm = document.getElementById("me_mat");
    if (mm)
        mm.innerHTML =
            `<option value="">-- Select --</option>` +
            mats
                .map(
                    (m) => `<option value="${m.id}">${m.name} (${m.unit})</option>`,
                )
                .join("");
}
async function populateWorkerDropdown() {
    const siteId = document.getElementById("l_site").value;
    const workers = await dbGet("workers");
    const filt = workers.filter(
        (w) => w.status === "Active" && (!siteId || w.site_id === siteId),
    );
    document.getElementById("l_worker").innerHTML =
        `<option value="">-- Select Worker --</option>` +
        filt
            .map(
                (w) =>
                    `<option value="${w.id}" data-wage="${w.daily_wage}" data-des="${w.designation}" data-gender="${w.gender}">${w.name}</option>`,
            )
            .join("");
}
function autoFillWorker() {
    const sel = document.getElementById("l_worker");
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    document.getElementById("l_des").value =
        opt.getAttribute("data-des") || "";
    document.getElementById("l_gender").value =
        opt.getAttribute("data-gender") || "";
    document.getElementById("l_wage").value =
        opt.getAttribute("data-wage") || 0;
    calcPay();
}
async function autoFillMat() {
    const id = document.getElementById("me_mat").value;
    const mats = await dbGet("materials_master");
    const m = mats.find((x) => x.id === id);
    if (m) {
        document.getElementById("me_unit").value = m.unit;
        document.getElementById("me_rate").value = m.default_rate || 0;
        calcMatAmt();
    }
}
function calcPay() {
    const wage = parseFloat(document.getElementById("l_wage").value) || 0;
    const st = document.getElementById("l_status").value;
    const pay = st === "Present" ? wage : st === "Half Day" ? wage * 0.5 : 0;
    document.getElementById("l_pay").value = pay.toFixed(2);
    // BUG-004: update live hint
    const hintEl = document.getElementById("labCalcHint");
    if (hintEl) {
        if (wage > 0) {
            hintEl.textContent = `${st} × ₹${wage.toLocaleString('en-IN')} = ₹${pay.toLocaleString('en-IN')}${st === 'Half Day' ? ' (50%)' : ''}`;
            hintEl.classList.remove('hint-placeholder');
        } else {
            hintEl.textContent = 'Status × Wage';
            hintEl.classList.add('hint-placeholder');
        }
    }
}
function calcMatAmt() {
    const q = parseFloat(document.getElementById("me_qty").value) || 0;
    const r = parseFloat(document.getElementById("me_rate").value) || 0;
    document.getElementById("me_amt").value = (q * r).toFixed(2);
    // BUG-004: update material hint on me_amt input (placeholder does this already)
}

// ── MODAL HELPERS ──
function openModal(id) {
    const overlay = document.getElementById(id);
    overlay.classList.add("open");
    // Close modal when clicking the backdrop (outside the .modal box)
    overlay.onclick = function(e) {
        if (e.target === overlay) closeModal(id);
    };
    // Reset type toggles to their defaults when opening fresh
    if (id === 'workerModal') {
        // BUG-005: clear duplicate error on open
        const errEl = document.getElementById('workerDuplicateError');
        if (errEl) errEl.style.display = 'none';
    }
    if (id === 'labModal') {
        // BUG-004: reset calc hint on open
        const hintEl = document.getElementById('labCalcHint');
        if (hintEl) { hintEl.textContent = 'Status × Wage'; hintEl.classList.add('hint-placeholder'); }
    }
    if (id === 'cashModal') {
        const ms = document.getElementById('cashTypeMS');
        const exp = document.getElementById('cashTypeExp');
        if (ms && exp) { ms.className = 'm-type-btn active-green'; exp.className = 'm-type-btn'; }
        // Reset mode grid — default UPI active
        document.querySelectorAll('#cashModeGrid .m-mode-btn').forEach((b, i) => {
            b.className = i === 1 ? 'm-mode-btn active' : 'm-mode-btn';
        });
        const cm = document.getElementById('c_mode');
        if (cm) cm.value = 'UPI';
    }
    if (id === 'matModal') {
        const inBtn = document.getElementById('meTypeIn');
        const outBtn = document.getElementById('meTypeOut');
        if (inBtn && outBtn) { inBtn.className = 'm-type-btn active-orange'; outBtn.className = 'm-type-btn'; }
        const mt = document.getElementById('me_type');
        if (mt) mt.value = 'In';
    }
    if (id === 'labModal') {
        const grid = document.querySelector('#labModal .m-status-grid');
        if (grid) {
            grid.querySelectorAll('.m-status-btn').forEach(b => b.className = 'm-status-btn');
            const first = grid.querySelector('.m-status-btn');
            if (first) first.className = 'm-status-btn active-present';
        }
        const ls = document.getElementById('l_status');
        if (ls) ls.value = 'Present';

        // Date access: Admin gets full access, others are locked to today for new entries
        const dateInput = document.getElementById("l_date");
        if (dateInput) {
            if (currentRole === "admin") {
                dateInput.readOnly = false;
                dateInput.style.background = "";
                dateInput.style.cursor = "";
                dateInput.min = "";
                dateInput.max = "";
            } else if (!editId) {
                const today = getToday();
                dateInput.value = today;
                dateInput.readOnly = true;
                dateInput.style.background = "var(--bg-readonly)";
                dateInput.style.cursor = "not-allowed";
            }
        }
    }
}
function closeModal(id) {
    document.getElementById(id).classList.remove("open");
    editId = null;
}
// Payment mode pill selector for cash modal
function setCashMode(mode, btn) {
    document.querySelectorAll('#cashModeGrid .m-mode-btn').forEach(b => b.className = 'm-mode-btn');
    btn.className = 'm-mode-btn active';
    const sel = document.getElementById('c_mode');
    if (sel) sel.value = mode;
}
function toast(msg, ok = true) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.style.borderLeftColor = ok ? "var(--success)" : "var(--danger)";
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2800);
}
function fmt(n) {
    return "₹" + (n || 0).toLocaleString("en-IN");
}
function fmtF(n) {
    return "₹" + parseFloat(n || 0).toLocaleString("en-IN");
}
function strCol(name) {
    const colors = [
        "#f97316",
        "#3b82f6",
        "#22c55e",
        "#8b5cf6",
        "#ef4444",
        "#f59e0b",
        "#06b6d4",
        "#ec4899",
    ];
    let hash = 0;
    for (let c of name || "") hash = c.charCodeAt(0) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

// ── ATTENDANCE MODAL ──
function openAttendanceModal() {
    editId = null;
    const today = getToday(); // ✅ properly store result
    const dateInput = document.getElementById("l_date");
    dateInput.value = today;

    if (currentRole !== "admin") {
        dateInput.min = today;
        dateInput.max = today;
        dateInput.readOnly = true;
        dateInput.style.background = "var(--bg-readonly)"; // BUG-018: was hardcoded #f1f5f9 (light box in dark theme)
        dateInput.style.cursor = "not-allowed";
    } else {
        dateInput.min = "";
        dateInput.max = "";
        dateInput.readOnly = false;
        dateInput.style.background = "";
        dateInput.style.cursor = "";
    }
    document.getElementById("l_site").value = "";
    document.getElementById("l_worker").innerHTML =
        '<option value="">-- Select Worker --</option>';
    document.getElementById("l_des").value = "";
    document.getElementById("l_gender").value = "";
    document.getElementById("l_wage").value = "";
    document.getElementById("l_hours").value = "";
    document.getElementById("l_pay").value = "";
    document.getElementById("l_remarks").value = "";
    document.getElementById("l_status").value = "Present";
    document.getElementById("labModalTitle").textContent = "Add Attendance";
    populateAllDropdowns();
    openModal("labModal");
}

// ════════════ SITES ════════════
async function saveSite() {
    if (editId && !guard("canEditSite", "Admin only")) return;
    if (!editId && !guard("canAddSite", "Admin only")) return;
    const name = document.getElementById("s_name").value.trim();
    if (!name) {
        toast("Site name is required", false);
        return;
    }
    const supEl = document.getElementById("s_sup");
    const engEl = document.getElementById("s_engineers");
    // Sanitize: ensure empty string becomes null for UUID fields
    const supervisorId =
        supEl.value && supEl.value.trim() !== "" ? supEl.value.trim() : null;
    const supervisorName =
        supervisorId && supEl.selectedIndex >= 0
            ? (supEl.options[supEl.selectedIndex]?.text || "")
                .replace("-- Select Supervisor --", "")
                .trim()
            : "";
    // Filter out empty strings from engineer IDs
    const engineerIds = engEl
        ? Array.from(engEl.selectedOptions)
            .map((o) => o.value)
            .filter((v) => v && v.trim() !== "")
        : [];
    const obj = {
        name,
        city: document.getElementById("s_city").value,
        addr: document.getElementById("s_addr").value,
        start_date: document.getElementById("s_date").value || null,
        status: document.getElementById("s_status").value,
        supervisor: supervisorName,
        supervisorid: supervisorId,
        engineerids: engineerIds,
        phone: document.getElementById("s_phone").value,
    };
    try {
        if (editId) await dbUpdate("sites", editId, obj);
        else await dbInsert("sites", obj);
        closeModal("siteModal");
        populateAllDropdowns();
        renderSites();
        renderOverview();
        toast(editId ? "Site updated!" : "Site added!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editSite(id) {
    if (!guard("canEditSite", "Admin only")) return;
    editId = id;
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === id);
    if (!s) return;
    document.getElementById("siteModalTitle").textContent = "Edit Site";
    document.getElementById("s_name").value = s.name;
    document.getElementById("s_city").value = s.city || "";
    document.getElementById("s_addr").value = s.addr || "";
    document.getElementById("s_date").value = s.start_date || "";
    document.getElementById("s_status").value = s.status || "Active";
    document.getElementById("s_phone").value = s.phone || "";
    // Load user dropdowns first, then pre-select saved values
    await populateSiteUserDropdowns();
    const supEl = document.getElementById("s_sup");
    if (supEl && s.supervisorid) {
        supEl.value = s.supervisorid;
        // fallback: if uuid not found in dropdown, try matching by name
        if (!supEl.value && s.supervisor) {
            Array.from(supEl.options).forEach((opt) => {
                if (
                    opt.text.trim().toLowerCase() ===
                    s.supervisor.trim().toLowerCase()
                )
                    opt.selected = true;
            });
        }
    }
    const engEl = document.getElementById("s_engineers");
    if (engEl && s.engineerids && Array.isArray(s.engineerids)) {
        Array.from(engEl.options).forEach((opt) => {
            opt.selected = s.engineerids.includes(opt.value);
        });
    }
    openModal("siteModal");
}
async function deleteSite(id) {
    if (!guard("canDeleteSite", "Admin only")) return;
    if (
        !confirm(
            "Delete this site?\nAll linked workers, attendance, material entries and cashbook records will be unlinked.",
        )
    )
        return;
    try {
        // Unlink all FK-referencing tables before deleting site
        const tables = [
            "workers",
            "attendance",
            "material_entries",
            "cashbook",
        ];
        for (const tbl of tables) {
            const { error } = await sb
                .from(tbl)
                .update({ site_id: null })
                .eq("site_id", id);
            if (error) throw error;
        }
        // Now safe to delete site
        await dbDelete("sites", id);
        populateAllDropdowns();
        renderSites();
        renderOverview();
        toast("Site deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ WORKERS ════════════
async function saveWorker() {
    if (editId && !guard("canEditWorker", "Cannot edit worker")) return;
    if (!editId && !guard("canAddWorker", "Cannot add worker")) return;
    const name = document.getElementById("w_name").value.trim();
    if (!name) {
        toast("Worker name required", false);
        return;
    }
    const obj = {
        name,
        phone: document.getElementById("w_phone").value.trim(),
        gender: document.getElementById("w_gender").value,
        designation: document.getElementById("w_des").value,
        daily_wage: parseFloat(document.getElementById("w_wage").value) || 0,
        site_id: document.getElementById("w_site").value || null,
        status: document.getElementById("w_status").value,
    };
    // BUG-005: Duplicate check (name + phone + site + designation)
    if (!editId) {
        const existing = await dbGet("workers");
        const isDup = existing.some(w =>
            w.name.trim().toLowerCase() === obj.name.toLowerCase() &&
            (w.phone || "").trim() === obj.phone &&
            (w.site_id || "") === (obj.site_id || "") &&
            (w.designation || "").toLowerCase() === obj.designation.toLowerCase()
        );
        if (isDup) {
            const errEl = document.getElementById('workerDuplicateError');
            if (errEl) {
                errEl.textContent = '⚠️ Worker already exists with the same name, phone, site, and designation.';
                errEl.style.display = 'block';
            }
            return;
        }
    }
    try {
        if (editId) await dbUpdate("workers", editId, obj);
        else await dbInsert("workers", obj);
        closeModal("workerModal");
        renderWorkers();
        toast(editId ? "Worker updated!" : "Worker added!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editWorker(id) {
    if (!guard("canEditWorker", "Cannot edit worker")) return;
    const workers = await dbGet("workers");
    const w = workers.find((x) => x.id === id);
    if (!w) return;
    if (currentRole !== "admin") {
        const today = getToday(); // ✅ correctly stored
        const addedDate = w.created_at ? w.created_at.split("T")[0] : "";
        if (addedDate !== today) {
            toast(
                "⛔ Can only edit workers added today — contact Admin",
                false,
            );
            return;
        }
    }
    editId = id;
    await populateAllDropdowns();
    document.getElementById("workerModalTitle").textContent = "Edit Worker";
    document.getElementById("w_name").value = w.name;
    document.getElementById("w_phone").value = w.phone || "";
    document.getElementById("w_gender").value = w.gender || "Male";
    document.getElementById("w_des").value = w.designation || "Labour";
    document.getElementById("w_wage").value = w.daily_wage || 0;
    document.getElementById("w_site").value = w.site_id || "";
    document.getElementById("w_status").value = w.status || "Active";
    openModal("workerModal");
}
async function deleteWorker(id) {
    if (!guard("canDeleteWorker", "Cannot delete worker")) return;
    const workers = await dbGet("workers");
    const w = workers.find((x) => x.id === id);
    if (!w) return;
    if (currentRole !== "admin") {
        const today = getToday(); // ✅ correctly stored
        const addedDate = w.created_at ? w.created_at.split("T")[0] : "";
        if (addedDate !== today) {
            toast(
                "⛔ Can only delete workers added today — contact Admin",
                false,
            );
            return;
        }
    }
    if (!confirm("Delete worker?")) return;
    try {
        await dbDelete("workers", id);
        renderWorkers();
        toast("Worker deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ MATERIAL MASTER ════════════
async function saveMatMaster() {
    if (editId && !guard("canEditMaterial", "Admin only")) return;
    if (!editId && !guard("canAddMaterial", "Admin only")) return;
    const name = document.getElementById("mm_name").value.trim();
    if (!name) {
        toast("Material name required", false);
        return;
    }
    const obj = {
        name,
        category: document.getElementById("mm_cat").value,
        unit: document.getElementById("mm_unit").value,
        default_rate:
            parseFloat(document.getElementById("mm_rate").value) || 0,
        status: document.getElementById("mm_status").value,
    };
    try {
        if (editId) await dbUpdate("materials_master", editId, obj);
        else await dbInsert("materials_master", obj);
        closeModal("matMasterModal");
        populateAllDropdowns();
        renderMatMaster();
        toast(editId ? "Updated!" : "Material added!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editMatMaster(id) {
    if (!guard("canEditMaterial", "Admin only")) return;
    editId = id;
    const mats = await dbGet("materials_master");
    const m = mats.find((x) => x.id === id);
    if (!m) return;
    document.getElementById("matMasterModalTitle").textContent =
        "Edit Material";
    document.getElementById("mm_name").value = m.name;
    document.getElementById("mm_cat").value = m.category || "Cement";
    document.getElementById("mm_unit").value = m.unit || "";
    document.getElementById("mm_rate").value = m.default_rate || 0;
    document.getElementById("mm_status").value = m.status || "Active";
    openModal("matMasterModal");
}
async function deleteMatMaster(id) {
    if (!guard("canDeleteMaterial", "Admin only")) return;
    if (!confirm("Delete material?")) return;
    try {
        await dbDelete("materials_master", id);
        populateAllDropdowns();
        renderMatMaster();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ ATTENDANCE ════════════
async function saveAttendance() {
    if (editId && !guard("canEditAttendance", "Cannot edit attendance"))
        return;
    if (!editId && !guard("canAddAttendance", "Cannot add attendance"))
        return;
    const date = document.getElementById("l_date").value;
    const siteId = document.getElementById("l_site").value;
    const workerId = document.getElementById("l_worker").value;
    if (!date || !siteId || !workerId) {
        toast("Date, site and worker required", false);
        return;
    }
    if (!guardPastDate(date, "add attendance for")) return; // ✅ blocks past dates for non-admin
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === siteId);
    const sel = document.getElementById("l_worker");
    const opt = sel.options[sel.selectedIndex];
    const obj = {
        date,
        site_id: siteId,
        site_name: s ? s.name : "",
        worker_id: workerId,
        worker_name: opt ? opt.text : "",
        designation: document.getElementById("l_des").value,
        gender: document.getElementById("l_gender").value,
        wage: parseFloat(document.getElementById("l_wage").value) || 0,
        status: document.getElementById("l_status").value,
        hours: document.getElementById("l_hours").value || null,
        pay: parseFloat(document.getElementById("l_pay").value) || 0,
        remarks: document.getElementById("l_remarks").value,
    };
    try {
        if (editId) await dbUpdate("attendance", editId, obj);
        else await dbInsert("attendance", obj);
        closeModal("labModal");
        renderLabour();
        renderOverview();
        toast(editId ? "Updated!" : "Attendance saved!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editAttendance(id) {
    if (!guard("canEditAttendance", "Cannot edit attendance")) return;
    const entries = await dbGet("attendance");
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    if (!guardPastDate(e.date, "edit")) return;
    editId = id;
    await populateAllDropdowns();
    document.getElementById("labModalTitle").textContent =
        "Edit Attendance";
    document.getElementById("l_date").value = e.date;
    document.getElementById("l_site").value = e.site_id;
    await populateWorkerDropdown();
    document.getElementById("l_worker").value = e.worker_id;
    document.getElementById("l_des").value = e.designation || "";
    document.getElementById("l_gender").value = e.gender || "";
    document.getElementById("l_wage").value = e.wage || 0;
    document.getElementById("l_status").value = e.status || "Present";
    document.getElementById("l_hours").value = e.hours || "";
    document.getElementById("l_pay").value = e.pay || 0;
    document.getElementById("l_remarks").value = e.remarks || "";

    // Lock date for non-admin
    const dateInput = document.getElementById("l_date");
    if (currentRole !== "admin") {
        const today = getToday();
        dateInput.min = today;
        dateInput.max = today;
        dateInput.readOnly = true;
        dateInput.style.background = "var(--bg-readonly)";
        dateInput.style.cursor = "not-allowed";
    } else {
        dateInput.min = "";
        dateInput.max = "";
        dateInput.readOnly = false;
        dateInput.style.background = "";
        dateInput.style.cursor = "";
    }
    openModal("labModal");
    // Sync status pill buttons AFTER openModal (openModal resets to Present)
    const statusClassMap = { "Present": "active-present", "Half Day": "active-halfday", "Absent": "active-absent", "Leave": "active-leave" };
    const pillGrid = document.querySelector("#labModal .m-status-grid");
    if (pillGrid) {
        const statuses = ["Present", "Half Day", "Absent", "Leave"];
        pillGrid.querySelectorAll(".m-status-btn").forEach((btn, i) => {
            btn.className = (statuses[i] === (e.status || "Present"))
                ? "m-status-btn " + (statusClassMap[statuses[i]] || "")
                : "m-status-btn";
        });
    }
}
async function deleteAttendance(id) {
    if (!guard("canDeleteAttendance", "Only Admin can delete attendance"))
        return;
    if (!confirm("Delete entry?")) return;
    try {
        await dbDelete("attendance", id);
        renderLabour();
        renderOverview();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ MATERIAL ENTRIES ════════════
async function saveMatEntry() {
    if (editId && !guard("canEditMatEntry", "Cannot edit material entries"))
        return;
    if (!editId && !guard("canAddMatEntry", "Cannot add material entries"))
        return;
    const date = document.getElementById("me_date").value;
    const siteId = document.getElementById("me_site").value;
    const matId = document.getElementById("me_mat").value;
    if (!date || !siteId || !matId) {
        toast("Date, site and material required", false);
        return;
    }
    if (!guardPastDate(date, "add material entry for")) return;
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === siteId);
    const mats = await dbGet("materials_master");
    const m = mats.find((x) => x.id === matId);
    const obj = {
        date,
        site_id: siteId,
        site_name: s ? s.name : "",
        material_id: matId,
        material_name: m ? m.name : "",
        type: document.getElementById("me_type").value,
        qty: parseFloat(document.getElementById("me_qty").value) || 0,
        unit: document.getElementById("me_unit").value,
        rate: parseFloat(document.getElementById("me_rate").value) || 0,
        amount: parseFloat(document.getElementById("me_amt").value) || 0,
        party: document.getElementById("me_party").value,
    };
    try {
        if (editId) await dbUpdate("material_entries", editId, obj);
        else await dbInsert("material_entries", obj);
        closeModal("matModal");
        renderMaterials();
        renderOverview();
        toast(editId ? "Updated!" : "Entry saved!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editMatEntry(id) {
    if (!guard("canEditMatEntry", "Cannot edit material entries")) return;
    const entries = await dbGet("material_entries");
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    if (!guardPastDate(e.date, "edit")) return;
    editId = id;
    await populateAllDropdowns();
    document.getElementById("matModalTitle").textContent =
        "Edit Material Entry";
    document.getElementById("me_date").value = e.date;
    document.getElementById("me_site").value = e.site_id;
    document.getElementById("me_type").value = e.type;
    document.getElementById("me_mat").value = e.material_id;
    document.getElementById("me_qty").value = e.qty;
    document.getElementById("me_unit").value = e.unit;
    document.getElementById("me_rate").value = e.rate;
    document.getElementById("me_amt").value = e.amount;
    document.getElementById("me_party").value = e.party || "";
    openModal("matModal");
    // Sync IN/OUT toggle AFTER openModal
    const inBtnE = document.getElementById("meTypeIn");
    const outBtnE = document.getElementById("meTypeOut");
    if (inBtnE && outBtnE) {
        if (e.type === "In") {
            inBtnE.className = "m-type-btn active-orange";
            outBtnE.className = "m-type-btn";
        } else {
            outBtnE.className = "m-type-btn active-orange";
            inBtnE.className = "m-type-btn";
        }
    }
}
async function deleteMatEntry(id) {
    if (
        !guard("canDeleteMatEntry", "Only Admin can delete material entries")
    )
        return;
    if (!confirm("Delete entry?")) return;
    try {
        await dbDelete("material_entries", id);
        renderMaterials();
        renderOverview();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ CASHBOOK ════════════
async function saveCash() {
    if (editId && !guard("canEditCash", "Cannot edit cash entries")) return;
    if (!editId && !guard("canAddCash", "Cannot add cash entries")) return;
    const date = document.getElementById("c_date").value;
    const siteId = document.getElementById("c_site").value;
    const amt = parseFloat(document.getElementById("c_amt").value) || 0;
    const party = document.getElementById("c_party").value.trim();
    // BUG-009: party is now required
    if (!date || !siteId || !amt) {
        toast("Date, site and amount required", false);
        return;
    }
    if (!party) {
        toast("Party is required", false);
        document.getElementById("c_party").focus();
        return;
    }
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === siteId);
    const obj = {
        date,
        site_id: siteId,
        site_name: s ? s.name : "",
        type: document.getElementById("c_type").value,
        head: document.getElementById("c_head").value,
        amount: amt,
        mode: document.getElementById("c_mode").value,
        party: party,  // BUG-009: use validated party
        notes: document.getElementById("c_notes").value,
    };
    try {
        if (editId) await dbUpdate("cashbook", editId, obj);
        else await dbInsert("cashbook", obj);
        closeModal("cashModal");
        renderCash();
        renderOverview();
        toast(editId ? "Updated!" : "Cash entry saved!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editCash(id) {
    if (!guard("canEditCash", "Cannot edit cash entries")) return;
    editId = id;
    const entries = await dbGet("cashbook");
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    await populateAllDropdowns();
    document.getElementById("cashModalTitle").textContent =
        "Edit Cash Entry";
    document.getElementById("c_date").value = e.date;
    document.getElementById("c_site").value = e.site_id;
    document.getElementById("c_type").value = e.type;
    document.getElementById("c_head").value = e.head;
    document.getElementById("c_amt").value = e.amount;
    document.getElementById("c_mode").value = e.mode || "Cash";
    document.getElementById("c_party").value = e.party || "";
    document.getElementById("c_notes").value = e.notes || "";

    openModal("cashModal");
    // Sync type toggle pills AFTER openModal (openModal resets to defaults)
    const msBtnE = document.getElementById("cashTypeMS");
    const expBtnE = document.getElementById("cashTypeExp");
    if (msBtnE && expBtnE) {
        if (e.type === "Money Sent") {
            msBtnE.className = "m-type-btn active-green";
            expBtnE.className = "m-type-btn";
        } else {
            expBtnE.className = "m-type-btn active-green";
            msBtnE.className = "m-type-btn";
        }
    }
    // Sync payment mode pill grid
    const modeLabels = { "Cash": "Cash", "UPI": "UPI", "Bank Transfer": "Bank", "Cheque": "Cheque", "NEFT": "NEFT", "RTGS": "RTGS" };
    document.querySelectorAll("#cashModeGrid .m-mode-btn").forEach(btn => {
        const matches = Object.entries(modeLabels).some(([val, lbl]) => val === (e.mode || "Cash") && btn.textContent.trim() === lbl);
        btn.className = matches ? "m-mode-btn active" : "m-mode-btn";
    });
}
async function deleteCash(id) {
    if (!guard("canDeleteCash", "Only Admin can delete cash entries"))
        return;
    if (!confirm("Delete entry?")) return;
    try {
        await dbDelete("cashbook", id);
        renderCash();
        renderOverview();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ RENDER OVERVIEW ════════════
async function renderOverview() {
    const gSite = document.getElementById("gSite").value;
    const gSiteName = gSite
        ? (
            document.getElementById("gSite")?.options[
                document.getElementById("gSite")?.selectedIndex
            ]?.text || ""
        ).trim()
        : "";

    const [sites, attend, mats, cash] = await Promise.all([
        dbGet("sites"),
        dbGet("attendance"),
        dbGet("material_entries"),
        dbGet("cashbook"),
    ]);

    // Helper: does a record belong to selected site?
    function matchSite(rec) {
        if (!gSite) return true;
        return rec.site_id === gSite || (rec.site_name && rec.site_name.trim() === gSiteName);
    }

    // Filter all data by selected site upfront
    const filtSites = gSite ? sites.filter(s => s.id === gSite || s.name === gSiteName) : sites;
    const filtAttend = attend.filter(matchSite);
    const filtMats = mats.filter(matchSite);
    const filtCash = cash.filter(matchSite);

    // ── TREND CALCULATIONS ──
    const last7Days = [];
    const prev7Days = [];
    for (let i = 0; i < 7; i++) {
        last7Days.push(new Date(new Date().getTime() - i * 86400000).toISOString().split("T")[0]);
        prev7Days.push(new Date(new Date().getTime() - (i + 7) * 86400000).toISOString().split("T")[0]);
    }
    const sumLab = (dates) => filtAttend.filter(a => dates.includes(a.date)).reduce((s, a) => s + (a.pay || 0), 0);
    const sumCash = (dates) => filtCash.filter(c => dates.includes(c.date) && c.type === "Money Sent").reduce((s, c) => s + (c.amount || 0), 0);
    
    const curLab7 = sumLab(last7Days);
    const oldLab7 = sumLab(prev7Days);
    const labTrend = oldLab7 > 0 ? Math.round(((curLab7 - oldLab7) / oldLab7) * 100) : 0;
    
    const curCash7 = sumCash(last7Days);
    const oldCash7 = sumCash(prev7Days);
    const cashTrend = oldCash7 > 0 ? Math.round(((curCash7 - oldCash7) / oldCash7) * 100) : 0;
    const sitesTrend = sites.filter(s => s.status === "Active" && s.created_at >= last7Days[6]).length;

    // Update Trend Labels
    const sTrendEl = document.getElementById("ov-sites-trend");
    if(sTrendEl) sTrendEl.innerHTML = `<span style="color: var(--success);">↗ +${sitesTrend}</span>`;
    const lTrendEl = document.getElementById("ov-labour-trend");
    if(lTrendEl) lTrendEl.innerHTML = `<span style="color: ${labTrend >= 0 ? 'var(--success)' : 'var(--danger)'};">${labTrend >= 0 ? '↗' : '↘'} ${labTrend >= 0 ? '+' : ''}${labTrend}%</span>`;
    const cTrendEl = document.getElementById("ov-cash-trend");
    if(cTrendEl) cTrendEl.innerHTML = `<span style="color: ${cashTrend >= 0 ? 'var(--success)' : 'var(--danger)'};">${cashTrend >= 0 ? '↗' : '↘'} ${cashTrend >= 0 ? '+' : ''}${cashTrend}%</span>`;

    // ── KPIs ──
    document.getElementById("ov-sites").textContent = filtSites.filter(s => s.status === "Active").length;
    document.getElementById("ov-labour").textContent = fmtF(filtAttend.reduce((s, a) => s + (a.pay || 0), 0));
    document.getElementById("ov-mat").textContent = fmtF(filtMats.filter(m => m.type === "In").reduce((s, m) => s + (m.amount || 0), 0));

    const sentOverall = filtCash.filter(c => c.type === "Money Sent").reduce((s, c) => s + (c.amount || 0), 0);
    const expOverall = filtCash.filter(c => c.type === "Expense").reduce((s, c) => s + (c.amount || 0), 0);
    const balOverall = sentOverall - expOverall;
    const bEl = document.getElementById("ov-cash");
    if(bEl) {
        bEl.textContent = fmtF(Math.abs(balOverall));
        bEl.style.color = balOverall >= 0 ? "var(--success)" : "var(--danger)";
    }

    // ── SITE-WISE COST (HORIZONTAL BARS) ──
    const siteCostsData = filtSites.map(s => {
        const cost = attend.filter(a => a.site_id === s.id || a.site_name === s.name).reduce((t, a) => t + (a.pay || 0), 0) +
                     mats.filter(m => (m.site_id === s.id || m.site_name === s.name) && m.type === "In").reduce((t, m) => t + (m.amount || 0), 0);
        return { name: s.name, cost };
    }).sort((a,b) => b.cost - a.cost).slice(0, 5);
    
    const maxCost = Math.max(...siteCostsData.map(c => c.cost)) || 1;
    const barListEl = document.getElementById("siteBarList");
    if(barListEl) barListEl.innerHTML = siteCostsData.map(sc => {
        const pct = Math.round((sc.cost / maxCost) * 100);
        return `<div class="sbar-wrap">
            <div class="sbar-lbl"><span>${sc.name}</span><span>${pct}%</span></div>
            <div class="sbar-bg"><div class="sbar-fill" style="width: ${pct}%"></div></div>
        </div>`;
    }).join("") || '<div style="text-align:center; padding: 20px; color: #94a3b8;">No cost data yet.</div>';

    // ── SITE SUMMARY TABLE ──
    const ovTableEl = document.getElementById("ovTable");
    if(ovTableEl) ovTableEl.innerHTML = filtSites.length === 0
        ? '<tr><td colspan="4" style="text-align:center; padding: 40px; color: #94a3b8;">No sites found.</td></tr>'
        : filtSites.map(s => {
            const sL = attend.filter(a => a.site_id === s.id || a.site_name === s.name).reduce((t, a) => t + (a.pay || 0), 0);
            const sM = mats.filter(m => (m.site_id === s.id || m.site_name === s.name) && m.type === "In").reduce((t, m) => t + (m.amount || 0), 0);
            const sSent = cash.filter(c => (c.site_id === s.id || c.site_name === s.name) && c.type === "Money Sent").reduce((t, c) => t + (c.amount || 0), 0);
            const sExp = cash.filter(c => (c.site_id === s.id || c.site_name === s.name) && c.type === "Expense").reduce((t, c) => t + (c.amount || 0), 0);
            const sBal = sSent - sExp;
            return `<tr>
                <td style="font-weight: 700; color: var(--text);">${s.name}</td>
                <td>${fmt(sL)}</td>
                <td>${fmt(sM)}</td>
                <td style="color: ${sBal >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight: 700; text-align: right;">${fmt(sBal)}</td>
            </tr>`;
        }).join("");

    // ── Trend Chart — last 7 days (filtered) ──
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(new Date().getTime() - i * 86400000);
        days.push(d.toISOString().split("T")[0]);
    }
    const dData = days.map((d) =>
        filtAttend
            .filter((a) => a.date === d)
            .reduce((s, a) => s + (a.pay || 0), 0),
    );
    if (trendChart2) trendChart2.destroy();
    trendChart2 = new Chart(
        document.getElementById("trendChart").getContext("2d"),
        {
            type: "line",
            data: {
                labels: days.map((d) => {
                    const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                    return daysMap[new Date(d).getDay()];
                }),
                datasets: [
                    {
                        label: "Labour Cost",
                        data: dData,
                        borderColor: "#eab308",
                        backgroundColor: "rgba(234, 179, 8, 0.1)",
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointBackgroundColor: "#eab308"
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { 
                    x: { 
                        grid: { display: false },
                        ticks: { color: "#94a3b8", font: { size: 11 } }
                    },
                    y: { 
                        beginAtZero: true,
                        grid: { color: "rgba(255,255,255,0.03)" },
                        ticks: { color: "#94a3b8", font: { size: 11 } }
                    }
                },
            },
        },
    );
}

// ════════════ RENDER LABOUR ════════════
function setLabStatus(status) {
    document.getElementById('labStatus').value = status;
    document.querySelectorAll('#labStatusGroup .pill').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === (status || 'All'));
    });
    renderLabour();
}

async function renderLabour() {
    const date = document.getElementById("labDate").value,
        site = document.getElementById("labSite").value;
    const des = document.getElementById("labDes").value,
        search = document.getElementById("labSearch").value.toLowerCase(),
        statusFilter = document.getElementById("labStatus")?.value;
    let E = await dbGet("attendance");
    if (date) E = E.filter((e) => e.date === date);
    if (site) {
        const _sName = (
            document.getElementById("labSite")?.options[
                document.getElementById("labSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        E = E.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
    }
    if (des)
        E = E.filter(
            (e) => (e.designation || "").toLowerCase() === des.toLowerCase(),
        );
    if (search)
        E = E.filter((e) =>
            (e.worker_name || "").toLowerCase().includes(search),
        );
    if (statusFilter) E = E.filter(e => e.status === statusFilter);
    E.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const total = E.reduce((s, e) => s + (+e.pay || 0), 0);
    const p = E.filter((e) => e.status === "Present").length;
    document.getElementById("labTotalPay").textContent = fmtF(total);
    const labTotFoot = document.getElementById("labTotalPayFoot");
    if (labTotFoot) labTotFoot.textContent = fmtF(total);
    
    document.getElementById("labP").textContent = p;
    document.getElementById("labH").textContent = E.filter(
        (e) => e.status === "Half Day",
    ).length;
    document.getElementById("labA").textContent = E.filter(
        (e) => e.status === "Absent",
    ).length;
    
    const countEl = document.getElementById("labCount");
    if (countEl) countEl.textContent = E.length + " records";
    const dB = {
        Mason: "bg-blue",
        Labour: "bg-gray",
        Helper: "bg-orange",
        Carpenter: "bg-purple",
        Barbender: "bg-green",
    };
    const sB = {
        Present: "bg-green",
        "Half Day": "bg-orange",
        Absent: "bg-red",
        Leave: "bg-gray",
    };
    const canEdit = can("canEditAttendance"),
        canDel = can("canDeleteAttendance");

    const cardsHtml = E.map((e) => {
        return `<div class="labour-accordion card" style="padding: 0; margin-bottom: 12px; overflow: hidden; border-radius: 12px; border: 1px solid var(--border-light);">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; cursor: pointer; background: var(--bg-card); transition: 0.2s;" onclick="toggleAccordion('labacc-${e.id}')">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="wav" style="width:42px; height:42px; font-size:18px; background:${strCol(e.worker_name)}; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; flex-shrink:0;">${(e.worker_name || "?")[0].toUpperCase()}</div>
                    <div>
                        <h4 style="margin:0; font-size: 15px; font-weight: 800; color: var(--text);">${e.worker_name || ""}</h4>
                        <p style="margin:0; font-size: 11.5px; color: var(--muted);">${e.designation || ""} • ${e.site_name || ""}</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 24px;">
                    <div style="text-align: right;">
                        <strong style="color: var(--text); font-size: 14px;">${fmtF(e.pay)}</strong>
                        <div style="font-size: 10.5px; color: var(--muted); text-transform: uppercase;">Pay</div>
                    </div>
                    <span class="badge ${sB[e.status] || "bg-gray"}">${e.status || ""}</span>
                    <div style="color: var(--muted); font-size: 12px;">▼</div>
                </div>
            </div>
            <div id="labacc-${e.id}" style="display: none; border-top: 1px solid var(--border-light); padding: 16px; background: var(--bg);">
                <div class="g2" style="margin-bottom: 12px;">
                    <div style="background: var(--bg-card); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light);">
                        <div style="font-size: 10px; color: var(--muted); font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px;">DETAILS</div>
                        <p style="margin:0 0 4px 0; font-size: 13px; color: var(--text-2);">Hours: <strong style="color: var(--text)">${e.hours || "–"}</strong></p>
                        <p style="margin:0; font-size: 13px; color: var(--text-2);">Wage/Day: <strong style="color: var(--text)">${fmt(e.wage || 0)}</strong></p>
                    </div>
                    <div style="background: var(--bg-card); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light);">
                        <div style="font-size: 10px; color: var(--muted); font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px;">NOTES</div>
                        <p style="margin:0; font-size: 13px; color: var(--text-2); overflow-wrap: break-word;">${e.remarks || "No remarks"}</p>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    ${canEdit ? `<button class="btn btn-outline" style="font-size: 11px; padding: 4px 10px;" onclick="editAttendance('${e.id}')">✏️ Edit</button>` : ""}
                    ${canDel ? `<button class="btn btn-outline" style="font-size: 11px; padding: 4px 10px; color: var(--danger); border-color: rgba(244,63,94,0.2);" onclick="deleteAttendance('${e.id}')">🗑 Delete</button>` : ""}
                </div>
            </div>
        </div>`;
    }).join("");

    const container = document.getElementById("labCardsContainer");
    if (container) container.innerHTML = cardsHtml || '<div style="text-align:center; padding: 40px; color: var(--muted);">No records found.</div>';

    // Doughnut chart
    const sites = await dbGet("sites"),
        allA = await dbGet("attendance");
    if (labChart2) labChart2.destroy();
    labChart2 = new Chart(
        document.getElementById("labChart").getContext("2d"),
        {
            type: "doughnut",
            data: {
                labels: sites.map((s) => s.name),
                datasets: [
                    {
                        data: sites.map((s) =>
                            allA
                                .filter((a) => a.site_id === s.id)
                                .reduce((t, a) => t + (a.pay || 0), 0),
                        ),
                        backgroundColor: [
                            "#f97316",
                            "#3b82f6",
                            "#22c55e",
                            "#8b5cf6",
                            "#f59e0b",
                        ],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
            },
        },
    );
}

function setMatTypeFilter(val) {
    document.getElementById('matType').value = val;
    const btns = document.querySelectorAll('.btn-mat-type');
    btns.forEach(b => b.classList.remove('active'));
    if(event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    renderMaterials();
}

async function renderMaterials() {
    const site = document.getElementById("matSite").value,
        name = document.getElementById("matName").value;
    const type = document.getElementById("matType").value;
    const search = document.getElementById("matSearch").value.toLowerCase();
    
    let E = await dbGet("material_entries");
    if (site) {
        const _sName = (
            document.getElementById("matSite")?.options[
                document.getElementById("matSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        E = E.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
    }
    if (name) E = E.filter((e) => (e.material_name || "").toLowerCase() === name.toLowerCase());
    if (type) E = E.filter((e) => e.type === type);
    
    E.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    
    if (search) {
        E = E.filter(
            (e) =>
                (e.material_name || "").toLowerCase().includes(search) ||
                (e.party || "").toLowerCase().includes(search),
        );
    }

    const inVal = E.filter((e) => e.type === "In").reduce((s, e) => s + (e.amount || 0), 0);
    const outVal = E.filter((e) => e.type === "Out").reduce((s, e) => s + (e.amount || 0), 0);
    
    const elInVal = document.getElementById("matInVal");
    const elOutVal = document.getElementById("matOutVal");
    const elInCnt = document.getElementById("matInCnt");
    const elOutCnt = document.getElementById("matOutCnt");

    if (elInVal) elInVal.textContent = fmt(inVal);
    if (elOutVal) elOutVal.textContent = fmt(outVal);
    if (elInCnt) elInCnt.textContent = E.filter((e) => e.type === "In").length;
    if (elOutCnt) elOutCnt.textContent = E.filter((e) => e.type === "Out").length;
    
    const canEdit = can("canEditMatEntry"),
        canDel = can("canDeleteMatEntry");
    
    const matTable = document.getElementById("matTable");
    if (matTable) {
        matTable.innerHTML = E.map((e) => {
            const badgeCls = e.type === "In" ? "badge-in" : "badge-out";
            const typeStr = e.type === "In" ? "📥 IN" : "📤 OUT";
            return `<tr>
                <td>${e.date || ""}</td>
                <td style="font-weight: 500;">${e.material_name || ""}</td>
                <td>${e.site_name || ""}</td>
                <td><span class="${badgeCls}">${typeStr}</span></td>
                <td>${e.qty || 0} ${e.unit || ""}</td>
                <td>₹${e.rate || 0}</td>
                <td class="mat-amount-td">₹${fmt(e.amount)}</td>
                <td>${e.party || "-"}</td>
                <td style="text-align:right;white-space:nowrap">
                    ${canEdit ? `<button class="mat-action-btn" onclick="editMatEntry('${e.id}')">✏️</button>` : ""}
                    ${canDel ? `<button class="mat-action-btn" onclick="deleteMatEntry('${e.id}')">🗑</button>` : ""}
                </td>
            </tr>`;
        }).join("") || '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No entries matching filter.</td></tr>';
    }

    // Stock summary — updated thin orange progress bars
    let allE = await dbGet("material_entries");
    if (site) {
        const _sn = (document.getElementById("matSite")?.options[document.getElementById("matSite")?.selectedIndex]?.text || "").trim();
        allE = allE.filter(e => e.site_id === site || (e.site_name && e.site_name.trim() === _sn));
    }
    const mMast = await dbGet("materials_master");
    
    const stockData = mMast.map(m => {
        const inQ = allE.filter(e => e.material_id === m.id && e.type === "In").reduce((s, e) => s + (e.qty || 0), 0);
        const outQ = allE.filter(e => e.material_id === m.id && e.type === "Out").reduce((s, e) => s + (e.qty || 0), 0);
        const net = inQ - outQ;
        const pct = inQ > 0 ? Math.min(100, Math.max(0, Math.round((net / inQ) * 100))) : 0;
        return { name: m.name, net, unit: m.unit, pct };
    }).sort((a, b) => b.net - a.net);

    const stockList = document.getElementById("stockList");
    if (stockList) {
        stockList.innerHTML = stockData.map(s => `
            <div class="stk-wrap">
                <div class="stk-title">${s.name}</div>
                <div class="stk-right">
                    <div class="stk-bg">
                        <div class="stk-fill" style="width:${s.pct}%"></div>
                    </div>
                    <div class="stk-val">${s.net} ${s.unit}</div>
                </div>
            </div>
        `).join("") || '<p style="color:var(--muted);font-size:13px;text-align:center;">No stock data available.</p>';
    }
}

// ════════════ RENDER CASHBOOK ════════════
async function renderCash() {
    const site = document.getElementById("cashSite").value,
        type = document.getElementById("cashType").value;
    const head = document.getElementById("cashHead").value,
        from = document.getElementById("cashFrom").value;
    const to = document.getElementById("cashTo").value,
        search = document.getElementById("cashSearch").value.toLowerCase();
    
    // Fetch both tables
    const [E, M] = await Promise.all([
        dbGet("cashbook"),
        dbGet("material_entries")
    ]);

    let filtCash = E;
    let filtMat = M;

    if (site) {
        const _sName = (
            document.getElementById("cashSite")?.options[
                document.getElementById("cashSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        filtCash = filtCash.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
        filtMat = filtMat.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
    }
    // ... filtering filtCash (E) ...
    if (type) filtCash = filtCash.filter((e) => e.type === type);
    if (head) filtCash = filtCash.filter((e) => e.head === head);
    if (from) filtCash = filtCash.filter((e) => e.date >= from);
    if (to) filtCash = filtCash.filter((e) => e.date <= to);
    if (search)
        filtCash = filtCash.filter(
            (e) =>
                (e.site_name || "").toLowerCase().includes(search) ||
                (e.party || "").toLowerCase().includes(search),
        );
    
    // Date filtering for Materials too in Cashbook
    if (from) filtMat = filtMat.filter((e) => e.date >= from);
    if (to) filtMat = filtMat.filter((e) => e.date <= to);

    filtCash.sort((a, b) => b.date.localeCompare(a.date));
    
    const sent = filtCash.filter((e) => e.type === "Money Sent").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    const exp = filtCash.filter((e) => e.type === "Expense").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    
    // Aggregate material purchases manually
    const matPurchased = filtMat.filter(e => e.type === "In").reduce((s, e) => s + (e.amount || 0), 0);

    document.getElementById("cashSent").textContent = fmtF(sent);
    document.getElementById("cashExp").textContent = fmtF(exp);
    document.getElementById("cashBal").textContent = fmtF(sent - exp);
    document.getElementById("cashLabPaid").textContent = fmtF(
        filtCash.filter((e) => e.head === "Labour Payment").reduce(
            (s, e) => s + (e.amount || 0),
            0,
        ),
    );
    // Combine cashbook "Material Purchase" records with the actual material entry totals
    const explicitMatCash = filtCash.filter((e) => e.head === "Material Purchase").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    document.getElementById("cashMatBought").textContent = fmtF(matPurchased + explicitMatCash);
    const canEdit = can("canEditCash"),
        canDel = can("canDeleteCash");
    document.getElementById("cashTable").innerHTML =
        filtCash.map(
            (e) => `<tr>
    <td>${e.date || ""}</td><td>${e.site_name || ""}</td>
    <td><span class="badge ${e.type === "Money Sent" ? "bg-green" : "bg-red"}">${e.type === "Money Sent" ? "Sent" : "Exp"}</span></td>
    <td>${e.head || ""}</td>
    <td><strong style="color:${e.type === "Money Sent" ? "var(--success)" : "var(--danger)"}">${e.type === "Money Sent" ? "+" : "-"}${fmtF(e.amount)}</strong></td>
    <td><span class="badge bg-blue">${e.mode || ""}</span></td><td>${(e.party && e.party.trim()) ? e.party : '—'}</td><td>${e.notes || ""}</td>
    <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editCash('${e.id}')">✏️</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteCash('${e.id}')">🗑</button>` : ""}</td>
  </tr>`,
        ).join("") ||
        '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px">No entries. Click "+ Add Entry".</td></tr>';

    // Site balance
    const sites = await dbGet("sites"),
        allC = await dbGet("cashbook");
    document.getElementById("cashSiteTable").innerHTML =
        sites
            .map((s) => {
                const sS = allC.filter((c) => c.site_id === s.id && c.type === "Money Sent").reduce((t, c) => t + (c.amount || 0), 0);
                const sE = allC.filter((c) => c.site_id === s.id && c.type === "Expense").reduce((t, c) => t + (c.amount || 0), 0);
                const sB = sS - sE;
                return `<tr><td><strong>${s.name}</strong></td><td style="color:var(--success)">${fmtF(sS)}</td><td style="color:var(--danger)">${fmtF(sE)}</td><td style="color:${sB >= 0 ? "var(--success)" : "var(--danger)"}">${fmtF(sB)}</td></tr>`;
            })
            .join("") ||
        '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">No sites found.</td></tr>';
}

async function renderSites() {
    let S = await dbGet("sites");
    const q = document.getElementById("siteSearchInp")?.value.toLowerCase() || "";
    const filterStatus = document.getElementById("siteStatusFilt")?.value || "";
    
    if (q) S = S.filter((s) => s.name.toLowerCase().includes(q));
    if (filterStatus) S = S.filter((s) => s.status === filterStatus);

    const [attend, mats, cash, workers] = await Promise.all([
        dbGet("attendance"),
        dbGet("material_entries"),
        dbGet("cashbook"),
        dbGet("workers")
    ]);

    const sc = { Active: "bg-green", Completed: "bg-gray", "On Hold": "bg-orange" };
    const canEdit = can("canEditSite");

    let totL = 0, totM = 0, totBal = 0;
    const cardsHtml = S.map((s) => {
        const sL = attend.filter(a => a.site_id === s.id || a.site_name === s.name).reduce((t, a) => t + (a.pay || 0), 0);
        const sM = mats.filter(m => (m.site_id === s.id || m.site_name === s.name) && m.type === "In").reduce((t, m) => t + (m.amount || 0), 0);
        const sSent = cash.filter(c => (c.site_id === s.id || c.site_name === s.name) && c.type === "Money Sent").reduce((t, c) => t + (c.amount || 0), 0);
        const sExp = cash.filter(c => (c.site_id === s.id || c.site_name === s.name) && c.type === "Expense").reduce((t, c) => t + (c.amount || 0), 0);
        const sBal = sSent - sExp;
        
        totL += sL;
        totM += sM;
        totBal += sBal;

        const wCount = workers.filter(w => w.site_id === s.id).length;
        const engs = (s.engineerids || []).length;
        const engStr = engs ? `${engs} Engineer(s)` : "None";
        const pct = sL+sM > 0 ? Math.min(100, Math.round(((sL+sM) / (sL+sM+Math.abs(sBal)+1)) * 100)) : 15;

        return `<div class="site-accordion card" style="padding: 0; margin-bottom: 12px; overflow: hidden; border-radius: 12px; border: 1px solid var(--border-light);">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; cursor: pointer; background: var(--bg-card); transition: 0.2s;" onclick="toggleAccordion('siteacc-${s.id}')">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width:42px; height:42px; font-size:20px; background: var(--info-bg); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink:0;">🏗️</div>
                    <div>
                        <h4 style="margin:0; font-size: 15px; font-weight: 800; color: var(--text);">${s.name}</h4>
                        <p style="margin:0; font-size: 11.5px; color: var(--muted);">📍 ${s.addr || "No location"}</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 24px;">
                    <div style="text-align: right;">
                        <strong style="color: ${sBal>=0?'var(--success)':'var(--danger)'}; font-size: 14px;">${sBal<0?'-':''}${fmt(Math.abs(sBal))}</strong>
                        <div style="font-size: 10.5px; color: var(--muted); text-transform: uppercase;">Balance</div>
                    </div>
                    <div style="width: 80px;" class="desk-only">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 4px; color: var(--primary); font-weight:700;">
                            <span>Progress</span><span>${pct}%</span>
                        </div>
                        <div style="background: var(--border-light); height: 4px; border-radius: 2px;">
                            <div style="background: var(--primary); height: 100%; width: ${pct}%; border-radius: 2px;"></div>
                        </div>
                    </div>
                    <span class="badge ${sc[s.status] || "bg-gray"}">${s.status}</span>
                    <div style="color: var(--muted); font-size: 12px;">▼</div>
                </div>
            </div>
            <div id="siteacc-${s.id}" style="display: none; border-top: 1px solid var(--border-light); padding: 16px; background: var(--bg);">
                <div class="g2" style="margin-bottom: 16px;">
                    <div style="background: var(--bg-card); padding: 16px; border-radius: 8px; border: 1px solid var(--border-light);">
                        <div style="font-size: 10px; color: var(--muted); font-weight: 700; margin-bottom: 12px; letter-spacing: 0.5px;">TEAM</div>
                        <div style="display: flex; justify-content: space-between;">
                            <div>
                                <p style="margin:0 0 6px 0; font-size: 13px; color: var(--text-2);">Supervisor: <strong style="color: var(--text)">${s.supervisor || "–"}</strong></p>
                                <p style="margin:0; font-size: 13px; color: var(--text-2);">Engineers: <strong style="color: var(--text)">${engStr}</strong></p>
                            </div>
                            <div style="text-align: right; font-size: 12px; color: var(--muted);">👥 ${wCount} workers</div>
                        </div>
                    </div>
                    <div style="background: var(--bg-card); padding: 16px; border-radius: 8px; border: 1px solid var(--border-light);">
                        <div style="font-size: 10px; color: var(--muted); font-weight: 700; margin-bottom: 12px; letter-spacing: 0.5px;">TIMELINE</div>
                        <p style="margin:0 0 6px 0; font-size: 13px; color: var(--text-2);">📅 Start: <strong style="color: var(--text)">${s.start_date || "–"}</strong></p>
                        <p style="margin:0; font-size: 13px; color: var(--text-2);">🎯 End: <strong style="color: var(--text)">${s.end_date || "–"}</strong></p>
                    </div>
                </div>
                <div class="g3" style="gap: 12px;">
                    <div style="background: var(--info-bg); border-radius: 8px; padding: 16px; text-align: center;">
                        <div style="font-size: 18px; margin-bottom: 6px;">👷</div>
                        <strong style="font-size: 16px; display: block; color: var(--info);">${fmt(sL)}</strong>
                        <div style="font-size: 11px; margin-bottom: 12px; color: var(--info);">Labour Cost</div>
                        <button class="btn btn-primary" style="width: 100%; background: var(--info); box-shadow:none;" onclick="document.getElementById('gSite').value='${s.id}'; syncGlobalSite(); showPage('labour', document.getElementById('navLabour'))">View Attendance</button>
                    </div>
                    <div style="background: var(--warning-bg); border-radius: 8px; padding: 16px; text-align: center;">
                        <div style="font-size: 18px; margin-bottom: 6px;">🧱</div>
                        <strong style="font-size: 16px; display: block; color: var(--warning);">${fmt(sM)}</strong>
                        <div style="font-size: 11px; margin-bottom: 12px; color: var(--warning);">Material Cost</div>
                        <button class="btn btn-primary" style="width: 100%; background: var(--warning); box-shadow:none;" onclick="document.getElementById('gSite').value='${s.id}'; syncGlobalSite(); showPage('materials', document.getElementById('navMaterials'))">View Materials</button>
                    </div>
                    <div style="background: var(--success-bg); border-radius: 8px; padding: 16px; text-align: center;">
                        <div style="font-size: 18px; margin-bottom: 6px;">💰</div>
                        <strong style="font-size: 16px; display: block; color: var(--success);">${fmt(sBal)}</strong>
                        <div style="font-size: 11px; margin-bottom: 12px; color: var(--success);">Balance</div>
                        <button class="btn btn-primary" style="width: 100%; background: var(--success); box-shadow:none;" onclick="document.getElementById('gSite').value='${s.id}'; syncGlobalSite(); showPage('cashbook', document.getElementById('navCashbook'))">View Cashbook</button>
                    </div>
                </div>
                ${canEdit ? `<div style="text-align: right; margin-top: 12px;"><button class="btn btn-outline" style="font-size: 11px; padding: 4px 8px;" onclick="editSite('${s.id}')">✏️ Edit Site</button></div>` : ''}
            </div>
        </div>`;
    }).join("");

    const container = document.getElementById("sitesAccordionContainer");
    if (container) container.innerHTML = cardsHtml || '<div style="text-align:center; padding: 40px; color: var(--muted);">No sites found.</div>';

    // Update inline metrics
    const cActiveWork = workers.filter(w => w.status === 'Active').length;
    const elts = { tsCount: S.length, twCount: cActiveWork, tlCost: fmtF(totL), tmCost: fmtF(totM), tnBal: fmtF(totBal) };
    for (let k in elts) {
        if (document.getElementById(k)) document.getElementById(k).textContent = elts[k];
    }
}

let workerViewMode = "list"; // "list" or "grid"

async function renderWorkers(q = "") {
    let W = await dbGet("workers");
    const fSite = document.getElementById("wfSite")?.value || "";
    const fDes = document.getElementById("wfDes")?.value || "";
    const fStatus = document.getElementById("wfStatus")?.value || "";
    const searchVal = document.getElementById("workerSearchInp")?.value || "";
    const sortVal = document.getElementById("wfSort")?.value || "name-asc";

    // Filtering
    if (searchVal) W = W.filter((w) => (w.name || "").toLowerCase().includes(searchVal.toLowerCase()));
    if (fSite) W = W.filter((w) => w.site_id === fSite);
    if (fDes) W = W.filter((w) => w.designation === fDes);
    if (fStatus) W = W.filter((w) => w.status === fStatus);

    // Sorting
    switch (sortVal) {
        case "name-asc":
            W.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
            break;
        case "name-desc":
            W.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
            break;
        case "wage-high":
            W.sort((a, b) => (b.daily_wage || 0) - (a.daily_wage || 0));
            break;
        case "wage-low":
            W.sort((a, b) => (a.daily_wage || 0) - (b.daily_wage || 0));
            break;
        case "recent":
            W.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
            break;
    }

    const canEdit = can("canEditWorker"),
        canDel = can("canDeleteWorker");
    const sites = await dbGet("sites");

    // Designation badge color map
    const desBadge = {
        Mason: "des-blue",
        Labour: "des-red",
        Helper: "des-pink",
        Carpenter: "des-green",
        Barbender: "des-purple",
    };

    // Helper: initials (2 letters)
    function getInitials(name) {
        const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return (parts[0] || "?").substring(0, 2).toUpperCase();
    }

    // ═══ LIST VIEW (Table) ═══
    const tableHtml = W.map((w) => {
        const sName = sites.find((s) => s.id === w.site_id)?.name || "–";
        const joinedDate = w.created_at
            ? new Date(w.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
            : "–";
        const phoneNum = w.phone || "";
        const desClass = desBadge[w.designation] || "des-gray";

        return `<tr class="wt-row">
            <td class="wt-check"><input type="checkbox" class="worker-row-check" value="${w.id}" onclick="event.stopPropagation()" /></td>
            <td>
                <div class="wt-worker-cell">
                    <div class="wt-avatar" style="background: ${strCol(w.name)}">${getInitials(w.name)}</div>
                    <div class="wt-worker-info">
                        <div class="wt-worker-name">${w.name || ""}</div>
                        <div class="wt-worker-phone">${phoneNum || "–"}</div>
                    </div>
                </div>
            </td>
            <td><span class="wt-des-badge ${desClass}">${w.designation || "–"}</span></td>
            <td class="wt-site-cell">${sName}</td>
            <td>${w.gender || "–"}</td>
            <td class="wt-wage-cell">₹${w.daily_wage || 0}</td>
            <td class="wt-date-cell">${joinedDate}</td>
            <td><span class="wt-status-badge ${w.status === "Active" ? "wt-active" : "wt-inactive"}">${w.status || "Active"}</span></td>
            <td class="wt-action-cell">
                <div class="wt-action-wrapper">
                    <button class="wt-action-btn" onclick="event.stopPropagation(); toggleWorkerActionMenu('wt-menu-${w.id}')">⋮</button>
                    <div class="wt-action-menu" id="wt-menu-${w.id}">
                        ${canEdit ? `<button onclick="event.stopPropagation(); editWorker('${w.id}'); closeAllWorkerMenus()">✏️ Edit</button>` : ""}
                        ${canDel ? `<button class="wt-delete-action" onclick="event.stopPropagation(); deleteWorker('${w.id}'); closeAllWorkerMenus()">🗑 Delete</button>` : ""}
                    </div>
                </div>
            </td>
        </tr>`;
    }).join("");

    const tbody = document.getElementById("workersTableBody");
    if (tbody) {
        tbody.innerHTML = tableHtml || `<tr><td colspan="9" style="text-align:center; padding: 60px 20px; color: var(--muted);">No workers found.</td></tr>`;
    }

    // ═══ GRID VIEW (Cards) ═══
    const gridHtml = W.map((w) => {
        const sName = sites.find((s) => s.id === w.site_id)?.name || "–";
        const desClass = desBadge[w.designation] || "des-gray";
        const phoneNum = w.phone || "–";

        return `<div class="wg-card">
            <div class="wg-card-header">
                <div class="wg-card-left">
                    <div class="wg-avatar" style="background: ${strCol(w.name)}">${getInitials(w.name)}</div>
                    <div class="wg-name-block">
                        <div class="wg-name">${w.name || ""}</div>
                        <span class="wt-des-badge ${desClass}">${w.designation || "–"}</span>
                    </div>
                </div>
                <span class="wt-status-badge ${w.status === "Active" ? "wt-active" : "wt-inactive"}">${w.status || "Active"}</span>
            </div>
            <div class="wg-card-body">
                <div class="wg-info-row"><span class="wg-info-icon">📍</span><span class="wg-info-text">${sName}</span></div>
                ${w.phone ? `<div class="wg-info-row"><span class="wg-info-icon">📞</span><span class="wg-info-text">${w.phone}</span></div>` : ""}
            </div>
            <div class="wg-card-footer">
                <span class="wg-wage-label">Wage/day</span>
                <span class="wg-wage-value">₹${w.daily_wage || 0}</span>
            </div>
            ${(canEdit || canDel) ? `<div class="wg-card-actions">
                ${canEdit ? `<button class="wg-action-btn" onclick="editWorker('${w.id}')">✏️</button>` : ""}
                ${canDel ? `<button class="wg-action-btn wg-delete" onclick="deleteWorker('${w.id}')">🗑</button>` : ""}
            </div>` : ""}
        </div>`;
    }).join("");

    const gridContainer = document.getElementById("workersGridView");
    if (gridContainer) {
        gridContainer.innerHTML = gridHtml || '<div style="text-align:center; padding: 60px 20px; color: var(--muted); grid-column: 1/-1;">No workers found.</div>';
    }

    // Apply current view mode
    applyWorkerViewMode();
}

// Toggle between list and grid views
function setWorkerView(view) {
    workerViewMode = view;
    document.getElementById("workerViewList")?.classList.toggle("active", view === "list");
    document.getElementById("workerViewGrid")?.classList.toggle("active", view === "grid");
    applyWorkerViewMode();
}

function applyWorkerViewMode() {
    const listView = document.getElementById("workersListView");
    const gridView = document.getElementById("workersGridView");
    if (listView) listView.style.display = workerViewMode === "list" ? "block" : "none";
    if (gridView) gridView.style.display = workerViewMode === "grid" ? "grid" : "none";
}

function toggleAllWorkerChecks(masterCheckbox) {
    document.querySelectorAll(".worker-row-check").forEach((cb) => {
        cb.checked = masterCheckbox.checked;
    });
}

function toggleWorkerActionMenu(menuId) {
    closeAllWorkerMenus();
    const menu = document.getElementById(menuId);
    if (menu) menu.classList.toggle("open");
}

function closeAllWorkerMenus() {
    document.querySelectorAll(".wt-action-menu").forEach((m) => m.classList.remove("open"));
}

function toggleWorkerRowMenu(event, id) {
    if (event.target.closest('.wt-action-wrapper') || event.target.closest('.wt-check')) return;
}

// ═══ EXCEL EXPORT using SheetJS ═══
async function exportWorkers() {
    const workers = await dbGet("workers");
    const sites = await dbGet("sites");

    // Build rows with proper headers
    const data = workers.map((w, i) => {
        const sName = sites.find((s) => s.id === w.site_id)?.name || "";
        const joined = w.created_at
            ? new Date(w.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
            : "";
        return {
            "S.No": i + 1,
            "Worker Name": w.name || "",
            "Phone": w.phone || "",
            "Designation": w.designation || "",
            "Gender": w.gender || "",
            "Daily Wage (₹)": w.daily_wage || 0,
            "Assigned Site": sName,
            "Status": w.status || "",
            "Date Joined": joined,
        };
    });

    // Create workbook & worksheet
    const ws = XLSX.utils.json_to_sheet(data);

    // Auto-fit column widths
    const colWidths = Object.keys(data[0] || {}).map((key) => {
        const maxLen = Math.max(
            key.length,
            ...data.map((row) => String(row[key] || "").length)
        );
        return { wch: Math.min(maxLen + 3, 30) };
    });
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Workers");

    // Generate and autodownload directly
    XLSX.writeFile(wb, "Workers-" + getToday() + ".xlsx");
    toast("Workers exported as Excel!");
}

// Close menus on outside click
document.addEventListener("click", function (e) {
    if (!e.target.closest(".wt-action-wrapper")) {
        closeAllWorkerMenus();
    }
});



// ── NAVIGATION ──
// ── GLOBAL SITE SYNC ──
function syncGlobalSite(sourceId) {
    const val = document.getElementById(sourceId).value;
    globalSiteVal = val; // BUG-021: remember choice so it survives page switches
    // Push to all page-level site dropdowns for uniformity
    ["gSite", "labSite", "matSite", "cashSite", "wfSite"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
    renderAll();
}

function renderAll() {
    renderOverview();
    renderLabour();
    renderMaterials();
    renderCash();
    renderSites();
    renderWorkers();
}

async function showPage(id, el) {
    if (window.innerWidth <= 900) closeSidebar();
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    document
        .querySelectorAll(".nav-item")
        .forEach((n) => n.classList.remove("active"));
    document.getElementById("page-" + id).classList.add("active");
    if (el) el.classList.add("active");
    const titles = {
        overview: "Overview",
        labour: "Labour",
        materials: "Materials",
        cashbook: "Cashbook",
        sites: "Sites",
        workers: "Workers",
    };
    document.getElementById("pgT").textContent = titles[id] || "Dashboard";
    document.getElementById("pgB").textContent =
        "Dashboard › " + (titles[id] || "Dashboard");
    document.getElementById("sidebar").classList.remove("open");
    // sync bottom nav
    document
        .querySelectorAll(".bnav-item")
        .forEach((b) => b.classList.remove("active"));
    const bnEl = document.getElementById("bn-" + id);
    if (bnEl) bnEl.classList.add("active");
    await populateAllDropdowns(); // BUG-021: restore selected site before rendering
    if (id === "overview") renderOverview();
    else if (id === "labour") renderLabour();
    else if (id === "materials") renderMaterials();
    else if (id === "cashbook") renderCash();
    else if (id === "sites") renderSites();
    else if (id === "workers") renderWorkers();
    // resize charts after page switch
    setTimeout(() => {
        if (trendChart2) trendChart2.resize();
        if (siteChart2) siteChart2.resize();
        if (labChart2) labChart2.resize();
    }, 50);
}
// Bottom nav handler (no sidebar nav-item to highlight)
function showPageBnav(id) {
    const navMap = {
        overview: "navOverview",
        labour: "navLabour",
        materials: "navMaterials",
        cashbook: "navCashbook",
    };
    const navEl = navMap[id] ? document.getElementById(navMap[id]) : null;
    showPage(id, navEl);
}
// Password eye toggle
function togglePw(inputId, btn) {
    const el = document.getElementById(inputId);
    el.type = el.type === "password" ? "text" : "password";
    btn.textContent = el.type === "password" ? "👁" : "🙈";
}
function showMaster(id, el) {
    ["sites", "workers", "materials"].forEach((m) => {
        document.getElementById("ms-" + m).style.display =
            m === id ? "block" : "none";
    });
    document
        .querySelectorAll(".mtab")
        .forEach((t) => t.classList.remove("active"));
    el.classList.add("active");
}

// ── EXPORT ──
async function exportData() {
    const [sites, workers, matMaster, attend, mats, cash] =
        await Promise.all([
            dbGet("sites"),
            dbGet("workers"),
            dbGet("materials_master"),
            dbGet("attendance"),
            dbGet("material_entries"),
            dbGet("cashbook"),
        ]);
        
    const wb = XLSX.utils.book_new();

    // Add sheets for all full database sets
    if (sites && sites.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sites), "Sites");
    if (workers && workers.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(workers), "Workers");
    if (matMaster && matMaster.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matMaster), "Materials Master");
    if (attend && attend.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attend), "Attendance");
    if (mats && mats.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mats), "Material Entries");
    if (cash && cash.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cash), "Cashbook");
    
    // Fallback if empty database
    if (wb.SheetNames.length === 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Notice: "No data found" }]), "Empty");
    }

    XLSX.writeFile(wb, "RamaConstruction-" + getToday() + ".xlsx");
    toast("Full Database Exported as Excel!");
}

// ── SIDEBAR TOGGLE (mobile) ──
/* Accordion Toggle */
function toggleAccordion(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
}

function toggleSidebar() {
    const sb = document.getElementById("sidebar");
    const ov = document.getElementById("sidebarOverlay");
    if (window.innerWidth > 900) {
        sb.classList.toggle("minimized");
        // Save state
        localStorage.setItem("sidebarMinimized", sb.classList.contains("minimized"));
    } else {
        const isOpen = sb.classList.toggle("open");
        if (ov) ov.classList.toggle("show", isOpen);
    }
}
function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    const ov = document.getElementById("sidebarOverlay");
    if (ov) ov.classList.remove("show");
}

// ── BOOT ──
window.onload = async function () {
    const { data } = await sb.auth.getSession();
    if (data.session) {
        currentUserId = data.session.user.id;
        showApp(data.session.user);
    } else {
        document.getElementById("loginScreen").style.display = "flex";
        document.getElementById("appWrapper").style.display = "none";
    }
};

// === MOBILE UI REFRESH PATCH ===
(function () {
    const isPhoneView = () => window.innerWidth <= 600;
    const esc = (v) =>
        String(v ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    const selectedText = (id) => {
        const el = document.getElementById(id);
        return (el?.options?.[el.selectedIndex]?.text || "").trim();
    };
    const fmtDate = (v) => v || "";
    const padCode = (n) => `# ${String(n).padStart(3, "0")}`;
    const ensureMobileBox = (parent, id, beforeEl) => {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement("div");
            el.id = id;
            el.className = "mobile-alt-view";
            if (beforeEl) parent.insertBefore(el, beforeEl);
            else parent.appendChild(el);
        }
        return el;
    };
    const initials = (name) => {
        const parts = String(name || "?")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        return (parts[0]?.[0] || "?").toUpperCase();
    };
    const statusBadgeClass = (status) =>
        ({
            Present: "bg-green",
            "Half Day": "bg-orange",
            Absent: "bg-red",
            Leave: "bg-gray",
            Active: "bg-green",
            Inactive: "bg-gray",
            Completed: "bg-blue",
            "On Hold": "bg-orange",
        })[status] || "bg-gray";
    const siteMatch = (entry, siteId, selectId) => {
        if (!siteId) return true;
        const sName = selectedText(selectId);
        return (
            entry.site_id === siteId ||
            (entry.site_name && entry.site_name.trim() === sName) ||
            (entry.sitename && entry.sitename.trim() === sName)
        );
    };
    const actionBtns = (editJs, deleteJs, canEdit, canDel) => {
        const out = [];
        if (canEdit)
            out.push(
                `<button class="mobile-action-btn edit" onclick="${editJs}">✏ Edit</button>`,
            );
        if (canDel)
            out.push(
                `<button class="mobile-action-btn delete" onclick="${deleteJs}">🗑 Delete</button>`,
            );
        return out.length
            ? `<div class="mobile-actions">${out.join("")}</div>`
            : "";
    };

    async function renderLabourMobileUI() {
        const page = document.getElementById("page-labour");
        if (!page) return;
        // Insert mobile view before the main attendance card (first .card after .g4)
        const mainCard = page.querySelector(".card");
        const box = ensureMobileBox(page, "labourMobileView", mainCard);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const date = document.getElementById("labDate")?.value || "";
        const site = document.getElementById("labSite")?.value || "";
        const des = document.getElementById("labDes")?.value || "";
        const search = (
            document.getElementById("labSearch")?.value || ""
        ).toLowerCase();
        const statusFilter = document.getElementById("labStatus")?.value || "";
        let E = await dbGet("attendance");
        if (date) E = E.filter((e) => e.date === date);
        if (site) E = E.filter((e) => siteMatch(e, site, "labSite"));
        if (des)
            E = E.filter(
                (e) => (e.designation || "").toLowerCase() === des.toLowerCase(),
            );
        if (search)
            E = E.filter((e) =>
                (e.worker_name || "").toLowerCase().includes(search),
            );
        if (statusFilter) E = E.filter((e) => e.status === statusFilter);
        E.sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
        );
        const total = E.reduce((s, e) => s + (+e.pay || 0), 0);
        const present = E.filter((e) => e.status === "Present").length;
        const halfDay = E.filter((e) => e.status === "Half Day").length;
        const absent = E.filter((e) => e.status === "Absent").length;
        const leave = E.filter((e) => e.status === "Leave").length;
        const canEditAttendance = can("canEditAttendance");
        const canDeleteAttendance = can("canDeleteAttendance");
        box.innerHTML = `
            <div class="mobile-summary-card">
              <div class="mobile-summary-title">Total Pay (Filtered)</div>
              <div class="mobile-summary-value">${fmtF(total)}</div>
              <div class="mobile-summary-grid">
                <div class="mobile-summary-row"><span>Present</span><strong style="color:#22c55e">${present}</strong></div>
                <div class="mobile-summary-row"><span>Half Day</span><strong style="color:#facc15">${halfDay}</strong></div>
                <div class="mobile-summary-row"><span>Absent</span><strong style="color:#f43f5e">${absent}</strong></div>
                <div class="mobile-summary-row"><span>Leave</span><strong>${leave}</strong></div>
              </div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-head">
                <div class="mobile-section-title">👷 Daily Attendance</div>
                <div class="mobile-count-pill">${present} Present</div>
              </div>
              <div class="mobile-list">
                ${E.length
                ? E.map(
                    (e) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top">
                      <div>
                        <div class="mobile-entry-name">${esc(e.worker_name || "")}</div>
                        <div class="mobile-entry-sub">${esc(e.designation || "")}</div>
                      </div>
                      <span class="badge ${statusBadgeClass(e.status)}">${esc(e.status || "")}</span>
                    </div>
                    <div class="mobile-meta-grid">
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Gender</div><div class="mobile-meta-value">${esc(e.gender || "–")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Site</div><div class="mobile-meta-value">${esc(e.site_name || "–")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Hrs</div><div class="mobile-meta-value">${esc(e.hours ?? "–")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Pay</div><div class="mobile-meta-value" style="color:#16a34a">${fmtF(e.pay)}</div></div>
                    </div>
                    ${e.remarks ? `<div class="mobile-remarks">Remarks: ${esc(e.remarks)}</div>` : ""}
                    ${actionBtns(`editAttendance('${e.id}')`, `deleteAttendance('${e.id}')`, canEditAttendance, canDeleteAttendance)}
                  </div>`,
                ).join("")
                : `<div class="mobile-empty">No records. Click &quot;+ Add Attendance&quot;.</div>`
            }
              </div>
            </div>`;
    }

    async function renderMaterialsMobileUI() {
        const page = document.getElementById("page-materials");
        if (!page) return;
        // BUG-020: the materials page was refactored away from ".g3"; anchor the
        // mobile card view before the (now hidden on phones) ledger table so the
        // cards render in place instead of being appended at the very bottom.
        const beforeEl =
            page.querySelector(".mat-table-container") || page.querySelector(".g3");
        const box = ensureMobileBox(page, "materialsMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const site = document.getElementById("matSite")?.value || "";
        const name = document.getElementById("matName")?.value || "";
        const type = document.getElementById("matType")?.value || "";
        const date = document.getElementById("matDate")?.value || "";
        const search = (
            document.getElementById("matSearch")?.value || ""
        ).toLowerCase();
        let E = await dbGet("material_entries");
        if (site) E = E.filter((e) => siteMatch(e, site, "matSite"));
        if (name)
            E = E.filter(
                (e) =>
                    (e.material_name || "").toLowerCase() === name.toLowerCase(),
            );
        if (type) E = E.filter((e) => e.type === type);
        if (date) E = E.filter((e) => e.date === date);
        if (search)
            E = E.filter(
                (e) =>
                    (e.material_name || "").toLowerCase().includes(search) ||
                    (e.party || "").toLowerCase().includes(search),
            );
        E.sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
        );
        const inVal = E.filter((e) => e.type === "In").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const outVal = E.filter((e) => e.type === "Out").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const inCnt = E.filter((e) => e.type === "In").length;
        const outCnt = E.filter((e) => e.type === "Out").length;
        let allE = await dbGet("material_entries");
        if (site) allE = allE.filter((e) => siteMatch(e, site, "matSite"));
        const mMast = await dbGet("materials_master");
        const canEditMat = can("canEditMatEntry");
        const canDeleteMat = can("canDeleteMatEntry");
        const stockHtml =
            mMast
                .map((m) => {
                    const inQ = allE
                        .filter((e) => e.material_id === m.id && e.type === "In")
                        .reduce((s, e) => s + (+e.qty || 0), 0);
                    const outQ = allE
                        .filter((e) => e.material_id === m.id && e.type === "Out")
                        .reduce((s, e) => s + (+e.qty || 0), 0);
                    const net = inQ - outQ;
                    if (!inQ && !outQ) return "";
                    const pct =
                        inQ > 0
                            ? Math.max(
                                8,
                                Math.min(100, Math.round((Math.abs(net) / inQ) * 100)),
                            )
                            : 8;
                    const negative = net < 0;
                    return `
              <div class="mobile-stock-row">
                <div class="mobile-stock-line"><strong>${esc(m.name || "")}</strong><span class="mobile-stock-qty ${negative ? "negative" : ""}">${net} ${esc(m.unit || "")}</span></div>
                <div class="mobile-stock-bar"><div class="mobile-stock-fill ${negative ? "negative" : ""}" style="width:${pct}%"></div></div>
              </div>`;
                })
                .join("") || '<div class="mobile-empty">No materials.</div>';
        box.innerHTML = `
            <div class="mobile-summary-card">
              <div class="mobile-summary-title">IN Value</div>
              <div class="mobile-summary-value">${fmtF(inVal)}</div>
              <div class="mobile-summary-row"><span>OUT Value</span><strong style="color:#f87171">${fmtF(outVal)}</strong></div>
              <div class="mobile-summary-row"><span>IN Entries</span><strong style="color:#22c55e">${inCnt}</strong></div>
              <div class="mobile-summary-row"><span>OUT Entries</span><strong style="color:#f59e0b">${outCnt}</strong></div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-title">📦 Stock</div>
              <div style="margin-top:12px">${stockHtml}</div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-title">🧱 Material Ledger</div>
              <div class="mobile-list" style="margin-top:12px">
                ${E.length
                ? E.map(
                    (e) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top">
                      <div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><span class="badge ${e.type === "In" ? "bg-green" : "bg-orange"}">${esc(e.type || "")}</span><div class="mobile-entry-name">${esc(e.material_name || "")}</div></div>
                        <div class="mobile-entry-sub">${esc(e.site_name || "")}</div>
                      </div>
                      <div class="mobile-amount ${e.type === "In" ? "pos" : "neg"}">${e.type === "In" ? "+" : "-"}${fmtF(e.amount)}</div>
                    </div>
                    <div class="mobile-meta-grid">
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Date</div><div class="mobile-meta-value">${fmtDate(e.date)}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Qty</div><div class="mobile-meta-value">${esc(e.qty || 0)} ${esc(e.unit || "")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Rate</div><div class="mobile-meta-value">${fmtF(e.rate)}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Party</div><div class="mobile-meta-value">${esc(e.party || "–")}</div></div>
                    </div>
                    ${actionBtns(`editMatEntry('${e.id}')`, `deleteMatEntry('${e.id}')`, canEditMat, canDeleteMat)}
                  </div>`,
                ).join("")
                : '<div class="mobile-empty">No entries.</div>'
            }
              </div>
            </div>`;
    }

    async function renderCashMobileUI() {
        const page = document.getElementById("page-cashbook");
        if (!page) return;
        const beforeEl = page.querySelector(".g5");
        const box = ensureMobileBox(page, "cashbookMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const site = document.getElementById("cashSite")?.value || "";
        const type = document.getElementById("cashType")?.value || "";
        const head = document.getElementById("cashHead")?.value || "";
        const from = document.getElementById("cashFrom")?.value || "";
        const to = document.getElementById("cashTo")?.value || "";
        const search = (
            document.getElementById("cashSearch")?.value || ""
        ).toLowerCase();
        let E = await dbGet("cashbook");
        if (site) E = E.filter((e) => siteMatch(e, site, "cashSite"));
        if (type) E = E.filter((e) => e.type === type);
        if (head) E = E.filter((e) => e.head === head);
        if (from) E = E.filter((e) => String(e.date || "") >= from);
        if (to) E = E.filter((e) => String(e.date || "") <= to);
        if (search)
            E = E.filter((e) =>
                [e.head, e.party, e.notes, e.site_name, e.mode].some((v) =>
                    (v || "").toLowerCase().includes(search),
                ),
            );
        E.sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
        );
        const totalSent = E.filter((e) => e.type === "Money Sent").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const totalExp = E.filter((e) => e.type === "Expense").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const balance = totalSent - totalExp;
        const labourPaid = E.filter(
            (e) => e.head === "Labour Payment",
        ).reduce((s, e) => s + (+e.amount || 0), 0);
        const materialPurchased = E.filter(
            (e) => e.head === "Material Purchase",
        ).reduce((s, e) => s + (+e.amount || 0), 0);
        const canEditCash = can("canEditCash");
        const canDeleteCash = can("canDeleteCash");
        const grouped = {};
        E.forEach((e) => {
            const k = e.site_name || "Unknown Site";
            grouped[k] ||= { sent: 0, exp: 0 };
            if (e.type === "Money Sent") grouped[k].sent += +e.amount || 0;
            else grouped[k].exp += +e.amount || 0;
        });
        box.innerHTML = `
            <div class="mobile-split-grid">
              <div class="mobile-mini-stat"><div class="mobile-mini-icon" style="color:#22c55e">↗</div><div class="mobile-mini-value" style="color:#22c55e">${fmtF(totalSent)}</div><div class="mobile-mini-label">Total Sent</div></div>
              <div class="mobile-mini-stat"><div class="mobile-mini-icon" style="color:#ef4444">↘</div><div class="mobile-mini-value" style="color:#ef4444">${fmtF(totalExp)}</div><div class="mobile-mini-label">Total Expenses</div></div>
              <div class="mobile-mini-stat"><div class="mobile-mini-icon" style="color:#3b82f6">₹</div><div class="mobile-mini-value" style="color:#3b82f6">${fmtF(balance)}</div><div class="mobile-mini-label">Balance</div></div>
              <div class="mobile-mini-stat"><div class="mobile-mini-icon" style="color:#eab308">◌</div><div class="mobile-mini-value" style="color:#eab308">${fmtF(labourPaid)}</div><div class="mobile-mini-label">Labour Paid</div></div>
            </div>
            <div class="mobile-mini-stat" style="margin-bottom:14px"><div class="mobile-mini-icon" style="color:#f97316">📦</div><div class="mobile-mini-value" style="color:#f97316">${fmtF(materialPurchased)}</div><div class="mobile-mini-label">Material Purchased</div></div>
            <div class="mobile-white-card">
              <div class="mobile-section-title">💰 Transactions</div>
              <div class="mobile-list" style="margin-top:12px">
                ${E.length
                ? E.map(
                    (e) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top">
                      <div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><span class="badge ${e.type === "Money Sent" ? "bg-green" : "bg-red"}">${e.type === "Money Sent" ? "Sent" : "Exp"}</span><div class="mobile-entry-name">${esc(e.head || "")}</div></div>
                        <div class="mobile-txn-meta">${fmtDate(e.date)} &nbsp;•&nbsp; ${esc(e.site_name || "")} &nbsp;•&nbsp; ${esc(e.mode || "")}${e.party ? ` &nbsp;•&nbsp; ${esc(e.party)}` : ""}${e.notes ? ` &nbsp;•&nbsp; ${esc(e.notes)}` : ""}</div>
                      </div>
                      <div class="mobile-amount ${e.type === "Money Sent" ? "pos" : "neg"}">${e.type === "Money Sent" ? "+" : ""}${fmtF(e.amount)}</div>
                    </div>
                    ${actionBtns(`editCash('${e.id}')`, `deleteCash('${e.id}')`, canEditCash, canDeleteCash)}
                  </div>`,
                ).join("")
                : '<div class="mobile-empty">No entries. Click &quot;+ Add Entry&quot;.</div>'
            }
              </div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-title">🏗 Site Balance</div>
              <div class="mobile-list" style="margin-top:12px">
                ${Object.keys(grouped).length
                ? Object.entries(grouped)
                    .map(
                        ([name, v]) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top" style="margin-bottom:0">
                      <div class="mobile-entry-name">${esc(name)}</div>
                      <div class="mobile-amount ${v.sent - v.exp >= 0 ? "pos" : "neg"}">${fmtF(v.sent - v.exp)}</div>
                    </div>
                    <div class="mobile-meta-grid" style="margin-top:10px">
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Sent</div><div class="mobile-meta-value" style="color:#f97316">${fmtF(v.sent)}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Expenses</div><div class="mobile-meta-value" style="color:#ef4444">${fmtF(v.exp)}</div></div>
                    </div>
                  </div>`,
                    )
                    .join("")
                : '<div class="mobile-empty">No site balance data.</div>'
            }
              </div>
            </div>`;
    }

    async function renderSitesMobileUI() {
        const wrap = document.getElementById("ms-sites");
        if (!wrap) return;
        // On mobile, the accordion layout is already mobile-friendly.
        // No need to create a separate mobile view - just ensure search uses new input
        if (!isPhoneView()) return;
        // Update search ref to use new input
        const search = (
            document.getElementById("siteSearchInp")?.value || ""
        ).toLowerCase();
        // The accordion is already rendered by renderSites(), nothing extra needed.
    }

    // BUG-020: workers page targeted the stale id "ms-workers" (renamed to
    // "page-workers"), so this renderer early-returned and the overflowing
    // desktop table (.workers-table-card .tw) was never replaced on phones.
    // Retarget to #page-workers, insert before #workersListView, and render
    // expandable cards (key fields on the face, Phone/Joined + actions behind
    // a tap toggle) so nothing ever needs to widen past the viewport.
    async function renderWorkersMobileUI() {
        const wrap = document.getElementById("page-workers");
        if (!wrap) return;
        const beforeEl = document.getElementById("workersListView");
        const box = ensureMobileBox(wrap, "workersMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const search = (
            wrap.querySelector(".fbar input, .topbar-search input")?.value || ""
        ).toLowerCase();
        const site = document.getElementById("wfSite")?.value || "";
        const des = document.getElementById("wfDes")?.value || "";
        let rows = await dbGet("workers");
        if (site) rows = rows.filter((w) => siteMatch(w, site, "wfSite"));
        if (des)
            rows = rows.filter(
                (w) => (w.designation || "").toLowerCase() === des.toLowerCase(),
            );
        if (search)
            rows = rows.filter((w) =>
                [w.name, w.worker_name, w.phone, w.site_name].some((v) =>
                    (v || "").toLowerCase().includes(search),
                ),
            );
        const canEditWorker = can("canEditWorker");
        const canDeleteWorker = can("canDeleteWorker");
        // BUG-021: workers store site_id, not site_name — resolve the site name
        // from the sites list (legacy site_name fallback) so SITE isn't blank.
        const sites = await dbGet("sites");
        box.innerHTML = rows.length
            ? rows
                .map((w) => {
                    const name = w.name || w.worker_name || "";
                    const siteName =
                        sites.find((s) => s.id === w.site_id)?.name ||
                        w.site_name ||
                        "–";
                    const joined = w.created_at
                        ? new Date(w.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                        })
                        : "–";
                    const actions = actionBtns(
                        `editWorker('${w.id}')`,
                        `deleteWorker('${w.id}')`,
                        canEditWorker,
                        canDeleteWorker,
                    );
                    return `
              <div class="mobile-master-card mob-exp">
                <div class="mobile-master-head">
                  <div class="mobile-master-left">
                    <div class="mobile-master-avatar">${initials(name)}</div>
                    <div>
                      <div class="mobile-master-name">${esc(name)}</div>
                      <div class="mobile-master-sub">${esc(w.designation || "")} • ${esc(w.gender || "")}</div>
                    </div>
                  </div>
                  <div class="mobile-head-right">
                    <span class="badge ${statusBadgeClass(w.status || "Active")}">${esc(w.status || "Active")}</span>
                    <button class="mobile-expand-btn" onclick="this.closest('.mob-exp').classList.toggle('open')" aria-label="Toggle details"><span class="chev">▾</span></button>
                  </div>
                </div>
                <div class="mobile-info-grid" style="margin-bottom:0">
                  <div class="mobile-info-box"><div class="mobile-meta-label">Site</div><div class="mobile-meta-value">${esc(siteName)}</div></div>
                  <div class="mobile-info-box"><div class="mobile-meta-label">Wage/Day</div><div class="mobile-meta-value">${fmtF(w.wage || w.daily_wage || 0)}</div></div>
                </div>
                <div class="mobile-entry-more">
                  <div class="mobile-info-grid" style="margin-top:10px;margin-bottom:0">
                    <div class="mobile-info-box"><div class="mobile-meta-label">Phone</div><div class="mobile-meta-value">${esc(w.phone || "–")}</div></div>
                    <div class="mobile-info-box"><div class="mobile-meta-label">Joined</div><div class="mobile-meta-value">${esc(joined)}</div></div>
                  </div>
                  ${actions}
                </div>
              </div>`;
                })
                .join("")
            : '<div class="mobile-empty">No workers found.</div>';
    }

    async function renderMatMasterMobileUI() {
        const wrap = document.getElementById("ms-materials");
        if (!wrap) return;
        const beforeEl = wrap.querySelector(".card");
        const box = ensureMobileBox(wrap, "matMasterMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const search = (
            wrap.querySelector(".fbar input")?.value || ""
        ).toLowerCase();
        let rows = await dbGet("materials_master");
        if (search)
            rows = rows.filter((m) =>
                [m.name, m.category, m.unit].some((v) =>
                    (v || "").toLowerCase().includes(search),
                ),
            );
        const canEditMaterial = can("canEditMaterial");
        const canDeleteMaterial = can("canDeleteMaterial");
        box.innerHTML = rows.length
            ? rows
                .map(
                    (m, i) => `
            <div class="mobile-master-card">
              <div class="mobile-master-head">
                <div class="mobile-master-left">
                  <div class="mobile-master-avatar">📦</div>
                  <div>
                    <div class="mobile-master-code">${padCode(i + 1)}</div>
                    <div class="mobile-master-name">${esc(m.name || "")}</div>
                    <div class="mobile-master-sub">${esc(m.category || "")}</div>
                  </div>
                </div>
                <span class="badge ${statusBadgeClass(m.status || "Active")}">${esc(m.status || "Active")}</span>
              </div>
              <div class="mobile-info-grid">
                <div class="mobile-info-box"><div class="mobile-meta-label">Unit</div><div class="mobile-meta-value">${esc(m.unit || "–")}</div></div>
                <div class="mobile-info-box"><div class="mobile-meta-label">Default Rate</div><div class="mobile-meta-value">${fmtF(m.default_rate || m.rate || 0)}</div></div>
              </div>
              ${actionBtns(`editMatMaster('${m.id}')`, `deleteMatMaster('${m.id}')`, canEditMaterial, canDeleteMaterial)}
            </div>`,
                )
                .join("")
            : '<div class="mobile-empty">No materials found.</div>';
    }

    // BUG-020: the overview "Site Summary" table (.ov2-table-wrapper) had no
    // mobile renderer, so it scrolled horizontally on phones. Render the same
    // rows as expandable cards (name + balance on the face, Labour/Material
    // behind a tap toggle) and hide the desktop table via CSS on phones.
    async function renderOverviewMobileUI() {
        const page = document.getElementById("page-overview");
        if (!page) return;
        const beforeEl = page.querySelector(".ov2-table-panel");
        const box = ensureMobileBox(page, "overviewMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const gSite = document.getElementById("gSite")?.value || "";
        const gSiteName = gSite ? selectedText("gSite") : "";
        const [sites, attend, mats, cash] = await Promise.all([
            dbGet("sites"),
            dbGet("attendance"),
            dbGet("material_entries"),
            dbGet("cashbook"),
        ]);
        const filtSites = gSite
            ? sites.filter((s) => s.id === gSite || s.name === gSiteName)
            : sites;
        const cards = filtSites
            .map((s) => {
                const sL = attend
                    .filter((a) => a.site_id === s.id || a.site_name === s.name)
                    .reduce((t, a) => t + (+a.pay || 0), 0);
                const sM = mats
                    .filter(
                        (m) =>
                            (m.site_id === s.id || m.site_name === s.name) &&
                            m.type === "In",
                    )
                    .reduce((t, m) => t + (+m.amount || 0), 0);
                const sSent = cash
                    .filter(
                        (c) =>
                            (c.site_id === s.id || c.site_name === s.name) &&
                            c.type === "Money Sent",
                    )
                    .reduce((t, c) => t + (+c.amount || 0), 0);
                const sExp = cash
                    .filter(
                        (c) =>
                            (c.site_id === s.id || c.site_name === s.name) &&
                            c.type === "Expense",
                    )
                    .reduce((t, c) => t + (+c.amount || 0), 0);
                const sBal = sSent - sExp;
                return `
              <div class="mobile-entry mob-exp">
                <div class="mobile-entry-top" style="margin-bottom:0">
                  <div class="mobile-entry-name">${esc(s.name || "")}</div>
                  <div class="mobile-head-right">
                    <div class="mobile-amount ${sBal >= 0 ? "pos" : "neg"}">${fmtF(sBal)}</div>
                    <button class="mobile-expand-btn" onclick="this.closest('.mob-exp').classList.toggle('open')" aria-label="Toggle details"><span class="chev">▾</span></button>
                  </div>
                </div>
                <div class="mobile-entry-more">
                  <div class="mobile-meta-grid" style="grid-template-columns:1fr 1fr;margin-top:10px;margin-bottom:0">
                    <div class="mobile-meta-item"><div class="mobile-meta-label">Labour</div><div class="mobile-meta-value">${fmtF(sL)}</div></div>
                    <div class="mobile-meta-item"><div class="mobile-meta-label">Material</div><div class="mobile-meta-value">${fmtF(sM)}</div></div>
                  </div>
                </div>
              </div>`;
            })
            .join("");
        box.innerHTML = `
            <div class="mobile-white-card">
              <div class="mobile-section-title">📋 Site Summary</div>
              <div class="mobile-list" style="margin-top:12px">
                ${filtSites.length ? cards : '<div class="mobile-empty">No sites found.</div>'}
              </div>
            </div>`;
    }

    const mobileHooksApplied = new Set();

    const wrapAsyncWhenReady = (name, fn) => {
        if (mobileHooksApplied.has(name)) return true;
        const original = window[name];
        if (typeof original !== "function") return false;

        window[name] = async function (...args) {
            const out = await original.apply(this, args);
            try {
                await fn();
            } catch (e) {
                console.error(e);
            }
            return out;
        };

        mobileHooksApplied.add(name);
        return true;
    };

    const renderAllMobileViews = () => {
        renderOverviewMobileUI(); // BUG-020
        renderLabourMobileUI();
        renderMaterialsMobileUI();
        renderCashMobileUI();
        renderSitesMobileUI();
        renderWorkersMobileUI();
        renderMatMasterMobileUI();
    };

    const applyMobileHooks = () => {
        const ok = [
            wrapAsyncWhenReady("renderOverview", renderOverviewMobileUI), // BUG-020
            wrapAsyncWhenReady("renderLabour", renderLabourMobileUI),
            wrapAsyncWhenReady("renderMaterials", renderMaterialsMobileUI),
            wrapAsyncWhenReady("renderCash", renderCashMobileUI),
            wrapAsyncWhenReady("renderSites", renderSitesMobileUI),
            wrapAsyncWhenReady("renderWorkers", renderWorkersMobileUI),
            wrapAsyncWhenReady("renderMatMaster", renderMatMasterMobileUI),
        ];

        if (ok.every(Boolean)) {
            renderAllMobileViews();
            return;
        }

        setTimeout(applyMobileHooks, 200);
    };

    window.addEventListener("load", applyMobileHooks);
    // init app
(function initApp() {
    const saved = localStorage.getItem("theme") || "light";
    document.body.setAttribute("data-theme", saved);
    
    // Resume sidebar state
    const sb = document.getElementById("sidebar");
    if (sb && localStorage.getItem("sidebarMinimized") === "true" && window.innerWidth > 900) {
        sb.classList.add("minimized");
    }

    setTimeout(() => {
        const btn = document.getElementById("themeToggleBtn");
        if (btn) btn.innerHTML = saved === "dark" ? "☀️" : "🌙";
    }, 100);
})();
window.addEventListener("resize", renderAllMobileViews);
})();
// === END MOBILE UI REFRESH PATCH ===

// ── THEME TOGGLE ──
function toggleTheme() {
    const currentTheme = document.body.getAttribute("data-theme") || "light";
    const newTheme = currentTheme === "light" ? "dark" : "light";
    document.body.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    
    // Set color-scheme on root
    document.documentElement.style.colorScheme = newTheme;
    const btn = document.getElementById("themeToggleBtn");
    if (btn) btn.innerHTML = newTheme === "dark" ? "☀️" : "🌙";
}

// init theme
(function initTheme() {
    const saved = localStorage.getItem("theme") || "light";
    document.body.setAttribute("data-theme", saved);
    setTimeout(() => {
        const btn = document.getElementById("themeToggleBtn");
        if (btn) btn.innerHTML = saved === "dark" ? "☀️" : "🌙";
    }, 100);
})();

// ════════════ AI ASSISTANT WIDGET LOGIC ════════════

function toggleAIChat() {
    const panel = document.getElementById("aiChatPanel");
    panel.classList.toggle("active");
    if (panel.classList.contains("active")) {
        document.getElementById("aiChatInput").focus();
    }
}

function handleAIChatKeyPress(e) {
    if (e.key === "Enter") sendAIChatMessage();
}

function sendAIChatMessage() {
    const input = document.getElementById("aiChatInput");
    const text = input.value.trim();
    if (!text) return;
    
    // Add user message
    addChatMessage(text, "user");
    input.value = "";
    
    // Show typing
    const typingId = showAITyping();
    
    // Simulate AI response delay
    setTimeout(() => {
        removeChatMessage(typingId);
        const reply = simulateAIResponse(text);
        addChatMessage(reply, "agent");
    }, 1200 + Math.random() * 800);
}

function addChatMessage(text, sender) {
    const body = document.getElementById("aiChatBody");
    const id = "msg-" + Date.now();
    const html = `
        <div id="${id}" class="ai-message ${sender}">
            <div class="ai-bubble">${escapeHTML(text)}</div>
        </div>
    `;
    body.insertAdjacentHTML("beforeend", html);
    body.scrollTop = body.scrollHeight;
    return id;
}

function showAITyping() {
    const body = document.getElementById("aiChatBody");
    const id = "typing-" + Date.now();
    const html = `
        <div id="${id}" class="ai-message agent">
            <div class="ai-bubble ai-typing">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    body.insertAdjacentHTML("beforeend", html);
    body.scrollTop = body.scrollHeight;
    return id;
}

function removeChatMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

// Simulated ConstructCo Assistant Backend
// Replace this function with an actual API call (e.g. to OpenAI/Gemini)
function simulateAIResponse(input) {
    const lower = input.toLowerCase();
    
    // Check Context
    const activePage = document.querySelector(".nav-item.active")?.textContent.trim() || document.querySelector(".bnav-item.active")?.textContent.trim() || "Overview";
    const siteSelect = document.getElementById("globalSiteFilter");
    const selectedSite = siteSelect ? siteSelect.options[siteSelect.selectedIndex]?.text : "All Sites";
    
    if (lower.includes("labour") || lower.includes("worker") || lower.includes("attend")) {
        return `I can help with labour management. Looking at ${selectedSite}, we have attendance data. Would you like to summarize worker hours or flag absenteeism?`;
    }
    if (lower.includes("material") || lower.includes("stock") || lower.includes("cement") || lower.includes("steel")) {
        return `For material tracking at ${selectedSite}, I can show IN/OUT entries and identify low-stock materials. What specific material do you need?`;
    }
    if (lower.includes("cash") || lower.includes("expense") || lower.includes("balance") || lower.includes("money")) {
        return `Checking the Cashbook for ${selectedSite}. I can summarize income/expenses, calculate net balance, or flag unusual transactions.`;
    }
    if (lower.includes("site") || lower.includes("performance") || lower.includes("progress")) {
        return `Sites Overview: I can list active sites, compare site-wise performance, and show detailed site summaries.`;
    }
    if (lower.includes("hello") || lower.includes("hi ") || lower === "hi") {
        return `Hello! ConstructCo Assistant here. Context is set to: [Site: ${selectedSite} | Module: ${activePage}]. I'm here to ensure smooth operations. How can I help?`;
    }
    if (lower.includes("export") || lower.includes("download") || lower.includes("excel")) {
        return "You can export the data to excel directly using the Export button located mapping at the top right of your dashboard. Would you like me to trigger a data dump?";
    }
    
    // Fallback based on system prompt constraints (Concise, action-oriented)
    return `As the ConstructCo Assistant, I prioritize concise, action-oriented answers. You are currently viewing ${selectedSite}. Please format requests focusing on Labour, Materials, Cashbook, Sites, or Workers workflows.`;
}
// == BUG-010: Topbar date drives filter (globalActiveDate) ==
function getActiveDate() {
    return localStorage.getItem('constructco_activeDate') || new Date().toISOString().split('T')[0];
}
// The existing onHeaderDateChange already handles date picking.
// Extend it to broadcast the date globally.
(function patchHeaderDate() {
    const orig = window.onHeaderDateChange;
    window.onHeaderDateChange = function(val) {
        if (val) {
            localStorage.setItem('constructco_activeDate', val);
            window.dispatchEvent(new CustomEvent('activeDateChanged', { detail: val }));
        }
        if (typeof orig === 'function') orig(val);
    };
    // Init: set stored date on the hidden input and label
    document.addEventListener('DOMContentLoaded', function() {
        const saved = localStorage.getItem('constructco_activeDate');
        const inp = document.getElementById('headerDateInput');
        const lbl = document.getElementById('pageHeaderDate');
        if (saved && inp) {
            inp.value = saved;
            if (lbl) {
                const d = new Date(saved + 'T00:00:00');
                lbl.textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            }
        }
    });
})();

// == BUG-012: Login page theme toggle ==
function toggleLoginTheme() {
    const current = document.body.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    document.documentElement.style.colorScheme = next;
    const icon = document.getElementById('loginThemeIcon');
    if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
}
// Init login theme icon after DOM loads
document.addEventListener('DOMContentLoaded', function() {
    const saved = localStorage.getItem('theme') || 'light';
    const icon = document.getElementById('loginThemeIcon');
    if (icon) icon.textContent = saved === 'dark' ? '☀️' : '🌙';
    // BUG-013: init Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();
});
