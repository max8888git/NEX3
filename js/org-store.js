/**
 * Shared colleges and departments registry.
 *
 * A college has departments. Each department has one or more programs.
 * Curricula and sections belong to a program. One department has one Program Chair.
 *
 * The stored shape is identical to the DM_COLLEGE object that
 * college-departments.html already keeps in memory, so that page round-trips
 * through here without transforming anything:
 *
 *   { active: [college], archivedColleges: [college], archivedDeptOnly: [dept] }
 *   college = { id, name, code, useDepartments, departments: [{ id, name, programs: [{ id, name }] }] }
 *
 * Persistence is localStorage because there is no backend yet; swapping
 * readStore/writeStore for API calls is the only change needed later.
 */
(function (global) {
  'use strict';

  if (global.OrgStore) return;

  var STORAGE_KEY = 'mcu-nex-org-v1';

  var data = null;
  var listeners = [];

  function emptyData() {
    return { active: [], archivedColleges: [], archivedDeptOnly: [] };
  }

  /**
   * The prototype's starting colleges, used only when nothing has been saved
   * yet. It lives here rather than inside one page so that every page sees the
   * same list on a first visit; when this was defined in college-departments
   * only, uploading a curriculum before opening that page found no colleges.
   *
   * Empty this array for a real deployment: the first thing the registrar does
   * is create their own colleges, and anything left here would be fake data.
   */
  function defaultData() {
    return {
      active: [
        {
          id: 'c-cas',
          name: 'College of Arts and Sciences',
          code: 'CAS',
          useDepartments: true,
          departments: [
            { id: 'd-cs', name: 'Computer Science' },
            { id: 'd-it', name: 'Information Technology' },
            { id: 'd-emc', name: 'EMC' },
            { id: 'd-psych', name: 'Psychology' },
            { id: 'd-bio', name: 'Biological Sciences' }
          ]
        },
        { id: 'c-opt', name: 'College of Optometry', code: 'OPT', useDepartments: false, departments: [] },
        { id: 'c-con', name: 'College of Nursing', code: 'CON', useDepartments: false, departments: [] }
      ],
      archivedColleges: [
        {
          id: 'c-cop',
          name: 'College of Pharmacy',
          code: 'COP',
          archivedLabel: 'Jun 2024',
          useDepartments: false,
          departments: []
        }
      ],
      archivedDeptOnly: [
        {
          id: 'd-chem',
          deptName: 'Chemistry',
          parentCode: 'CAS',
          parentName: 'College of Arts and Sciences',
          archivedLabel: 'Jan 2025'
        }
      ]
    };
  }

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.active)) return null;
      if (!Array.isArray(parsed.archivedColleges)) parsed.archivedColleges = [];
      if (!Array.isArray(parsed.archivedDeptOnly)) parsed.archivedDeptOnly = [];
      return parsed;
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

  /**
   * Reads the saved organisation. An empty list is correct for a fresh MySQL
   * database; colleges are created through the UI, not seeded here.
   */
  function load() {
    if (data) return data;
    var stored = readStore();
    if (stored) {
      data = stored;
      return data;
    }
    data = emptyData();
    return data;
  }

  function applyDoc(doc) {
    if (!doc) return;
    if (!data) data = emptyData();
    data.active = Array.isArray(doc.active) ? doc.active : [];
    data.archivedColleges = Array.isArray(doc.archivedColleges) ? doc.archivedColleges : [];
    data.archivedDeptOnly = Array.isArray(doc.archivedDeptOnly) ? doc.archivedDeptOnly : [];
  }

  var useApi = false;

  function hydrate() {
    if (!global.McuApi) {
      load();
      return Promise.resolve(data);
    }
    return global.McuApi.health().then(function (h) {
      if (!h.configured || !h.installed) {
        load();
        return data;
      }
      useApi = true;
      return global.McuApi.get('org.php').then(function (res) {
        applyDoc(res.org);
        writeStore();
        notify();
        return data;
      });
    }).catch(function () {
      load();
      return data;
    });
  }

  /** Writes the whole object. college-departments.html calls this on every render. */
  function save(next) {
    if (next && Array.isArray(next.active)) {
      if (next !== data) applyDoc(next);
      else data = next;
    }
    writeStore();
    notify();
    if (!useApi || !global.McuApi) {
      return Promise.resolve({ ok: true, org: data });
    }
    return global.McuApi.send('PUT', 'org.php', data)
      .then(function (res) {
        applyDoc(res.org);
        writeStore();
        notify();
        return { ok: true, org: data };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function newId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  }

  function sameName(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  /**
   * Creates a college. Used by the Colleges page and by the curriculum upload
   * dialog, so that an empty system is not a dead end during an upload.
   */
  function addCollege(name, code, useDepartments) {
    var clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!clean) return Promise.resolve({ ok: false, error: 'Enter a name for the college.' });

    var all = load().active;
    for (var i = 0; i < all.length; i++) {
      if (sameName(all[i].name, clean)) {
        return Promise.resolve({
          ok: false,
          error: 'A college called "' + all[i].name + '" already exists.',
          existing: all[i]
        });
      }
    }

    var college = {
      id: newId('c'),
      name: clean,
      code: String(code == null ? '' : code).trim().toUpperCase(),
      useDepartments: !!useDepartments,
      departments: []
    };
    if (!useApi || !global.McuApi) {
      all.push(college);
      writeStore();
      notify();
      return Promise.resolve({ ok: true, college: college });
    }
    return global.McuApi.send('POST', 'org.php', {
      action: 'addCollege',
      name: clean,
      code: college.code,
      useDepartments: !!useDepartments
    })
      .then(function (res) {
        applyDoc(res.org);
        writeStore();
        notify();
        return { ok: true, college: res.college };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  /** Adds a department, switching the college to multi-program if it was not. */
  function addDepartment(collegeId, name) {
    var clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!clean) return Promise.resolve({ ok: false, error: 'Enter a name for the department.' });

    var college = findCollege(collegeId);
    if (!college) return Promise.resolve({ ok: false, error: 'Pick a college first.' });
    if (!Array.isArray(college.departments)) college.departments = [];

    for (var i = 0; i < college.departments.length; i++) {
      if (sameName(college.departments[i].name, clean)) {
        return Promise.resolve({
          ok: false,
          error: '"' + college.departments[i].name + '" is already under this college.',
          existing: college.departments[i]
        });
      }
    }

    var dept = { id: newId('dept'), name: clean, programs: [{ id: newId('d'), name: clean }] };
    if (!useApi || !global.McuApi) {
      college.departments.push(dept);
      college.useDepartments = true;
      writeStore();
      notify();
      return Promise.resolve({ ok: true, department: dept, college: college });
    }
    return global.McuApi.send('POST', 'org.php', {
      action: 'addDepartment',
      collegeId: collegeId,
      name: clean
    })
      .then(function (res) {
        applyDoc(res.org);
        writeStore();
        notify();
        return { ok: true, department: res.department, college: findCollege(collegeId) };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function colleges() {
    return load().active.slice();
  }

  function findCollege(collegeId) {
    var all = load().active;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === collegeId) return all[i];
    }
    return null;
  }

  function childPrograms(dept) {
    var programs = dept && Array.isArray(dept.programs) ? dept.programs : [];
    if (!programs.length && dept) {
      return [{ id: dept.id, name: dept.name }];
    }
    return programs;
  }

  function programChoices(collegeId) {
    var col = findCollege(collegeId);
    if (!col || !col.useDepartments) return [];
    var out = [];
    (col.departments || []).forEach(function (d) {
      childPrograms(d).forEach(function (p) {
        var same = sameName(p.name, d.name);
        out.push({
          id: p.id,
          name: same ? p.name : d.name + ' — ' + p.name,
          programName: p.name,
          orgDepartmentId: d.id,
          orgDepartmentName: d.name
        });
      });
    });
    return out;
  }

  function departmentsFor(collegeId) {
    return programChoices(collegeId);
  }

  function orgDepartments(collegeId) {
    var col = findCollege(collegeId);
    if (!col || !col.useDepartments) return [];
    return (col.departments || []).slice();
  }

  /**
   * One entry per program that can own a curriculum. departmentId stays the
   * program's public id so sections and curricula keep pointing at the program.
   */
  function programs() {
    var out = [];
    load().active.forEach(function (col) {
      var depts = col.useDepartments ? col.departments || [] : [];
      if (!depts.length) {
        out.push({
          collegeId: col.id,
          collegeName: col.name,
          departmentId: null,
          departmentName: null,
          representsCollege: true,
          label: col.name
        });
        return;
      }
      depts.forEach(function (d) {
        childPrograms(d).forEach(function (p) {
          var same = sameName(p.name, d.name);
          var labelName = same ? p.name : d.name + ' — ' + p.name;
          out.push({
            collegeId: col.id,
            collegeName: col.name,
            departmentId: p.id,
            departmentName: labelName,
            programName: p.name,
            orgDepartmentId: d.id,
            orgDepartmentName: d.name,
            representsCollege: false,
            label: col.name + ' — ' + labelName
          });
        });
      });
    });
    return out;
  }

  function collegeName(collegeId) {
    var col = findCollege(collegeId);
    return col ? col.name : '';
  }

  function departmentName(collegeId, departmentId) {
    if (!departmentId) return '';
    var list = departmentsFor(collegeId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === departmentId) return list[i].name;
    }
    return '';
  }

  // ---------------------------------------------------------------- selects

  function makeOption(doc, value, label) {
    var o = doc.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function fillCollegeSelect(sel, selectedId, opts) {
    if (!sel) return;
    opts = opts || {};
    var doc = sel.ownerDocument || global.document;
    sel.innerHTML = '';
    var list = colleges();
    if (opts.placeholder !== false) {
      sel.appendChild(makeOption(doc, '', list.length ? 'Select college…' : 'No colleges yet'));
    }
    list.forEach(function (c) {
      sel.appendChild(makeOption(doc, c.id, c.name));
    });
    if (selectedId) sel.value = selectedId;
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  }

  /**
   * Departments for one college. A college that does not use departments has no
   * choice to make, so the caller should hide the control; hasDepartments says
   * whether that is the case.
   */
  function fillDepartmentSelect(sel, collegeId, selectedId, opts) {
    if (!sel) return false;
    opts = opts || {};
    var doc = sel.ownerDocument || global.document;
    var list = departmentsFor(collegeId);
    sel.innerHTML = '';
    if (!list.length) {
      sel.appendChild(makeOption(doc, '', 'This college has no programs'));
      sel.value = '';
      return false;
    }
    if (opts.placeholder !== false) {
      sel.appendChild(makeOption(doc, '', 'Select program…'));
    }
    list.forEach(function (d) {
      sel.appendChild(makeOption(doc, d.id, d.name));
    });
    if (selectedId) sel.value = selectedId;
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    return true;
  }

  // ---------------------------------------------------------------- events

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
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

  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return;
      data = null;
      load();
      notify();
    });
  }

  global.OrgStore = {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    hydrate: hydrate,
    save: save,
    addCollege: addCollege,
    addDepartment: addDepartment,
    colleges: colleges,
    findCollege: findCollege,
    departmentsFor: departmentsFor,
    orgDepartments: orgDepartments,
    programs: programs,
    collegeName: collegeName,
    departmentName: departmentName,
    fillCollegeSelect: fillCollegeSelect,
    fillDepartmentSelect: fillDepartmentSelect,
    onChange: onChange
  };
})(typeof window !== 'undefined' ? window : this);
