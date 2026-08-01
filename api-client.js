/*
 * SIM AL-QUR'AN IBS — Pure HTTP API client
 * Version: 20260801-v293-api
 *
 * Tidak memakai iframe, postMessage, atau google.script.run.
 * Semua panggilan dikirim langsung dengan fetch() ke doPost Apps Script.
 */
(function (global) {
  "use strict";

  const API_URL = String(global.SIM_GAS_API_URL || "").trim();
  const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;
  let requestSequence = 0;

  function createError(message, details) {
    const error = new Error(String(message || "Permintaan API gagal."));
    if (details && typeof details === "object") {
      if (details.name) error.name = String(details.name);
      if (details.code) error.code = String(details.code);
      if (details.stack) error.stack = String(details.stack);
      if (details.forceLogout) error.forceLogout = true;
      if (details.retryable) error.retryable = true;
    }
    return error;
  }

  function getStoredSession() {
    try {
      const raw = global.localStorage.getItem("loginSession");
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function getDeviceInfoSafe() {
    try {
      return typeof global.getDeviceInfo === "function"
        ? String(global.getDeviceInfo() || "")
        : String(global.navigator && global.navigator.userAgent || "");
    } catch (_error) {
      return String(global.navigator && global.navigator.userAgent || "");
    }
  }

  function buildAuth() {
    const session = getStoredSession() || {};
    return {
      sessionId: String(session.sessionId || ""),
      username: String(session.username || ""),
      name: String(session.name || ""),
      role: String(session.role || ""),
      loginMethod: String(session.loginMethod || ""),
      deviceInfo: getDeviceInfoSafe()
    };
  }

  function invokeHandler(handler, value, userObject) {
    if (typeof handler !== "function") return;
    setTimeout(function () {
      try {
        handler(value, userObject);
      } catch (error) {
        console.error("Handler API frontend gagal:", error);
      }
    }, 0);
  }

  function handleSessionError(error) {
    if (!error || !error.forceLogout) return;
    try {
      if (typeof global.handleForcedLogoutFromServer === "function") {
        global.handleForcedLogoutFromServer(error.message);
      }
    } catch (_ignored) {}
  }

  async function request(functionName, args, options) {
    options = options || {};
    if (!API_URL) throw createError("window.SIM_GAS_API_URL belum diatur.");

    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    const requestId = "sim_api_" + Date.now().toString(36) + "_" + (++requestSequence).toString(36);

    try {
      const response = await fetch(API_URL + (API_URL.includes("?") ? "&" : "?") + "api=1", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          /* text/plain adalah simple request sehingga tidak memicu preflight OPTIONS. */
          "Content-Type": "text/plain;charset=UTF-8"
        },
        body: JSON.stringify({
          action: "api",
          requestId: requestId,
          functionName: String(functionName || ""),
          args: Array.isArray(args) ? args : [],
          auth: buildAuth(),
          client: {
            origin: global.location.origin,
            version: String(global.SIM_PWA_VERSION || ""),
            href: global.location.href
          }
        })
      });

      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (_parseError) {
        throw createError(
          "Respons API bukan JSON. Periksa deployment Apps Script dan akses 'Anyone'.",
          { code: "INVALID_JSON_RESPONSE", stack: raw.slice(0, 800) }
        );
      }

      if (!response.ok || !payload || payload.ok !== true) {
        const details = payload && payload.error ? payload.error : payload;
        throw createError(
          details && details.message ? details.message : "API Apps Script menolak permintaan.",
          details || {}
        );
      }

      return payload.result;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw createError("Fungsi " + functionName + " melewati batas waktu API.", {
          name: "TimeoutError",
          code: "API_TIMEOUT"
        });
      }
      if (error instanceof TypeError && /fetch/i.test(String(error.message || ""))) {
        throw createError(
          "Tidak dapat terhubung ke API Apps Script. Periksa internet, deployment /exec, akses Anyone, atau CORS.",
          { name: error.name, code: "API_NETWORK_ERROR", stack: error.stack || "" }
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function createRunner(state) {
    state = state || {};
    return new Proxy({}, {
      get: function (_target, property) {
        if (property === "withSuccessHandler") {
          return function (handler) {
            return createRunner(Object.assign({}, state, { successHandler: handler }));
          };
        }
        if (property === "withFailureHandler") {
          return function (handler) {
            return createRunner(Object.assign({}, state, { failureHandler: handler }));
          };
        }
        if (property === "withUserObject") {
          return function (userObject) {
            return createRunner(Object.assign({}, state, { userObject: userObject }));
          };
        }
        if (property === "then" || typeof property === "symbol") return undefined;

        return function () {
          const args = Array.prototype.slice.call(arguments);
          request(String(property), args, state)
            .then(function (result) {
              invokeHandler(state.successHandler, result, state.userObject);
            })
            .catch(function (error) {
              handleSessionError(error);
              invokeHandler(state.failureHandler, error, state.userObject);
              if (typeof state.failureHandler !== "function") {
                console.error("API Apps Script gagal:", error);
              }
            });
        };
      }
    });
  }

  const urlApi = {
    getLocation: function (callback) {
      const params = new URLSearchParams(global.location.search || "");
      const parameter = {};
      const parameters = {};
      params.forEach(function (value, key) {
        if (!(key in parameter)) parameter[key] = value;
        if (!parameters[key]) parameters[key] = [];
        parameters[key].push(value);
      });
      if (typeof callback === "function") {
        callback({
          hash: global.location.hash.replace(/^#/, ""),
          parameter: parameter,
          parameters: parameters
        });
      }
    }
  };

  global.simApi = {
    run: createRunner(),
    url: urlApi,
    call: function (functionName) {
      return request(functionName, Array.prototype.slice.call(arguments, 1));
    },
    request: request
  };
})(window);
