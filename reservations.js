
const API_BASE = "https://naijabites.onrender.com";

const $ = id => document.getElementById(id);
const form = $("reservationForm");

const today = new Date();
const localToday = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000
).toISOString().slice(0, 10);

$("date").min = localToday;

async function api(url, options = {}) {
    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        credentials: "include",
        headers: {
            "Accept": "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
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

// Load the logged-in customer's details
api("/api/auth/me")
    .then(d => {
        if (d.user) {
            if (d.user.name) $("fullName").value = d.user.name;
            if (d.user.email) $("email").value = d.user.email;
            if (d.user.phone) $("phone").value = d.user.phone;
        }
    })
    .catch(error => {
        console.error("Could not load account details:", error);
    });

// Submit reservation
form.addEventListener("submit", async event => {
    event.preventDefault();

    const date = $("date").value;
    const time = $("time").value;

    if (date < localToday) {
        $("message").textContent =
            "Please choose today or a future date.";
        return;
    }

    try {
        await api("/api/reservations", {
            method: "POST",
            body: JSON.stringify({
                restaurant: $("restaurant").value,
                name: $("fullName").value.trim(),
                phone: $("phone").value.trim(),
                guests: Number($("guests").value),
                date,
                time,
                notes: $("notes").value.trim()
            })
        });

        $("message").textContent =
            "Reservation saved to your NaijaBites account.";

        $("message").classList.add("success");

        setTimeout(() => {
            location.href = "reservation-history.html?saved=1";
        }, 650);

    } catch (error) {
        $("message").textContent = error.message;
    }
});
