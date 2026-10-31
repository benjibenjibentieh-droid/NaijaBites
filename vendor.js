
const API_BASE = "https://naijabites.onrender.com";

const $ = id => document.getElementById(id);
let vendor = null;

async function api(url, options = {}) {
    const r = await fetch(`${API_BASE}${url}`, {
        ...options,
        credentials: "include",
        headers: {
            "Accept": "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    const text = await r.text();
    let d;

    try {
        d = JSON.parse(text);
    } catch {
        throw new Error("The server returned an invalid response.");
    }

    if (!r.ok) {
        throw new Error(d.error || `Request failed (${r.status}).`);
    }

    return d;
}

function msg(id, text) {
    $(id).textContent = text || "";
}

function authMode() {
    $("loginForm").hidden = false;
}

function showDashboard() {
    $("authPanel").hidden = true;
    $("dashboard").hidden = false;
    $("companyName").textContent = vendor.companyName;
    loadDashboard();
}

function showAuth() {
    $("authPanel").hidden = false;
    $("dashboard").hidden = true;
}

// Vendor login
$("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    msg("loginMessage", "Signing in…");

    const f = new FormData(e.currentTarget);

    try {
        const d = await api("/api/vendor/login", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(f))
        });

        vendor = d.vendor;
        showDashboard();

    } catch (err) {
        msg("loginMessage", err.message);
    }
});

// Vendor logout
$("logoutButton").addEventListener("click", async () => {
    try {
        await api("/api/vendor/logout", {
            method: "POST",
            body: "{}"
        });
    } catch (e) {
        console.error("Logout error:", e);
    }

    vendor = null;
    showAuth();
    authMode();
});

// Publish meal
$("mealForm").addEventListener("submit", async e => {
    e.preventDefault();

    const form = e.currentTarget;
    msg("mealMessage", "Publishing meal…");

    const f = new FormData(form);
    const body = Object.fromEntries(f);
    body.price = Number(body.price);

    try {
        await api("/api/vendor/products", {
            method: "POST",
            body: JSON.stringify(body)
        });

        form.reset();

        if (form.elements.unit) {
            form.elements.unit.value = "plate";
        }

        msg(
            "mealMessage",
            "Meal published. It is now available on the customer marketplace."
        );

        await loadDashboard();

    } catch (err) {
        msg("mealMessage", err.message);
    }
});

// Add vendor branch location
$("locationForm").addEventListener("submit", async e => {
    e.preventDefault();

    const form = e.currentTarget;
    msg("locationMessage", "Saving branch…");

    try {
        await api("/api/vendor/locations", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });

        form.reset();

        if (form.elements.state) {
            form.elements.state.value = "Lagos";
        }

        msg(
            "locationMessage",
            "Location saved. It will be shown with your meals on the marketplace."
        );

        await loadDashboard();

    } catch (err) {
        msg("locationMessage", err.message);
    }
});

const naira = n =>
    "₦" + Number(n || 0).toLocaleString("en-NG", {
        maximumFractionDigits: 0
    });

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

// Load dashboard data
async function loadDashboard() {
    try {
        const d = await api("/api/vendor/dashboard");

        const products = d.products || [];
        const locations = d.locations || [];

        $("mealCount").textContent = products.length;
        $("locationCount").textContent = locations.length;

        $("vendorMeals").innerHTML = products.length
            ? products.map(p => `
                <article class="vendor-item">
                    <img src="${esc(p.image || "")}" alt="" loading="lazy">
                    <div>
                        <h4>${esc(p.name)}</h4>
                        <p>
                            ${naira(p.price)} · ${esc(p.category)} ·
                            ${p.active ? "Published" : "Hidden"}
                        </p>
                    </div>
                    <button
                        class="${p.active ? "off" : ""}"
                        data-toggle="${esc(p.id)}"
                        data-active="${p.active ? 1 : 0}">
                        ${p.active ? "Hide" : "Publish"}
                    </button>
                </article>
            `).join("")
            : '<p class="muted">No meals yet. Publish your first meal above.</p>';

        $("vendorLocations").innerHTML = locations.length
            ? locations.map(l => `
                <article class="vendor-item">
                    <div class="icon">📍</div>
                    <div>
                        <h4>${esc(l.name)}</h4>
                        <p>
                            ${esc(l.address)}, ${esc(l.city)}, ${esc(l.state)}
                            ${l.phone ? " · " + esc(l.phone) : ""}
                        </p>
                    </div>
                    <button data-delete-location="${esc(l.id)}">
                        Remove
                    </button>
                </article>
            `).join("")
            : '<p class="muted">No locations yet. Add your first branch above.</p>';

    } catch (e) {
        if (
            e.message.toLowerCase().includes("sign in") ||
            e.message.toLowerCase().includes("session") ||
            e.message.includes("401")
        ) {
            vendor = null;
            showAuth();
        } else {
            msg("mealMessage", e.message);
        }
    }
}

// Meal visibility and branch deletion
$("dashboard").addEventListener("click", async e => {
    const toggle = e.target.closest("[data-toggle]");

    if (toggle) {
        try {
            await api(
                `/api/vendor/products/${encodeURIComponent(toggle.dataset.toggle)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        active: toggle.dataset.active !== "1"
                    })
                }
            );

            await loadDashboard();

        } catch (err) {
            msg("mealMessage", err.message);
        }

        return;
    }

    const remove = e.target.closest("[data-delete-location]");

    if (remove && confirm("Remove this branch location?")) {
        try {
            await api(
                `/api/vendor/locations/${encodeURIComponent(remove.dataset.deleteLocation)}`,
                { method: "DELETE" }
            );

            await loadDashboard();

        } catch (err) {
            msg("locationMessage", err.message);
        }
    }
});

// Restore an existing vendor session
(async () => {
    try {
        const d = await api("/api/vendor/me");
        vendor = d.vendor;
        showDashboard();
    } catch {
        showAuth();
    }
})();
