const API_BASE = "https://naijabites.onrender.com";

const $ = id => document.getElementById(id);

$("year").textContent = new Date().getFullYear();

function money(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG");
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}

async function getJSON(url) {
    const response = await fetch(`${API_BASE}${url}`, {
        credentials: "include",
        headers: {
            "Accept": "application/json"
        }
    });

    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `The server returned an invalid response for ${url}.`
        );
    }

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

async function load() {
    try {
        const me = await getJSON("/api/auth/me");

        if (!me.user) {
            $("ordersList").innerHTML = `
                <div class="empty-orders">
                    <h2>Sign in to view orders</h2>
                    <a href="index.html?signin=1">Sign in →</a>
                </div>`;
            return;
        }

        const d = await getJSON("/api/orders");
        const orders = d.orders || [];

        $("ordersList").innerHTML = orders.length
            ? orders.map(o => `
                <article class="order-card">
                    <div class="order-top">
                        <div>
                            <h2>Order ${esc(o.id)}</h2>
                            <p>${new Date(o.createdAt).toLocaleString()}</p>
                        </div>
                        <span class="order-status">
                            ${esc(o.status || "Pending")}
                        </span>
                    </div>
                    <div class="order-summary">
                        <div class="order-total">
                            <span>Total</span>
                            <strong>${money(o.total)}</strong>
                        </div>
                    </div>
                    <div class="order-address">
                        <strong>Payment reference:</strong>
                        ${esc(o.reference || "Pending")}
                    </div>
                </article>
            `).join("")
            : `
                <div class="empty-orders">
                    <h2>No orders yet</h2>
                    <p>Your database orders will appear here.</p>
                    <a href="index.html">Browse meals →</a>
                </div>`;
    } catch (e) {
        $("ordersList").textContent =
            e.message || "Could not load orders.";
    }
}

if (new URLSearchParams(location.search).get("placed") === "1") {
    $("historyMessage").textContent =
        "Your order status has been updated.";
}

load();
