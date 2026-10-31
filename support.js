
const API_BASE = "https://naijabites.onrender.com";

const form = document.getElementById("supportForm");
const statusEl = document.getElementById("status");
const saved = document.getElementById("savedMessages");

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

async function api(url, options = {}) {
    const r = await fetch(`${API_BASE}${url}`, {
        ...options,
        credentials: "include",
        headers: {
            "Accept": "application/json",
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

async function render() {
    try {
        const d = await api("/api/support/messages/mine");
        const items = d.messages || [];

        saved.innerHTML = items.length
            ? items.map(x => `
                <article class="saved-item">
                    <b>${esc(x.topic)}</b> · ${esc(x.name)}
                    <small>${new Date(x.createdAt).toLocaleString()}</small>
                    <p>${esc(x.message)}</p>
                    <small>${esc(x.email)} · ${esc(x.status)}</small>
                </article>
            `).join("")
            : '<p class="empty">No support messages submitted from your account yet.</p>';

    } catch (e) {
        if (e.message.includes("401")) {
            saved.innerHTML =
                '<p class="empty">Sign in to see messages saved to your account.</p>';
        } else {
            saved.textContent = e.message;
        }
    }
}

form.addEventListener("submit", async e => {
    e.preventDefault();

    const item = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        topic: document.getElementById("topic").value,
        message: document.getElementById("message").value.trim()
    };

    try {
        await api("/api/support/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(item)
        });

        form.reset();
        statusEl.textContent =
            "Message saved to the NaijaBites database.";

        await render();

    } catch (e) {
        statusEl.textContent = e.message;
    }
});

render();
