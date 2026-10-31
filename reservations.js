const $ = id => document.getElementById(id);
const form = $("reservationForm");
const today = new Date();
const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
$("date").min = localToday;
fetch("/api/auth/me", { credentials: "same-origin" }).then(r => r.json()).then(d => { if (d.user) { if (d.user.name) $("fullName").value = d.user.name; if (d.user.email) $("email").value = d.user.email; if (d.user.phone) $("phone").value = d.user.phone } }).catch(() => { });
form.addEventListener("submit", async event => {
    event.preventDefault(); const date = $("date").value, time = $("time").value; if (date < localToday) { $("message").textContent = "Please choose today or a future date."; return }
    try { const response = await fetch("/api/reservations", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant: $("restaurant").value, name: $("fullName").value.trim(), phone: $("phone").value.trim(), guests: Number($("guests").value), date, time, notes: $("notes").value.trim() }) }); const d = await response.json(); if (!response.ok) throw new Error(d.error || "Could not save reservation."); $("message").textContent = "Reservation saved to your NaijaBites account."; $("message").classList.add("success"); setTimeout(() => location.href = "reservation-history.html?saved=1", 650) } catch (e) { $("message").textContent = e.message }
});
