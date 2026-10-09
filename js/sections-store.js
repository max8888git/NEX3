/**
 * Saved class sections for a program / year level / offering term.
 *
 * Academic year + semester is the current offering: every section created
 * belongs to that one term until the whole offering is archived.
 *
 * Display names follow "{Program} {year}-{n}", e.g. Computer Science 1-1.
 */
(function (global) {
  'use strict';

  if (global.SectionsStore) return;

  var STORAGE_KEY = 'mcu-nex-sections-v1';
  var CAP = 40;
  var data = null;
  var listeners = [];
  var useApi = false;

  function emptyDoc() {
    return {
      schoolYear: { id: '', label: '' },
      schoolYears: [],
      currentTerm: null,
      archivedTerms: [],
      sections: []
    };
  }

  function clone(doc) {
    try {
      return JSON.parse(JSON.stringify(doc || emptyDoc()));
    } catch (e) {
      return emptyDoc();
    }
  }

  function offeringKey(year, code) {
    return String(year || '') + '|' + String(code || '');
  }

  function termRank(code) {
    if (code === 'summer') return 3;
    if (String(code) === '2') return 2;
    return 1;
  }

  function normalizeTerm(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var year = String(raw.schoolYear || '').trim();
    var code = String(raw.termCode || '').trim();
    if (!year || !code) return null;
    return { schoolYear: year, termCode: code };
  }

  function normalizeArchived(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (t) {
        return {
          schoolYear: t.schoolYear || '',
          termCode: t.termCode || '',
          archivedLabel: t.archivedLabel || '',
          sectionCount: parseInt(t.sectionCount, 10) || 0
        };
      })
      .filter(function (t) {
        return t.schoolYear && t.termCode;
      });
  }

  function archiveLabelNow() {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = new Date();
    return months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function inferCurrentTerm(doc) {
    var archived = {};
    (doc.archivedTerms || []).forEach(function (t) {
      archived[offeringKey(t.schoolYear, t.termCode)] = true;
    });
    var best = null;
    (doc.sections || []).forEach(function (s) {
      var k = offeringKey(s.schoolYear, s.termCode);
      if (!s.schoolYear || !s.termCode || archived[k]) return;
      if (
        !best ||
        String(s.schoolYear) > best.schoolYear ||
        (s.schoolYear === best.schoolYear && termRank(s.termCode) > termRank(best.termCode))
      ) {
        best = { schoolYear: s.schoolYear, termCode: String(s.termCode) };
      }
    });
    if (best) doc.currentTerm = best;
  }

  function normalize(raw) {
    var base = emptyDoc();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.schoolYear && typeof raw.schoolYear === 'object') {
      base.schoolYear = {
        id: raw.schoolYear.id || '',
        label: raw.schoolYear.label || ''
      };
    }
    if (Array.isArray(raw.schoolYears)) {
      base.schoolYears = raw.schoolYears.map(function (y) {
        return {
          id: y.id || '',
          label: y.label || '',
          isCurrent: !!y.isCurrent
        };
      });
    }
    base.sections = Array.isArray(raw.sections)
      ? raw.sections.map(function (s) {
          return {
            id: s.id,
            name: s.name,
            sectionCode: String(s.sectionCode != null ? s.sectionCode : ''),
            collegeId: s.collegeId || '',
            collegeName: s.collegeName || '',
            programId: s.programId || s.departmentId || null,
            programName: s.programName || '',
            departmentId: s.departmentId || null,
            departmentName: s.departmentName || '',
            termCode: s.termCode || '1',
            yearLevel: parseInt(s.yearLevel, 10) || 1,
            curriculumId: s.curriculumId || '',
            curriculumName: s.curriculumName || '',
            studentCount: parseInt(s.studentCount, 10) || 0,
            isRetake: !!s.isRetake,
            subjects: Array.isArray(s.subjects) ? s.subjects.slice() : [],
            planId: s.planId || null,
            schoolYear: s.schoolYear || (base.schoolYear && base.schoolYear.label) || ''
          };
        })
      : [];
    base.archivedTerms = normalizeArchived(raw.archivedTerms);
    var termProvided = Object.prototype.hasOwnProperty.call(raw, 'currentTerm');
    base.currentTerm = normalizeTerm(raw.currentTerm);
    if (!termProvided && !base.currentTerm) inferCurrentTerm(base);
    return base;
  }

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function writeStore() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /* private browsing */
    }
  }

  function applyDoc(doc) {
    var prev = data;
    var next = normalize(doc);
    if ((!next.schoolYear || !next.schoolYear.label) && prev && prev.schoolYear) {
      next.schoolYear = prev.schoolYear;
    }
    if ((!next.schoolYears || !next.schoolYears.length) && prev && prev.schoolYears) {
      next.schoolYears = prev.schoolYears;
    }
    if (!next.currentTerm && prev && prev.currentTerm && !(doc && Object.prototype.hasOwnProperty.call(doc, 'currentTerm'))) {
      next.currentTerm = prev.currentTerm;
    }
    data = next;
  }

  function load() {
    if (data) return data;
    data = readStore() || emptyDoc();
    return data;
  }

  function notify() {
    listeners.forEach(function (cb) {
      try {
        cb();
      } catch (e) {
        /* ignore */
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
        return global.McuApi.get('sections.php').then(function (res) {
          applyDoc(res);
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

  function evenSplit(students, cap) {
    cap = cap || CAP;
    var n = parseInt(students, 10);
    if (!n || n < 1) return [];
    var count = Math.ceil(n / cap);
    var base = Math.floor(n / count);
    var rem = n % count;
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push(base + (i < rem ? 1 : 0));
    }
    return out;
  }

  function splitInto(students, sectionCount) {
    var n = parseInt(students, 10);
    var count = parseInt(sectionCount, 10);
    if (!n || n < 1 || !count || count < 1) return [];
    var base = Math.floor(n / count);
    var rem = n % count;
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push(base + (i < rem ? 1 : 0));
    }
    return out;
  }

  function displayName(programName, yearLevel, code) {
    return String(programName || 'Program') + ' ' + yearLevel + '-' + code;
  }

  function programLabel(collegeId, departmentId) {
    if (!global.OrgStore) return 'Program';
    if (departmentId) {
      return global.OrgStore.departmentName(collegeId, departmentId) || 'Program';
    }
    return global.OrgStore.collegeName(collegeId) || 'Program';
  }

  function sameScope(sec, collegeId, departmentId, termCode, yearLevel, schoolYear) {
    var dept = departmentId || null;
    var secDept = sec.departmentId || null;
    var year = schoolYear || '';
    return (
      sec.collegeId === collegeId &&
      secDept === dept &&
      String(sec.termCode) === String(termCode) &&
      Number(sec.yearLevel) === Number(yearLevel) &&
      (!year || String(sec.schoolYear || '') === String(year))
    );
  }

  function existingFor(collegeId, departmentId, termCode, yearLevel, schoolYear) {
    return load().sections.filter(function (s) {
      return !s.isRetake && sameScope(s, collegeId, departmentId, termCode, yearLevel, schoolYear);
    });
  }

  function existingRetakes(collegeId, departmentId, termCode, yearLevel, schoolYear) {
    return load().sections.filter(function (s) {
      return s.isRetake && sameScope(s, collegeId, departmentId, termCode, yearLevel, schoolYear);
    });
  }

  function nextRetakeCode(collegeId, departmentId, termCode, yearLevel, schoolYear) {
    var max = 0;
    existingRetakes(collegeId, departmentId, termCode, yearLevel, schoolYear).forEach(function (s) {
      var m = String(s.sectionCode || '').match(/^R(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'R' + (max + 1);
  }

  function rememberSchoolYear(label) {
    if (!label) return;
    var doc = load();
    for (var i = 0; i < doc.schoolYears.length; i++) {
      if (doc.schoolYears[i].label === label) return;
    }
    doc.schoolYears.push({ id: '', label: label, isCurrent: false });
  }

  function localSavePlan(payload) {
    var collegeId = payload.collegeId;
    var departmentId = payload.departmentId || null;
    var termCode = payload.termCode;
    var yearLevel = parseInt(payload.yearLevel, 10);
    var programName = programLabel(collegeId, departmentId);
    var collegeName = global.OrgStore ? global.OrgStore.collegeName(collegeId) : '';
    var rows = payload.sections || [];
    var schoolYear = payload.schoolYear || load().schoolYear.label || '';
    var next = [];
    load().sections.forEach(function (s) {
      if (s.isRetake || !sameScope(s, collegeId, departmentId, termCode, yearLevel, schoolYear)) next.push(s);
    });
    var replaced = next.length !== load().sections.length;
    rememberSchoolYear(schoolYear);
    rows.forEach(function (row, i) {
      var code = String(row.code != null ? row.code : i + 1);
      next.push({
        id: 's-local-' + Date.now() + '-' + i,
        name: displayName(programName, yearLevel, code),
        sectionCode: code,
        collegeId: collegeId,
        collegeName: collegeName,
        programId: departmentId,
        programName: programName,
        departmentId: departmentId,
        departmentName: departmentId ? programName : '',
        termCode: termCode,
        yearLevel: yearLevel,
        curriculumId: payload.curriculumId,
        curriculumName: payload.curriculumName || '',
        studentCount: parseInt(row.studentCount, 10) || 0,
        isRetake: false,
        subjects: [],
        planId: null,
        schoolYear: schoolYear
      });
    });
    data.sections = next;
    writeStore();
    notify();
    return Promise.resolve({ ok: true, replaced: replaced, sections: list() });
  }

  function savePlan(payload) {
    if (!useApi || !global.McuApi) {
      return localSavePlan(payload);
    }
    return global.McuApi.send('POST', 'sections.php', {
      collegeId: payload.collegeId,
      departmentId: payload.departmentId || null,
      schoolYear: payload.schoolYear || '',
      termCode: payload.termCode,
      yearLevel: payload.yearLevel,
      curriculumId: payload.curriculumId,
      studentCount: payload.studentCount,
      sections: payload.sections
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, replaced: !!res.replaced, sections: list() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localSaveRetake(payload) {
    var collegeId = payload.collegeId;
    var departmentId = payload.departmentId || null;
    var termCode = payload.termCode;
    var yearLevel = parseInt(payload.yearLevel, 10);
    var programName = programLabel(collegeId, departmentId);
    var collegeName = global.OrgStore ? global.OrgStore.collegeName(collegeId) : '';
    var schoolYear = payload.schoolYear || load().schoolYear.label || '';
    var code = nextRetakeCode(collegeId, departmentId, termCode, yearLevel, schoolYear);
    var first = (payload.subjects || [])[0] || {};
    load().sections.push({
      id: 's-local-r-' + Date.now(),
      name: displayName(programName, yearLevel, code),
      sectionCode: code,
      collegeId: collegeId,
      collegeName: collegeName,
      programId: departmentId,
      programName: programName,
      departmentId: departmentId,
      departmentName: departmentId ? programName : '',
      termCode: termCode,
      yearLevel: yearLevel,
      curriculumId: first.curriculumId || '',
      curriculumName: first.curriculumName || '',
      studentCount: parseInt(payload.studentCount, 10) || 0,
      isRetake: true,
      subjects: (payload.subjects || []).slice(),
      planId: null,
      schoolYear: schoolYear
    });
    rememberSchoolYear(schoolYear);
    writeStore();
    notify();
    return Promise.resolve({ ok: true, sectionCode: code, sections: list() });
  }

  function saveRetake(payload) {
    if (!useApi || !global.McuApi) {
      return localSaveRetake(payload);
    }
    return global.McuApi.send('POST', 'sections.php', {
      action: 'retake',
      collegeId: payload.collegeId,
      departmentId: payload.departmentId || null,
      schoolYear: payload.schoolYear || '',
      termCode: payload.termCode,
      yearLevel: payload.yearLevel,
      studentCount: payload.studentCount,
      reason: payload.reason || 'Retake',
      subjects: payload.subjects
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, sectionCode: res.sectionCode, sections: list() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localRemoveSection(id) {
    load().sections = load().sections.filter(function (s) {
      return s.id !== id;
    });
    writeStore();
    notify();
    return Promise.resolve({ ok: true, removed: 1, sections: list() });
  }

  function removeSection(id) {
    if (!id) {
      return Promise.resolve({ ok: false, error: 'Section id is required.' });
    }
    if (!useApi || !global.McuApi || String(id).indexOf('s-local-') === 0) {
      return localRemoveSection(id);
    }
    return global.McuApi.send('DELETE', 'sections.php?id=' + encodeURIComponent(id))
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, removed: res.removed || 1, sections: list() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localRemoveYearLevel(payload) {
    var collegeId = payload.collegeId;
    var departmentId = payload.departmentId || null;
    var termCode = payload.termCode;
    var yearLevel = parseInt(payload.yearLevel, 10);
    var schoolYear = payload.schoolYear || '';
    var before = load().sections.length;
    load().sections = load().sections.filter(function (s) {
      return !sameScope(s, collegeId, departmentId, termCode, yearLevel, schoolYear);
    });
    var removed = before - load().sections.length;
    writeStore();
    notify();
    return Promise.resolve({ ok: true, removed: removed, sections: list() });
  }

  function removeYearLevel(payload) {
    if (!payload || !payload.collegeId || !payload.termCode || !payload.yearLevel) {
      return Promise.resolve({ ok: false, error: 'Year level to delete is incomplete.' });
    }
    if (!useApi || !global.McuApi) {
      return localRemoveYearLevel(payload);
    }
    return global.McuApi.send('DELETE', 'sections.php', {
      action: 'yearLevel',
      collegeId: payload.collegeId,
      departmentId: payload.departmentId || null,
      schoolYear: payload.schoolYear || '',
      termCode: payload.termCode,
      yearLevel: payload.yearLevel
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, removed: res.removed || 0, sections: list() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function updateStudentCount(id, count) {
    var n = parseInt(count, 10);
    if (isNaN(n) || n < 0) n = 0;
    var all = load().sections;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) all[i].studentCount = n;
    }
    writeStore();
    notify();
    if (!useApi || !global.McuApi) {
      return Promise.resolve({ ok: true, sections: list() });
    }
    return global.McuApi.send('PATCH', 'sections.php', { id: id, studentCount: n })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, sections: list() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function list(opts) {
    opts = opts || {};
    var all = load().sections.slice();
    if (opts.includeArchived) return all;
    if (opts.archived) {
      return all.filter(function (s) {
        return !matchesCurrent(s);
      });
    }
    return all.filter(matchesCurrent);
  }

  function matchesCurrent(s) {
    var t = load().currentTerm;
    if (!t) return false;
    return (
      String(s.schoolYear || '') === String(t.schoolYear) &&
      String(s.termCode) === String(t.termCode)
    );
  }

  function currentTerm() {
    var t = load().currentTerm;
    return t ? { schoolYear: t.schoolYear, termCode: t.termCode } : null;
  }

  function sectionsForTerm(term) {
    if (!term) return [];
    var key = offeringKey(term.schoolYear, term.termCode);
    return load().sections.filter(function (s) {
      return offeringKey(s.schoolYear, s.termCode) === key;
    });
  }

  function archivedTerms() {
    var cur = currentTerm();
    var curKey = cur ? offeringKey(cur.schoolYear, cur.termCode) : '';
    var byKey = {};
    (load().archivedTerms || []).forEach(function (t) {
      var k = offeringKey(t.schoolYear, t.termCode);
      if (!k || k === curKey) return;
      byKey[k] = {
        schoolYear: t.schoolYear,
        termCode: t.termCode,
        archivedLabel: t.archivedLabel || '',
        sectionCount: 0
      };
    });
    load().sections.forEach(function (s) {
      var k = offeringKey(s.schoolYear, s.termCode);
      if (!k || k === curKey) return;
      if (!byKey[k]) {
        byKey[k] = {
          schoolYear: s.schoolYear,
          termCode: s.termCode,
          archivedLabel: '',
          sectionCount: 0
        };
      }
      byKey[k].sectionCount += 1;
    });
    return Object.keys(byKey)
      .map(function (k) {
        return byKey[k];
      })
      .sort(function (a, b) {
        if (a.schoolYear !== b.schoolYear) return String(b.schoolYear).localeCompare(String(a.schoolYear));
        return termRank(b.termCode) - termRank(a.termCode);
      });
  }

  function rememberArchivedTerm(term, label) {
    if (!term) return;
    var key = offeringKey(term.schoolYear, term.termCode);
    var next = [];
    var found = false;
    (load().archivedTerms || []).forEach(function (t) {
      if (offeringKey(t.schoolYear, t.termCode) === key) {
        next.push({
          schoolYear: term.schoolYear,
          termCode: term.termCode,
          archivedLabel: label || t.archivedLabel || '',
          sectionCount: t.sectionCount || 0
        });
        found = true;
      } else {
        next.push(t);
      }
    });
    if (!found) {
      next.push({
        schoolYear: term.schoolYear,
        termCode: term.termCode,
        archivedLabel: label || archiveLabelNow(),
        sectionCount: sectionsForTerm(term).length
      });
    }
    load().archivedTerms = next;
  }

  function forgetArchivedTerm(term) {
    if (!term) return;
    var key = offeringKey(term.schoolYear, term.termCode);
    load().archivedTerms = (load().archivedTerms || []).filter(function (t) {
      return offeringKey(t.schoolYear, t.termCode) !== key;
    });
  }

  function localSetCurrentTerm(year, code) {
    var cur = currentTerm();
    if (cur && (cur.schoolYear !== year || String(cur.termCode) !== String(code))) {
      if (sectionsForTerm(cur).length) {
        return {
          ok: false,
          error:
            'Archive the current offering (' +
            cur.schoolYear +
            ') before starting a new academic year or semester.'
        };
      }
    }
    load().currentTerm = { schoolYear: year, termCode: code };
    rememberSchoolYear(year);
    forgetArchivedTerm(load().currentTerm);
    writeStore();
    notify();
    return { ok: true, currentTerm: currentTerm() };
  }

  function setCurrentTerm(year, code) {
    if (!year || !code) {
      return Promise.resolve({ ok: false, error: 'Select an academic year and semester.' });
    }
    if (!useApi || !global.McuApi) {
      return Promise.resolve(localSetCurrentTerm(year, code));
    }
    return global.McuApi.send('POST', 'sections.php', {
      action: 'setTerm',
      schoolYear: year,
      termCode: code
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, currentTerm: currentTerm() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localArchiveTerm(year, code) {
    var t = year && code ? { schoolYear: year, termCode: code } : currentTerm();
    if (!t) return { ok: false, error: 'There is no current offering to archive.' };
    rememberArchivedTerm(t, archiveLabelNow());
    var cur = currentTerm();
    if (cur && offeringKey(cur.schoolYear, cur.termCode) === offeringKey(t.schoolYear, t.termCode)) {
      load().currentTerm = null;
    }
    writeStore();
    notify();
    return { ok: true, archived: true, sectionCount: sectionsForTerm(t).length };
  }

  function archiveTerm(year, code) {
    if (!useApi || !global.McuApi) {
      return Promise.resolve(localArchiveTerm(year, code));
    }
    return global.McuApi.send('POST', 'sections.php', {
      action: 'archiveTerm',
      schoolYear: year || '',
      termCode: code || ''
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, archived: true, sectionCount: res.sectionCount || 0 };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localUnarchiveTerm(year, code) {
    var cur = currentTerm();
    if (cur && (cur.schoolYear !== year || String(cur.termCode) !== String(code))) {
      if (sectionsForTerm(cur).length) {
        return {
          ok: false,
          error:
            'Archive the current offering (' +
            cur.schoolYear +
            ') before restoring another academic year or semester.'
        };
      }
    }
    load().currentTerm = { schoolYear: year, termCode: code };
    rememberSchoolYear(year);
    forgetArchivedTerm(load().currentTerm);
    writeStore();
    notify();
    return { ok: true, currentTerm: currentTerm() };
  }

  function unarchiveTerm(year, code) {
    if (!year || !code) {
      return Promise.resolve({ ok: false, error: 'Choose an archived offering to restore.' });
    }
    if (!useApi || !global.McuApi) {
      return Promise.resolve(localUnarchiveTerm(year, code));
    }
    return global.McuApi.send('POST', 'sections.php', {
      action: 'unarchiveTerm',
      schoolYear: year,
      termCode: code
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, currentTerm: currentTerm() };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localClearActive() {
    var t = currentTerm();
    if (!t) return { ok: false, error: 'There is no current offering to clear.' };
    var n = 0;
    load().sections = load().sections.filter(function (s) {
      if (matchesCurrent(s)) {
        n += 1;
        return false;
      }
      return true;
    });
    writeStore();
    notify();
    return { ok: true, cleared: true, removed: n };
  }

  function clearActive() {
    if (!useApi || !global.McuApi) {
      return Promise.resolve(localClearActive());
    }
    return global.McuApi.send('POST', 'sections.php', { action: 'clearActive' })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, cleared: true, removed: res.removed || 0 };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function localDeleteTerm(year, code) {
    if (!year || !code) {
      return { ok: false, error: 'Choose an archived offering to delete.' };
    }
    var cur = currentTerm();
    if (cur && offeringKey(cur.schoolYear, cur.termCode) === offeringKey(year, code)) {
      return { ok: false, error: 'Archive this offering first. The live offering cannot be deleted from Archived.' };
    }
    var key = offeringKey(year, code);
    var n = 0;
    load().sections = load().sections.filter(function (s) {
      if (offeringKey(s.schoolYear, s.termCode) === key) {
        n += 1;
        return false;
      }
      return true;
    });
    forgetArchivedTerm({ schoolYear: year, termCode: code });
    writeStore();
    notify();
    return { ok: true, deleted: true, sectionCount: n };
  }

  function deleteTerm(year, code) {
    if (!year || !code) {
      return Promise.resolve({ ok: false, error: 'Choose an archived offering to delete.' });
    }
    if (!useApi || !global.McuApi) {
      return Promise.resolve(localDeleteTerm(year, code));
    }
    return global.McuApi.send('POST', 'sections.php', {
      action: 'deleteTerm',
      schoolYear: year,
      termCode: code
    })
      .then(function (res) {
        applyDoc(res);
        writeStore();
        notify();
        return { ok: true, deleted: true, sectionCount: res.sectionCount || 0 };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
  }

  function schoolYears() {
    return load().schoolYears.slice();
  }

  function schoolYear() {
    return load().schoolYear;
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return;
      data = null;
      load();
      notify();
    });
  }

  global.SectionsStore = {
    STORAGE_KEY: STORAGE_KEY,
    CAP: CAP,
    hydrate: hydrate,
    load: load,
    list: list,
    currentTerm: currentTerm,
    archivedTerms: archivedTerms,
    setCurrentTerm: setCurrentTerm,
    archiveTerm: archiveTerm,
    unarchiveTerm: unarchiveTerm,
    deleteTerm: deleteTerm,
    clearActive: clearActive,
    schoolYear: schoolYear,
    schoolYears: schoolYears,
    evenSplit: evenSplit,
    splitInto: splitInto,
    displayName: displayName,
    programLabel: programLabel,
    existingFor: existingFor,
    existingRetakes: existingRetakes,
    nextRetakeCode: nextRetakeCode,
    savePlan: savePlan,
    saveRetake: saveRetake,
    removeSection: removeSection,
    removeYearLevel: removeYearLevel,
    updateStudentCount: updateStudentCount,
    onChange: onChange
  };
})(typeof window !== 'undefined' ? window : this);
