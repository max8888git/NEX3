/**
 * Facilities "Room types" list: add, rename, delete-with-replace.
 * Dropdowns elsewhere only pick from this catalog.
 */
(function (global) {
  'use strict';

  var lastRoomsOpen = false;

  function $(id) {
    return global.document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function usageLine(t) {
    var u = (t && t.usage) || {};
    var rooms = Number(u.rooms) || 0;
    var subjects = Number(u.subjects) || 0;
    var parts = [];
    parts.push(rooms === 1 ? '1 room' : rooms + ' rooms');
    parts.push(subjects === 1 ? '1 subject' : subjects + ' subjects');
    if (t.requiresCampusRoom === false) parts.push('no campus room');
    return parts.join(' · ');
  }

  function inUse(t) {
    return !!(t && t.usage && t.usage.inUse);
  }

  function setTab(pane) {
    var buildings = $('flowBuildings');
    var rooms = $('flowRooms');
    var types = $('flowRoomTypes');
    var tabBuildings = $('facTabBuildings');
    var tabTypes = $('facTabRoomTypes');
    var goingTypes = pane === 'types';

    if (goingTypes) {
      lastRoomsOpen = !!(rooms && !rooms.hidden);
      if (buildings) buildings.hidden = true;
      if (rooms) rooms.hidden = true;
      if (types) types.hidden = false;
    } else {
      if (types) types.hidden = true;
      if (lastRoomsOpen && rooms) {
        rooms.hidden = false;
        if (buildings) buildings.hidden = true;
      } else {
        if (buildings) buildings.hidden = false;
        if (rooms) rooms.hidden = true;
      }
    }

    if (tabBuildings) {
      tabBuildings.classList.toggle('is-active', !goingTypes);
      tabBuildings.setAttribute('aria-selected', goingTypes ? 'false' : 'true');
    }
    if (tabTypes) {
      tabTypes.classList.toggle('is-active', goingTypes);
      tabTypes.setAttribute('aria-selected', goingTypes ? 'true' : 'false');
    }
    if (goingTypes) renderList();
  }

  function renderList() {
    var ul = $('roomTypeList');
    if (!ul || !global.RoomTypes) return;
    var items = global.RoomTypes.list();
    ul.innerHTML = '';
    if (!items.length) {
      var empty = global.document.createElement('p');
      empty.className = 'rt-empty';
      empty.textContent = 'No room types yet.';
      ul.appendChild(empty);
      return;
    }
    items.forEach(function (t) {
      var li = global.document.createElement('li');
      li.className = 'rt-row';
      var protectedType = global.RoomTypes.isProtectedType(t);
      li.innerHTML =
        '<div class="rt-row-main"><div class="rt-name">' +
        esc(t.name) +
        (protectedType ? '<span class="rt-badge">Built-in</span>' : '') +
        '</div><div class="rt-meta">' +
        esc(usageLine(t)) +
        '</div></div>';
      if (!protectedType) {
        var actions = global.document.createElement('div');
        actions.className = 'rt-actions';
        var renameBtn = global.document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', function () {
          openRename(t);
        });
        var deleteBtn = global.document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'rt-btn-delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', function () {
          openDelete(t);
        });
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        li.appendChild(actions);
      }
      ul.appendChild(li);
    });
  }

  function closeOverlay(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function openDelete(type) {
    var doc = global.document;
    var others = global.RoomTypes.list().filter(function (t) {
      return t.id !== type.id;
    });
    var overlay = doc.createElement('div');
    overlay.className = 'rt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Delete room type');

    var used = inUse(type);
    var options = others
      .map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      })
      .join('');
    var replaceBlock = used
      ? '<label for="rtReplaceSelect">Replace with</label><select id="rtReplaceSelect">' +
        options +
        '</select>'
      : '';
    var hint = used
      ? 'Rooms and curriculum lecture/lab tags that use "' +
        type.name +
        '" will be retagged to the replacement. This cannot be undone.'
      : '"' + type.name + '" is not used on any room or subject. Delete it?';

    overlay.innerHTML =
      '<div class="rt-dialog"><h2>Delete room type</h2><p>' +
      esc(hint) +
      '</p>' +
      replaceBlock +
      '<div class="rt-dialog-error" hidden></div>' +
      '<div class="rt-dialog-actions">' +
      '<button type="button" class="rt-dialog-cancel">Cancel</button>' +
      '<button type="button" class="rt-dialog-danger">Delete</button>' +
      '</div></div>';
    doc.body.appendChild(overlay);

    var errEl = overlay.querySelector('.rt-dialog-error');
    var replaceSel = overlay.querySelector('#rtReplaceSelect');
    function finish() {
      closeOverlay(overlay);
      doc.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') finish();
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) finish();
    });
    overlay.querySelector('.rt-dialog-cancel').addEventListener('click', finish);
    overlay.querySelector('.rt-dialog-danger').addEventListener('click', function () {
      var replaceId = replaceSel ? replaceSel.value : '';
      if (used && !replaceId) {
        errEl.hidden = false;
        errEl.textContent = 'Choose a replacement room type.';
        return;
      }
      global.RoomTypes.remove(type.id, replaceId).then(function (res) {
        if (!res.ok) {
          errEl.hidden = false;
          errEl.textContent = res.error || 'The room type could not be deleted.';
          return;
        }
        finish();
        renderList();
      });
    });
    doc.addEventListener('keydown', onKey);
  }

  function openRename(type) {
    var doc = global.document;
    var overlay = doc.createElement('div');
    overlay.className = 'rt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Rename room type');
    overlay.innerHTML =
      '<div class="rt-dialog"><h2>Rename room type</h2>' +
      '<p>This name updates on rooms and on curriculum lecture/lab tags.</p>' +
      '<label for="rtRenameInput">New name</label>' +
      '<input id="rtRenameInput" type="text" maxlength="120" autocomplete="off" />' +
      '<div class="rt-dialog-error" hidden></div>' +
      '<div class="rt-dialog-actions">' +
      '<button type="button" class="rt-dialog-cancel">Cancel</button>' +
      '<button type="button" class="rt-dialog-primary">Save name</button>' +
      '</div></div>';
    doc.body.appendChild(overlay);
    var input = overlay.querySelector('#rtRenameInput');
    input.value = type.name;
    input.focus();
    input.select();
    var errEl = overlay.querySelector('.rt-dialog-error');
    function finish() {
      closeOverlay(overlay);
      doc.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') finish();
      if (e.key === 'Enter' && e.target === input) {
        e.preventDefault();
        submit();
      }
    }
    function submit() {
      global.RoomTypes.rename(type.id, input.value).then(function (res) {
        if (!res.ok) {
          errEl.hidden = false;
          errEl.textContent = res.error || 'The room type could not be renamed.';
          return;
        }
        finish();
        renderList();
      });
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) finish();
    });
    overlay.querySelector('.rt-dialog-cancel').addEventListener('click', finish);
    overlay.querySelector('.rt-dialog-primary').addEventListener('click', submit);
    doc.addEventListener('keydown', onKey);
  }

  function init() {
    if (!$('flowRoomTypes') || !global.RoomTypes) return;

    var tabBuildings = $('facTabBuildings');
    var tabTypes = $('facTabRoomTypes');
    if (tabBuildings) {
      tabBuildings.addEventListener('click', function () {
        setTab('buildings');
      });
    }
    if (tabTypes) {
      tabTypes.addEventListener('click', function () {
        setTab('types');
      });
    }

    var addBtn = $('btnAddRoomType');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        global.RoomTypes.promptNew({
          onCreated: function () {
            renderList();
          }
        });
      });
    }

    if (typeof global.RoomTypes.onChange === 'function') {
      global.RoomTypes.onChange(function () {
        if ($('flowRoomTypes') && !$('flowRoomTypes').hidden) renderList();
      });
    }

    renderList();
  }

  function boot() {
    (global.MCUNexReady || Promise.resolve()).then(init);
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
