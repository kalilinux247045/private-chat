(function () {
  const errorBox = document.getElementById("selectError");
  const logoutButton = document.getElementById("logoutButton");

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

  document.querySelectorAll("[data-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      errorBox.textContent = "";
      button.disabled = true;

      try {
        const data = await requestJson("/api/select-user", {
          method: "POST",
          body: JSON.stringify({ user: button.dataset.user })
        });
        window.location.href = data.next || "/chat";
      } catch (err) {
        errorBox.textContent = err.message;
        button.disabled = false;
      }
    });
  });

  logoutButton.addEventListener("click", async () => {
    await requestJson("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
    window.location.href = "/";
  });
})();
