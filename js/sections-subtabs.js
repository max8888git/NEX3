/**
 * Create / Active / Archived subtabs on Data management → Sections.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (global.MCUNexReady) return global.MCUNexReady.then(fn);
    fn();
  }

  function paneFromHash() {
    var h = String(location.hash || '')
      .replace(/^#/, '')
      .toLowerCase();
    if (h === 'active' || h === 'archived') return h;
    return 'create';
  }

  function showPane(id, pushHash) {
    if (id !== 'active' && id !== 'archived') id = 'create';
    var panes = {
      create: document.getElementById('secPaneCreate'),
      active: document.getElementById('secPaneActive'),
      archived: document.getElementById('secPaneArchived')
    };
    Object.keys(panes).forEach(function (key) {
      if (panes[key]) panes[key].hidden = key !== id;
    });
    document.querySelectorAll('[data-sec-pane]').forEach(function (btn) {
      var on = btn.getAttribute('data-sec-pane') === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var next = '#' + id;
    if (pushHash !== false && location.hash !== next) {
      try {
        history.replaceState(null, '', next);
      } catch (e) {
        location.hash = next;
      }
    }
  }

  ready(function () {
    var tabs = document.querySelectorAll('[data-sec-pane]');
    if (!tabs.length) return;
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        showPane(btn.getAttribute('data-sec-pane'));
      });
    });
    document.querySelectorAll('[data-sec-go]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showPane(el.getAttribute('data-sec-go'));
      });
    });
    global.addEventListener('hashchange', function () {
      showPane(paneFromHash(), false);
    });
    showPane(paneFromHash(), false);
    global.SectionsSubtabs = { show: showPane };
  });
})(typeof window !== 'undefined' ? window : this);
