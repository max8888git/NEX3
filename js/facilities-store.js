/**
 * Shared campus facilities registry (buildings, floors, rooms, proximity).
 *
 * Mirrors buildings / floors / rooms / building_proximity / floor_college_access
 * plus a small extras JSON blob for room timetables. The stored shape is the
 * same snapshot the Facilities page already keeps in memory, so that page and
 * the reports that copy it round-trip through here without transforming fields:
 *
 *   {
 *     buildingOrder, buildingNames, roomsByBuilding, roomFloorById, roomStatus,
 *     buildingUsesFloors, extraFloorsByBuilding, roomAllocation, roomTimetables,
 *     buildingProximity, floorDepartmentsByBuilding, buildingDeptOnly,
 *     buildingAvailable
 *   }
 *
 * An empty campus is correct for a fresh database. Buildings are created
 * through the Facilities page, not seeded here.
 */
(function (global) {
  'use strict';

  if (global.FacilitiesStore) return;

  var STORAGE_KEY = 'mcu-nex-facilities-v1';

  var data = null;
  var listeners = [];
  var useApi = false;
  var saveChain = Promise.resolve();

  function emptySnapshot() {
    return {
      buildingOrder: [],
      buildingNames: {},
      roomsByBuilding: {},
      roomFloorById: {},
      roomStatus: {},
      buildingUsesFloors: {},
      extraFloorsByBuilding: {},
      roomAllocation: {},
      roomTimetables: {},
      buildingProximity: {},
      floorDepartmentsByBuilding: {},
      buildingDeptOnly: {},
      buildingAvailable: {}
    };
  }

  function asMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    var out = {};
    Object.keys(value).forEach(function (k) {
      var v = value[k];
      if (Array.isArray(v)) out[k] = v.slice();
      else if (v && typeof v === 'object') {
        var inner = {};
        Object.keys(v).forEach(function (ik) {
          inner[ik] = Array.isArray(v[ik]) ? v[ik].slice() : v[ik];
        });
        out[k] = inner;
      } else out[k] = v;
    });
    return out;
  }

  function cloneSnapshot(doc) {
    try {
      return normalize(JSON.parse(JSON.stringify(doc || emptySnapshot())));
    } catch (e) {
      return normalize(doc);
    }
  }

  function normalize(raw) {
    var base = emptySnapshot();
    if (!raw || typeof raw !== 'object') return base;
    base.buildingOrder = Array.isArray(raw.buildingOrder) ? raw.buildingOrder.slice() : [];
    base.buildingNames = asMap(raw.buildingNames);
    base.roomsByBuilding = asMap(raw.roomsByBuilding);
    base.roomFloorById = asMap(raw.roomFloorById);
    base.roomStatus = asMap(raw.roomStatus);
    base.buildingUsesFloors = asMap(raw.buildingUsesFloors);
    base.extraFloorsByBuilding = asMap(raw.extraFloorsByBuilding);
    base.roomAllocation = asMap(raw.roomAllocation);
    base.roomTimetables = asMap(raw.roomTimetables);
    base.buildingProximity = asMap(raw.buildingProximity);
    base.floorDepartmentsByBuilding = asMap(raw.floorDepartmentsByBuilding);
    base.buildingDeptOnly = asMap(raw.buildingDeptOnly);
    base.buildingAvailable = asMap(raw.buildingAvailable);
    return base;
  }

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return normalize(parsed);
    } catch (e) {
      return null;
    }
  }

  function writeStore() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /* private browsing or quota: still usable for this page view */
    }
  }

  function applyDoc(doc) {
    data = normalize(doc);
    return data;
  }

  function load() {
    if (data) return data;
    var stored = readStore();
    data = stored || emptySnapshot();
    return data;
  }

  function notify() {
    listeners.forEach(function (cb) {
      try {
        cb();
      } catch (e) {
        /* one bad listener must not stop the others */
      }
    });
  }

  function hydrate() {
    if (!global.McuApi) {
      load();
      return Promise.resolve(data);
    }
    return global.McuApi.health()
      .then(function (h) {
        if (!h.configured || !h.installed) {
          load();
          return data;
        }
        useApi = true;
        return global.McuApi.get('facilities.php').then(function (res) {
          applyDoc(res.snapshot);
          writeStore();
          notify();
          return data;
        });
      })
      .catch(function () {
        load();
        return data;
      });
  }

  function save(next) {
    applyDoc(cloneSnapshot(next || data));
    writeStore();
    notify();
    if (!useApi || !global.McuApi) {
      return Promise.resolve({ ok: true, snapshot: snapshot() });
    }
    var payload = cloneSnapshot(data);
    saveChain = saveChain
      .catch(function () {
        return null;
      })
      .then(function () {
        return global.McuApi.send('PUT', 'facilities.php', payload);
      });
    return saveChain
      .then(function (res) {
        applyDoc(res.snapshot);
        writeStore();
        notify();
        return {
          ok: true,
          snapshot: snapshot(),
          scheduleImpact: res.scheduleImpact || null,
          blockedRooms: res.blockedRooms || []
        };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function snapshot() {
    return normalize(load());
  }

  function collegeOptions() {
    if (!global.OrgStore || typeof global.OrgStore.colleges !== 'function') return [];
    return global.OrgStore.colleges().map(function (c) {
      return { id: c.id, label: c.name };
    });
  }

  function roomKey(bkey, rid) {
    return String(bkey) + '::' + String(rid);
  }

  function roomGet(map, bkey, rid) {
    if (!map || typeof map !== 'object') return undefined;
    var k = roomKey(bkey, rid);
    if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
    var id = String(rid);
    if (Object.prototype.hasOwnProperty.call(map, id)) return map[id];
    return undefined;
  }

  function roomSet(map, bkey, rid, val) {
    if (!map || typeof map !== 'object') return;
    var k = roomKey(bkey, rid);
    map[k] = val;
    var id = String(rid);
    if (Object.prototype.hasOwnProperty.call(map, id)) delete map[id];
  }

  function roomDel(map, bkey, rid) {
    if (!map || typeof map !== 'object') return;
    delete map[roomKey(bkey, rid)];
    delete map[String(rid)];
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
    return function () {
      listeners = listeners.filter(function (fn) {
        return fn !== cb;
      });
    };
  }

  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return;
      data = null;
      load();
      notify();
    });
  }

  global.FacilitiesStore = {
    STORAGE_KEY: STORAGE_KEY,
    emptySnapshot: emptySnapshot,
    load: load,
    hydrate: hydrate,
    save: save,
    snapshot: snapshot,
    collegeOptions: collegeOptions,
    roomKey: roomKey,
    roomGet: roomGet,
    roomSet: roomSet,
    roomDel: roomDel,
    onChange: onChange
  };
})(typeof window !== 'undefined' ? window : this);
