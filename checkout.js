"use strict";

const money = n => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0
}).format(n);

const form = document.getElementById("checkoutForm");
const message = document.getElementById("checkoutMessage");
const payButton = document.getElementById("payButton");
const summary = document.getElementById("orderItems");
const phoneInput = document.getElementById("customerPhone");

async function api(url, options = {}) {
  const r = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

function getDeliveryLocation() {
  try {
    return JSON.parse(sessionStorage.getItem("naijabitesDeliveryLocation") || "null");
  } catch {
    return null;
  }
}

async function initialize() {
  try {
    const deliveryLocation = getDeliveryLocation();
    const deliveryAddress = document.getElementById("checkoutDeliveryAddress");

    if (!deliveryLocation) {
      deliveryAddress.textContent =
        "No delivery location selected. Return to your cart to choose an address.";
      payButton.disabled = true;
      message.textContent = "Choose a delivery location before paying.";
      return;
    }

    deliveryAddress.textContent = deliveryLocation.label || "Delivery location selected";

    const me = await api("/api/auth/me");
    if (!me.user) {
      message.textContent = "Please sign in before checking out.";
      payButton.disabled = true;
      setTimeout(() => location.href = "index.html?signin=1", 700);
      return;
    }

    document.getElementById("customerName").value = me.user.name || "";
    document.getElementById("customerEmail").value = me.user.email || "";
    phoneInput.value = me.user.phone || "";

    document.getElementById("customerName").readOnly = true;
    document.getElementById("customerEmail").readOnly = true;
    phoneInput.required = true;
    // If the account has no phone number, let the customer enter one at checkout.
    phoneInput.readOnly = Boolean(String(me.user.phone || "").trim());

    const [cartData, productsData] = await Promise.all([
      api("/api/cart"),
      api("/api/products")
    ]);

    const cart = cartData.cart || {};
    const products = new Map((productsData.products || []).map(p => [Number(p.id), p]));
    const items = Object.values(cart);

    if (!items.length) {
      summary.textContent =
        "Your database cart is empty. Return to the marketplace and add items.";
      payButton.disabled = true;
      message.textContent = "Add at least one item before checking out.";
      return;
    }

    summary.innerHTML = "";
    let total = 0;

    for (const item of items) {
      const p = products.get(Number(item.id));
      if (!p) continue;

      const line = Number(p.price) * Number(item.quantity);
      total += line;

      const row = document.createElement("div");
      row.className = "pay-item";
      const label = document.createElement("span");
      label.textContent = `${p.name} × ${item.quantity}`;
      const amount = document.createElement("strong");
      amount.textContent = money(line);
      row.append(label, amount);
      summary.append(row);
    }

    document.getElementById("orderTotal").textContent = money(total);
    if (!summary.children.length) {
      message.textContent =
        "Your cart has unavailable products. Return to the marketplace and refresh.";
      payButton.disabled = true;
    }
  } catch (e) {
    summary.textContent = e.message;
    message.textContent =
      "Could not load your account and database cart. Make sure the server and SQL Server are running.";
    payButton.disabled = true;
  }
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  message.textContent = "";

  const phone = phoneInput.value.trim();
  if (!phone) {
    message.textContent = "Phone number is required for checkout.";
    phoneInput.focus();
    return;
  }

  payButton.disabled = true;
  payButton.textContent = "Preparing secure checkout…";

  try {
    const result = await api("/api/payments/initialize", {
      method: "POST",
      body: JSON.stringify({ phone })
    });

    if (!result.authorization_url) {
      throw new Error("Paystack did not return a checkout link.");
    }
    location.assign(result.authorization_url);
  } catch (err) {
    message.textContent = err.message;
    payButton.disabled = false;
    payButton.textContent = "Try Paystack again";
  }
});

initialize();
