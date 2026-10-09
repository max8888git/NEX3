/**
 * Keeps HTML pages on a logged-in MySQL user: redirect to login, send each
 * role to its own folder, fill the topbar name, and clear the session on logout.
 */
(function (global) {
  'use strict';

  function siteRoot() {
    if (global.McuApi && global.McuApi.base) {
      return String(global.McuApi.base).replace(/api\/?$/, '');
    }
    try {
      return new URL('../', global.location.href).href.replace(/\/(admin|super-admin|viewing|viewing-with-approval|viewing-program-head)\/?$/, '/');
    } catch (e) {
      return '../';
    }
  }

  function go(path) {
    global.location.href = siteRoot() + String(path || '').replace(/^\/+/, '');
  }

  function folderRole() {
    var path = String(global.location.pathname || '').replace(/\\/g, '/');
    if (path.indexOf('/super-admin/') !== -1) return 'super_admin';
    if (path.indexOf('/viewing-with-approval/') !== -1) return 'vpaa';
    if (path.indexOf('/viewing-program-head/') !== -1) return 'program_chair';
    if (path.indexOf('/viewing/') !== -1) return 'dean';
    if (path.indexOf('/admin/') !== -1) return 'admin';
    return '';
  }

  function initials(name) {
    var parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return '•';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function applyChrome(user) {
    var nameEl = document.querySelector('.topbar-user > span');
    if (nameEl) nameEl.textContent = user.name;
    var avatar = document.querySelector('.topbar-user .avatar');
    if (avatar) avatar.textContent = initials(user.name);
    var chip = document.querySelector('.topbar-right > .chip');
    if (chip && user.roleLabel) chip.textContent = user.roleLabel;
  }

  function bindLogout() {
    document.querySelectorAll('a.logout').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var done = function () {
          go('index.html');
        };
        if (!global.McuApi) {
          done();
          return;
        }
        global.McuApi.send('POST', 'auth.php', { action: 'logout' }).then(done).catch(done);
      });
    });
  }

  function isLoginPage() {
    return !!document.getElementById('login-form');
  }

  function boot() {
    bindLogout();
    if (!global.McuApi) return;
    global.McuApi.get('auth.php')
      .then(function (res) {
        var user = res && res.user;
        if (isLoginPage()) {
          if (user && user.home) go(user.home);
          return;
        }
        if (!user) {
          go('index.html');
          return;
        }
        applyChrome(user);
        var need = folderRole();
        if (need && need !== user.role && user.home) {
          go(user.home);
        }
      })
      .catch(function () {
        if (!isLoginPage()) go('index.html');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
