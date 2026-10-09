/**
 * The Add Curriculum drop zone and its review dialog.
 *
 * Turns any element into a CSV drop target, then walks the user through
 * confirming which program and academic year the file belongs to before
 * anything is stored. Nothing is saved until that confirmation, so a mislabelled
 * upload can be abandoned at no cost.
 *
 * Rows that cannot be read are shown alongside the good ones and skipped on
 * save rather than failing the whole file, because one malformed line in a
 * hundred-subject curriculum should not send the user back to Excel.
 *
 * Depends on curriculum-store.js, org-store.js and, optionally, room-types.js.
 */
(function (global) {
  'use strict';

  if (global.CurriculumUpload) return;

  var doc = global.document;
  var STYLE_ID = 'cu-upload-styles';

  function injectStyles() {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.cu-overlay{position:fixed;inset:0;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1.25rem;}',
      '.cu-box{background:#fff;border-radius:14px;width:100%;max-width:1080px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 45px rgba(0,0,0,.25);font-family:inherit;}',
      '.cu-box--sm{max-width:440px;}',
      '.cu-head{padding:1.25rem 1.4rem .9rem;border-bottom:1px solid #e5e7eb;}',
      '.cu-head h2{margin:0 0 .25rem;font-size:1.1rem;color:#111827;font-weight:600;}',
      '.cu-head p{margin:0;font-size:.85rem;color:#6b7280;line-height:1.45;}',
      '.cu-body{padding:1.1rem 1.4rem;overflow:auto;flex:1;}',
      '.cu-foot{padding:.9rem 1.4rem 1.15rem;border-top:1px solid #e5e7eb;display:flex;gap:.5rem;justify-content:flex-end;align-items:center;flex-wrap:wrap;}',
      '.cu-foot .cu-foot__note{margin-right:auto;font-size:.82rem;color:#6b7280;}',
      '.cu-btn{padding:.55rem .95rem;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;border:1px solid #d1d5db;background:#fff;color:#374151;font-family:inherit;}',
      '.cu-btn--primary{border-color:transparent;background:var(--purple,#5c267e);color:#fff;}',
      '.cu-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.cu-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.9rem;margin-bottom:1.1rem;}',
      '.cu-field label{display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:.3rem;}',
      '.cu-field select,.cu-field input{width:100%;padding:.5rem .65rem;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;font-family:inherit;box-sizing:border-box;background:#fff;}',
      '.cu-note{margin:.3rem 0 0;font-size:.76rem;color:#6b7280;line-height:1.4;}',
      '.cu-note--bad{color:#b91c1c;}',
      '.cu-check{display:flex;gap:.45rem;align-items:flex-start;margin-top:.75rem;font-size:.84rem;color:#374151;cursor:pointer;line-height:1.45;}',
      '.cu-callout{border-radius:9px;padding:.7rem .8rem;font-size:.84rem;line-height:1.5;margin-bottom:1rem;}',
      '.cu-callout--warn{background:#fffbeb;border:1px solid #fcd34d;color:#92400e;}',
      '.cu-callout--bad{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;}',
      '.cu-callout--info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;}',
      '.cu-callout--good{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;}',
      '.cu-callout label{display:flex;gap:.45rem;align-items:flex-start;margin-top:.5rem;font-weight:600;cursor:pointer;}',
      '.cu-tablewrap{border:1px solid #e5e7eb;border-radius:10px;overflow:auto;max-height:44vh;}',
      '.cu-table{width:100%;border-collapse:collapse;font-size:.8rem;white-space:nowrap;}',
      '.cu-table th{position:sticky;top:0;background:#f9fafb;text-align:left;padding:.5rem .6rem;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb;z-index:1;}',
      '.cu-table td{padding:.45rem .6rem;border-bottom:1px solid #f3f4f6;color:#1f2937;}',
      '.cu-table tbody tr:last-child td{border-bottom:0;}',
      '.cu-table tr.cu-row--error td{background:#fef2f2;}',
      '.cu-table tr.cu-row--warning td{background:#fffbeb;}',
      '.cu-msg{display:block;white-space:normal;font-size:.74rem;line-height:1.4;margin-top:.15rem;}',
      '.cu-msg--error{color:#b91c1c;}',
      '.cu-msg--warning{color:#92400e;}',
      '.cu-zone--over{border-color:var(--purple,#5c267e)!important;background:#fff!important;box-shadow:0 8px 24px rgba(92,38,126,.16)!important;}',
      '.cu-zone--busy{opacity:.65;pointer-events:none;}'
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

  /** June onwards belongs to the year that is starting, not the one ending. */
  function defaultAcademicYear() {
    var now = new Date();
    var start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
    return start + '-' + (start + 1);
  }

  /**
   * Returns the canonical "2026-2027" form, or null if the text is not two
   * consecutive years. An en or em dash is accepted, since that is what a paste
   * from Word or a curriculum sheet usually carries, but it is stored as a plain
   * hyphen so the same year always matches itself.
   */
  function normalizeAcademicYear(value) {
    var m = /^(\d{4})\s*[-\u2013\u2014]\s*(\d{4})$/.exec(String(value || '').trim());
    if (!m) return null;
    if (parseInt(m[2], 10) !== parseInt(m[1], 10) + 1) return null;
    return m[1] + '-' + m[2];
  }

  function validAcademicYear(value) {
    return normalizeAcademicYear(value) !== null;
  }

  // ------------------------------------------------------------ small dialog

  /**
   * True when this overlay is the frontmost one. Escape must only close the
   * dialog on top, otherwise dismissing a nested prompt would also throw away
   * the review behind it along with the upload.
   */
  function isTopmost(overlay) {
    var all = doc.querySelectorAll('.cu-overlay');
    return all.length === 0 || all[all.length - 1] === overlay;
  }

  /**
   * A one-field prompt with an optional tick box, used to create a college or a
   * department without leaving the upload. onSubmit returns true to close, or
   * calls fail(message) and returns false to keep the dialog open.
   */
  function askText(opts, onSubmit, onCancel) {
    injectStyles();
    var overlay = doc.createElement('div');
    overlay.className = 'cu-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="cu-box cu-box--sm">' +
        '<div class="cu-head"><h2>' + esc(opts.title) + '</h2>' +
          (opts.hint ? '<p>' + esc(opts.hint) + '</p>' : '') +
        '</div>' +
        '<div class="cu-body">' +
          '<div class="cu-field">' +
            '<label for="cuAskInput">' + esc(opts.label) + '</label>' +
            '<input id="cuAskInput" type="text" autocomplete="off" placeholder="' + esc(opts.placeholder || '') + '">' +
          '</div>' +
          (opts.checkboxLabel
            ? '<label class="cu-check"><input type="checkbox" id="cuAskCheck"> ' + esc(opts.checkboxLabel) + '</label>'
            : '') +
          '<p class="cu-note cu-note--bad" id="cuAskError" hidden></p>' +
        '</div>' +
        '<div class="cu-foot">' +
          '<button type="button" class="cu-btn" data-cancel>Cancel</button>' +
          '<button type="button" class="cu-btn cu-btn--primary" data-ok>' + esc(opts.submitLabel || 'Add') + '</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(overlay);

    var input = overlay.querySelector('#cuAskInput');
    var check = overlay.querySelector('#cuAskCheck');
    var errorEl = overlay.querySelector('#cuAskError');
    input.focus();

    var done = false;
    function close(cancelled) {
      if (done) return;
      done = true;
      doc.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (cancelled && typeof onCancel === 'function') onCancel();
    }
    function fail(message) {
      errorEl.hidden = false;
      errorEl.textContent = message;
    }
    function submit() {
      errorEl.hidden = true;
      var ret = onSubmit(input.value, check ? check.checked : false, fail);
      if (ret && typeof ret.then === 'function') {
        ret.then(function (ok) {
          if (ok) close(false);
        });
        return;
      }
      if (ret) close(false);
    }
    function onKey(e) {
      if (!isTopmost(overlay)) return;
      if (e.key === 'Escape') close(true);
      if (e.key === 'Enter' && doc.activeElement === input) {
        e.preventDefault();
        submit();
      }
    }
    doc.addEventListener('keydown', onKey);
    overlay.querySelector('[data-ok]').addEventListener('click', submit);
    overlay.querySelector('[data-cancel]').addEventListener('click', function () {
      close(true);
    });
  }

  function notice(title, message, tone) {
    injectStyles();
    var overlay = doc.createElement('div');
    overlay.className = 'cu-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="cu-box cu-box--sm">' +
      '<div class="cu-head"><h2>' + esc(title) + '</h2></div>' +
      '<div class="cu-body"><div class="cu-callout cu-callout--' + (tone || 'bad') + '">' + esc(message) + '</div></div>' +
      '<div class="cu-foot"><button type="button" class="cu-btn cu-btn--primary" data-close>Close</button></div>' +
      '</div>';
    doc.body.appendChild(overlay);
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      doc.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape' && isTopmost(overlay)) close();
    }
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    doc.addEventListener('keydown', onKey);
    overlay.querySelector('[data-close]').focus();
  }

  // ----------------------------------------------------------- review dialog

  function openReview(parsed, fileName, onSaved) {
    injectStyles();

    var rows = parsed.rows;
    var errorCount = rows.filter(function (r) { return r.status === 'error'; }).length;
    var warnCount = rows.filter(function (r) { return r.status === 'warning'; }).length;
    var goodCount = rows.length - errorCount;

    var overlay = doc.createElement('div');
    overlay.className = 'cu-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Review curriculum upload');

    var unknownTypes = global.CurriculumStore.unknownRoomTypes(rows);

    overlay.innerHTML =
      '<div class="cu-box">' +
        '<div class="cu-head">' +
          '<h2>Review curriculum</h2>' +
          '<p>' + esc(fileName) + ' — ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') +
            ' read. Choose the program and academic year this curriculum belongs to.</p>' +
        '</div>' +
        '<div class="cu-body">' +
          '<div class="cu-fields">' +
            '<div class="cu-field">' +
              '<label for="cuCollege">College</label>' +
              '<select id="cuCollege"></select>' +
              '<p class="cu-note" id="cuCollegeNote"></p>' +
            '</div>' +
            '<div class="cu-field" id="cuDeptField">' +
              '<label for="cuDept">Program</label>' +
              '<select id="cuDept"></select>' +
              '<p class="cu-note" id="cuDeptNote"></p>' +
            '</div>' +
            '<div class="cu-field">' +
              '<label for="cuYear">Academic year</label>' +
              '<input id="cuYear" type="text" inputmode="numeric" placeholder="2026-2027" autocomplete="off">' +
              '<p class="cu-note" id="cuYearNote"></p>' +
            '</div>' +
          '</div>' +
          '<div id="cuFlags"></div>' +
          '<div class="cu-tablewrap"><table class="cu-table">' +
            '<thead><tr>' +
              '<th>Row</th><th>Course id</th><th>Course title</th><th>Lec</th><th>Lab</th>' +
              '<th>Total units</th><th>Hrs/week</th><th>Hrs/semester</th>' +
              '<th>Year level</th><th>Semester</th>' +
              '<th>Lecture room type</th><th>Lab room type</th>' +
              '<th>Prereq 1</th><th>Prereq 2</th><th>Prereq 3</th>' +
            '</tr></thead><tbody id="cuRows"></tbody>' +
          '</table></div>' +
        '</div>' +
        '<div class="cu-foot">' +
          '<span class="cu-foot__note" id="cuFootNote"></span>' +
          '<button type="button" class="cu-btn" data-cancel>Cancel</button>' +
          '<button type="button" class="cu-btn cu-btn--primary" data-save>Save curriculum</button>' +
        '</div>' +
      '</div>';

    doc.body.appendChild(overlay);

    var selCollege = overlay.querySelector('#cuCollege');
    var collegeNote = overlay.querySelector('#cuCollegeNote');
    var deptField = overlay.querySelector('#cuDeptField');
    var selDept = overlay.querySelector('#cuDept');
    var deptNote = overlay.querySelector('#cuDeptNote');
    var inputYear = overlay.querySelector('#cuYear');
    var yearNote = overlay.querySelector('#cuYearNote');
    var flags = overlay.querySelector('#cuFlags');
    var tbody = overlay.querySelector('#cuRows');
    var footNote = overlay.querySelector('#cuFootNote');
    var saveBtn = overlay.querySelector('[data-save]');
    var cancelBtn = overlay.querySelector('[data-cancel]');

    // ---- preview table
    tbody.innerHTML = rows
      .map(function (r) {
        var c = r.course;
        var msgs = r.messages
          .map(function (m) {
            return '<span class="cu-msg cu-msg--' + m.level + '">' + esc(m.text) + '</span>';
          })
          .join('');
        return (
          '<tr class="cu-row--' + r.status + '">' +
          '<td>' + r.sourceRow + '</td>' +
          '<td>' + esc(c.course_id || '—') + msgs + '</td>' +
          '<td>' + esc(c.course_title || '—') + '</td>' +
          '<td>' + c.lecture_units + '</td>' +
          '<td>' + c.lab_units + '</td>' +
          '<td>' + c.total_units + '</td>' +
          '<td>' + c.total_hours_week + '</td>' +
          '<td>' + c.total_hours_sem + '</td>' +
          '<td>' + (c.year_level ? global.CurriculumStore.yearLevelLabel(c.year_level) : '—') + '</td>' +
          '<td>' + (c.semester ? global.CurriculumStore.semesterLabel(c.semester) : '—') + '</td>' +
          '<td>' + esc(c.lecture_room_type || '—') + '</td>' +
          '<td>' + esc(c.lab_room_type || '—') + '</td>' +
          '<td>' + esc(c.prerequisite_1 || '—') + '</td>' +
          '<td>' + esc(c.prerequisite_2 || '—') + '</td>' +
          '<td>' + esc(c.prerequisite_3 || '—') + '</td>' +
          '</tr>'
        );
      })
      .join('');

    // ---- callouts above the table
    var flagHtml = '';
    if (!global.CurriculumStore.storageWorks()) {
      flagHtml +=
        '<div class="cu-callout cu-callout--bad">This browser is not letting these pages store data, so a ' +
        'curriculum saved here would not survive to the Curriculums page. Serving the folder from a local ' +
        'web server, rather than opening the files directly from disk, is the usual fix.</div>';
    }
    flagHtml +=
      '<div class="cu-callout cu-callout--info">If the file names hours per week, those hours are kept even when they do not match the units, and the row is flagged. ' +
      'If hours are missing they are computed from the units: ' +
      '<strong>1 lecture unit = 1 hour/week</strong>, <strong>1 lab unit = 3 hours/week</strong>. ' +
      'Hours per semester follow hours per week × the term length (18 weeks, or 6 in summer). Choose a lecture room type whenever there are lecture units, and a lab room type whenever there are lab units; neither is filled in automatically. Each prerequisite column holds one course id.</div>';
    if (errorCount) {
      flagHtml +=
        '<div class="cu-callout cu-callout--bad">' + errorCount + ' row' + (errorCount === 1 ? '' : 's') +
        ' could not be read and will be skipped. Fix them in the file and upload again if they are needed.</div>';
    }
    if (warnCount) {
      flagHtml +=
        '<div class="cu-callout cu-callout--warn">' + warnCount + ' row' + (warnCount === 1 ? '' : 's') +
        ' need a second look. They will still be saved, using the values shown below.</div>';
    }
    if (!parsed.columns.hasHeader) {
      flagHtml +=
        '<div class="cu-callout cu-callout--info">No header row was recognised, so the columns were read in the ' +
        'documented order. Check the preview before saving.</div>';
    }
    if (unknownTypes.length) {
      flagHtml +=
        '<div class="cu-callout cu-callout--warn">' +
        'These room types are not in the Facilities list yet: ' + esc(unknownTypes.join(', ')) +
        '. Add them under Facilities → Room types before rooms can be tagged with them. Subject names in this file are still saved as written.</div>';
    }
    flags.innerHTML = flagHtml;

    // ---- program and year fields
    var ADD_COLLEGE = '__cu_add_college__';
    var ADD_DEPT = '__cu_add_dept__';
    var prevCollege = '';
    var prevDept = '';

    function appendAddOption(sel, value, label) {
      var o = doc.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }

    function fillColleges(selectedId) {
      global.OrgStore.fillCollegeSelect(selCollege, selectedId);
      appendAddOption(selCollege, ADD_COLLEGE, '+ Add new college…');
      if (selectedId) selCollege.value = selectedId;
      var none = global.OrgStore.colleges().length === 0;
      collegeNote.className = 'cu-note' + (none ? ' cu-note--bad' : '');
      collegeNote.textContent = none
        ? 'No colleges yet. Add one here, or on the Colleges and Departments page.'
        : 'Not in the list? Choose “Add new college”.';
    }

    function fillDepts(selectedId) {
      global.OrgStore.fillDepartmentSelect(selDept, collegeValue(), selectedId);
      appendAddOption(selDept, ADD_DEPT, '+ Add new program…');
      if (selectedId) selDept.value = selectedId;
    }

    // The two sentinels are actions, never real selections, so everything that
    // reads these pickers treats them as nothing chosen.
    function collegeValue() {
      return selCollege.value === ADD_COLLEGE ? '' : selCollege.value;
    }
    function deptValue() {
      return selDept.value === ADD_DEPT ? '' : selDept.value;
    }

    fillColleges();
    inputYear.value = defaultAcademicYear();

    // Rebuilt only when the college actually changes, so that typing in the
    // academic year field does not silently reset an already chosen department.
    var lastCollegeId = null;
    function syncDept() {
      var collegeId = collegeValue();
      if (collegeId !== lastCollegeId) {
        lastCollegeId = collegeId;
        fillDepts();
      }
      var hasDepts = global.OrgStore.departmentsFor(collegeId).length > 0;
      deptField.hidden = false;
      selDept.disabled = !collegeId;
      deptNote.className = 'cu-note';
      if (!collegeId) {
        deptNote.textContent = 'Pick a college first.';
      } else if (!hasDepts) {
        deptNote.textContent = 'This college has no departments, so the curriculum is filed under the college itself.';
      } else {
        deptNote.textContent = 'Each program has its own curriculum. A department can hold more than one program.';
      }
    }

    function askCollege() {
      askText(
        {
          title: 'Add college',
          hint: 'It is saved to the Colleges and Departments page too, so this only has to be done once.',
          label: 'College name',
          placeholder: 'e.g. College of Physical Therapy',
          checkboxLabel: 'This college uses departments',
          submitLabel: 'Add college'
        },
        function (value, hasDepartments, fail) {
          return global.OrgStore.addCollege(value, '', hasDepartments).then(function (result) {
            if (!result.ok) {
              fail(result.error);
              return false;
            }
            fillColleges(result.college.id);
            lastCollegeId = null;
            refresh();
            return true;
          });
        },
        function () {
          fillColleges(prevCollege);
          refresh();
        }
      );
    }

    function askDepartment() {
      var collegeId = collegeValue();
      askText(
        {
          title: 'Add program',
          hint: 'This adds a department and its first program under ' + (global.OrgStore.collegeName(collegeId) || 'this college') + '. Add further programs on Colleges and departments.',
          label: 'Program name',
          placeholder: 'e.g. Occupational Therapy',
          submitLabel: 'Add program'
        },
        function (value, _unused, fail) {
          return global.OrgStore.addDepartment(collegeId, value).then(function (result) {
            if (!result.ok) {
              fail(result.error);
              return false;
            }
            var created = result.department && result.department.programs && result.department.programs[0];
            fillDepts(created ? created.id : '');
            refresh();
            return true;
          });
        },
        function () {
          fillDepts(prevDept);
          refresh();
        }
      );
    }

    function currentMeta() {
      var collegeId = collegeValue();
      var hasDepts = global.OrgStore.departmentsFor(collegeId).length > 0;
      var departmentId = hasDepts ? deptValue() : '';
      return {
        collegeId: collegeId,
        collegeName: global.OrgStore.collegeName(collegeId),
        departmentId: departmentId || null,
        departmentName: departmentId ? global.OrgStore.departmentName(collegeId, departmentId) : null,
        academicYear: normalizeAcademicYear(inputYear.value) || inputYear.value.trim(),
        sourceFileName: fileName,
        needsDept: hasDepts
      };
    }

    function refresh() {
      syncDept();
      var meta = currentMeta();
      var problems = [];
      if (!meta.collegeId) problems.push('choose a college');
      if (meta.needsDept && !meta.departmentId) problems.push('choose a department');

      var yearOk = validAcademicYear(meta.academicYear);
      yearNote.className = 'cu-note' + (meta.academicYear && !yearOk ? ' cu-note--bad' : '');
      yearNote.textContent = yearOk || !meta.academicYear
        ? 'Two consecutive years, for example 2026-2027.'
        : 'Enter two consecutive years, for example 2026-2027.';
      if (!yearOk) problems.push('enter a valid academic year');

      if (!goodCount) problems.push('fix at least one row in the file');

      saveBtn.disabled = problems.length > 0;
      if (problems.length) {
        footNote.textContent = 'To save, ' + problems.join(', ') + '.';
      } else {
        var existing = global.CurriculumStore.findExisting(meta.collegeId, meta.departmentId, meta.academicYear);
        footNote.textContent = existing
          ? 'A curriculum already exists for this program and year; saving will ask before replacing it.'
          : goodCount + ' subject' + (goodCount === 1 ? '' : 's') + ' will be saved.';
      }

      // Remembered so that cancelling the add dialog can put the picker back.
      prevCollege = collegeValue();
      prevDept = deptValue();
    }

    selCollege.addEventListener('change', function () {
      if (selCollege.value === ADD_COLLEGE) {
        askCollege();
        return;
      }
      refresh();
    });
    selDept.addEventListener('change', function () {
      if (selDept.value === ADD_DEPT) {
        askDepartment();
        return;
      }
      refresh();
    });
    inputYear.addEventListener('input', refresh);
    refresh();

    // ---- lifecycle
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      doc.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(e) {
      if (e.key === 'Escape' && isTopmost(overlay)) close();
    }
    doc.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', close);

    function commit(meta, courses, replace) {
      global.CurriculumStore.save(meta, courses, { replace: replace }).then(function (result) {
        if (!result.ok && result.conflict) {
          var who = meta.departmentName ? meta.collegeName + ' — ' + meta.departmentName : meta.collegeName;
          var ok = global.confirm(
            'A curriculum for ' + who + ' (' + meta.academicYear + ') already exists with ' +
            result.conflict.courses.length + ' subjects.\n\nReplace it with this file?'
          );
          if (!ok) return;
          commit(meta, courses, true);
          return;
        }
        if (!result.ok) {
          notice('The curriculum could not be saved', result.error || 'The database refused to store it.');
          return;
        }
        close();
        notice(
          result.replaced ? 'Curriculum replaced' : 'Curriculum saved',
          courses.length + ' subject' + (courses.length === 1 ? '' : 's') + ' saved for ' +
            (meta.departmentName ? meta.collegeName + ' — ' + meta.departmentName : meta.collegeName) +
            ', ' + meta.academicYear + '. Open the Curriculums page to view it.',
          'good'
        );
        if (typeof onSaved === 'function') onSaved(result.curriculum);
      });
    }

    saveBtn.addEventListener('click', function () {
      var meta = currentMeta();
      var courses = rows
        .filter(function (r) { return r.status !== 'error'; })
        .map(function (r) { return r.course; });
      commit(meta, courses, false);
    });
  }

  // ------------------------------------------------------------- file intake

  function handleFile(file, onSaved) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      notice('That is not a CSV file', 'Save the curriculum as CSV from Excel or Sheets, then drop it here.');
      return;
    }
    var reader = new global.FileReader();
    reader.onerror = function () {
      notice('The file could not be read', 'Try opening it, saving it again as CSV, and dropping it here once more.');
    };
    reader.onload = function () {
      var parsed = global.CurriculumStore.parse(String(reader.result || ''));
      if (!parsed.ok) {
        notice('This file could not be used', parsed.error);
        return;
      }
      openReview(parsed, file.name, onSaved);
    };
    reader.readAsText(file);
  }

  /**
   * Makes an element accept a dropped CSV, and click to browse. Any existing
   * link behaviour is suppressed so the zone uploads instead of navigating.
   */
  function attach(zone, options) {
    if (!zone) return;
    injectStyles();
    options = options || {};

    var input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.style.display = 'none';
    zone.parentNode.insertBefore(input, zone.nextSibling);

    input.addEventListener('change', function () {
      handleFile(input.files && input.files[0], options.onSaved);
      input.value = '';
    });

    // The zone is a link, so pressing Enter already raises a click; handling
    // keydown as well would open the file picker twice.
    zone.addEventListener('click', function (e) {
      e.preventDefault();
      input.click();
    });

    var depth = 0;
    zone.addEventListener('dragenter', function (e) {
      e.preventDefault();
      depth++;
      zone.classList.add('cu-zone--over');
    });
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) zone.classList.remove('cu-zone--over');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      zone.classList.remove('cu-zone--over');
      var files = e.dataTransfer && e.dataTransfer.files;
      handleFile(files && files[0], options.onSaved);
    });
  }

  global.CurriculumUpload = {
    attach: attach,
    handleFile: handleFile,
    defaultAcademicYear: defaultAcademicYear,
    validAcademicYear: validAcademicYear,
    normalizeAcademicYear: normalizeAcademicYear
  };
})(typeof window !== 'undefined' ? window : this);
