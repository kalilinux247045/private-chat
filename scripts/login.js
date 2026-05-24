(function () {
  const form = document.getElementById("loginForm");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const button = document.getElementById("loginButton");
  const errorBox = document.getElementById("loginError");

  async function requestJson(url, options) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Something went wrong");
    }
    return data;
  }

  requestJson("/api/session", { method: "GET" })
    .then((session) => {
      if (session.authenticated && session.selectedUser) {
        window.location.href = "/chat";
      } else if (session.authenticated) {
        window.location.href = "/users";
      }
    })
    .catch(() => {});

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.textContent = "";
    button.disabled = true;
    button.textContent = "Checking...";

    try {
      const data = await requestJson("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      });

      window.location.href = data.next || "/users";
    } catch (err) {
      errorBox.textContent = err.message;
      passwordInput.value = "";
      passwordInput.focus();
    } finally {
      button.disabled = false;
      button.textContent = "Unlock";
    }
  });
})();
