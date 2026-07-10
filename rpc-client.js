/* =========================================================
   SIM GAS RPC CLIENT V20
   Pengganti google.script.run untuk frontend GitHub Pages.
========================================================= */
(function () {
  "use strict";

  const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbxv29VDLzUWt-J6rEL-KcqylOGqilnPiijfibo-xj6mX7Pu3kAz6l1av9OkMddtX_Kw-Q/exec";
  const RPC_TIMEOUT_MS = 330000;

  function getGasUrl() {
    return String(window.SIM_GAS_API_URL || DEFAULT_GAS_URL || "").trim();
  }

  function safeDeviceInfo() {
    try {
      if (typeof window.getDeviceInfo === "function") {
        return String(window.getDeviceInfo() || "");
      }
    } catch (err) {}

    let clientId = "";
    try {
      if (typeof window.getLoginBrowserFingerprint === "function") {
        clientId = String(window.getLoginBrowserFingerprint() || "");
      }
    } catch (err) {}

    return [
      navigator.userAgent || "",
      clientId ? "[CLIENT_ID:" + clientId + "]" : "",
      "[PWA_RPC]"
    ].filter(Boolean).join(" ");
  }

  function getAuthPayload() {
    try {
      const raw = localStorage.getItem("loginSession");
      if (!raw) return null;

      const session = JSON.parse(raw);
      if (!session || !session.sessionId || !session.username) return null;

      return {
        sessionId: String(session.sessionId || ""),
        username: String(session.username || ""),
        role: String(session.role || ""),
        deviceInfo: safeDeviceInfo()
      };
    } catch (err) {
      return null;
    }
  }

  function createRpcError(message, details) {
    const error = new Error(message || "Permintaan ke server gagal.");
    if (details && typeof details === "object") {
      Object.keys(details).forEach(function (key) {
        try { error[key] = details[key]; } catch (err) {}
      });
    }
    return error;
  }

  async function invokeRpc(method, args) {
    const gasUrl = getGasUrl();
    if (!gasUrl) {
      throw createRpcError("URL Google Apps Script belum diatur.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(function () {
      controller.abort();
    }, RPC_TIMEOUT_MS);

    try {
      const response = await fetch(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          action: "rpc",
          method: String(method || ""),
          args: Array.isArray(args) ? args : [],
          auth: getAuthPayload(),
          client: {
            source: "github-pwa",
            version: String(window.SIM_PWA_VERSION || ""),
            href: location.href,
            timezone:
              (window.Intl && Intl.DateTimeFormat)
                ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
                : ""
          }
        }),
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });

      const text = await response.text();
      let payload;

      try {
        payload = JSON.parse(text);
      } catch (parseError) {
        throw createRpcError(
          "Respons server bukan JSON. HTTP " + response.status +
          ". Potongan respons: " + text.slice(0, 240)
        );
      }

      if (!payload || payload.ok !== true) {
        const serverError = payload && payload.error ? payload.error : {};
        throw createRpcError(
          serverError.message ||
          (payload && payload.message) ||
          "Server menolak permintaan.",
          serverError
        );
      }

      return payload.result;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw createRpcError(
          "Permintaan ke server melewati batas waktu. Coba lagi."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function createRunner() {
    let successHandler = null;
    let failureHandler = null;
    let userObject;

    const target = {
      withSuccessHandler: function (handler) {
        successHandler = typeof handler === "function" ? handler : null;
        return proxy;
      },

      withFailureHandler: function (handler) {
        failureHandler = typeof handler === "function" ? handler : null;
        return proxy;
      },

      withUserObject: function (value) {
        userObject = value;
        return proxy;
      }
    };

    const proxy = new Proxy(target, {
      get: function (obj, property) {
        if (property === "then") return undefined;
        if (typeof property === "symbol") return obj[property];
        if (Object.prototype.hasOwnProperty.call(obj, property)) {
          return obj[property];
        }

        return function () {
          const args = Array.prototype.slice.call(arguments);

          invokeRpc(String(property), args)
            .then(function (result) {
              if (successHandler) {
                successHandler(result, userObject);
              }
            })
            .catch(function (error) {
              if (failureHandler) {
                failureHandler(error, userObject);
              } else {
                console.error(
                  "RPC Google Apps Script gagal:",
                  property,
                  error
                );
              }
            });
        };
      }
    });

    return proxy;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};

  Object.defineProperty(window.google.script, "run", {
    configurable: true,
    enumerable: true,
    get: function () {
      return createRunner();
    }
  });

  window.SimGasRpc = {
    invoke: invokeRpc,
    getAuthPayload: getAuthPayload,
    version: "v20"
  };

  console.log(
    "SIM GAS RPC aktif:",
    window.SIM_PWA_VERSION || "tanpa-versi"
  );
})();
