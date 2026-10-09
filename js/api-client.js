/**
 * Talks to the PHP/MySQL API from any page depth.
 *
 * The script lives in /js, so the API is the sibling /api folder. Pages still
 * work if the folder is served from a subpath.
 */
(function (global) {
  'use strict';

  if (global.McuApi) return;

  function apiBase() {
    var el = document.querySelector('script[src*="api-client.js"]');
    var src = el && el.src ? el.src : '';
    if (src) {
      return src.replace(/\/js\/api-client\.js(\?.*)?$/, '/api/');
    }
    return new URL('../api/', global.location.href).href;
  }

  var BASE = apiBase();
  var lastError = null;
  var configured = false;

  function looksLikePhpSource(text) {
    var raw = String(text || '');
    return (
      raw.indexOf('<?php') !== -1 ||
      raw.indexOf('pdo_from_config') !== -1 ||
      /json_ok\s*\(/.test(raw)
    );
  }

  function phpServerHint() {
    var path = '';
    try {
      path = String(global.location.pathname || '').replace(/\\/g, '/');
    } catch (e) {
      path = '';
    }
    var match = path.match(
      /\/(admin|super-admin|viewing|viewing-with-approval|viewing-program-head)\/[^/]+$/
    );
    if (match) {
      return 'http://localhost:8000' + match[0];
    }
    return 'http://localhost:8000/';
  }

  function apiFailureMessage(text, res) {
    var raw = String(text || '').replace(/^\uFEFF/, '');
    if (looksLikePhpSource(raw)) {
      return (
        'This page is not running through PHP, so MySQL cannot be used. Open ' +
        phpServerHint() +
        ' instead of opening the HTML file directly.'
      );
    }
    var trimmed = raw.trim();
    if (trimmed.charAt(0) === '<') {
      return 'The API did not return JSON (HTTP ' + (res ? res.status : '?') + ').';
    }
    if (trimmed.length > 180) {
      return 'The API did not return JSON.';
    }
    return trimmed || 'The API did not return JSON.';
  }

  function request(method, path, body) {
    var opts = {
      method: method,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return global.fetch(BASE + path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          throw new Error(apiFailureMessage(text, res));
        }
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || apiFailureMessage(text, res) || 'Request failed (' + res.status + ')');
        }
        return data;
      });
    });
  }

  function health() {
    if (global.location && global.location.protocol === 'file:') {
      configured = false;
      lastError =
        'This page was opened as a file. MySQL is only available through PHP. Open ' +
        phpServerHint() +
        ' instead.';
      return Promise.resolve({ ok: false, configured: false, installed: false, error: lastError });
    }
    return request('GET', 'health.php')
      .then(function (data) {
        configured = !!(data.configured && data.installed);
        lastError = configured
          ? null
          : data.error ||
            (data.configured
              ? 'Database tables are missing. Open api/install.php.'
              : 'MySQL is not configured. Open api/install.php.');
        return data;
      })
      .catch(function (err) {
        configured = false;
        lastError = err.message || String(err);
        return { ok: false, configured: false, installed: false, error: lastError };
      });
  }

  global.McuApi = {
    base: BASE,
    get configured() {
      return configured;
    },
    get lastError() {
      return lastError;
    },
    health: health,
    get: function (path) {
      return request('GET', path);
    },
    send: function (method, path, body) {
      return request(method, path, body);
    }
  };
})(typeof window !== 'undefined' ? window : this);
