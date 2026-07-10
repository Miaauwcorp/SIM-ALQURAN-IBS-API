(function () {
  "use strict";

  const VERSION = String(
    window.SIM_PWA_VERSION || "20260710-v20"
  );

  let deferredInstallPrompt = null;
  let installButton = null;

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function removeInstallButton() {
    if (installButton && installButton.parentNode) {
      installButton.parentNode.removeChild(installButton);
    }
    installButton = null;
  }

  function ensureInstallButton() {
    if (
      isStandalone() ||
      !deferredInstallPrompt ||
      installButton
    ) {
      return;
    }

    installButton = document.createElement("button");
    installButton.type = "button";
    installButton.textContent = "Install Aplikasi";
    installButton.setAttribute("aria-label", "Install aplikasi PWA");
    installButton.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:999997",
      "border:0",
      "border-radius:999px",
      "padding:12px 18px",
      "font:700 14px Arial,sans-serif",
      "background:#15803d",
      "color:#fff",
      "box-shadow:0 12px 30px rgba(0,0,0,.24)",
      "cursor:pointer"
    ].join(";");

    installButton.addEventListener("click", async function () {
      if (!deferredInstallPrompt) return;

      installButton.disabled = true;

      try {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
      } catch (err) {
        console.warn("Prompt install PWA gagal:", err);
      }

      deferredInstallPrompt = null;
      removeInstallButton();
    });

    document.body.appendChild(installButton);
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    ensureInstallButton();
  });

  window.addEventListener("appinstalled", function () {
    deferredInstallPrompt = null;
    removeInstallButton();
  });

  window.simInstallPwa = async function () {
    if (!deferredInstallPrompt) {
      return {
        success: false,
        message:
          "Prompt instalasi belum tersedia. Gunakan menu browser > Install aplikasi."
      };
    }

    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    removeInstallButton();

    return {
      success: choice && choice.outcome === "accepted",
      outcome: choice ? choice.outcome : ""
    };
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register(
          "./sw.js?v=" + encodeURIComponent(VERSION),
          { updateViaCache: "none" }
        )
        .then(function (registration) {
          console.log("Service Worker aktif:", registration.scope);

          registration.update().catch(function (err) {
            console.warn("Cek update Service Worker gagal:", err);
          });

          setInterval(function () {
            registration.update().catch(function () {});
          }, 60 * 60 * 1000);
        })
        .catch(function (err) {
          console.error("Service Worker gagal:", err);
        });
    });

    navigator.serviceWorker.addEventListener(
      "message",
      function (event) {
        const data = event.data || {};

        if (data.type === "SIM_SW_ACTIVATED") {
          console.log("PWA versi aktif:", data.version);
        }
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureInstallButton);
  } else {
    ensureInstallButton();
  }
})();
