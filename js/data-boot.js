/**
 * Loads org, curricula, room types and facilities from MySQL before the page uses them.
 * Falls back to whatever the stores already have (localStorage) if the API
 * is unreachable, and shows a banner so the missing database is obvious.
 */
(function (global) {
  'use strict';

  function banner(text, tone, link) {
    if (!global.document || !global.document.body) return;
    if (global.document.getElementById('mcu-api-banner')) return;
    var el = global.document.createElement('div');
    el.id = 'mcu-api-banner';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:sticky;top:0;z-index:10000;padding:0.65rem 1rem;font:600 0.85rem/1.45 DM Sans,system-ui,sans-serif;' +
      (tone === 'bad'
        ? 'background:#fef2f2;color:#991b1b;border-bottom:1px solid #fecaca;'
        : 'background:#fffbeb;color:#92400e;border-bottom:1px solid #fcd34d;');
    el.textContent = text;
    if (link && link.href) {
      el.appendChild(global.document.createTextNode(' '));
      var a = global.document.createElement('a');
      a.href = link.href;
      a.textContent = link.label || link.href;
      el.appendChild(a);
      if (link.suffix) el.appendChild(global.document.createTextNode(link.suffix));
    }
    global.document.body.insertBefore(el, global.document.body.firstChild);
  }

  var tasks = [];
  if (global.OrgStore && typeof global.OrgStore.hydrate === 'function') tasks.push(global.OrgStore.hydrate());
  if (global.CurriculumStore && typeof global.CurriculumStore.hydrate === 'function') tasks.push(global.CurriculumStore.hydrate());
  if (global.RoomTypes && typeof global.RoomTypes.hydrate === 'function') tasks.push(global.RoomTypes.hydrate());
  if (global.FacilitiesStore && typeof global.FacilitiesStore.hydrate === 'function') tasks.push(global.FacilitiesStore.hydrate());
  if (global.SectionsStore && typeof global.SectionsStore.hydrate === 'function') tasks.push(global.SectionsStore.hydrate());

  global.MCUNexReady = Promise.all(tasks).then(function () {
    if (global.McuApi && global.McuApi.lastError) {
      var err = String(global.McuApi.lastError);
      var phpNotRunning = /not running through PHP|opened as a file/i.test(err);
      if (phpNotRunning) {
        banner(err + ' This page is using local browser storage until then.', 'warn');
      } else {
        banner('MySQL is not connected. ' + err, 'warn', {
          href: (global.McuApi.base || '../api/') + 'install.php',
          label: 'Open api/install.php',
          suffix: ' after starting MySQL. This page is using local browser storage until then.'
        });
      }
    }
    return true;
  });
})(typeof window !== 'undefined' ? window : this);
