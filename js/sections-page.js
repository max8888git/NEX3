/**
 * Sections calculator page: offering term (academic year + semester) first,
 * then college → department → year → curriculum version → student count.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (global.MCUNexReady) return global.MCUNexReady.then(fn);
    fn();
  }

  function yearLabel(y) {
    var n = parseInt(y, 10);
    if (n === 1) return '1st year';
    if (n === 2) return '2nd year';
    if (n === 3) return '3rd year';
    if (n === 4) return '4th year';
    if (n === 5) return '5th year';
    if (n === 6) return '6th year';
    return 'Year ' + n;
  }

  function semesterLabel(code) {
    if (code === '2') return '2nd semester';
    if (code === 'summer') return 'Summer';
    return '1st semester';
  }

  function curriculumLabel(c) {
    var name = (c.name || '').trim();
    var year = (c.academicYear || '').trim();
    if (name && year && name.indexOf(year) === -1) return name + ' (' + year + ')';
    return name || year || 'Curriculum';
  }

  function uniqueYears(courses, semester) {
    var years = {};
    var matched = false;
    (courses || []).forEach(function (co) {
      var y = parseInt(co.year_level, 10);
      if (!y) return;
      if (semester && String(co.semester) === String(semester)) {
        years[y] = true;
        matched = true;
      }
    });
    if (!matched) {
      (courses || []).forEach(function (co) {
        var y = parseInt(co.year_level, 10);
        if (y) years[y] = true;
      });
    }
    return Object.keys(years)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function curriculaFor(collegeId, departmentId) {
    if (!global.CurriculumStore) return [];
    return global.CurriculumStore.list().filter(function (c) {
      if (c.collegeId !== collegeId) return false;
      if (departmentId) return c.departmentId === departmentId;
      return !c.departmentId;
    });
  }

  function fallbackAcademicYear() {
    var now = new Date();
    var y = now.getFullYear();
    var start = now.getMonth() + 1 >= 6 ? y : y - 1;
    return start + '-' + (start + 1);
  }

  function validAcademicYear(label) {
    var m = String(label || '').trim().match(/^(\d{4})-(\d{4})$/);
    return !!(m && parseInt(m[2], 10) === parseInt(m[1], 10) + 1);
  }

  ready(function () {
    var termYear = document.getElementById('dmTermYear');
    var termNewWrap = document.getElementById('dmTermNewYearWrap');
    var termNew = document.getElementById('dmTermNewYear');
    var termSem = document.getElementById('dmTermSemester');
    var termApply = document.getElementById('dmTermApply');
    var termActive = document.getElementById('dmTermActive');
    var termPicker = document.getElementById('dmTermPicker');
    var termLocked = document.getElementById('dmTermLocked');
    var termArchive = document.getElementById('dmTermArchive');
    var termClear = document.getElementById('dmTermClear');
    var archiveModal = document.getElementById('dmTermArchiveModal');
    var archiveModalBody = document.getElementById('dmTermArchiveBody');
    var archiveModalYes = document.getElementById('dmTermArchiveYes');
    var archiveModalNo = document.getElementById('dmTermArchiveNo');
    var clearModal = document.getElementById('dmTermClearModal');
    var clearModalBody = document.getElementById('dmTermClearBody');
    var clearModalYes = document.getElementById('dmTermClearYes');
    var clearModalNo = document.getElementById('dmTermClearNo');
    var work = document.getElementById('dmSecWork');
    var col = document.getElementById('dmSecCollege');
    var depWrap = document.getElementById('dmSecDepartmentWrap');
    var dep = document.getElementById('dmSecDepartment');
    var ylEl = document.getElementById('dmSecYearLevel');
    var curEl = document.getElementById('dmSecCurriculum');
    var studentsEl = document.getElementById('dmSecStudents');
    var btn = document.getElementById('dmSecCalculate');
    var result = document.getElementById('dmSecResult');
    var summary = document.getElementById('dmSecResultSummary');
    var capLine = document.getElementById('dmSecResultCap');
    var countEl = document.getElementById('dmSecCount');
    var avgLine = document.getElementById('dmSecAvgLine');
    var warn = document.getElementById('dmSecWarning');
    var tableBody = document.getElementById('dmSecTableBody');
    var resultActions = document.getElementById('dmSecResultActions');
    var saveBtn = document.getElementById('dmSecSave');
    var saveMsg = document.getElementById('dmSecSaveMsg');
    if (!col || !dep || !ylEl || !curEl || !studentsEl || !btn || !result) return;

    var draft = [];
    var lastTotal = 0;

    function currentOffering() {
      return global.SectionsStore && typeof SectionsStore.currentTerm === 'function'
        ? SectionsStore.currentTerm()
        : null;
    }

    function termSemester() {
      var t = currentOffering();
      return t ? t.termCode : '';
    }

    function termSchoolYear() {
      var t = currentOffering();
      return t ? t.schoolYear : '';
    }

    function fillTermYears() {
      if (!termYear) return;
      var keep = termYear.value;
      var current = fallbackAcademicYear();
      var years = (global.SectionsStore.schoolYears() || []).map(function (y) {
        if (y.isCurrent) current = y.label;
        return y.label;
      });
      if (!years.length) {
        current = (global.SectionsStore.schoolYear() || {}).label || fallbackAcademicYear();
      }
      if (current && years.indexOf(current) < 0) years.unshift(current);
      var offering = currentOffering();
      if (offering && offering.schoolYear && years.indexOf(offering.schoolYear) < 0) {
        years.push(offering.schoolYear);
      }
      if (!years.length) years.push(fallbackAcademicYear());
      years.sort(function (a, b) {
        return String(b).localeCompare(String(a));
      });
      termYear.innerHTML = '';
      years.forEach(function (label) {
        var o = new Option(label, label);
        if (label === current) o.textContent = label + ' (current)';
        termYear.appendChild(o);
      });
      termYear.appendChild(new Option('Add academic year…', '__new__'));
      if (keep && keep !== '__new__' && years.indexOf(keep) >= 0) termYear.value = keep;
      else if (offering && years.indexOf(offering.schoolYear) >= 0) termYear.value = offering.schoolYear;
      else termYear.value = current;
      if (termNewWrap) termNewWrap.hidden = termYear.value !== '__new__';
    }

    function suggestNewYear() {
      if (!termNew) return;
      var base = (global.SectionsStore.schoolYear() || {}).label || fallbackAcademicYear();
      var m = String(base).match(/^(\d{4})/);
      var start = m ? parseInt(m[1], 10) + 1 : new Date().getFullYear();
      if (!termNew.value) termNew.value = start + '-' + (start + 1);
    }

    function selectedTermYear() {
      if (!termYear) return fallbackAcademicYear();
      if (termYear.value === '__new__') return String(termNew ? termNew.value : '').trim();
      return termYear.value;
    }

    function applyTerm() {
      var year = selectedTermYear();
      var sem = termSem ? termSem.value : '1';
      if (!validAcademicYear(year)) {
        alert('Academic year must look like 2026-2027.');
        return;
      }
      if (!sem) {
        alert('Select a semester.');
        return;
      }
      if (termYear && termYear.value === '__new__') {
        var exists = false;
        for (var i = 0; i < termYear.options.length; i++) {
          if (termYear.options[i].value === year) exists = true;
        }
        if (!exists) {
          var opt = new Option(year, year);
          termYear.insertBefore(opt, termYear.options[termYear.options.length - 1]);
        }
        termYear.value = year;
        if (termNewWrap) termNewWrap.hidden = true;
      }
      if (termApply) termApply.disabled = true;
      global.SectionsStore.setCurrentTerm(year, sem).then(function (res) {
        if (termApply) termApply.disabled = false;
        if (!res.ok) {
          alert(res.error || 'Could not start that offering.');
          return;
        }
        draft = [];
        lastTotal = 0;
        if (result) result.hidden = true;
        if (resultActions) resultActions.hidden = true;
        syncTermUi();
        fillYearsAndCurricula();
      });
    }

    function archiveCurrentOffering() {
      var t = currentOffering();
      if (!t) {
        alert('There is no current offering to archive.');
        return;
      }
      var label = t.schoolYear + ' · ' + semesterLabel(t.termCode);
      var msg =
        'Archive ' +
        label +
        ' for the whole campus? This moves every section from every college and every year level in that academic year and semester to Archived Sections. You can restore the whole offering later from that tab.';
      if (archiveModal && archiveModalBody) {
        archiveModalBody.textContent = msg;
        archiveModal.hidden = false;
        return;
      }
      if (!confirm(msg)) return;
      performArchive();
    }

    function performArchive() {
      var t = currentOffering();
      if (!t) {
        alert('There is no current offering to archive.');
        return;
      }
      if (termArchive) termArchive.disabled = true;
      global.SectionsStore.archiveTerm(t.schoolYear, t.termCode).then(function (res) {
        if (termArchive) termArchive.disabled = false;
        if (!res.ok) {
          alert(res.error || 'Could not archive this offering.');
          return;
        }
        draft = [];
        lastTotal = 0;
        if (result) result.hidden = true;
        if (resultActions) resultActions.hidden = true;
        syncTermUi();
        fillTermYears();
      });
    }

    function clearActiveSections() {
      var t = currentOffering();
      if (!t) {
        alert('There is no current offering to clear.');
        return;
      }
      var n = global.SectionsStore ? global.SectionsStore.list().length : 0;
      var label = t.schoolYear + ' · ' + semesterLabel(t.termCode);
      var msg =
        'Delete all ' +
        n +
        ' active section' +
        (n === 1 ? '' : 's') +
        ' in ' +
        label +
        '? This does not archive the offering — the academic year and semester stay current. Meetings on the live timetable for these sections are also removed. This cannot be undone.';
      if (clearModal && clearModalBody) {
        clearModalBody.textContent = msg;
        clearModal.hidden = false;
        return;
      }
      if (!confirm(msg)) return;
      performClear();
    }

    function performClear() {
      if (!global.SectionsStore || typeof global.SectionsStore.clearActive !== 'function') {
        alert('Could not clear active sections.');
        return;
      }
      if (termClear) termClear.disabled = true;
      global.SectionsStore.clearActive().then(function (res) {
        if (termClear) termClear.disabled = false;
        if (!res.ok) {
          alert(res.error || 'Could not clear active sections.');
          return;
        }
        draft = [];
        lastTotal = 0;
        if (result) result.hidden = true;
        if (resultActions) resultActions.hidden = true;
        syncTermUi();
      });
    }

    function syncTermUi() {
      var t = currentOffering();
      var see = document.querySelectorAll('a.btn-see-sections');
      see.forEach(function (a) {
        a.href = '#active';
        a.setAttribute('data-sec-go', 'active');
      });
      if (t) {
        if (termPicker) termPicker.hidden = true;
        if (termLocked) termLocked.hidden = false;
        if (work) work.hidden = false;
        if (termActive) {
          termActive.hidden = false;
          termActive.innerHTML =
            'Current offering: <strong>' +
            t.schoolYear +
            '</strong> · <strong>' +
            semesterLabel(t.termCode) +
            '</strong> for the whole campus (every college and year level). Archive this offering when the semester ends.';
        }
        if (termSem) termSem.value = t.termCode;
      } else {
        if (termPicker) termPicker.hidden = false;
        if (termLocked) termLocked.hidden = true;
        if (work) work.hidden = true;
        if (termActive) termActive.hidden = true;
      }
    }

    function studentsNum() {
      var n = parseInt(String(studentsEl.value).trim(), 10);
      return isNaN(n) || n < 0 ? 0 : n;
    }

    function selectedProgram() {
      var collegeId = col.value;
      var depts = global.OrgStore ? global.OrgStore.departmentsFor(collegeId) : [];
      var showDept = depts.length > 1;
      var departmentId = showDept ? dep.value : depts.length === 1 ? depts[0].id : null;
      return { collegeId: collegeId, departmentId: departmentId, depts: depts, showDept: showDept };
    }

    function fillYearsAndCurricula() {
      var prog = selectedProgram();
      var list = curriculaFor(prog.collegeId, prog.departmentId);
      var semester = termSemester();
      var prevYear = ylEl.value;
      var prevCur = curEl.value;

      var yearSet = {};
      list.forEach(function (c) {
        uniqueYears(c.courses, semester).forEach(function (y) {
          yearSet[y] = true;
        });
      });
      var years = Object.keys(yearSet)
        .map(function (k) {
          return parseInt(k, 10);
        })
        .sort(function (a, b) {
          return a - b;
        });

      ylEl.innerHTML = '';
      if (!prog.collegeId || (prog.showDept && !prog.departmentId)) {
        ylEl.appendChild(new Option('Select a program first', ''));
      } else if (!list.length) {
        ylEl.appendChild(new Option('No curriculum for this program yet', ''));
      } else if (!years.length) {
        ylEl.appendChild(new Option('No year levels in this curriculum', ''));
      } else {
        ylEl.appendChild(new Option('Select year level…', ''));
        years.forEach(function (y) {
          ylEl.appendChild(new Option(yearLabel(y), String(y)));
        });
        if (prevYear && years.indexOf(parseInt(prevYear, 10)) >= 0) ylEl.value = prevYear;
        else if (years.length === 1) ylEl.value = String(years[0]);
      }

      fillCurricula(prevCur);
    }

    function fillCurricula(prevCur) {
      var prog = selectedProgram();
      var year = parseInt(ylEl.value, 10);
      var semester = termSemester();
      var list = curriculaFor(prog.collegeId, prog.departmentId).filter(function (c) {
        if (!year) return true;
        return uniqueYears(c.courses, semester).indexOf(year) >= 0;
      });
      curEl.innerHTML = '';
      if (!year) {
        curEl.appendChild(new Option('Select a year level first', ''));
        return;
      }
      if (!list.length) {
        curEl.appendChild(new Option('No curriculum covers this year level', ''));
        return;
      }
      curEl.appendChild(new Option('Select curriculum version…', ''));
      list
        .slice()
        .sort(function (a, b) {
          return String(b.academicYear || '').localeCompare(String(a.academicYear || ''));
        })
        .forEach(function (c) {
          curEl.appendChild(new Option(curriculumLabel(c), c.id));
        });
      if (prevCur) curEl.value = prevCur;
      if (!curEl.value && list.length === 1) curEl.value = list[0].id;
      if (curEl.selectedIndex < 0) curEl.selectedIndex = 0;
    }

    function syncDepartment() {
      var collegeId = col.value;
      var depts = global.OrgStore ? global.OrgStore.departmentsFor(collegeId) : [];
      var show = depts.length > 1;
      if (depWrap) depWrap.hidden = !show;
      dep.required = show;
      if (show) {
        global.OrgStore.fillDepartmentSelect(dep, collegeId, dep.value);
      } else {
        dep.innerHTML = '';
        if (depts.length === 1) {
          dep.appendChild(new Option(depts[0].name, depts[0].id));
          dep.value = depts[0].id;
        }
      }
      fillYearsAndCurricula();
    }

    function programName() {
      var prog = selectedProgram();
      return global.SectionsStore.programLabel(prog.collegeId, prog.departmentId);
    }

    function renderDraft() {
      if (!tableBody) return;
      tableBody.innerHTML = '';
      var over = false;
      var sum = 0;
      draft.forEach(function (row, i) {
        sum += row.studentCount;
        if (row.studentCount > global.SectionsStore.CAP) over = true;
        var tr = document.createElement('tr');
        var tdName = document.createElement('td');
        tdName.textContent = row.name;
        var tdCount = document.createElement('td');
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.step = '1';
        inp.className = 'dm-sec-count-input';
        inp.value = String(row.studentCount);
        inp.setAttribute('aria-label', 'Students in ' + row.name);
        inp.addEventListener('input', function () {
          var v = parseInt(inp.value, 10);
          draft[i].studentCount = isNaN(v) || v < 0 ? 0 : v;
          refreshStats();
        });
        tdCount.appendChild(inp);
        tr.appendChild(tdName);
        tr.appendChild(tdCount);
        tableBody.appendChild(tr);
      });
      refreshStats(over, sum);
    }

    function refreshStats(over, sum) {
      if (over == null) {
        over = draft.some(function (r) {
          return r.studentCount > global.SectionsStore.CAP;
        });
        sum = 0;
        draft.forEach(function (r) {
          sum += r.studentCount;
        });
      }
      var s = draft.length;
      var avg = s ? sum / s : 0;
      var avgTxt = avg % 1 === 0 ? String(avg) : avg.toFixed(1);
      if (avgLine) {
        avgLine.innerHTML =
          '<strong>Total assigned:</strong> ' +
          sum +
          ' students across ' +
          s +
          ' section' +
          (s === 1 ? '' : 's') +
          ' (average ' +
          avgTxt +
          ').';
      }
      if (warn) {
        if (over) {
          warn.hidden = false;
          warn.textContent =
            'At least one section is over the ' +
            global.SectionsStore.CAP +
            '-student cap. Continue only if this override is intentional.';
        } else {
          warn.hidden = true;
        }
      }
    }

    function buildDraft(sectionCount) {
      var n = studentsNum();
      var counts =
        sectionCount != null
          ? global.SectionsStore.splitInto(n, sectionCount)
          : global.SectionsStore.evenSplit(n, global.SectionsStore.CAP);
      var year = parseInt(ylEl.value, 10);
      var pname = programName();
      lastTotal = n;
      draft = counts.map(function (count, i) {
        var code = String(i + 1);
        return {
          code: code,
          name: global.SectionsStore.displayName(pname, year, code),
          studentCount: count
        };
      });
      if (countEl) countEl.value = String(draft.length);
      renderDraft();
    }

    function fillColleges() {
      if (global.OrgStore) global.OrgStore.fillCollegeSelect(col, col.value);
      syncDepartment();
    }

    col.addEventListener('change', syncDepartment);
    dep.addEventListener('change', fillYearsAndCurricula);
    if (termYear) {
      termYear.addEventListener('change', function () {
        var isNew = termYear.value === '__new__';
        if (termNewWrap) termNewWrap.hidden = !isNew;
        if (isNew) suggestNewYear();
      });
    }
    if (termApply) termApply.addEventListener('click', applyTerm);
    if (termArchive) termArchive.addEventListener('click', archiveCurrentOffering);
    if (termClear) termClear.addEventListener('click', clearActiveSections);
    if (archiveModalYes) {
      archiveModalYes.addEventListener('click', function () {
        if (archiveModal) archiveModal.hidden = true;
        performArchive();
      });
    }
    if (archiveModalNo) {
      archiveModalNo.addEventListener('click', function () {
        if (archiveModal) archiveModal.hidden = true;
      });
    }
    if (archiveModal) {
      archiveModal.addEventListener('click', function (e) {
        if (e.target === archiveModal) archiveModal.hidden = true;
      });
    }
    if (clearModalYes) {
      clearModalYes.addEventListener('click', function () {
        if (clearModal) clearModal.hidden = true;
        performClear();
      });
    }
    if (clearModalNo) {
      clearModalNo.addEventListener('click', function () {
        if (clearModal) clearModal.hidden = true;
      });
    }
    if (clearModal) {
      clearModal.addEventListener('click', function (e) {
        if (e.target === clearModal) clearModal.hidden = true;
      });
    }
    ylEl.addEventListener('change', function () {
      fillCurricula(curEl.value);
    });

    if (countEl) {
      countEl.addEventListener('change', function () {
        var s = parseInt(countEl.value, 10);
        if (isNaN(s) || s < 1) s = 1;
        if (s > 50) s = 50;
        countEl.value = String(s);
        if (lastTotal > 0) buildDraft(s);
      });
    }

    btn.addEventListener('click', function () {
      if (saveMsg) {
        saveMsg.hidden = true;
        saveMsg.textContent = '';
      }
      if (!currentOffering()) {
        alert('Set the academic year and semester first.');
        return;
      }
      var prog = selectedProgram();
      if (!prog.collegeId) {
        alert('Select a college.');
        return;
      }
      if (prog.showDept && !prog.departmentId) {
        alert('Select a program.');
        return;
      }
      if (!ylEl.value) {
        alert('Select a year level.');
        return;
      }
      if (!curEl.value) {
        alert('Select a curriculum.');
        return;
      }
      var n = studentsNum();
      if (n < 1) {
        alert('Enter a positive number of students.');
        return;
      }
      var rec = global.SectionsStore.evenSplit(n, global.SectionsStore.CAP).length;
      summary.innerHTML =
        'Based on <strong>' +
        n +
        '</strong> students and a maximum of <strong>' +
        global.SectionsStore.CAP +
        '</strong> per section, this opens <strong>' +
        rec +
        '</strong> section' +
        (rec === 1 ? '' : 's') +
        ', named <strong>' +
        global.SectionsStore.displayName(programName(), parseInt(ylEl.value, 10), '1') +
        '</strong> through <strong>' +
        global.SectionsStore.displayName(programName(), parseInt(ylEl.value, 10), String(rec)) +
        '</strong>.';
      if (capLine) {
        capLine.textContent =
          termSchoolYear() +
          ' · ' +
          semesterLabel(termSemester()) +
          ' · ' +
          yearLabel(ylEl.value) +
          '. You can change a section’s headcount, including above 40.';
      }
      result.hidden = false;
      if (resultActions) resultActions.hidden = false;
      buildDraft();
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var prog = selectedProgram();
        if (!draft.length) {
          alert('Calculate sections first.');
          return;
        }
        if (!currentOffering()) {
          alert('Set the academic year and semester first.');
          return;
        }
        var existing = global.SectionsStore.existingFor(
          prog.collegeId,
          prog.departmentId,
          termSemester(),
          parseInt(ylEl.value, 10),
          termSchoolYear()
        );
        if (existing.length) {
          var ok = confirm(
            'This program and year level already has ' +
              existing.length +
              ' regular section' +
              (existing.length === 1 ? '' : 's') +
              ' in ' +
              termSchoolYear() +
              ' ' +
              semesterLabel(termSemester()) +
              '. Saving will replace those regular sections only. Retake sections are kept. Continue?'
          );
          if (!ok) return;
        }
        var curOpt = curEl.options[curEl.selectedIndex];
        saveBtn.disabled = true;
        global.SectionsStore.savePlan({
          collegeId: prog.collegeId,
          departmentId: prog.departmentId,
          schoolYear: termSchoolYear(),
          termCode: termSemester(),
          yearLevel: parseInt(ylEl.value, 10),
          curriculumId: curEl.value,
          curriculumName: curOpt ? curOpt.textContent : '',
          studentCount: lastTotal,
          sections: draft.map(function (row) {
            return { code: row.code, studentCount: row.studentCount };
          })
        }).then(function (res) {
          saveBtn.disabled = false;
          if (!res.ok) {
            alert(res.error || 'Could not save sections.');
            return;
          }
          if (saveMsg) {
            saveMsg.hidden = false;
            saveMsg.textContent =
              'Saved ' + draft.length + ' section' + (draft.length === 1 ? '' : 's') + '.';
          }
        });
      });
    }

    fillTermYears();
    fillColleges();
    syncTermUi();
    if (global.OrgStore) global.OrgStore.onChange(fillColleges);
    if (global.CurriculumStore) global.CurriculumStore.onChange(fillYearsAndCurricula);
    if (global.SectionsStore && SectionsStore.onChange) {
      SectionsStore.onChange(function () {
        fillTermYears();
        syncTermUi();
      });
    }

    bindRetakeForm();

    function bindRetakeForm() {
      var rCol = document.getElementById('dmRetakeCollege');
      var rDepWrap = document.getElementById('dmRetakeDepartmentWrap');
      var rDep = document.getElementById('dmRetakeDepartment');
      var rYear = document.getElementById('dmRetakeYearLevel');
      var rCur = document.getElementById('dmRetakeCurriculum');
      var rSub = document.getElementById('dmRetakeSubject');
      var rAdd = document.getElementById('dmRetakeAddSubject');
      var rList = document.getElementById('dmRetakeSubjectList');
      var rStudents = document.getElementById('dmRetakeStudents');
      var rReason = document.getElementById('dmRetakeReason');
      var rWarn = document.getElementById('dmRetakeWarning');
      var rSave = document.getElementById('dmRetakeSave');
      var rMsg = document.getElementById('dmRetakeSaveMsg');
      if (!rCol || !rDep || !rYear || !rCur || !rSub || !rStudents || !rSave) return;

      var picked = [];

      function retakeProgram() {
        var collegeId = rCol.value;
        var depts = global.OrgStore ? global.OrgStore.departmentsFor(collegeId) : [];
        var showDept = depts.length > 1;
        var departmentId = showDept ? rDep.value : depts.length === 1 ? depts[0].id : null;
        return { collegeId: collegeId, departmentId: departmentId, depts: depts, showDept: showDept };
      }

      function yearsFromAllCurricula(list) {
        var yearSet = {};
        list.forEach(function (c) {
          uniqueYears(c.courses, '').forEach(function (y) {
            yearSet[y] = true;
          });
        });
        return Object.keys(yearSet)
          .map(function (k) {
            return parseInt(k, 10);
          })
          .sort(function (a, b) {
            return a - b;
          });
      }

      function fillRetakeYearsAndCurricula() {
        var prog = retakeProgram();
        var list = curriculaFor(prog.collegeId, prog.departmentId);
        var prevYear = rYear.value;
        var prevCur = rCur.value;
        var years = yearsFromAllCurricula(list);

        rYear.innerHTML = '';
        if (!prog.collegeId || (prog.showDept && !prog.departmentId)) {
          rYear.appendChild(new Option('Select a program first', ''));
        } else if (!list.length) {
          rYear.appendChild(new Option('No curriculum for this program yet', ''));
        } else if (!years.length) {
          rYear.appendChild(new Option('No year levels in these curricula', ''));
        } else {
          rYear.appendChild(new Option('Select year level…', ''));
          years.forEach(function (y) {
            rYear.appendChild(new Option(yearLabel(y), String(y)));
          });
          if (prevYear && years.indexOf(parseInt(prevYear, 10)) >= 0) rYear.value = prevYear;
          else if (years.length === 1) rYear.value = String(years[0]);
        }

        rCur.innerHTML = '';
        if (!list.length) {
          rCur.appendChild(new Option('No curriculum for this program yet', ''));
        } else {
          rCur.appendChild(new Option('Select curriculum (old or new)…', ''));
          list
            .slice()
            .sort(function (a, b) {
              return String(b.academicYear || '').localeCompare(String(a.academicYear || ''));
            })
            .forEach(function (c) {
              rCur.appendChild(new Option(curriculumLabel(c), c.id));
            });
          if (prevCur) rCur.value = prevCur;
        }
        fillRetakeSubjects();
      }

      function fillRetakeSubjects() {
        var cur = global.CurriculumStore ? global.CurriculumStore.get(rCur.value) : null;
        var term = termSemester();
        rSub.innerHTML = '';
        if (!cur) {
          rSub.appendChild(new Option('Select a curriculum first', ''));
          return;
        }
        var courses = (cur.courses || []).slice().sort(function (a, b) {
          var offA = String(a.semester) === String(term) ? 1 : 0;
          var offB = String(b.semester) === String(term) ? 1 : 0;
          if (offA !== offB) return offA - offB;
          if (a.year_level !== b.year_level) return a.year_level - b.year_level;
          return String(a.course_id).localeCompare(String(b.course_id));
        });
        if (!courses.length) {
          rSub.appendChild(new Option('This curriculum has no subjects', ''));
          return;
        }
        rSub.appendChild(new Option('Select a subject…', ''));
        courses.forEach(function (co) {
          var inTerm = String(co.semester) === String(term);
          var label =
            co.course_id +
            ' — ' +
            (co.course_title || '') +
            ' (' +
            yearLabel(co.year_level) +
            ', ' +
            semesterLabel(co.semester) +
            (inTerm ? ', already this semester' : '') +
            ')';
          rSub.appendChild(new Option(label, String(co.course_id || '')));
        });
      }

      function subjectKey(item) {
        return (item.id || '') + '|' + (item.curriculumId || '') + '|' + (item.courseId || '');
      }

      function renderPicked() {
        if (!rList) return;
        rList.innerHTML = '';
        if (!picked.length) {
          var empty = document.createElement('p');
          empty.className = 'page-sub';
          empty.textContent = 'No extra subjects yet. Pick a curriculum — including an older one — then add the failed subject.';
          rList.appendChild(empty);
          return;
        }
        picked.forEach(function (item, i) {
          var row = document.createElement('div');
          row.className = 'dm-retake-chip';
          var text = document.createElement('span');
          text.textContent =
            item.courseId +
            ' — ' +
            item.title +
            ' · ' +
            item.curriculumName +
            ' · ' +
            yearLabel(item.yearLevel) +
            ' / ' +
            semesterLabel(item.termCode);
          var rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'dm-retake-chip-remove';
          rm.textContent = 'Remove';
          rm.addEventListener('click', function () {
            picked.splice(i, 1);
            renderPicked();
          });
          row.appendChild(text);
          row.appendChild(rm);
          rList.appendChild(row);
        });
      }

      function syncRetakeDepartment() {
        var collegeId = rCol.value;
        var depts = global.OrgStore ? global.OrgStore.departmentsFor(collegeId) : [];
        var show = depts.length > 1;
        if (rDepWrap) rDepWrap.hidden = !show;
        if (show) {
          global.OrgStore.fillDepartmentSelect(rDep, collegeId, rDep.value);
        } else {
          rDep.innerHTML = '';
          if (depts.length === 1) {
            rDep.appendChild(new Option(depts[0].name, depts[0].id));
            rDep.value = depts[0].id;
          }
        }
        fillRetakeYearsAndCurricula();
      }

      function fillRetakeColleges() {
        if (global.OrgStore) global.OrgStore.fillCollegeSelect(rCol, rCol.value);
        syncRetakeDepartment();
      }

      function refreshRetakeWarn() {
        if (!rWarn) return;
        var n = parseInt(String(rStudents.value || '').trim(), 10) || 0;
        if (n > global.SectionsStore.CAP) {
          rWarn.hidden = false;
          rWarn.textContent =
            'This retake section is over the ' +
            global.SectionsStore.CAP +
            '-student cap. Continue only if that headcount is intentional.';
        } else {
          rWarn.hidden = true;
        }
      }

      rCol.addEventListener('change', syncRetakeDepartment);
      rDep.addEventListener('change', fillRetakeYearsAndCurricula);
      rCur.addEventListener('change', fillRetakeSubjects);
      if (termApply) {
        termApply.addEventListener('click', function () {
          fillRetakeSubjects();
        });
      }
      rStudents.addEventListener('input', refreshRetakeWarn);

      if (rAdd) {
        rAdd.addEventListener('click', function () {
          var cur = global.CurriculumStore ? global.CurriculumStore.get(rCur.value) : null;
          if (!cur || rSub.selectedIndex < 1) {
            alert('Select a curriculum and a subject.');
            return;
          }
          var courseId = rSub.value;
          var co = null;
          (cur.courses || []).forEach(function (c) {
            if (String(c.course_id) === String(courseId)) co = c;
          });
          if (!co) {
            alert('Select a subject.');
            return;
          }
          var item = {
            id: co.id || '',
            courseId: co.course_id,
            title: co.course_title || co.course_id,
            yearLevel: co.year_level,
            termCode: co.semester,
            curriculumId: cur.id,
            curriculumName: curriculumLabel(cur)
          };
          var key = subjectKey(item);
          for (var i = 0; i < picked.length; i++) {
            if (subjectKey(picked[i]) === key) {
              alert('That subject is already on this retake section.');
              return;
            }
          }
          picked.push(item);
          renderPicked();
        });
      }

      rSave.addEventListener('click', function () {
        if (rMsg) {
          rMsg.hidden = true;
          rMsg.textContent = '';
        }
        var prog = retakeProgram();
        if (!currentOffering()) {
          alert('Set the academic year and semester first.');
          return;
        }
        if (!prog.collegeId) {
          alert('Select a college.');
          return;
        }
        if (prog.showDept && !prog.departmentId) {
          alert('Select a program.');
          return;
        }
        if (!rYear.value) {
          alert('Select a year level.');
          return;
        }
        var n = parseInt(String(rStudents.value || '').trim(), 10);
        if (!n || n < 1) {
          alert('Enter a positive number of students for the retake section.');
          return;
        }
        if (!picked.length) {
          alert('Add at least one subject that is not normally in this semester.');
          return;
        }
        rSave.disabled = true;
        global.SectionsStore.saveRetake({
          collegeId: prog.collegeId,
          departmentId: prog.departmentId,
          schoolYear: termSchoolYear(),
          termCode: termSemester(),
          yearLevel: parseInt(rYear.value, 10),
          studentCount: n,
          reason: rReason ? String(rReason.value || '').trim() : 'Retake',
          subjects: picked
        }).then(function (res) {
          rSave.disabled = false;
          if (!res.ok) {
            alert(res.error || 'Could not save the retake section.');
            return;
          }
          var pname = global.SectionsStore.programLabel(prog.collegeId, prog.departmentId);
          if (rMsg) {
            rMsg.hidden = false;
            rMsg.textContent =
              'Saved ' +
              global.SectionsStore.displayName(pname, parseInt(rYear.value, 10), res.sectionCode || 'R1') +
              '.';
          }
          picked = [];
          renderPicked();
        });
      });

      fillRetakeColleges();
      renderPicked();
      if (global.OrgStore) global.OrgStore.onChange(fillRetakeColleges);
      if (global.CurriculumStore) global.CurriculumStore.onChange(fillRetakeYearsAndCurricula);
    }
  });
})(typeof window !== 'undefined' ? window : this);
