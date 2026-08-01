/*
 * SIM AL-QUR'AN IBS — GitHub to Apps Script RPC client
 * Version: 20260801-v292-github
 *
 * Mempertahankan sintaks google.script.run tanpa mengubah
 * puluhan pemanggilan yang sudah ada pada index.html.
 */
(function (global) {
  "use strict";

  const API_URL = String(global.SIM_GAS_API_URL || "").trim();
  const APP_ORIGIN = global.location.origin;
  const BRIDGE_ID =
    "sim_rpc_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2);

  const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;
  const READY_TIMEOUT_MS = 45 * 1000;

  const pending = new Map();
  const queued = [];
  let iframe = null;
  let bridgeWindow = null;
  let bridgeOrigin = "*";
  let bridgeReady = false;
  let bridgeFailed = null;
  let requestSequence = 0;

  function createError(message, details) {
    const error = new Error(String(message || "RPC Apps Script gagal."));
    if (details && typeof details === "object") {
      if (details.name) error.name = String(details.name);
      if (details.stack) error.stack = String(details.stack);
    }
    return error;
  }

  function invokeHandler(handler, value, userObject) {
    if (typeof handler !== "function") return;
    setTimeout(function () {
      try {
        handler(value, userObject);
      } catch (error) {
        console.error("Handler RPC frontend gagal:", error);
      }
    }, 0);
  }

  function finishRequest(requestId, ok, value) {
    const item = pending.get(requestId);
    if (!item) return;

    pending.delete(requestId);
    clearTimeout(item.timer);

    if (ok) {
      invokeHandler(item.successHandler, value, item.userObject);
      if (item.resolve) item.resolve(value);
      return;
    }

    const error = createError(
      value && value.message ? value.message : value,
      value
    );

    invokeHandler(item.failureHandler, error, item.userObject);
    if (item.reject) item.reject(error);
  }

  function postRequest(payload) {
    /*
     * HtmlService berjalan di iframe internal googleusercontent.
     * Karena itu gunakan WindowProxy yang mengirim SIM_RPC_READY,
     * bukan selalu iframe.contentWindow milik elemen luar.
     */
    if (!bridgeWindow) {
      throw createError("Window RPC bridge Apps Script belum tersedia.");
    }

    bridgeWindow.postMessage(
      Object.assign({
        type: "SIM_RPC_REQUEST",
        bridgeId: BRIDGE_ID
      }, payload),
      bridgeOrigin || "*"
    );
  }

  function flushQueue() {
    if (!bridgeReady) return;
    while (queued.length) {
      const payload = queued.shift();
      try {
        postRequest(payload);
      } catch (error) {
        finishRequest(payload.requestId, false, {
          name: error.name,
          message: error.message,
          stack: error.stack || ""
        });
      }
    }
  }

  function failAll(error) {
    bridgeFailed = error;
    while (queued.length) {
      const payload = queued.shift();
      finishRequest(payload.requestId, false, {
        name: error.name || "Error",
        message: error.message || String(error),
        stack: error.stack || ""
      });
    }
  }

  function buildBridgeUrl() {
    const url = new URL(API_URL);
    url.searchParams.set("rpcBridge", "1");
    url.searchParams.set("origin", APP_ORIGIN);
    url.searchParams.set("bridgeId", BRIDGE_ID);
    url.searchParams.set("v", String(global.SIM_PWA_VERSION || ""));
    return url.toString();
  }

  function initBridge() {
    if (!API_URL) {
      failAll(createError("window.SIM_GAS_API_URL belum diatur."));
      return;
    }

    iframe = document.createElement("iframe");
    iframe.id = "sim-gas-rpc-bridge";
    iframe.title = "Apps Script RPC Bridge";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.cssText =
      "position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;" +
      "border:0;opacity:0;pointer-events:none;";
    iframe.src = buildBridgeUrl();

    const mount = function () {
      (document.body || document.documentElement).appendChild(iframe);
    };

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });

    setTimeout(function () {
      if (!bridgeReady) {
        failAll(createError(
          "RPC bridge tidak siap. Periksa deployment Apps Script, origin GitHub, dan akses web app."
        ));
      }
    }, READY_TIMEOUT_MS);
  }

  global.addEventListener("message", function (event) {
    const data = event.data || {};
    if (data.bridgeId !== BRIDGE_ID) return;

    if (data.type === "SIM_RPC_READY") {
      /*
       * event.source adalah iframe HtmlService internal yang
       * benar-benar memiliki google.script.run.
       */
      bridgeWindow = event.source;
      bridgeOrigin = event.origin || "*";
      bridgeReady = true;
      bridgeFailed = null;
      flushQueue();
      return;
    }

    if (
      data.type === "SIM_RPC_RESULT" &&
      event.source === bridgeWindow
    ) {
      finishRequest(
        data.requestId,
        data.success === true,
        data.success ? data.result : data.error
      );
    }
  });

  function enqueueCall(functionName, args, options) {
    options = options || {};

    const requestId =
      BRIDGE_ID +
      "_" +
      (++requestSequence).toString(36);

    const timer = setTimeout(function () {
      finishRequest(requestId, false, {
        name: "TimeoutError",
        message:
          "Fungsi " +
          functionName +
          " melewati batas waktu RPC frontend."
      });
    }, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

    pending.set(requestId, {
      timer: timer,
      successHandler: options.successHandler || null,
      failureHandler: options.failureHandler || null,
      userObject: options.userObject,
      resolve: options.resolve || null,
      reject: options.reject || null
    });

    const payload = {
      requestId: requestId,
      functionName: String(functionName || ""),
      args: Array.isArray(args) ? args : []
    };

    if (bridgeFailed) {
      finishRequest(requestId, false, {
        name: bridgeFailed.name || "Error",
        message: bridgeFailed.message || String(bridgeFailed),
        stack: bridgeFailed.stack || ""
      });
      return;
    }

    if (bridgeReady) postRequest(payload);
    else queued.push(payload);
  }

  function createRunner(state) {
    state = state || {};

    return new Proxy({}, {
      get: function (_target, property) {
        if (property === "withSuccessHandler") {
          return function (handler) {
            return createRunner(Object.assign({}, state, {
              successHandler: handler
            }));
          };
        }

        if (property === "withFailureHandler") {
          return function (handler) {
            return createRunner(Object.assign({}, state, {
              failureHandler: handler
            }));
          };
        }

        if (property === "withUserObject") {
          return function (userObject) {
            return createRunner(Object.assign({}, state, {
              userObject: userObject
            }));
          };
        }

        if (property === "then") return undefined;
        if (typeof property === "symbol") return undefined;

        return function () {
          enqueueCall(
            String(property),
            Array.prototype.slice.call(arguments),
            state
          );
        };
      }
    });
  }

  global.google = global.google || {};
  global.google.script = global.google.script || {};
  global.google.script.run = createRunner();

  global.callGoogleScript = function (functionName) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      enqueueCall(functionName, args, {
        resolve: resolve,
        reject: reject
      });
    });
  };

  global.google.script.url = global.google.script.url || {
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

  initBridge();
})(window);
