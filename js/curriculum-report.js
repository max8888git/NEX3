/**
 * Maps data-management curricula (CurriculumStore) into the row shape used
 * by curriculums/curriculums.html. Room types stay in the store; the view
 * page has no columns for them.
 */
(function (global) {
  'use strict';

  if (global.CurriculumReport) return;

  function yearLevelForView(year) {
    var n = Number(year) || 1;
    if (global.CurriculumStore && typeof CurriculumStore.yearLevelLabel === 'function') {
      return String(CurriculumStore.yearLevelLabel(n)).replace(/\s+Year$/i, ' year');
    }
    var suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
    return n + suffix + ' year';
  }

  function semesterLabelForView(sem) {
    if (sem === '2') return '2nd';
    if (sem === 'summer') return 'Summer';
    return '1st';
  }

  function joinPrereqs(course) {
    return [course.prerequisite_1, course.prerequisite_2, course.prerequisite_3]
      .map(function (p) {
        return String(p == null ? '' : p).trim();
      })
      .filter(Boolean)
      .join(', ');
  }

  function storeCourseToViewRow(cur, course) {
    var sem = String(course.semester || '1');
    return {
      curriculumId: cur.id,
      dept: cur.collegeId,
      deptName: cur.collegeName || '',
      course: cur.departmentId || cur.collegeId,
      courseName: cur.departmentName || cur.collegeName || '',
      schoolYear: cur.academicYear,
      curriculumYear: cur.academicYear,
      semester: sem,
      semesterLabel: semesterLabelForView(sem),
      status: 'active',
      section: 'A',
      classCode: course.course_id || course.course_code || '',
      subject: course.course_title || '',
      lec: Number(course.lecture_units) || 0,
      lab: Number(course.lab_units) || 0,
      units: Number(course.total_units) || 0,
      hrsWeek: Number(course.total_hours_week) || 0,
      hrsSem: Number(course.total_hours_sem) || 0,
      prereq: joinPrereqs(course),
      yearLevel: yearLevelForView(course.year_level)
    };
  }

  function rowsFromStore() {
    if (!global.CurriculumStore || typeof CurriculumStore.list !== 'function') return [];
    var out = [];
    CurriculumStore.list().forEach(function (cur) {
      if (!cur || !Array.isArray(cur.courses)) return;
      cur.courses.forEach(function (course) {
        out.push(storeCourseToViewRow(cur, course));
      });
    });
    return out;
  }

  function lookupsFromRows(rows) {
    var deptOrder = [];
    var deptLabels = {};
    var courseLabels = {};
    var departmentsByCollege = {};
    var years = {};

    if (global.OrgStore && typeof OrgStore.colleges === 'function') {
      OrgStore.colleges().forEach(function (col) {
        deptOrder.push(col.id);
        deptLabels[col.id] = col.name;
        var depts = typeof OrgStore.departmentsFor === 'function' ? OrgStore.departmentsFor(col.id) : [];
        departmentsByCollege[col.id] = depts.map(function (d) {
          courseLabels[d.id] = d.name;
          return { value: d.id, label: d.name };
        });
        if (!depts.length) {
          courseLabels[col.id] = col.name;
        }
      });
    }

    (rows || []).forEach(function (r) {
      if (r.curriculumYear) years[r.curriculumYear] = true;
      if (r.dept && deptOrder.indexOf(r.dept) < 0) {
        deptOrder.push(r.dept);
        if (!deptLabels[r.dept]) {
          deptLabels[r.dept] = r.deptName || r.dept;
        }
      }
      if (r.course && !courseLabels[r.course]) {
        courseLabels[r.course] = r.courseName || r.course;
      }
      if (r.dept && r.course && r.course !== r.dept) {
        if (!departmentsByCollege[r.dept]) departmentsByCollege[r.dept] = [];
        var exists = departmentsByCollege[r.dept].some(function (d) {
          return d.value === r.course;
        });
        if (!exists) {
          departmentsByCollege[r.dept].push({
            value: r.course,
            label: courseLabels[r.course] || r.course
          });
        }
      }
    });

    if (global.CurriculumStore && typeof CurriculumStore.list === 'function') {
      CurriculumStore.list().forEach(function (cur) {
        if (cur.collegeId && !deptLabels[cur.collegeId]) {
          if (deptOrder.indexOf(cur.collegeId) < 0) deptOrder.push(cur.collegeId);
          deptLabels[cur.collegeId] = cur.collegeName || cur.collegeId;
        }
        if (cur.departmentId) {
          courseLabels[cur.departmentId] = cur.departmentName || cur.departmentId;
        } else if (cur.collegeId) {
          courseLabels[cur.collegeId] = cur.collegeName || cur.collegeId;
        }
      });
    }

    var yearList = Object.keys(years).sort(function (a, b) {
      return String(b).localeCompare(String(a));
    });

    return {
      deptOrder: deptOrder,
      deptLabels: deptLabels,
      courseLabels: courseLabels,
      departmentsByCollege: departmentsByCollege,
      years: yearList
    };
  }

  function fillSelect(sel, options, selected) {
    if (!sel) return;
    var keep = selected != null ? String(selected) : sel.value;
    sel.innerHTML = '';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    if (keep && Array.prototype.some.call(sel.options, function (o) { return o.value === keep; })) {
      sel.value = keep;
    }
  }

  function fillYearSelect(sel, lookups, selected) {
    var opts = [{ value: 'all', label: 'All' }].concat(
      (lookups.years || []).map(function (y) {
        var parts = String(y).split('-');
        var label = parts.length === 2 ? parts[0] + '–' + parts[1] : y;
        return { value: y, label: label };
      })
    );
    fillSelect(sel, opts, selected);
  }

  function fillCollegeSelect(sel, lookups, selected) {
    var opts = [{ value: 'all', label: 'All' }].concat(
      (lookups.deptOrder || []).map(function (id) {
        return { value: id, label: lookups.deptLabels[id] || id };
      })
    );
    fillSelect(sel, opts, selected);
  }

  function departmentsForCollege(collegeId, lookups) {
    if (!lookups) return [];
    if (collegeId === 'all') {
      var all = [];
      var seen = {};
      Object.keys(lookups.departmentsByCollege || {}).forEach(function (cid) {
        (lookups.departmentsByCollege[cid] || []).forEach(function (d) {
          if (seen[d.value]) return;
          seen[d.value] = true;
          all.push(d);
        });
      });
      return all;
    }
    return (lookups.departmentsByCollege && lookups.departmentsByCollege[collegeId]) || [];
  }

  function syncDepartmentSelect(sel, groupEl, collegeId, lookups, selected) {
    if (!sel) return;
    var depts = departmentsForCollege(collegeId, lookups);
    if (depts.length) {
      sel.disabled = false;
      sel.classList.remove('is-disabled');
      if (groupEl) groupEl.classList.remove('is-disabled');
      fillSelect(
        sel,
        [{ value: 'all', label: 'All' }].concat(depts),
        selected
      );
    } else {
      sel.disabled = true;
      sel.classList.add('is-disabled');
      if (groupEl) groupEl.classList.add('is-disabled');
      fillSelect(sel, [{ value: 'all', label: '—' }], 'all');
    }
  }

  function fillPageFilters(ids, lookups, selected) {
    selected = selected || {};
    fillYearSelect(document.getElementById(ids.year), lookups, selected.year);
    fillCollegeSelect(document.getElementById(ids.college), lookups, selected.college);
    syncDepartmentSelect(
      document.getElementById(ids.department),
      document.getElementById(ids.departmentGroup),
      selected.college || (document.getElementById(ids.college) && document.getElementById(ids.college).value) || 'all',
      lookups,
      selected.department
    );
  }

  global.CurriculumReport = {
    rowsFromStore: rowsFromStore,
    lookupsFromRows: lookupsFromRows,
    fillYearSelect: fillYearSelect,
    fillCollegeSelect: fillCollegeSelect,
    syncDepartmentSelect: syncDepartmentSelect,
    fillPageFilters: fillPageFilters,
    departmentsForCollege: departmentsForCollege
  };
})(typeof window !== 'undefined' ? window : this);
