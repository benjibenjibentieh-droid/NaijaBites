
const API_BASE = "https://naijabites.onrender.com";

const form = document.getElementById("signupForm");
const message = document.getElementById("formMessage");
const submitButton = document.getElementById("signupSubmit");

document.getElementById("year").textContent = new Date().getFullYear();

const fieldIds = ["fullName", "email", "phone", "password", "confirmPassword"];

const errorIds = {
    fullName: "nameError",
    email: "emailError",
    phone: "phoneError",
    password: "passwordError",
    confirmPassword: "confirmError"
};

document.querySelectorAll("[data-toggle]").forEach(button => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.toggle);
        const reveal = input.type === "password";

        input.type = reveal ? "text" : "password";
        button.textContent = reveal ? "Hide" : "Show";

        button.setAttribute(
            "aria-label",
            `${reveal ? "Hide" : "Show"} ${input.id === "password" ? "password" : "confirmation password"}`
        );
    });
});

function setError(field, text) {
    document.getElementById(errorIds[field]).textContent = text;
    document.getElementById(field).classList.toggle("invalid", Boolean(text));
    document.getElementById(field).setAttribute(
        "aria-invalid",
        text ? "true" : "false"
    );
}

function validate() {
    const values = Object.fromEntries(
        fieldIds.map(id => [
            id,
            document.getElementById(id).value.trim()
        ])
    );

    const name = values.fullName;
    const email = values.email.toLowerCase();
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirmPassword").value;

    let valid = true;

    fieldIds.forEach(id => setError(id, ""));

    if (name.length < 2) {
        setError("fullName", "Enter your full name (at least 2 characters).");
        valid = false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setError("email", "Enter a valid email address.");
        valid = false;
    }

    if (values.phone && !/^[+()\d\s.-]{7,20}$/.test(values.phone)) {
        setError("phone", "Enter a valid phone number or leave this blank.");
        valid = false;
    }

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password)) {
        setError(
            "password",
            "Use 8+ characters including uppercase, lowercase, a number and a symbol."
        );
        valid = false;
    }

    if (!confirm || confirm !== password) {
        setError("confirmPassword", "Passwords do not match.");
        valid = false;
    }

    return {
        valid,
        name,
        email,
        phone: values.phone,
        password
    };
}

form.addEventListener("submit", async event => {
    event.preventDefault();

    message.textContent = "";
    message.className = "form-message";

    const result = validate();

    if (!result.valid) {
        message.textContent =
            "Please fix the highlighted fields and try again.";
        message.classList.add("error");

        document.querySelector(".signup-card input.invalid")?.focus();
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Creating account…";

    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                name: result.name,
                email: result.email,
                phone: result.phone,
                password: result.password
            })
        });

        const text = await response.text();
        let data;

        try {
            data = JSON.parse(text);
        } catch {
            throw new Error("The server returned an invalid response.");
        }

        if (!response.ok) {
            throw new Error(data.error || "Could not create account.");
        }

        message.textContent =
            "Your account has been created. Taking you to the marketplace…";

        message.classList.add("success");

        location.href = "index.html?welcome=1";

    } catch (err) {
        message.textContent =
            err.message || "Could not create your account. Check the server and database.";

        message.classList.add("error");

        submitButton.disabled = false;
        submitButton.innerHTML = 'Create account <span>→</span>';
    }
});
