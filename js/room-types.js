/**
 * Shared room-type registry.
 *
 * Which laboratories a campus has cannot be known up front, so the list is data
 * rather than a fixed set of options: staff add a type the moment they meet one
 * and it is selectable everywhere from then on.
 *
 * Mirrors the room_types table in database_schema.sql (name, is_active). The name
 * is the whole classification: "Chemistry Laboratory" already says it is a
 * laboratory, so there is no second category field to keep in agreement with it.
 *
 * Persistence is MySQL via room-types.php, with localStorage as a fallback.
 * Add, rename, and delete live on the Facilities Room types list. Dropdowns
 * only pick an existing type. Lecture and Off-campus are reserved.
 */
(function (global) {
  'use strict';

  if (global.RoomTypes) return;

  var STORAGE_KEY = 'mcu-nex-room-types-v1';
  var ADD_NEW_VALUE = '__add_new_room_type__';
  var BASELINE_NAME = 'Lecture';

  var types = null;
  var listeners = [];
  var attached = [];

  var useApi = false;

  function applyTypes(list) {
    types = ensureBaseline(
      (Array.isArray(list) ? list : []).filter(function (t) {
        return t && typeof t.name === 'string' && t.name.length > 0;
      }).map(function (t) {
        t.isProtected = isProtectedType(t);
        return t;
      })
    );
    return types;
  }

  function hydrate() {
    if (!global.McuApi) {
      load();
      return Promise.resolve(types);
    }
    return global.McuApi.health().then(function (h) {
      if (!h.configured || !h.installed) {
        load();
        return types;
      }
      useApi = true;
      return global.McuApi.get('room-types.php').then(function (res) {
        applyTypes(res.types);
        writeStore();
        notify();
        return types;
      });
    }).catch(function () {
      load();
      return types;
    });
  }

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeStore() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
    } catch (e) {
      /* private browsing or quota: the list still works for this page view */
    }
  }

  function ensureBaseline(list) {
    var hasBaseline = list.some(function (t) {
      return normalizeName(t.name) === normalizeName(BASELINE_NAME);
    });
    if (!hasBaseline) {
      list.unshift({
        id: 'baseline-lecture',
        name: BASELINE_NAME,
        isActive: true,
        isBaseline: true,
        isProtected: true,
        createdAt: null
      });
    }
    return list;
  }

  function load() {
    if (types) return types;
    types = ensureBaseline(
      readStore().filter(function (t) {
        return t && typeof t.name === 'string' && t.name.length > 0;
      })
    );
    return types;
  }

  // ------------------------------------------------------------ name matching

  /**
   * Folds the spelling variants that staff actually produce, so "Computer Lab",
   * "computer lab" and "Computer Laboratory" all collapse to one key and are
   * caught as duplicates rather than becoming three separate types that split
   * the room pool.
   */
  function normalizeName(name) {
    var s = String(name == null ? '' : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    s = s.replace(/\blabs\b/g, 'laboratory');
    s = s.replace(/\blab\b/g, 'laboratory');
    s = s.replace(/\blaboratories\b/g, 'laboratory');
    s = s.replace(/\blec\b/g, 'lecture');
    s = s.replace(/\brm\b/g, 'room');
    return s.replace(/\s+/g, ' ').trim();
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    var i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var curr = [i];
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = curr;
    }
    return prev[b.length];
  }

  /** The existing type a proposed name would duplicate, or null. */
  function findConflict(name) {
    var canon = canonicalName(name);
    var key = normalizeName(name);
    if (!key && !canon) return null;
    var all = load();
    for (var i = 0; i < all.length; i++) {
      if (canon && canonicalName(all[i].name) === canon) return all[i];
      if (key && normalizeName(all[i].name) === key) return all[i];
    }
    return null;
  }

  /**
   * Existing types close enough to be worth querying, for names the exact check
   * cannot catch, e.g. a typo like "Chemisty Laboratory".
   */
  function similar(name) {
    var key = normalizeName(name);
    if (key.length < 3) return [];
    return list().filter(function (t) {
      var other = normalizeName(t.name);
      if (other === key) return false;
      if (other.indexOf(key) !== -1 || key.indexOf(other) !== -1) return true;
      var limit = key.length <= 6 ? 1 : 2;
      return editDistance(key, other) <= limit;
    });
  }

  // -------------------------------------------------------------- public data

  /** Lecture, then Off-campus, then everything else alphabetical. */
  function sortRank(t) {
    if (t && (t.isBaseline || isBaselineName(t.name))) return 0;
    if (t && (t.isProtected || canonicalName(t.name) === 'Off-campus')) return 1;
    return 2;
  }

  function sortForDisplay(a, b) {
    var ra = sortRank(a);
    var rb = sortRank(b);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  }

  function list() {
    return load()
      .filter(function (t) {
        return t.isActive !== false;
      })
      .slice()
      .sort(sortForDisplay);
  }

  /** Everything except the Lecture baseline, for tagging a subject's lab hours. */
  function needsCampusRoom(t) {
    return !t || t.requiresCampusRoom !== false;
  }

  function listLaboratories() {
    return list().filter(function (t) {
      return normalizeName(t.name) !== normalizeName(BASELINE_NAME);
    });
  }

  /** Physical campus rooms only — hides Off-campus. */
  function listCampusRooms() {
    return list().filter(needsCampusRoom);
  }

  function isBaselineName(name) {
    return normalizeName(name) === normalizeName(BASELINE_NAME);
  }

  function canonicalName(name) {
    var clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    var key = clean
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (key === 'off campus' || key === 'no room' || key === 'noroom') return 'Off-campus';
    return clean;
  }

  function isProtectedName(name) {
    return isBaselineName(name) || canonicalName(name) === 'Off-campus';
  }

  function isProtectedType(t) {
    return !!(t && (t.isProtected || t.isBaseline || isProtectedName(t.name)));
  }

  function findByName(name) {
    return findConflict(name);
  }

  function add(name, opts) {
    var clean = canonicalName(String(name == null ? '' : name).replace(/\s+/g, ' ').trim());
    if (!clean) return Promise.resolve({ ok: false, error: 'Enter a name for the room type.' });
    if (clean.length > 120) return Promise.resolve({ ok: false, error: 'Keep the name under 120 characters.' });

    var conflict = findConflict(clean);
    if (conflict) return Promise.resolve({ ok: false, conflict: conflict });

    if (useApi && global.McuApi) {
      return global.McuApi.send('POST', 'room-types.php', {
        name: clean,
        requiresCampusRoom: opts && opts.requiresCampusRoom === false ? false : true
      })
        .then(function (res) {
          if (res.conflict && res.type) {
            return { ok: false, conflict: res.type };
          }
          return applyMutationPayload(res).then(function () {
            return { ok: true, type: res.type };
          });
        })
        .catch(function (err) {
          return { ok: false, error: err.message || String(err) };
        });
    }

    var type = {
      id: 'rt-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: clean,
      isActive: true,
      requiresCampusRoom: canonicalName(clean) === 'Off-campus' ? false : !(opts && opts.requiresCampusRoom === false),
      createdAt: new Date().toISOString()
    };
    load().push(type);
    writeStore();
    notify();
    return Promise.resolve({ ok: true, type: type });
  }

  function findById(id) {
    var all = load();
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function refreshDependents() {
    var tasks = [];
    if (global.CurriculumStore && typeof global.CurriculumStore.hydrate === 'function') {
      tasks.push(global.CurriculumStore.hydrate());
    }
    if (global.FacilitiesStore && typeof global.FacilitiesStore.hydrate === 'function') {
      tasks.push(global.FacilitiesStore.hydrate());
    }
    return Promise.all(tasks).then(function () {
      if (global.document && global.document.dispatchEvent) {
        global.document.dispatchEvent(new CustomEvent('mcu-room-types-changed'));
      }
    });
  }

  function applyMutationPayload(res) {
    if (res && Array.isArray(res.types)) {
      applyTypes(res.types);
      writeStore();
    } else if (res && res.type) {
      var existing = findById(res.type.id) || findConflict(res.type.name);
      if (existing) {
        Object.keys(res.type).forEach(function (k) {
          existing[k] = res.type[k];
        });
      } else {
        load().push(res.type);
      }
      writeStore();
    }
    notify();
    return refreshDependents().then(function () {
      return res;
    });
  }

  function rename(id, name) {
    var clean = canonicalName(String(name == null ? '' : name).replace(/\s+/g, ' ').trim());
    if (!clean) return Promise.resolve({ ok: false, error: 'Enter a name for the room type.' });
    if (clean.length > 120) return Promise.resolve({ ok: false, error: 'Keep the name under 120 characters.' });

    var current = findById(id);
    if (current && isProtectedType(current)) {
      return Promise.resolve({ ok: false, error: 'Lecture and Off-campus cannot be renamed.' });
    }
    if (isProtectedName(clean)) {
      return Promise.resolve({ ok: false, error: 'That name is reserved. Choose a different room type name.' });
    }
    var conflict = findConflict(clean);
    if (conflict && conflict.id !== id) {
      return Promise.resolve({ ok: false, conflict: conflict, error: 'A room type named "' + conflict.name + '" already exists.' });
    }

    if (useApi && global.McuApi) {
      return global.McuApi.send('POST', 'room-types.php', { action: 'rename', id: id, name: clean })
        .then(function (res) {
          return applyMutationPayload(res).then(function () {
            return { ok: true, type: res.type };
          });
        })
        .catch(function (err) {
          return { ok: false, error: err.message || String(err) };
        });
    }

    if (!current) return Promise.resolve({ ok: false, error: 'That room type was not found.' });
    current.name = clean;
    writeStore();
    notify();
    return refreshDependents().then(function () {
      return { ok: true, type: current };
    });
  }

  function remove(id, replaceId) {
    var current = findById(id);
    if (current && isProtectedType(current)) {
      return Promise.resolve({ ok: false, error: 'Lecture and Off-campus cannot be deleted.' });
    }

    if (useApi && global.McuApi) {
      var body = { action: 'delete', id: id };
      if (replaceId) body.replaceId = replaceId;
      return global.McuApi.send('POST', 'room-types.php', body)
        .then(function (res) {
          return applyMutationPayload(res).then(function () {
            return { ok: true };
          });
        })
        .catch(function (err) {
          return { ok: false, error: err.message || String(err) };
        });
    }

    if (!current) return Promise.resolve({ ok: false, error: 'That room type was not found.' });
    types = load().filter(function (t) {
      return t.id !== id;
    });
    writeStore();
    notify();
    return refreshDependents().then(function () {
      return { ok: true };
    });
  }

  // ------------------------------------------------------------- change events

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function notify() {
    refreshAttached();
    listeners.forEach(function (cb) {
      try {
        cb(list());
      } catch (e) {
        /* one bad listener must not stop the others */
      }
    });
  }

  global.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    types = null;
    load();
    notify();
  });

  // ---------------------------------------------------------------- selects

  function makeOption(value, label) {
    var o = global.document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  /**
   * Fills a room-type picker. By default there is no blank option: the first
   * entry is the Lecture baseline and it is selected when nothing else applies,
   * so a room always carries a type.
   *
   * Callers tagging a subject's laboratory hours pass excludeBaseline so Lecture
   * is not offered there. Lecture room type is a separate picker and is never
   * inferred. allowEmpty is for subjects that have no hours in that component.
   *
   * An unrecognised current value is kept as an option rather than discarded,
   * so opening a room saved under an older spelling does not silently retype it.
   */
  function fillSelect(sel, selectedName, opts) {
    if (!sel) return;
    opts = opts || {};
    var items = opts.excludeBaseline ? listLaboratories() : list();
    if (opts.campusRoomsOnly) {
      items = items.filter(needsCampusRoom);
    }
    sel.innerHTML = '';

    if (opts.allowEmpty) {
      sel.appendChild(makeOption('', opts.emptyLabel || 'No specific room type'));
    }

    items.forEach(function (t) {
      sel.appendChild(makeOption(t.name, t.name));
    });

    // The sentinel is never a real selection, so treat it as "nothing chosen"
    // rather than letting it be preserved as an unrecognised value.
    var wanted = String(selectedName == null ? '' : selectedName).trim();
    if (wanted === ADD_NEW_VALUE) wanted = '';
    if (opts.excludeBaseline && isBaselineName(wanted)) wanted = '';
    var match = wanted ? findConflict(wanted) : null;
    if (wanted && match && opts.campusRoomsOnly && !needsCampusRoom(match)) {
      sel.appendChild(makeOption(match.name, match.name + ' (curriculum only)'));
    } else if (wanted && !match) {
      sel.appendChild(makeOption(wanted, wanted + ' (not in list)'));
    }

    if (opts.includeAddNew === true) {
      sel.appendChild(makeOption(ADD_NEW_VALUE, opts.addNewLabel || '+ Add new room type…'));
    }

    if (match) sel.value = match.name;
    else if (wanted) sel.value = wanted;
    else if (opts.allowEmpty) sel.value = '';
    else if (items.length) sel.value = items[0].name;

    // Remembered on the element itself, so cancelling the add dialog reverts
    // correctly even when the host page re-filled the picker programmatically.
    sel.setAttribute('data-rt-prev', sel.value);
  }

  /** Fills a filter picker: an "all" entry first, no add-new option. */
  function fillFilterSelect(sel, opts) {
    if (!sel) return;
    opts = opts || {};
    var allValue = opts.allValue != null ? opts.allValue : '';
    var previous = sel.value;
    sel.innerHTML = '';
    sel.appendChild(makeOption(allValue, opts.allLabel || 'All types'));

    // Null prototype, so a type whose name normalises to "constructor" or
    // "toString" is not mistaken for one already seen.
    var seen = Object.create(null);
    var filterItems = opts.campusRoomsOnly ? listCampusRooms() : list();
    filterItems.forEach(function (t) {
      seen[normalizeName(t.name)] = true;
      sel.appendChild(makeOption(t.name, t.name));
    });

    // Values present in the data but not in the registry, so filtering by them
    // stays possible instead of those rooms becoming unreachable.
    (opts.extraValues || []).forEach(function (v) {
      var name = String(v == null ? '' : v).trim();
      if (!name) return;
      var key = normalizeName(name);
      if (seen[key]) return;
      seen[key] = true;
      sel.appendChild(makeOption(name, name));
    });

    if (opts.unspecifiedValue != null) {
      sel.appendChild(makeOption(opts.unspecifiedValue, opts.unspecifiedLabel || 'Unspecified'));
    }

    if (previous != null) sel.value = previous;
    if (sel.selectedIndex < 0) sel.value = allValue;
  }

  /**
   * Wires a picker so it stays in sync with the registry. Add/rename/delete
   * happen on the Facilities Room types list, not from these dropdowns.
   */
  function attachSelect(sel, opts) {
    if (!sel) return;
    opts = opts || {};
    var record = { el: sel, kind: opts.kind === 'filter' ? 'filter' : 'edit', opts: opts };
    attached.push(record);

    if (record.kind === 'filter') {
      fillFilterSelect(sel, opts);
      return;
    }

    fillSelect(sel, opts.selected, opts);

    if (opts.includeAddNew !== true) return;

    sel.addEventListener('change', function () {
      if (sel.value !== ADD_NEW_VALUE) {
        sel.setAttribute('data-rt-prev', sel.value);
        return;
      }
      var previous = sel.getAttribute('data-rt-prev') || '';
      function accept(type) {
        fillSelect(sel, type.name, opts);
        if (typeof opts.onChange === 'function') opts.onChange(type.name);
      }
      promptNew({
        campusRoomsOnly: !!opts.campusRoomsOnly,
        onCreated: accept,
        onUseExisting: accept,
        onCancel: function () {
          fillSelect(sel, previous, opts);
        }
      });
    });
  }

  function refreshAttached() {
    attached.forEach(function (record) {
      if (!record.el || !record.el.isConnected) return;
      if (record.kind === 'filter') fillFilterSelect(record.el, record.opts);
      else fillSelect(record.el, record.el.value, record.opts);
    });
  }

  // ----------------------------------------------------------------- dialog

  var PURPLE = 'var(--purple, #6d28d9)';

  function styleButton(btn, primary) {
    btn.style.cssText =
      'padding:0.5rem 0.9rem;border-radius:8px;font-size:0.9rem;font-weight:600;cursor:pointer;border:1px solid ' +
      (primary ? 'transparent;background:' + PURPLE + ';color:#fff;' : '#d1d5db;background:#fff;color:#374151;');
  }

  function promptNew(handlers) {
    handlers = handlers || {};
    var doc = global.document;

    var overlay = doc.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', handlers.title || 'Add room type');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(17,24,39,0.55);display:flex;align-items:center;' +
      'justify-content:center;z-index:9999;padding:1rem;';

    var box = doc.createElement('div');
    box.style.cssText =
      'background:#fff;border-radius:14px;padding:1.35rem;width:100%;max-width:430px;' +
      'box-shadow:0 20px 45px rgba(0,0,0,0.25);font-family:inherit;';

    var title = doc.createElement('h2');
    title.textContent = handlers.title || 'Add room type';
    title.style.cssText = 'margin:0 0 0.3rem;font-size:1.05rem;color:#111827;';

    var hint = doc.createElement('p');
    hint.textContent =
      handlers.hint ||
      'Name the room type as staff will recognise it. It becomes selectable everywhere once saved.';
    hint.style.cssText = 'margin:0 0 1rem;font-size:0.85rem;color:#6b7280;line-height:1.45;';

    var nameLabel = doc.createElement('label');
    nameLabel.textContent = handlers.nameLabel || 'Room type name';
    nameLabel.style.cssText =
      'display:block;font-size:0.8rem;font-weight:600;color:#374151;margin-bottom:0.3rem;';
    var nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = handlers.placeholder || 'e.g. Chemistry Laboratory';
    nameInput.autocomplete = 'off';
    nameInput.style.cssText =
      'width:100%;padding:0.55rem 0.7rem;border:1px solid #d1d5db;border-radius:8px;font-size:0.92rem;box-sizing:border-box;';
    nameLabel.appendChild(nameInput);

    var notice = doc.createElement('div');
    notice.style.cssText = 'margin-top:0.85rem;font-size:0.85rem;line-height:1.45;';

    var actions = doc.createElement('div');
    actions.style.cssText =
      'display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.25rem;';
    var cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    styleButton(cancelBtn, false);
    var createBtn = doc.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = handlers.submitLabel || 'Add room type';
    styleButton(createBtn, true);
    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);

    box.appendChild(title);
    box.appendChild(hint);
    box.appendChild(nameLabel);

    var campusWrap = doc.createElement('label');
    campusWrap.style.cssText =
      'display:flex;align-items:flex-start;gap:0.55rem;margin:0.9rem 0 0;font-size:0.85rem;color:#374151;cursor:pointer;line-height:1.4;';
    var campusBox = doc.createElement('input');
    campusBox.type = 'checkbox';
    campusBox.checked = true;
    campusBox.style.cssText = 'margin-top:0.2rem;flex-shrink:0;';
    var campusText = doc.createElement('span');
    campusText.innerHTML =
      '<strong>Needs a campus room</strong><br><span style="color:#6b7280">Uncheck for Off-campus. That occupies student time but never books a room, and it is not merged.</span>';
    campusWrap.appendChild(campusBox);
    campusWrap.appendChild(campusText);
    if (!handlers.campusRoomsOnly) {
      box.appendChild(campusWrap);
    }

    box.appendChild(notice);
    box.appendChild(actions);
    overlay.appendChild(box);
    doc.body.appendChild(overlay);
    nameInput.focus();

    var closed = false;
    function close(cb, arg) {
      if (closed) return;
      closed = true;
      doc.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof cb === 'function') cb(arg);
    }

    function useExisting(type) {
      close(handlers.onUseExisting || handlers.onCreated, type);
    }

    function renderNotice() {
      notice.innerHTML = '';
      var value = nameInput.value.trim();
      if (!value) {
        createBtn.disabled = false;
        createBtn.style.opacity = '1';
        return;
      }

      var conflict = findConflict(value);
      if (conflict && handlers.campusRoomsOnly && !needsCampusRoom(conflict)) {
        createBtn.disabled = true;
        createBtn.style.opacity = '0.5';
        var only = doc.createElement('div');
        only.style.cssText =
          'background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:0.6rem 0.7rem;color:#92400e;';
        only.textContent =
          '"' + conflict.name + '" is a curriculum type (no campus room). Pick a campus room type instead.';
        notice.appendChild(only);
        return;
      }
      if (conflict) {
        createBtn.disabled = true;
        createBtn.style.opacity = '0.5';
        var warn = doc.createElement('div');
        warn.style.cssText =
          'background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:0.6rem 0.7rem;color:#92400e;';
        warn.appendChild(
          doc.createTextNode('This already exists as "' + conflict.name + '". ')
        );
        var useBtn = doc.createElement('button');
        useBtn.type = 'button';
        useBtn.textContent = 'Use "' + conflict.name + '"';
        useBtn.style.cssText =
          'margin-top:0.5rem;display:block;padding:0.35rem 0.6rem;border-radius:6px;border:1px solid #92400e;' +
          'background:#fff;color:#92400e;font-size:0.82rem;font-weight:600;cursor:pointer;';
        useBtn.addEventListener('click', function () {
          useExisting(conflict);
        });
        warn.appendChild(useBtn);
        notice.appendChild(warn);
        return;
      }

      createBtn.disabled = false;
      createBtn.style.opacity = '1';

      var close_matches = similar(value).filter(function (t) {
        return !handlers.campusRoomsOnly || needsCampusRoom(t);
      });
      if (!close_matches.length) return;

      var box2 = doc.createElement('div');
      box2.style.cssText =
        'background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:0.6rem 0.7rem;color:#1e40af;';
      var lead = doc.createElement('div');
      lead.textContent =
        close_matches.length === 1 ? 'Did you mean this existing type?' : 'Similar existing types:';
      lead.style.cssText = 'font-weight:600;margin-bottom:0.4rem;';
      box2.appendChild(lead);
      close_matches.slice(0, 4).forEach(function (t) {
        var useBtn = doc.createElement('button');
        useBtn.type = 'button';
        useBtn.textContent = 'Use "' + t.name + '"';
        useBtn.style.cssText =
          'display:block;margin:0.25rem 0;padding:0.32rem 0.6rem;border-radius:6px;border:1px solid #1e40af;' +
          'background:#fff;color:#1e40af;font-size:0.82rem;font-weight:600;cursor:pointer;';
        useBtn.addEventListener('click', function () {
          useExisting(t);
        });
        box2.appendChild(useBtn);
      });
      notice.appendChild(box2);
    }

    function submit() {
      add(nameInput.value, {
        requiresCampusRoom: handlers.campusRoomsOnly ? true : campusBox.checked
      }).then(function (result) {
        if (result.ok) {
          close(handlers.onCreated, result.type);
          return;
        }
        if (result.conflict) {
          renderNotice();
          return;
        }
        notice.innerHTML = '';
        var err = doc.createElement('div');
        err.textContent = result.error;
        err.style.cssText =
          'background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:0.6rem 0.7rem;color:#991b1b;';
        notice.appendChild(err);
      });
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(handlers.onCancel);
      } else if (e.key === 'Enter' && e.target === nameInput) {
        e.preventDefault();
        if (!createBtn.disabled) submit();
      }
    }

    nameInput.addEventListener('input', renderNotice);
    createBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', function () {
      close(handlers.onCancel);
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close(handlers.onCancel);
    });
    doc.addEventListener('keydown', onKey);
  }

  global.RoomTypes = {
    ADD_NEW_VALUE: ADD_NEW_VALUE,
    BASELINE_NAME: BASELINE_NAME,
    list: list,
    hydrate: hydrate,
    listLaboratories: listLaboratories,
    listCampusRooms: listCampusRooms,
    isBaselineName: isBaselineName,
    isProtectedName: isProtectedName,
    isProtectedType: isProtectedType,
    add: add,
    rename: rename,
    remove: remove,
    findByName: findByName,
    similar: similar,
    normalizeName: normalizeName,
    canonicalName: canonicalName,
    fillSelect: fillSelect,
    fillFilterSelect: fillFilterSelect,
    attachSelect: attachSelect,
    promptNew: promptNew,
    onChange: onChange
  };
})(window);
