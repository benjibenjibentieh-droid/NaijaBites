
const API_BASE = "https://naijabites.onrender.com";

const list = document.getElementById("reservationsList");
const notice = document.getElementById("notice");

if (new URLSearchParams(location.search).get("saved") === "1") {
    notice.hidden = false;
    notice.textContent = "Your reservation was saved successfully.";
}

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
    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        credentials: "include",
        headers: {
            "Accept": "application/json",
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
}

async function render() {
    try {
        const me = await api("/api/auth/me");

        if (!me.user) {
            list.innerHTML = `
                <section class="empty-panel">
                    <h2>Sign in to view reservations</h2>
                    <a class="primary" href="index.html?signin=1">Sign in</a>
                </section>`;
            return;
        }

        const d = await api("/api/reservations");
        const items = d.reservations || [];

        if (!items.length) {
            list.innerHTML = `
                <section class="empty-panel">
                    <div>🍽️</div>
                    <h2>No reservations yet</h2>
                    <p>Your saved reservations will appear here.</p>
                    <a class="primary" href="reservations.html">Reserve a table</a>
                </section>`;
            return;
        }

        list.innerHTML = items.map(i => `
            <article class="reservation-card">
                <div class="card-top">
                    <div>
                        <p class="eyebrow">${esc(i.id)}</p>
                        <h2>${esc(i.Restaurant)}</h2>
                    </div>
                    <span class="status">${esc(i.Status || "Booked")}</span>
                </div>

                <div class="details">
                    <p><b>When</b><span>${esc(i.date)} · ${esc(i.time)}</span></p>
                    <p><b>Guests</b><span>${Number(i.Guests) || 1}</span></p>
                    <p><b>Reserved for</b><span>${esc(i.name)}</span></p>
                    <p><b>Contact</b><span>${esc(i.phone)} · ${esc(i.email)}</span></p>
                    ${i.Notes ? `<p><b>Requests</b><span>${esc(i.Notes)}</span></p>` : ""}
                </div>

                ${i.Status === "Cancelled"
                    ? '<p class="cancel-note">This reservation is cancelled.</p>'
                    : `<button class="cancel-button" data-cancel="${esc(i.id)}">Cancel reservation</button>`
                }
            </article>
        `).join("");

        list.querySelectorAll("[data-cancel]").forEach(button => {
            button.addEventListener("click", async () => {
                if (!confirm("Are you sure you want to cancel this reservation?")) {
                    return;
                }

                button.disabled = true;

                try {
                    await api(
                        `/api/reservations/${encodeURIComponent(button.dataset.cancel)}/cancel`,
                        { method: "POST" }
                    );

                    await render();
                } catch (error) {
                    alert(error.message);
                    button.disabled = false;
                }
            });
        });

    } catch (e) {
        list.textContent = e.message || "Could not load reservations.";
    }
}

render();
