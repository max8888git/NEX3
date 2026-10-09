/**
 * Loads timetable send / send-back records onto Admin, Super Admin, and VPAA
 * Requests pages.
 */
(function (global) {
  'use strict';

  function actorFromPage() {
    var path = String(global.location.pathname || '').replace(/\\/g, '/');
    if (path.indexOf('/super-admin/') !== -1) return 'super_admin';
    if (path.indexOf('/viewing-with-approval/') !== -1) return 'vpaa';
    if (path.indexOf('/admin/') !== -1) return 'admin';
    var page = document.getElementById('schedPage') || document.getElementById('requestPage');
    return (page && page.getAttribute('data-actor')) || '';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function render(records) {
    var el = document.getElementById('timetableRequestList');
    if (!el) return;
    if (!records.length) {
      el.innerHTML = '<p class="req-empty">No timetable sends or send-backs yet.</p>';
      return;
    }
    el.innerHTML = records
      .map(function (row) {
        var sentBack = row.kind === 'send_back';
        var tagClass = sentBack ? 'tag-approval' : 'tag-send';
        var note = row.note
          ? '<div class="item-sub">' + escapeHtml(row.note) + '</div>'
          : '';
        return (
          '<div class="item request-item">' +
            '<div class="item-title">' +
            escapeHtml(row.title) +
            '</div>' +
            '<div class="item-sub">' +
            escapeHtml(row.summary) +
            '</div>' +
            note +
            '<div class="item-meta">' +
            '<span class="tag ' +
            tagClass +
            '">' +
            (sentBack ? 'Sent back' : 'Sent') +
            '</span>' +
            '<span class="tag">' +
            escapeHtml(row.atLabel || '') +
            '</span>' +
            '</div>' +
            '</div>'
        );
      })
      .join('');
  }

  function load() {
    var el = document.getElementById('timetableRequestList');
    if (!el || !global.McuApi) return;
    el.innerHTML = '<p class="req-empty">Loading timetable records…</p>';
    global.McuApi.get('requests.php?actor=' + encodeURIComponent(actorFromPage()))
      .then(function (res) {
        render(res.records || []);
      })
      .catch(function (err) {
        el.innerHTML =
          '<p class="req-empty">' + escapeHtml(err.message || String(err)) + '</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})(typeof window !== 'undefined' ? window : this);
