/**
 * Active sections browser, plus archived-offering cards and the view popup.
 * Lives on Data management → Sections (Active / Archived subtabs).
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (global.MCUNexReady) return global.MCUNexReady.then(fn);
    fn();
  }

  function yearHeadingLabel(y) {
    var words = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
    var n = parseInt(y, 10);
    if (n >= 1 && n < words.length) return words[n] + ' year';
    return 'Year ' + n;
  }

  function studentTotal(rows) {
    var n = 0;
    (rows || []).forEach(function (sec) {
      n += Number(sec.studentCount) || 0;
    });
    return n;
  }

  function studentTotalText(n) {
    return n + (n === 1 ? ' student' : ' students');
  }

  function headingWithTotal(tag, className, name, rows) {
    var el = document.createElement(tag);
    el.className = className;
    var nameEl = document.createElement('span');
    nameEl.className = 'vs-heading-name';
    nameEl.textContent = name;
    var totalEl = document.createElement('span');
    totalEl.className = 'vs-heading-total';
    function paint() {
      totalEl.textContent = studentTotalText(studentTotal(rows));
    }
    paint();
    el.appendChild(nameEl);
    el.appendChild(totalEl);
    return { el: el, paint: paint };
  }

  function semesterLabel(code) {
    if (code === '2') return '2nd semester';
    if (code === 'summer') return 'Summer';
    return '1st semester';
  }

  function offeringTitle(year, code) {
    return (year || 'Academic year') + ' · ' + semesterLabel(code);
  }

  function confirmDeleteSection(sec) {
    var name = sec.name || 'this section';
    var extra = sec.isRetake ? ' (retake)' : '';
    return confirm('Delete ' + name + extra + '? This cannot be undone.');
  }

  function confirmDeleteOffering(year, code) {
    return confirm(
      'Delete ' +
        offeringTitle(year, code) +
        ' permanently? This removes every section and the timetable for that academic year and semester. This cannot be undone.'
    );
  }

  function confirmDeleteYearLevel(rows) {
    if (!rows || !rows.length) return false;
    var first = rows[0];
    var regulars = 0;
    var retakes = 0;
    rows.forEach(function (s) {
      if (s.isRetake) retakes += 1;
      else regulars += 1;
    });
    var program = first.programName || first.departmentName || first.collegeName || 'this program';
    var mix =
      regulars +
      ' regular' +
      (regulars === 1 ? '' : 's') +
      (retakes ? ' and ' + retakes + ' retake' + (retakes === 1 ? '' : 's') : '');
    return confirm(
      'Delete all ' +
        rows.length +
        ' ' +
        program +
        ' ' +
        yearHeadingLabel(first.yearLevel).toLowerCase() +
        ' section' +
        (rows.length === 1 ? '' : 's') +
        '? This includes ' +
        mix +
        '. This cannot be undone.'
    );
  }

  ready(function () {
    var collegeSelect = document.getElementById('vsCollege');
    var departmentSelect = document.getElementById('vsDepartment');
    var yearSelect = document.getElementById('vsYearLevel');
    var container = document.getElementById('vsSectionsContainer');
    var banner = document.getElementById('vsTermBanner');
    var segActive = document.getElementById('vsSegActive');
    var segArchived = document.getElementById('vsSegArchived');
    var archiveHint = document.getElementById('vsArchiveHint');
    var filtersEl = document.getElementById('vsFilters');
    var archivedList = document.getElementById('vsArchivedList');
    var archiveModal = document.getElementById('vsArchiveModal');
    var archiveModalTitle = document.getElementById('vsArchiveModalTitle');
    var archiveModalBody = document.getElementById('vsArchiveModalBody');
    var archiveModalClose = document.getElementById('vsArchiveModalClose');
    var unified = !!archivedList;
    if (!collegeSelect || !departmentSelect || !yearSelect || !container) return;

    var pane = 'active';
    var openArchivedKey = '';

    function currentOffering() {
      return global.SectionsStore && typeof SectionsStore.currentTerm === 'function'
        ? SectionsStore.currentTerm()
        : null;
    }

    function sourceList() {
      if (pane === 'archived') return global.SectionsStore.list({ archived: true });
      return global.SectionsStore.list();
    }

    function populateColleges() {
      var keep = collegeSelect.value;
      collegeSelect.innerHTML = '';
      collegeSelect.appendChild(new Option('All colleges', ''));
      var list = global.OrgStore ? global.OrgStore.colleges() : [];
      list.forEach(function (c) {
        collegeSelect.appendChild(new Option(c.name, c.id));
      });
      if (keep) collegeSelect.value = keep;
    }

    function populateDepartments() {
      var collegeId = collegeSelect.value;
      var depts = collegeId && global.OrgStore ? global.OrgStore.departmentsFor(collegeId) : [];
      var keep = departmentSelect.value;
      departmentSelect.innerHTML = '';
      departmentSelect.appendChild(new Option('All programs', ''));
      if (!collegeId || depts.length <= 1) {
        departmentSelect.disabled = true;
        departmentSelect.value = '';
        return;
      }
      departmentSelect.disabled = false;
      depts.forEach(function (d) {
        departmentSelect.appendChild(new Option(d.name, d.id));
      });
      if (keep) departmentSelect.value = keep;
    }

    function populateYearLevels() {
      var keep = yearSelect.value;
      var years = {};
      sourceList().forEach(function (s) {
        years[s.yearLevel] = true;
      });
      var keys = Object.keys(years)
        .map(function (k) {
          return parseInt(k, 10);
        })
        .sort(function (a, b) {
          return a - b;
        });
      yearSelect.innerHTML = '';
      yearSelect.appendChild(new Option('All years', ''));
      if (!keys.length) {
        for (var i = 1; i <= 6; i++) {
          yearSelect.appendChild(new Option(yearHeadingLabel(i), String(i)));
        }
      } else {
        keys.forEach(function (y) {
          yearSelect.appendChild(new Option(yearHeadingLabel(y), String(y)));
        });
      }
      if (keep) yearSelect.value = keep;
    }

    function updateChrome() {
      var t = currentOffering();
      if (banner) {
        if (!unified && pane === 'archived') {
          banner.textContent =
            'Each row is one past academic year and semester. Open a row to see its sections.';
        } else if (t) {
          banner.innerHTML =
            'Current offering: <strong>' +
            t.schoolYear +
            '</strong> · <strong>' +
            semesterLabel(t.termCode) +
            '</strong> — every college and year level.';
        } else {
          banner.textContent =
            'No current offering yet. Set the academic year and semester on Create Sections.';
        }
      }
      if (segActive) segActive.setAttribute('aria-selected', pane === 'active' ? 'true' : 'false');
      if (segArchived) segArchived.setAttribute('aria-selected', pane === 'archived' ? 'true' : 'false');
      if (archiveHint) archiveHint.hidden = unified || pane !== 'archived';
      if (filtersEl) filtersEl.hidden = !unified && pane === 'archived';
    }

    function closeArchiveModal() {
      if (archiveModal) archiveModal.hidden = true;
      if (archiveModalBody) archiveModalBody.innerHTML = '';
    }

    function openArchiveModal(info, rows) {
      if (!archiveModal || !archiveModalBody) return;
      if (archiveModalTitle) {
        archiveModalTitle.textContent = offeringTitle(info.schoolYear, info.termCode);
      }
      archiveModalBody.innerHTML = '';
      if (rows.length) {
        renderCollegeGroups(archiveModalBody, rows, { allowEdit: false });
      } else {
        var none = document.createElement('p');
        none.className = 'vs-empty';
        none.style.padding = '0.5rem 0 0.25rem';
        none.textContent = 'No sections were saved in this offering.';
        archiveModalBody.appendChild(none);
      }
      archiveModal.hidden = false;
    }

    function goActiveTab() {
      if (global.SectionsSubtabs && typeof global.SectionsSubtabs.show === 'function') {
        global.SectionsSubtabs.show('active');
      } else {
        pane = 'active';
      }
    }

    function displayArchived() {
      if (!archivedList) return;
      archivedList.innerHTML = '';
      var allArchived = global.SectionsStore.list({ archived: true });
      var byTerm = {};
      allArchived.forEach(function (sec) {
        var k = String(sec.schoolYear || '') + '|' + String(sec.termCode || '');
        if (!byTerm[k]) byTerm[k] = [];
        byTerm[k].push(sec);
      });
      var offerings = global.SectionsStore.archivedTerms() || [];
      if (!offerings.length) {
        var emptyA = document.createElement('p');
        emptyA.className = 'vs-empty';
        emptyA.textContent =
          'No archived offerings yet. When a semester ends, archive it from Create Sections. That one action files every college and year level from that academic year and semester here, as a single item.';
        archivedList.appendChild(emptyA);
        return;
      }
      offerings.forEach(function (info) {
        var k = String(info.schoolYear) + '|' + String(info.termCode);
        var rows = byTerm[k] || [];
        var colleges = {};
        rows.forEach(function (sec) {
          colleges[sec.collegeName || sec.collegeId || 'College'] = true;
        });
        var collegeN = Object.keys(colleges).length;
        var group = document.createElement('div');
        group.className = 'vs-term-group';
        var top = document.createElement('div');
        top.className = 'vs-term-group__top';
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'vs-term-group__open';
        var title = document.createElement('div');
        title.className = 'vs-term-group__title';
        title.textContent = offeringTitle(info.schoolYear, info.termCode);
        var sub = document.createElement('div');
        sub.className = 'vs-term-group__meta';
        sub.textContent =
          rows.length +
          ' section' +
          (rows.length === 1 ? '' : 's') +
          (collegeN ? ' · ' + collegeN + ' college' + (collegeN === 1 ? '' : 's') : '') +
          ' · all year levels' +
          (info.archivedLabel ? ' · Archived · ' + info.archivedLabel : '') +
          ' · Open to view sections';
        openBtn.appendChild(title);
        openBtn.appendChild(sub);
        openBtn.addEventListener('click', function () {
          openArchiveModal(info, rows);
        });
        top.appendChild(openBtn);
        var actions = document.createElement('div');
        actions.className = 'vs-term-group__actions';
        var un = document.createElement('button');
        un.type = 'button';
        un.className = 'vs-btn-unarchive';
        un.textContent = 'Unarchive this offering';
        un.addEventListener('click', function (e) {
          e.stopPropagation();
          un.disabled = true;
          global.SectionsStore.unarchiveTerm(info.schoolYear, info.termCode).then(function (res) {
            un.disabled = false;
            if (!res.ok) {
              alert(res.error || 'Could not unarchive this offering.');
              return;
            }
            closeArchiveModal();
            goActiveTab();
            populateYearLevels();
            displaySections();
            displayArchived();
          });
        });
        actions.appendChild(un);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'vs-btn-delete';
        del.textContent = 'Delete';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirmDeleteOffering(info.schoolYear, info.termCode)) return;
          del.disabled = true;
          global.SectionsStore.deleteTerm(info.schoolYear, info.termCode).then(function (res) {
            del.disabled = false;
            if (!res.ok) {
              alert(res.error || 'Could not delete this offering.');
              return;
            }
            closeArchiveModal();
            displayArchived();
          });
        });
        actions.appendChild(del);
        top.appendChild(actions);
        group.appendChild(top);
        archivedList.appendChild(group);
      });
    }

    function filterRows(list) {
      var collegeId = collegeSelect.value;
      var departmentId = departmentSelect.disabled ? '' : departmentSelect.value;
      var year = yearSelect.value;
      return list.filter(function (sec) {
        if (collegeId && sec.collegeId !== collegeId) return false;
        if (departmentId && sec.departmentId !== departmentId) return false;
        if (year && String(sec.yearLevel) !== String(year)) return false;
        return true;
      });
    }

    function renderCollegeGroups(host, filtered, opts) {
      opts = opts || {};
      var allowEdit = opts.allowEdit !== false;
      var grouped = {};
      filtered.forEach(function (sec) {
        var ck = sec.collegeName || 'College';
        if (!grouped[ck]) grouped[ck] = [];
        grouped[ck].push(sec);
      });

      Object.keys(grouped)
        .sort()
        .forEach(function (collegeName) {
          var wrap = document.createElement('div');
          wrap.className = 'vs-college-block';
          var collegeHead = headingWithTotal('h2', 'vs-college-title', collegeName, grouped[collegeName]);
          wrap.appendChild(collegeHead.el);

          var byDept = {};
          grouped[collegeName].forEach(function (sec) {
            var dk = sec.orgDepartmentName || sec.departmentName || sec.programName || collegeName;
            if (!byDept[dk]) byDept[dk] = [];
            byDept[dk].push(sec);
          });

          Object.keys(byDept)
            .sort(function (a, b) {
              return a.localeCompare(b);
            })
            .forEach(function (deptName) {
              var deptWrap = document.createElement('div');
              deptWrap.className = 'vs-dept-section';
              var deptHead = headingWithTotal('h3', 'vs-dept-title', deptName, byDept[deptName]);
              deptWrap.appendChild(deptHead.el);

              var programNames = {};
              byDept[deptName].forEach(function (sec) {
                var pn = sec.programName || deptName;
                programNames[pn] = true;
              });
              var splitPrograms = Object.keys(programNames).length > 1 || (Object.keys(programNames)[0] && Object.keys(programNames)[0] !== deptName);
              var programBuckets = splitPrograms ? programNames : { '': true };
              Object.keys(programBuckets)
                .sort()
                .forEach(function (programName) {
              var rowsForProgram = splitPrograms
                ? byDept[deptName].filter(function (sec) { return (sec.programName || deptName) === programName; })
                : byDept[deptName];
              if (splitPrograms) {
                var progHead = headingWithTotal('h4', 'vs-dept-title', programName, rowsForProgram);
                deptWrap.appendChild(progHead.el);
              }

              var byYear = {};
              rowsForProgram.forEach(function (sec) {
                var key = String(sec.yearLevel);
                if (!byYear[key]) byYear[key] = [];
                byYear[key].push(sec);
              });

              Object.keys(byYear)
                .sort(function (a, b) {
                  return parseInt(a, 10) - parseInt(b, 10);
                })
                .forEach(function (key) {
                  var rows = byYear[key];
                  var yr = rows[0].yearLevel;
                  var yearBlock = document.createElement('div');
                  yearBlock.className = 'vs-year-block';
                  var toolbar = document.createElement('div');
                  toolbar.className = 'vs-year-toolbar';
                  var label = document.createElement('span');
                  label.className = 'vs-year-label';
                  label.textContent =
                    yearHeadingLabel(yr) +
                    (rows[0].curriculumName ? ' · ' + rows[0].curriculumName : '');
                  toolbar.appendChild(label);
                  var totalEl = document.createElement('span');
                  totalEl.className = 'vs-year-total';
                  function paintYearTotal() {
                    totalEl.textContent = studentTotalText(studentTotal(rows));
                    if (splitPrograms && progHead) progHead.paint();
                    deptHead.paint();
                    collegeHead.paint();
                  }
                  paintYearTotal();
                  toolbar.appendChild(totalEl);
                  if (allowEdit) {
                    var delYear = document.createElement('button');
                    delYear.type = 'button';
                    delYear.className = 'vs-btn-delete vs-btn-delete--year';
                    delYear.textContent = 'Delete year level';
                    delYear.addEventListener('click', function () {
                      if (!confirmDeleteYearLevel(rows)) return;
                      delYear.disabled = true;
                      global.SectionsStore.removeYearLevel({
                        collegeId: rows[0].collegeId,
                        departmentId: rows[0].departmentId,
                        schoolYear: rows[0].schoolYear,
                        termCode: rows[0].termCode,
                        yearLevel: rows[0].yearLevel
                      }).then(function (res) {
                        delYear.disabled = false;
                        if (!res.ok) alert(res.error || 'Could not delete that year level.');
                      });
                    });
                    toolbar.appendChild(delYear);
                  }
                  yearBlock.appendChild(toolbar);

                  var tw = document.createElement('div');
                  tw.className = 'vs-table-wrap';
                  var table = document.createElement('table');
                  table.className = 'vs-table';
                  var thead = document.createElement('thead');
                  var trh = document.createElement('tr');
                  ['Section name', 'Students', 'Subjects', 'Actions'].forEach(function (h) {
                    var th = document.createElement('th');
                    th.textContent = h;
                    if (h === 'Students') th.className = 'vs-col-students';
                    if (h === 'Actions') th.className = 'vs-col-actions';
                    trh.appendChild(th);
                  });
                  thead.appendChild(trh);
                  table.appendChild(thead);
                  var tbody = document.createElement('tbody');
                  rows.forEach(function (sec) {
                    var tr = document.createElement('tr');
                    var tdName = document.createElement('td');
                    tdName.textContent = sec.name;
                    if (sec.isRetake) {
                      var badge = document.createElement('span');
                      badge.className = 'vs-retake-badge';
                      badge.textContent = 'Retake';
                      tdName.appendChild(document.createTextNode(' '));
                      tdName.appendChild(badge);
                    }
                    var tdSt = document.createElement('td');
                    tdSt.className = 'vs-num';
                    if (allowEdit) {
                      var stInput = document.createElement('input');
                      stInput.type = 'number';
                      stInput.min = '0';
                      stInput.step = '1';
                      stInput.className = 'vs-input-students';
                      stInput.value = String(sec.studentCount);
                      stInput.setAttribute('aria-label', 'Students in ' + sec.name);
                      stInput.addEventListener('change', function () {
                        var v = parseInt(stInput.value, 10);
                        if (isNaN(v) || v < 0) v = 0;
                        stInput.value = String(v);
                        stInput.title = v > 40 ? 'Over the 40-student cap' : '';
                        sec.studentCount = v;
                        paintYearTotal();
                        global.SectionsStore.updateStudentCount(sec.id, v);
                      });
                      if (sec.studentCount > 40) stInput.title = 'Over the 40-student cap';
                      tdSt.appendChild(stInput);
                    } else {
                      tdSt.textContent = String(sec.studentCount);
                    }
                    var tdSub = document.createElement('td');
                    if (sec.isRetake && sec.subjects && sec.subjects.length) {
                      tdSub.className = 'vs-retake-subjects';
                      tdSub.textContent = sec.subjects
                        .map(function (sub) {
                          return (sub.courseId || '') + (sub.title ? ' — ' + sub.title : '');
                        })
                        .join('; ');
                    } else {
                      tdSub.textContent = sec.isRetake ? '—' : 'Regular load';
                    }
                    var tdAct = document.createElement('td');
                    tdAct.className = 'vs-col-actions';
                    if (allowEdit) {
                      var delBtn = document.createElement('button');
                      delBtn.type = 'button';
                      delBtn.className = 'vs-btn-delete';
                      delBtn.textContent = 'Delete';
                      delBtn.setAttribute('aria-label', 'Delete ' + sec.name);
                      delBtn.addEventListener('click', function () {
                        if (!confirmDeleteSection(sec)) return;
                        delBtn.disabled = true;
                        global.SectionsStore.removeSection(sec.id).then(function (res) {
                          delBtn.disabled = false;
                          if (!res.ok) alert(res.error || 'Could not delete that section.');
                        });
                      });
                      tdAct.appendChild(delBtn);
                    } else {
                      tdAct.textContent = '—';
                    }
                    tr.appendChild(tdName);
                    tr.appendChild(tdSt);
                    tr.appendChild(tdSub);
                    tr.appendChild(tdAct);
                    tbody.appendChild(tr);
                  });
                  table.appendChild(tbody);
                  tw.appendChild(table);
                  yearBlock.appendChild(tw);
                  deptWrap.appendChild(yearBlock);
                });
              });

              wrap.appendChild(deptWrap);
            });

          host.appendChild(wrap);
        });
    }

    function displaySections() {
      updateChrome();
      var filtered = filterRows(sourceList());
      container.innerHTML = '';

      if (!unified && pane === 'archived') {
        var allArchived = global.SectionsStore.list({ archived: true });
        var byTerm = {};
        allArchived.forEach(function (sec) {
          var k = String(sec.schoolYear || '') + '|' + String(sec.termCode || '');
          if (!byTerm[k]) byTerm[k] = [];
          byTerm[k].push(sec);
        });
        var offerings = global.SectionsStore.archivedTerms() || [];
        if (!offerings.length) {
          var emptyA = document.createElement('p');
          emptyA.className = 'vs-empty';
          emptyA.textContent =
            'No archived offerings yet. When a semester ends, archive it from the Sections page. That one action files every college and year level from that academic year and semester here, as a single item.';
          container.appendChild(emptyA);
          return;
        }
        offerings.forEach(function (info) {
          var k = String(info.schoolYear) + '|' + String(info.termCode);
          var rows = byTerm[k] || [];
          var colleges = {};
          rows.forEach(function (sec) {
            colleges[sec.collegeName || sec.collegeId || 'College'] = true;
          });
          var collegeN = Object.keys(colleges).length;
          var open = openArchivedKey === k;
          var group = document.createElement('div');
          group.className = 'vs-term-group' + (open ? ' is-open' : '');
          var top = document.createElement('div');
          top.className = 'vs-term-group__top';
          var openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'vs-term-group__open';
          openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
          var title = document.createElement('div');
          title.className = 'vs-term-group__title';
          title.textContent = offeringTitle(info.schoolYear, info.termCode);
          var sub = document.createElement('div');
          sub.className = 'vs-term-group__meta';
          sub.textContent =
            rows.length +
            ' section' +
            (rows.length === 1 ? '' : 's') +
            (collegeN
              ? ' · ' + collegeN + ' college' + (collegeN === 1 ? '' : 's')
              : '') +
            ' · all year levels' +
            (info.archivedLabel ? ' · Archived · ' + info.archivedLabel : '') +
            (open ? '' : ' · Open to view sections');
          openBtn.appendChild(title);
          openBtn.appendChild(sub);
          openBtn.addEventListener('click', function () {
            openArchivedKey = open ? '' : k;
            displaySections();
          });
          top.appendChild(openBtn);
          var actions = document.createElement('div');
          actions.className = 'vs-term-group__actions';
          var un = document.createElement('button');
          un.type = 'button';
          un.className = 'vs-btn-unarchive';
          un.textContent = 'Unarchive this offering';
          un.addEventListener('click', function (e) {
            e.stopPropagation();
            un.disabled = true;
            global.SectionsStore.unarchiveTerm(info.schoolYear, info.termCode).then(function (res) {
              un.disabled = false;
              if (!res.ok) {
                alert(res.error || 'Could not unarchive this offering.');
                return;
              }
              openArchivedKey = '';
              pane = 'active';
              populateYearLevels();
              displaySections();
            });
          });
          actions.appendChild(un);
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'vs-btn-delete';
          del.textContent = 'Delete';
          del.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!confirmDeleteOffering(info.schoolYear, info.termCode)) return;
            del.disabled = true;
            global.SectionsStore.deleteTerm(info.schoolYear, info.termCode).then(function (res) {
              del.disabled = false;
              if (!res.ok) {
                alert(res.error || 'Could not delete this offering.');
                return;
              }
              if (openArchivedKey === k) openArchivedKey = '';
              displaySections();
            });
          });
          actions.appendChild(del);
          top.appendChild(actions);
          group.appendChild(top);
          if (open) {
            var body = document.createElement('div');
            body.className = 'vs-term-group__body';
            if (rows.length) {
              renderCollegeGroups(body, rows, { allowEdit: false });
            } else {
              var none = document.createElement('p');
              none.className = 'vs-empty';
              none.style.padding = '0.5rem 0 1rem';
              none.textContent = 'No sections were saved in this offering.';
              body.appendChild(none);
            }
            group.appendChild(body);
          }
          container.appendChild(group);
        });
        return;
      }

      if (!filtered.length) {
        var empty = document.createElement('p');
        empty.className = 'vs-empty';
        var t = currentOffering();
        empty.textContent = t
          ? 'No sections in ' +
            offeringTitle(t.schoolYear, t.termCode) +
            ' match the current filters. Create them on Create Sections.'
          : 'No current offering yet. Set the academic year and semester on Create Sections, then create sections.';
        container.appendChild(empty);
        return;
      }

      renderCollegeGroups(container, filtered, { allowEdit: true });
    }

    if (segActive) {
      segActive.addEventListener('click', function () {
        pane = 'active';
        openArchivedKey = '';
        populateYearLevels();
        displaySections();
      });
    }
    if (segArchived) {
      segArchived.addEventListener('click', function () {
        pane = 'archived';
        populateYearLevels();
        displaySections();
      });
    }
    if (archiveModalClose) {
      archiveModalClose.addEventListener('click', closeArchiveModal);
    }
    if (archiveModal) {
      archiveModal.addEventListener('click', function (e) {
        if (e.target === archiveModal) closeArchiveModal();
      });
    }
    collegeSelect.addEventListener('change', function () {
      populateDepartments();
      displaySections();
    });
    departmentSelect.addEventListener('change', displaySections);
    yearSelect.addEventListener('change', displaySections);

    populateColleges();
    populateDepartments();
    populateYearLevels();
    displaySections();
    displayArchived();

    if (global.SectionsStore) {
      global.SectionsStore.onChange(function () {
        populateYearLevels();
        displaySections();
        displayArchived();
      });
    }
    if (global.OrgStore) {
      global.OrgStore.onChange(function () {
        populateColleges();
        populateDepartments();
        displaySections();
      });
    }
  });
})(typeof window !== 'undefined' ? window : this);
