/**
 * Renders a saved curriculum as one read-only table.
 *
 * The table is generated from the data rather than from a fixed four-year,
 * two-semester grid: it emits a block for every year level and term that the
 * curriculum actually contains, so a six-year program produces six years of
 * blocks and a summer term appears only in the years that have one. Each block
 * keeps its own subtotals, which a single flat list would lose.
 *
 * Total units stay derived from lecture + lab. Hours a week come from the
 * saved curriculum: if a file named hours per week, those hours are kept even
 * when they do not match the units. If hours were omitted they use
 * 1 lecture unit = 1 hour/week and 1 lab unit = 3 hours/week. A regular
 * semester is 18 weeks; summer is 6 weeks. lecture_room_type and lab_room_type
 * are chosen separately and never filled in automatically. Up to three
 * prerequisites sit in prerequisite_1..3 so one cell never holds more than
 * one course id. A subject with both lecture and lab stays as one row.
 *
 * Depends on curriculum-store.js and, optionally, room-types.js.
 */
(function (global) {
  'use strict';

  if (global.CurriculumView) return;

  var doc = global.document;
  var STYLE_ID = 'cv-view-styles';

  var COLUMNS = 14;

  function injectStyles() {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.cv-toolbar{display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1.1rem;}',
      '.cv-field{min-width:260px;flex:1 1 260px;}',
      '.cv-field label{display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;}',
      '.cv-field select,.cv-field input{width:100%;padding:.5rem .65rem;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;font-family:inherit;box-sizing:border-box;background:#fff;}',
      '.cv-actions{display:flex;gap:.5rem;flex-wrap:wrap;}',
      '.cv-btn{padding:.5rem .9rem;border-radius:8px;font-size:.86rem;font-weight:600;cursor:pointer;border:1px solid #d1d5db;background:#fff;color:#374151;font-family:inherit;}',
      '.cv-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.cv-summary{display:flex;gap:1.5rem;flex-wrap:wrap;padding:.85rem 1rem;background:#faf7fc;border:1px solid #ece4f2;border-radius:10px;margin-bottom:1rem;}',
      '.cv-summary div{font-size:.82rem;color:#6b7280;}',
      '.cv-summary strong{display:block;font-size:1.02rem;color:#1f2937;font-weight:600;margin-top:.1rem;}',
      '.cv-tablewrap{border:1px solid #e5e7eb;border-radius:10px;overflow:auto;}',
      '.cv-table{width:100%;border-collapse:separate;border-spacing:0;font-size:.83rem;}',
      '.cv-table th{position:sticky;top:0;background:#f9fafb;text-align:left;padding:.55rem .6rem;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb;white-space:nowrap;z-index:1;}',
      '.cv-table td{padding:.45rem .6rem;border-bottom:1px solid #f3f4f6;color:#1f2937;vertical-align:middle;}',
      '.cv-table td.cv-num,.cv-table th.cv-num{text-align:right;white-space:nowrap;}',
      '.cv-table tr.cv-year-gap td{padding:0;height:14px;background:#f4f0f7;border-top:1px solid #e5d9ef;border-bottom:none;}',
      '.cv-table tr.cv-group td{background:#f3eefa;font-weight:700;color:#5c267e;padding:.5rem .6rem;border-bottom:1px solid #e5d9ef;letter-spacing:.01em;}',
      '.cv-table tr.cv-group--year td{background:#e9d8f5;padding:.7rem .7rem;font-size:.9rem;border-top:3px solid #5c267e;}',
      '.cv-table tr.cv-subtotal td{background:#fcfbfd;font-weight:600;color:#4b5563;border-bottom:1px solid #e5e7eb;}',
      '.cv-table tr.cv-grand td{background:#f9fafb;font-weight:700;color:#111827;border-top:2px solid #e5e7eb;}',
      '.cv-table td.cv-derived{color:#6b7280;font-style:italic;}',
      '.cv-empty{padding:2.5rem 1.5rem;text-align:center;border:2px dashed #e5e7eb;border-radius:12px;color:#6b7280;}',
      '.cv-empty h3{margin:0 0 .4rem;font-size:1rem;color:#374151;font-weight:600;}',
      '.cv-empty p{margin:0 auto;max-width:34rem;font-size:.88rem;line-height:1.55;}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Trims trailing zeros so 3.00 reads as 3 but 1.5 keeps its half. */
  function num(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return String(v);
  }

  function programLabel(cur) {
    return cur.departmentName ? cur.collegeName + ' — ' + cur.departmentName : cur.collegeName;
  }

  function derive(course, fromUnits) {
    var lec = Number(course.lecture_units) || 0;
    var lab = Number(course.lab_units) || 0;
    var c = global.CurriculumStore.contactHours(
      lec,
      lab,
      course.semester,
      fromUnits ? null : course.total_hours_week,
      fromUnits ? null : course.total_hours_sem
    );
    return {
      total_units: Math.round((lec + lab) * 100) / 100,
      total_hours_week: c.hoursWeek,
      total_hours_sem: c.hoursSem,
      weeks_in_term: c.weeks
    };
  }

  function mount(root, options) {
    if (!root) return null;
    injectStyles();
    options = options || {};

    var CS = global.CurriculumStore;
    var autoSelectFirst = options.autoSelectFirst !== false;
    var hidePicker = !!options.hidePicker;
    var selectedId = options.selectedId || null;
    var filterText = '';

    root.innerHTML =
      '<div class="cv-toolbar">' +
        '<div class="cv-field">' +
          '<label for="cvPick">Curriculum</label>' +
          '<select id="cvPick"></select>' +
        '</div>' +
        '<div class="cv-field" style="max-width:260px;">' +
          '<label for="cvFilter">Find a subject</label>' +
          '<input id="cvFilter" type="search" placeholder="Course id or title" autocomplete="off">' +
        '</div>' +
      '</div>' +
      '<div id="cvSummary"></div>' +
      '<div id="cvContent"></div>';

    var pick = root.querySelector('#cvPick');
    var filter = root.querySelector('#cvFilter');
    var summary = root.querySelector('#cvSummary');
    var content = root.querySelector('#cvContent');
    if (hidePicker && pick && pick.parentNode) pick.parentNode.hidden = true;

    function current() {
      return selectedId ? CS.get(selectedId) : null;
    }

    // ------------------------------------------------------------- rendering

    function renderPicker() {
      var all = CS.list();
      if (!all.length) {
        pick.innerHTML = '<option value="">No curriculums saved yet</option>';
        pick.disabled = true;
        selectedId = null;
        return;
      }
      pick.disabled = false;
      if (!selectedId || !CS.get(selectedId)) {
        selectedId = autoSelectFirst ? all[0].id : null;
      }
      pick.innerHTML = all
        .map(function (c) {
          return (
            '<option value="' + esc(c.id) + '"' + (c.id === selectedId ? ' selected' : '') + '>' +
            esc(programLabel(c) + '  ·  ' + c.academicYear + '  ·  ' + c.courses.length + ' subjects') +
            '</option>'
          );
        })
        .join('');
    }

    function renderSummary() {
      var cur = current();
      if (!cur) {
        summary.innerHTML = '';
        return;
      }
      var t = CS.totals(cur.courses);
      var years = {};
      var hasSummer = false;
      cur.courses.forEach(function (c) {
        years[c.year_level] = true;
        if (c.semester === 'summer') hasSummer = true;
      });
      var yearCount = Object.keys(years).length;
      summary.innerHTML =
        '<div class="cv-summary">' +
          '<div>Program<strong>' + esc(programLabel(cur)) + '</strong></div>' +
          '<div>Academic year<strong>' + esc(cur.academicYear) + '</strong></div>' +
          '<div>Subjects<strong>' + cur.courses.length + '</strong></div>' +
          '<div>Year levels<strong>' + yearCount + (hasSummer ? ', with summer' : '') + '</strong></div>' +
          '<div>Total units<strong>' + num(t.total_units) + '</strong></div>' +
          '<div>Total hours<strong>' + num(t.total_hours_sem) + '</strong></div>' +
        '</div>';
    }

    function matchesFilter(course) {
      if (!filterText) return true;
      var needle = filterText.toLowerCase();
      return (
        String(course.course_id || course.course_code || '').toLowerCase().indexOf(needle) >= 0 ||
        String(course.course_title || '').toLowerCase().indexOf(needle) >= 0
      );
    }

    function dash(value) {
      return value ? esc(value) : '—';
    }

    function readRowCell(course, index) {
      var d = derive(course);
      var id = CS.courseIdOf(course);
      return (
        '<tr data-index="' + index + '">' +
        '<td>' + dash(id) + '</td>' +
        '<td>' + dash(course.course_title) + '</td>' +
        '<td class="cv-num">' + num(course.lecture_units) + '</td>' +
        '<td class="cv-num">' + num(course.lab_units) + '</td>' +
        '<td class="cv-num cv-derived">' + num(d.total_units) + '</td>' +
        '<td class="cv-num cv-derived">' + num(d.total_hours_week) + '</td>' +
        '<td class="cv-num cv-derived">' + num(d.total_hours_sem) + '</td>' +
        '<td>' + esc(CS.yearLevelLabel(course.year_level)) + '</td>' +
        '<td>' + esc(CS.semesterLabel(course.semester)) + '</td>' +
        '<td>' + dash(course.lecture_room_type) + '</td>' +
        '<td>' + dash(course.lab_room_type) + '</td>' +
        '<td>' + dash(course.prerequisite_1) + '</td>' +
        '<td>' + dash(course.prerequisite_2) + '</td>' +
        '<td>' + dash(course.prerequisite_3) + '</td>' +
        '</tr>'
      );
    }

    function subtotalRow(label, courses) {
      var t = CS.totals(courses);
      return (
        '<tr class="cv-subtotal">' +
        '<td colspan="2">' + esc(label) + '</td>' +
        '<td class="cv-num">' + num(t.lecture_units) + '</td>' +
        '<td class="cv-num">' + num(t.lab_units) + '</td>' +
        '<td class="cv-num">' + num(t.total_units) + '</td>' +
        '<td class="cv-num">' + num(t.total_hours_week) + '</td>' +
        '<td class="cv-num">' + num(t.total_hours_sem) + '</td>' +
        '<td colspan="7"></td>' +
        '</tr>'
      );
    }

    function renderTable() {
      var cur = current();
      if (!cur) {
        if (CS.list().length && !autoSelectFirst) {
          content.innerHTML =
            '<div class="cv-empty">' +
              '<h3>No curriculum selected</h3>' +
              '<p>Open a college and choose one of its curriculums to view it here.</p>' +
            '</div>';
          return;
        }
        content.innerHTML =
          '<div class="cv-empty">' +
            '<h3>No curriculums saved yet</h3>' +
            '<p>Curriculums are added by dropping a CSV file on the <strong>Add Curriculum</strong> box on the ' +
            'Dashboard. Once a file is uploaded and assigned to a college, department and academic year, it ' +
            'appears here for viewing.</p>' +
          '</div>';
        return;
      }
      if (!cur.courses.length) {
        content.innerHTML =
          '<div class="cv-empty"><h3>This curriculum has no subjects</h3>' +
          '<p>Upload the file again from the Dashboard to fill this curriculum.</p></div>';
        return;
      }

      var indexed = cur.courses.map(function (c, i) {
        return { course: c, index: i };
      });
      var visible = indexed.filter(function (r) {
        return matchesFilter(r.course);
      });

      if (!visible.length) {
        content.innerHTML =
          '<div class="cv-empty"><h3>No subjects match “' + esc(filterText) + '”</h3>' +
          '<p>Clear the search box to see the whole curriculum.</p></div>';
        return;
      }

      var groups = CS.groupCourses(
        visible.map(function (r) {
          return r.course;
        })
      );

      var body = '';
      var prevYear = null;
      groups.forEach(function (g) {
        var yearStart = prevYear !== g.year_level;
        if (yearStart && prevYear !== null) {
          body += '<tr class="cv-year-gap"><td colspan="' + COLUMNS + '"></td></tr>';
        }
        body +=
          '<tr class="cv-group' + (yearStart ? ' cv-group--year' : '') + '">' +
          '<td colspan="' + COLUMNS + '">' + esc(g.label) + '</td></tr>';
        prevYear = g.year_level;
        g.courses.forEach(function (course) {
          var entry = null;
          for (var i = 0; i < visible.length; i++) {
            if (visible[i].course === course) {
              entry = visible[i];
              break;
            }
          }
          if (!entry) return;
          body += readRowCell(course, entry.index);
        });
        body += subtotalRow(g.label + ' subtotal', g.courses);
      });

      var grand = CS.totals(cur.courses);
      body +=
        '<tr class="cv-grand">' +
        '<td colspan="2">Whole curriculum' + (filterText ? ' (all subjects, not just matches)' : '') + '</td>' +
        '<td class="cv-num">' + num(grand.lecture_units) + '</td>' +
        '<td class="cv-num">' + num(grand.lab_units) + '</td>' +
        '<td class="cv-num">' + num(grand.total_units) + '</td>' +
        '<td class="cv-num">' + num(grand.total_hours_week) + '</td>' +
        '<td class="cv-num">' + num(grand.total_hours_sem) + '</td>' +
        '<td colspan="7"></td>' +
        '</tr>';

      content.innerHTML =
        '<div class="cv-tablewrap"><table class="cv-table"><thead><tr>' +
          '<th>Course id</th><th>Course title</th>' +
          '<th class="cv-num">Lec</th><th class="cv-num">Lab</th><th class="cv-num">Total units</th>' +
          '<th class="cv-num">Hrs/week</th><th class="cv-num">Hrs/semester</th>' +
          '<th>Year level</th><th>Semester</th>' +
          '<th>Lecture room type</th><th>Lab room type</th>' +
          '<th>Prereq 1</th><th>Prereq 2</th><th>Prereq 3</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    function render() {
      renderPicker();
      renderSummary();
      renderTable();
    }

    // ---------------------------------------------------------------- events

    pick.addEventListener('change', function () {
      selectedId = pick.value;
      render();
    });

    filter.addEventListener('input', function () {
      filterText = filter.value.trim();
      renderTable();
    });

    CS.onChange(function () {
      render();
    });

    render();

    return {
      refresh: render,
      select: function (id) {
        selectedId = id;
        render();
      }
    };
  }

  global.CurriculumView = { mount: mount };
})(typeof window !== 'undefined' ? window : this);

