/**
 * Topbar notifications for the signed-in user only.
 * Loads from the API so each role sees the interactions they were part of.
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'mcu-nex-notify-styles-v2';

  function siteRoot() {
    if (global.McuApi && global.McuApi.base) {
      return String(global.McuApi.base).replace(/api\/?$/, '');
    }
    try {
      return new URL('../', global.location.href).href.replace(
        /\/(admin|super-admin|viewing|viewing-with-approval|viewing-program-head)\/?$/,
        '/'
      );
    } catch (e) {
      return '../';
    }
  }

  function toHref(path) {
    var rel = String(path || '').replace(/^\/+/, '');
    if (!rel) return '#';
    return siteRoot() + rel;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.topbar-notify{position:relative;z-index:25;}',
      '.topbar-notify .notify-menu{',
      'display:none!important;',
      'position:absolute;',
      'top:130%;',
      'right:0;',
      'min-width:280px;',
      'max-width:min(340px,92vw);',
      'max-height:min(420px,70vh);',
      'overflow-y:auto;',
      'padding:0!important;',
      'background:#fff;',
      'color:#1f1230;',
      'border:1px solid #e3d9f0;',
      'border-radius:0.6rem;',
      'box-shadow:0 14px 30px rgba(0,0,0,0.16);',
      'z-index:120;',
      '}',
      '.topbar-notify.open .notify-menu{display:block!important;}',
      '.topbar-notify .notify-menu div{white-space:normal!important;padding:0!important;color:inherit;}',
      '.topbar-notify .notify-menu div:hover{background:transparent!important;color:inherit!important;}',
      '.topbar-notify .notify-menu-header{padding:0.45rem 0.75rem!important;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#7a6992;border-bottom:1px solid #e3d9f0;}',
      '.topbar-notify a.notify-menu-item{display:block;padding:0.55rem 0.85rem!important;text-decoration:none;color:#1f1230;border-bottom:1px solid #e3d9f0;font-size:0.82rem;line-height:1.35;white-space:normal;}',
      '.topbar-notify a.notify-menu-item:hover{background:#f6f1fc!important;color:#5c267e!important;}',
      '.topbar-notify a.notify-menu-item.unread{background:#faf7ff;}',
      '.topbar-notify .notify-item-badge{display:inline-block;font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#5c267e;background:#ede4f7;padding:0.15rem 0.4rem!important;border-radius:999px;margin-bottom:0.25rem;}',
      '.topbar-notify .notify-item-title{font-weight:600;color:#5c267e;}',
      '.topbar-notify .notify-item-body{font-size:0.78rem;color:#7a6992;margin-top:0.2rem;}',
      '.topbar-notify .notify-item-time{font-size:0.7rem;color:#9a8ab0;margin-top:0.2rem;}',
      '.topbar-notify .notify-menu-empty{padding:0.85rem!important;font-size:0.82rem;color:#7a6992;}',
      '.topbar-notify .notify-menu-footer{padding:0.5rem 0.75rem!important;font-size:0.75rem;border-top:1px solid #e3d9f0;background:#faf8fc;}',
      '.topbar-notify .notify-menu[hidden]{display:none!important;}',
      '.topbar-notify .notify-footer-links{display:flex;flex-direction:column;gap:0.4rem;}',
      '.topbar-notify .notify-footer-link{display:block;color:#5c267e;font-weight:600;text-decoration:none;font-size:0.78rem;line-height:1.35;background:none;border:0;padding:0;cursor:pointer;font-family:inherit;text-align:left;}',
      '.topbar-notify .notify-footer-link:hover{text-decoration:underline;background:transparent!important;}',
      '.topbar-notify .topbar-notify-dot{opacity:0;transform:scale(0);transition:opacity .15s ease,transform .15s ease;background:#e05454!important;box-shadow:0 0 0 3px rgba(224,84,84,0.35)!important;}',
      '.topbar-notify.has-unread .topbar-notify-dot{opacity:1;transform:scale(1);}'
    ].join('');
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildMenuHTML(items) {
    var html = '<div class="notify-menu-header">Notifications</div>';
    if (!items.length) {
      html += '<div class="notify-menu-empty">No notifications yet.</div>';
    } else {
      items.forEach(function (item) {
        html +=
          '<a role="menuitem" class="notify-menu-item' +
          (item.isRead ? '' : ' unread') +
          '" href="' +
          escapeHtml(toHref(item.href)) +
          '" data-nid="' +
          String(item.id) +
          '">';
        html += '<span class="notify-item-badge">' + escapeHtml(item.badge || 'Requests') + '</span>';
        html += '<div class="notify-item-title">' + escapeHtml(item.title) + '</div>';
        html += '<div class="notify-item-body">' + escapeHtml(item.body) + '</div>';
        if (item.atLabel) {
          html += '<div class="notify-item-time">' + escapeHtml(item.atLabel) + '</div>';
        }
        html += '</a>';
      });
    }
    html +=
      '<div class="notify-menu-footer"><div class="notify-footer-links">' +
      '<button type="button" class="notify-footer-link" data-notify-mark-all>Mark all as read</button>' +
      '</div></div>';
    return html;
  }

  function setNotifyMenuHidden(menu, hidden) {
    if (!menu) return;
    menu.hidden = hidden;
    menu.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }

  function closeAllNotify() {
    document.querySelectorAll('.topbar-notify').forEach(function (r) {
      r.classList.remove('open');
      var b = r.querySelector('.topbar-notify-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
      setNotifyMenuHidden(r.querySelector('.notify-menu'), true);
    });
  }

  function closeOtherNotify(except) {
    document.querySelectorAll('.topbar-notify.open').forEach(function (r) {
      if (r !== except) {
        r.classList.remove('open');
        var b = r.querySelector('.topbar-notify-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
        setNotifyMenuHidden(r.querySelector('.notify-menu'), true);
      }
    });
  }

  function mountNotify(root) {
    var btn = root.querySelector('.topbar-notify-btn');
    var menu = root.querySelector('.notify-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'notify-menu';
      menu.setAttribute('role', 'menu');
      root.appendChild(menu);
    }
    menu.setAttribute('aria-label', 'Notification list');
    var items = [];

    function applyState(res) {
      items = (res && res.notifications) || [];
      menu.innerHTML = buildMenuHTML(items);
      root.classList.toggle('has-unread', !!(res && res.unreadCount));
      bindMenuLinks();
    }

    function load() {
      if (!global.McuApi) {
        applyState({ notifications: [], unreadCount: 0 });
        return Promise.resolve();
      }
      return global.McuApi.get('notifications.php')
        .then(applyState)
        .catch(function () {
          applyState({ notifications: [], unreadCount: 0 });
        });
    }

    function bindMenuLinks() {
      menu.querySelectorAll('a[data-nid]').forEach(function (a) {
        a.addEventListener('click', function () {
          var id = parseInt(a.getAttribute('data-nid') || '0', 10);
          if (id && global.McuApi) {
            global.McuApi.send('POST', 'notifications.php', { action: 'mark_read', id: id }).catch(function () {});
          }
          closeAllNotify();
        });
      });
      var markAll = menu.querySelector('[data-notify-mark-all]');
      if (markAll) {
        markAll.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!global.McuApi) return;
          global.McuApi.send('POST', 'notifications.php', { action: 'mark_all' })
            .then(applyState)
            .catch(function () {});
        });
      }
    }

    root.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    menu.addEventListener(
      'pointerdown',
      function (e) {
        if (e.button !== 0) return;
        var a = e.target.closest && e.target.closest('a');
        if (a && menu.contains(a)) closeAllNotify();
      },
      true
    );

    load();
    setNotifyMenuHidden(menu, true);

    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-haspopup', 'true');
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Notifications');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeOtherNotify(root);
        var open = !root.classList.contains('open');
        if (open) load();
        root.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        setNotifyMenuHidden(menu, !open);
        document.querySelectorAll('.topbar-user').forEach(function (user) {
          user.classList.remove('open');
          user.setAttribute('aria-expanded', 'false');
        });
      });
    }

    setInterval(function () {
      if (document.hidden) return;
      load();
    }, 45000);
  }

  var docCloseAttached = false;
  function attachDocCloseNotify() {
    if (docCloseAttached) return;
    docCloseAttached = true;
    document.addEventListener('click', closeAllNotify);
  }

  function wireUserClosesNotify() {
    document.querySelectorAll('.topbar-user').forEach(function (user) {
      user.addEventListener('click', closeAllNotify);
    });
  }

  function init() {
    injectStyles();
    attachDocCloseNotify();
    document.querySelectorAll('.topbar-notify').forEach(mountNotify);
    wireUserClosesNotify();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
