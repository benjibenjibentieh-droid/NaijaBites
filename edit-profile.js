
const API_BASE = "https://naijabites.onrender.com";

const $ = id => document.getElementById(id);

$("year").textContent = new Date().getFullYear();

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

let current = null;

async function loadProfile() {
    try {
        const d = await api("/api/auth/me");
        current = d.user;

        if (!current) {
            $("formMessage").textContent =
                "Please sign in before editing your profile.";
            $("formMessage").className = "form-message error";

            $("profileForm")
                .querySelectorAll("input,button[type=submit]")
                .forEach(el => el.disabled = true);

            return;
        }

        $("fullName").value = current.name || "";
        $("email").value = current.email || "";
        $("phone").value = current.phone || "";

    } catch (e) {
        $("formMessage").textContent = e.message;
        $("formMessage").className = "form-message error";
    }
}

$("profileForm").addEventListener("submit", async e => {
    e.preventDefault();

    const name = $("fullName").value.trim();
    const email = $("email").value.trim().toLowerCase();
    const phone = $("phone").value.trim();

    if (
        name.length < 2 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    ) {
        $("formMessage").textContent =
            "Enter a valid name and email.";
        $("formMessage").className = "form-message error";
        return;
    }

    try {
        await api("/api/auth/profile", {
            method: "PUT",
            body: JSON.stringify({ name, email, phone })
        });

        $("formMessage").textContent =
            "Profile updated successfully.";
        $("formMessage").className = "form-message success";

        location.href = "index.html";

    } catch (err) {
        $("formMessage").textContent = err.message;
        $("formMessage").className = "form-message error";
    }
});

$("signOutButton").addEventListener("click", async () => {
    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch (e) {
        console.error("Logout error:", e);
    }

    location.href = "index.html";
});

loadProfile();
