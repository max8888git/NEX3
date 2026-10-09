/**
 * Create schedule / final report: load a term timetable and browse it
 * by section, by room, or by class. Create schedule can generate and edit;
 * final-report sets data-readonly="true" on #schedPage to keep the same
 * views and filters without changing the saved schedule.
 */
(function (global) {
  'use strict';

  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_LABELS = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat' };
  var DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
  var PAIR_OF = { Mon: 'Wed', Wed: 'Mon', Tue: 'Thu', Thu: 'Tue', Fri: 'Sat', Sat: 'Fri' };
  var GRID_START = 7 * 60;
  var GRID_END = 19 * 60;
  var SLOT = 30;
  var LUNCH_START = 12 * 60;
  var LUNCH_END = 13 * 60;
  var PALETTE = ['#ede4f5', '#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#e0e7ff', '#ffedd5', '#e2e8f0'];
  var roomLabelById = {};

  function ready(fn) {
    if (global.MCUNexReady) return global.MCUNexReady.then(fn);
    fn();
  }

  function qs(id) {
    return document.getElementById(id);
  }

  function semesterLabel(code) {
    if (code === '2') return '2nd semester';
    if (code === 'summer') return 'Summer';
    return '1st semester';
  }

  function dayOrder(d) {
    return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[d] || 9;
  }

  function meetingRoomLabel(m) {
    if (!m) return '';
    if (m.roomId && roomLabelById[m.roomId]) return roomLabelById[m.roomId];
    return m.roomCode || '';
  }

  function meetingWhen(m) {
    return m.day + ' ' + formatTimeRange(m.start, m.end);
  }

  function meetingLine(m) {
    var code = meetingRoomLabel(m);
    var room = code ? ' · ' + code : ' · Off-campus';
    return meetingWhen(m) + room;
  }

  function sortedMeetings(meetings) {
    return (meetings || []).slice().sort(function (a, b) {
      var day = dayOrder(a.day) - dayOrder(b.day);
      if (day) return day;
      return String(a.start || '').localeCompare(String(b.start || ''));
    });
  }

  function meetingColumnHtml(meetings, options) {
    var withRoom = !options || options.room !== false;
    var note = options && options.note ? String(options.note) : '';
    var list = sortedMeetings(meetings);
    function stacked(fn) {
      return list
        .map(function (m) {
          return escapeHtml(fn(m));
        })
        .join('<br>');
    }
    var timeHtml = list.length
      ? stacked(function (m) {
          return formatTimeRangeLines(m.start, m.end) || '—';
        })
      : '—';
    if (note) {
      timeHtml = (list.length ? timeHtml + ' · ' : '') + escapeHtml(note);
    }
    if (!list.length && !note) {
      return withRoom ? '<td>—</td><td>—</td><td>—</td>' : '<td>—</td><td>—</td>';
    }
    var seenDay = {};
    var dayLabels = [];
    var seenRoom = {};
    var roomLabels = [];
    list.forEach(function (m) {
      var label = DAY_LABELS[m.day] || m.day || '—';
      if (!seenDay[label]) {
        seenDay[label] = true;
        dayLabels.push(label);
      }
      var room = meetingRoomLabel(m) || 'Off-campus';
      if (!seenRoom[room]) {
        seenRoom[room] = true;
        roomLabels.push(room);
      }
    });
    return (
      '<td>' +
      (dayLabels.length ? dayLabels.map(escapeHtml).join('<br>') : '—') +
      '</td><td class="sched-cell-time">' +
      timeHtml +
      '</td>' +
      (withRoom
        ? '<td>' +
          (roomLabels.length ? roomLabels.map(escapeHtml).join('<br>') : '—') +
          '</td>'
        : '')
    );
  }

  function sectionLabel(name, count, cls) {
    var label = String(name || '');
    if (!label) return '';
    var n = Number(count);
    if (!isFinite(n)) return label;
    if (isPartitioned(cls)) {
      return label + ' (' + Number(cls.partitionStudents) + ' of ' + Number(cls.sectionStudentCount) + ' students)';
    }
    return label + ' (' + n + (n === 1 ? ' student' : ' students') + ')';
  }

  function isPartitioned(cls) {
    return !!(
      cls &&
      Number(cls.partitionCount) > 1 &&
      isFinite(Number(cls.partitionStudents)) &&
      isFinite(Number(cls.sectionStudentCount))
    );
  }

  function studentCountLabel(n) {
    var x = Math.round(Number(n) || 0);
    if (x < 0) x = 0;
    return x + (x === 1 ? ' student' : ' students');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function minutesOf(hhmm) {
    var p = String(hhmm || '').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function slotIndex(hhmm) {
    return Math.round((minutesOf(hhmm) - GRID_START) / SLOT);
  }

  function slotCount() {
    return Math.round((GRID_END - GRID_START) / SLOT);
  }

  function formatClock(mins) {
    var h = Math.floor(mins / 60) % 24;
    if (h < 0) h += 24;
    var m = mins % 60;
    if (m < 0) m += 60;
    var suffix = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12;
    if (!h12) h12 = 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + suffix;
  }

  function formatHhmm(hhmmStr) {
    if (hhmmStr == null || String(hhmmStr).trim() === '') return '';
    return formatClock(minutesOf(hhmmStr));
  }

  function formatTimeRange(start, end) {
    var a = formatHhmm(start);
    var b = formatHhmm(end);
    if (!a && !b) return '';
    return a + '–' + b;
  }

  function formatTimeRangeLines(start, end) {
    var a = formatHhmm(start);
    var b = formatHhmm(end);
    if (!a && !b) return '';
    if (!a) return b;
    if (!b) return a;
    return a + '\n– ' + b;
  }

  function hhmm(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function colorFor(code) {
    var h = 0;
    String(code || '').split('').forEach(function (c) {
      h = (h * 31 + c.charCodeAt(0)) | 0;
    });
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  function emptyLine(text) {
    var p = document.createElement('p');
    p.className = 'sched-empty';
    p.textContent = text;
    return p;
  }

  ready(function () {
    var yearEl = qs('schedYear');
    var semEl = qs('schedSemester');
    var colEl = qs('schedCollege');
    var depWrap = qs('schedDepartmentWrap');
    var depEl = qs('schedDepartment');
    var ylEl = qs('schedYearLevel');
    var sectionStatusEl = qs('schedSectionStatus');
    var genSettingsWrap = qs('schedGenSettingsWrap');
    var genSettingsBtn = qs('schedGenSettingsBtn');
    var genPanel = qs('schedGenPanel');
    var genMergeEl = qs('schedGenMerge');
    var genSplitEl = qs('schedGenSplitHours');
    var genLunchEl = qs('schedGenKeepLunch');
    var genPartitionEl = qs('schedGenPartitionScope');
    var genScopeEl = qs('schedGenScope');
    var genSaveBtn = qs('schedGenSave');
    var runBtn = qs('schedGenerate');
    var remainingBtn = qs('schedGenerateRemaining');
    var statusEl = qs('schedStatus');
    var sectionView = qs('schedSectionView');
    var roomView = qs('schedRoomView');
    var classView = qs('schedClassView');
    var genFilters = qs('schedGenerateFilters');
    var layoutTabs = qs('schedLayoutTabs');
    var roomTableFilters = qs('schedRoomTableFilters');
    var classFilters = qs('schedClassFilters');
    var classSearchEl = qs('schedClassSearch');
    var classCollegeEl = qs('schedClassCollege');
    var classComponentEl = qs('schedClassComponent');
    var classStatusEl = qs('schedClassStatus');
    var classYearLevelEl = qs('schedClassYearLevel');
    var classBuildingEl = qs('schedClassBuilding');
    var classMergedEl = qs('schedClassMerged');
    var roomBuildingEl = qs('schedRoomBuilding');
    var roomFloorEl = qs('schedRoomFloor');
    var roomTypeEl = qs('schedRoomType');
    var roomCrumb = qs('schedRoomCrumb');
    var modal = qs('schedMergeModal');
    var modalBody = qs('schedMergeBody');
    var modalYes = qs('schedMergeYes');
    var modalNo = qs('schedMergeNo');
    var editModal = qs('schedEditModal');
    // 'jobs' is This session / Sections. Set this to 'classic' to restore the previous single scroll.
    var editClassLayout = 'jobs';
    var page = document.getElementById('schedPage');
    var shell = document.querySelector('.shell');
    var printBtn = qs('schedPrint');
    var readOnly = !!(page && page.getAttribute('data-readonly') === 'true');
    if (!yearEl || !semEl) return;
    if (!readOnly && !runBtn) return;

    var primaryView = (page && page.getAttribute('data-view')) || 'sections';
    var layout = defaultRoomLayout();
    var openSectionGrid = '';
    var openRoomTableGrid = '';
    var selectedBuilding = '';
    var selectedRoom = '';
    var runId = '';
    var classes = [];
    var rooms = [];
    var editState = null;
    var actor = (page && page.getAttribute('data-actor')) || '';
    var selectedVersion = '';
    var publication = null;
    var generatorSettings = { mergeMode: 'auto', splitHours: 3, keepLunch: true };
    var offeringPane = 'active';
    var currentOffering = null;
    var archivedOfferings = [];
    var offeringMeta = { canArchive: false, canUnarchive: false, viewingLive: true };
    var archivedPick = null;
    var bannerEl = qs('schedTermBanner');
    var segActive = qs('schedSegActive');
    var segArchived = qs('schedSegArchived');
    var archiveHint = qs('schedArchiveHint');
    var archivedList = qs('schedArchivedList');
    var workspaceEl = qs('schedWorkspace');
    var archiveBtn = qs('schedArchiveOffering');
    var backArchivedBtn = qs('schedBackArchived');
    var pageKind = (page && page.getAttribute('data-page')) === 'report' ? 'report' : 'create';
    var usesWorkspace = actor === 'admin' || actor === 'super_admin' || (actor === 'vpaa' && pageKind === 'report');
    var workspaceState = null;
    var pendingSaveId = '';
    var reportYear = '';
    var reportSem = '';
    var reportTerms = [];
    var savesPanel = qs('schedSavesPanel');
    var workspaceHint = qs('schedWorkspaceHint');
    var workspaceActions = qs('schedWorkspaceActions');

    function allowedWorkspaces() {
      return pageKind === 'report' ? ['final', 'awaiting'] : ['mine', 'submitted', 'saves', 'archives'];
    }

    function workspaceFromUrl() {
      try {
        var q = new URLSearchParams(location.search || '');
        var ws = String(q.get('ws') || '').toLowerCase();
        if (ws === 'shared') ws = 'mine';
        if (allowedWorkspaces().indexOf(ws) >= 0) return ws;
      } catch (err) {}
      return pageKind === 'report' ? (actor === 'vpaa' ? 'awaiting' : 'final') : 'mine';
    }

    var workspace = usesWorkspace ? workspaceFromUrl() : 'mine';

    function writeWorkspaceUrl() {
      if (!usesWorkspace) return;
      try {
        var url = new URL(location.href);
        url.searchParams.set('ws', workspace);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (err) {}
    }

    function ws() {
      return workspaceState || {};
    }

    function canManageOfferings() {
      return actor === '' || actor === 'admin' || actor === 'super_admin';
    }

    function scheduleLocked() {
      if (!usesWorkspace) return readOnly || offeringPane === 'archived';
      if (pageKind === 'report') return true;
      if (workspace === 'submitted' || workspace === 'saves' || workspace === 'archives') return true;
      return offeringPane === 'archived';
    }

    function offeringTitle(year, code) {
      return (year || 'Academic year') + ' · ' + semesterLabel(code);
    }

    function csvAttr(name) {
      return String((page && page.getAttribute(name)) || '')
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }

    function normName(s) {
      return String(s || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(the|of|and|college|department|program)\b/g, ' ')
        .replace(/s\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function nameMatches(a, b) {
      var x = normName(a);
      var y = normName(b);
      if (!x || !y) return false;
      return x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
    }

    function scopedColleges() {
      var names = csvAttr('data-scope-college-name');
      if (!names.length || !global.OrgStore) return [];
      return global.OrgStore.colleges().filter(function (c) {
        return names.some(function (n) {
          return nameMatches(c.name, n);
        });
      });
    }

    function scopedDepartments() {
      var names = csvAttr('data-scope-department-name');
      var colleges = scopedColleges();
      if (!names.length || !global.OrgStore) return [];
      var out = [];
      (colleges.length ? colleges : global.OrgStore.colleges()).forEach(function (c) {
        (global.OrgStore.departmentsFor(c.id) || []).forEach(function (d) {
          if (
            names.some(function (n) {
              return nameMatches(d.name, n);
            })
          ) {
            out.push(d);
          }
        });
      });
      return out;
    }

    function matchesScope(c) {
      var cols = scopedColleges();
      if (cols.length) {
        var ok = cols.some(function (col) {
          return col.id === c.collegeId;
        });
        if (!ok) return false;
      }
      var deps = scopedDepartments();
      if (deps.length) {
        return deps.some(function (d) {
          return d.id === c.departmentId;
        });
      }
      return true;
    }

    function versionLabel(code) {
      if (actor === 'super_admin') {
        return (
          {
            working: 'Live timetable',
            pendingSuperAdmin:
              publication && publication.returnedFromVpaa ? 'Returned by VPAA' : 'Submitted by Admin',
            pendingVpaa: 'Sent to VPAA',
            published: 'VPAA published'
          }[code] || code
        );
      }
      if (actor === 'vpaa') {
        return (
          {
            pendingVpaa: 'Ready to publish',
            published: 'Published'
          }[code] || code
        );
      }
      return (
        {
          working: 'Working copy',
          pendingSuperAdmin: 'Sent to Super Admin',
          pendingVpaa: 'Awaiting VPAA',
          published: 'VPAA approved'
        }[code] || code
      );
    }

    function emptyScheduleText(forClasses) {
      if (offeringPane === 'active' && !currentOffering) {
        return 'No current offering yet. Set the academic year and semester on the Sections page, then return here.';
      }
      var term = (yearEl.value || '') + ' ' + semesterLabel(semEl.value);
      var vers = (publication && publication.versions) || [];
      if (actor === 'dean' || actor === 'program_chair') {
        return (
          'No published timetable for ' +
          term.trim() +
          ' yet. This page only shows the copy after the VPAA approves it, so an empty list here is expected while Admin is still working.'
        );
      }
      if (actor === 'vpaa' && vers.indexOf('pendingVpaa') < 0 && vers.indexOf('published') < 0) {
        return (
          'No campus package is waiting for you on ' +
          term.trim() +
          '. Super Admin has to approve Admin’s timetable first. This is not a database connection problem.'
        );
      }
      if (selectedVersion === 'published') {
        return 'No VPAA-approved timetable for ' + term.trim() + ' yet.';
      }
      if (selectedVersion === 'pendingVpaa') {
        return 'Nothing is waiting for VPAA approval.';
      }
      if (selectedVersion === 'pendingSuperAdmin') {
        return 'Nothing is waiting for Super Admin approval.';
      }
      if (usesWorkspace && workspace === 'mine') {
        return forClasses
          ? 'No personal schedule yet. Press Generate schedule on By section, or open a save.'
          : 'No personal schedule yet. Press Generate schedule, or open a save from the Saves tab.';
      }
      if (usesWorkspace && workspace === 'submitted') {
        return actor === 'super_admin'
          ? 'Admin has not submitted a timetable yet.'
          : 'No timetable is waiting for Super Admin. Submit one from My schedule.';
      }
      if (usesWorkspace && workspace === 'awaiting') {
        return actor === 'vpaa'
          ? 'Nothing is waiting for your approval.'
          : 'No timetable is waiting for the VPAA.';
      }
      if (usesWorkspace && workspace === 'final') {
        return actor === 'vpaa'
          ? 'You have not published a timetable for ' + term.trim() + ' yet.'
          : 'No VPAA-approved timetable for ' + term.trim() + ' yet.';
      }
      if (scheduleLocked()) return 'No saved schedule for ' + term.trim() + '.';
      if (forClasses) return 'No schedule yet. Press Generate schedule on By section to place classes.';
      return 'No schedule yet. Press Generate schedule to place classes.';
    }

    function noRoomsText() {
      return scheduleLocked()
        ? 'No rooms in Facilities yet.'
        : 'No rooms in Facilities yet. Add rooms in Data management, then generate a schedule.';
    }

    function gridEditOpts(empty) {
      var opts = { empty: empty };
      if (!scheduleLocked()) {
        opts.onEdit = function (block) {
          openEditModal(block.class, block.meeting);
        };
      }
      return opts;
    }

    function actionsCol() {
      return scheduleLocked() ? '' : '<col class="sched-col-actions">';
    }

    function actionsHead() {
      return scheduleLocked() ? '' : '<th></th>';
    }

    function editCell(offeringId, meetingId) {
      if (scheduleLocked()) return '';
      var extra =
        meetingId != null && String(meetingId) !== ''
          ? ' data-edit-meeting="' + escapeHtml(meetingId) + '"'
          : '';
      return (
        '<td class="sched-actions-cell"><button type="button" class="sched-link-btn" data-edit-offering="' +
        escapeHtml(offeringId) +
        '"' +
        extra +
        '>Edit</button></td>'
      );
    }

    function sectionSubjectActions(c) {
      if (scheduleLocked()) return '';
      var html =
        '<td class="sched-actions-cell"><button type="button" class="sched-link-btn" data-edit-offering="' +
        escapeHtml(c.id) +
        '">Edit</button>';
      if ((c.meetings || []).length) {
        html +=
          '<button type="button" class="sched-link-btn" data-unschedule-offering="' +
          escapeHtml(c.id) +
          '">Unschedule</button>';
      }
      return html + '</td>';
    }

    function programFilterValue(p) {
      return p.departmentId || 'college:' + p.collegeId;
    }

    function listedPrograms() {
      if (!global.OrgStore || typeof global.OrgStore.programs !== 'function') return [];
      var collegeId = colEl ? colEl.value : '';
      var scoped = scopedDepartments();
      var list = global.OrgStore.programs();
      if (scoped.length) {
        return list.filter(function (p) {
          return scoped.some(function (d) {
            return d.id === p.departmentId;
          });
        });
      }
      if (collegeId) {
        return list.filter(function (p) {
          return p.collegeId === collegeId;
        });
      }
      return list;
    }

    function matchesSectionFilters(c) {
      var college = colEl ? colEl.value : '';
      var prog = depEl && depWrap && !depWrap.hidden ? depEl.value : '';
      var yl = ylEl ? ylEl.value : '';
      if (college && c.collegeId !== college) return false;
      if (prog) {
        if (prog.indexOf('college:') === 0) {
          if (c.collegeId !== prog.slice(8) || c.departmentId) return false;
        } else if (c.departmentId !== prog) {
          return false;
        }
      }
      if (yl && String(c.yearLevel) !== String(yl)) return false;
      var place = sectionStatusEl ? sectionStatusEl.value : '';
      if (place) {
        var scheduled = classIsScheduled(c);
        if (place === 'scheduled' && !scheduled) return false;
        if (place === 'unscheduled' && scheduled) return false;
      }
      return true;
    }

    function classIsScheduled(c) {
      return !!(c && c.meetings && c.meetings.length && c.status === 'scheduled');
    }

    function defaultRoomLayout() {
      var pref = page && page.getAttribute('data-room-layout');
      return pref === 'table' || pref === 'grid' ? pref : 'table';
    }

    function applyHash() {
      var h = (location.hash || '').replace(/^#/, '');
      if (!h) return;
      var parts = h.split('/');
      if (parts[0] === 'rooms' || parts[0] === 'sections' || parts[0] === 'classes') {
        primaryView = parts[0];
      }
      if (primaryView === 'sections') {
        if (parts[1] && parts[1] !== 'table' && parts[1] !== 'grid') {
          openSectionGrid = decodeURIComponent(parts[1]);
        }
        return;
      }
      if (primaryView === 'classes') return;
      if (parts[1] === 'grid' || parts[1] === 'table') layout = parts[1];
      else layout = defaultRoomLayout();
      if (layout === 'grid') {
        selectedBuilding = parts[2] ? decodeURIComponent(parts[2]) : '';
        selectedRoom = parts[3] ? decodeURIComponent(parts[3]) : '';
      } else if (layout === 'table' && parts[2]) {
        openRoomTableGrid = decodeURIComponent(parts[2]);
      }
    }

    function writeHash() {
      var h = '#' + primaryView;
      if (primaryView === 'sections') {
        if (openSectionGrid) h += '/' + encodeURIComponent(openSectionGrid);
      } else if (primaryView === 'classes') {
        /* list only */
      } else {
        h += '/' + layout;
        if (layout === 'grid') {
          if (selectedBuilding) h += '/' + encodeURIComponent(selectedBuilding);
          if (selectedRoom) h += '/' + encodeURIComponent(selectedRoom);
        } else if (openRoomTableGrid) {
          h += '/' + encodeURIComponent(openRoomTableGrid);
        }
      }
      if (location.hash !== h) {
        try {
          history.replaceState(null, '', h);
        } catch (e) {
          location.hash = h;
        }
      }
    }

    function syncSectionFilters() {
      if (genFilters) {
        genFilters.hidden = primaryView !== 'sections';
      }
    }

    function hideGenInfo() {
      var info = qs('schedGenInfo');
      var infoBtn = qs('schedGenInfoBtn');
      if (info) info.classList.remove('is-open');
      if (infoBtn) infoBtn.setAttribute('aria-expanded', 'false');
    }

    function hideGenPanel() {
      if (genPanel) genPanel.hidden = true;
      if (genSettingsBtn) genSettingsBtn.setAttribute('aria-expanded', 'false');
      hideGenInfo();
    }

    function placementCounts() {
      var scheduled = 0;
      classes.forEach(function (c) {
        if (c && c.meetings && c.meetings.length) scheduled += 1;
      });
      return { total: classes.length, scheduled: scheduled };
    }

    function syncGenerateChrome() {
      var blocked = scheduleLocked() || primaryView !== 'sections' || (usesWorkspace && !ws().canGenerate);
      var counts = placementCounts();
      var showGenerate = !blocked && !!currentOffering && counts.scheduled === 0;
      var showRemaining = !blocked && counts.scheduled > 0 && counts.scheduled < counts.total;
      if (runBtn) runBtn.hidden = !showGenerate;
      if (remainingBtn) remainingBtn.hidden = !showRemaining;
      var hideSettings = blocked;
      if (genSettingsWrap) genSettingsWrap.hidden = hideSettings;
      if (hideSettings) hideGenPanel();
    }

    function showView(which, nextLayout) {
      if (which === 'sections' || which === 'rooms' || which === 'classes') primaryView = which;
      if (nextLayout === 'table' || nextLayout === 'grid') layout = nextLayout;
      if (sectionView) sectionView.hidden = primaryView !== 'sections';
      if (roomView) roomView.hidden = primaryView !== 'rooms';
      if (classView) classView.hidden = primaryView !== 'classes';
      document.querySelectorAll('[data-sched-view]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-sched-view') === primaryView);
      });
      document.querySelectorAll('[data-sched-layout]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-sched-layout') === layout);
      });
      syncSectionFilters();
      syncTermFilterChrome();
      syncGenerateChrome();
      if (layoutTabs) layoutTabs.hidden = primaryView !== 'rooms';
      if (roomTableFilters) roomTableFilters.hidden = !(primaryView === 'rooms' && layout === 'table');
      if (classFilters) classFilters.hidden = primaryView !== 'classes';
      if (roomCrumb) roomCrumb.hidden = !(primaryView === 'rooms' && layout === 'grid');
      if (shell) {
        shell.classList.toggle(
          'sched-shell--wide',
          (primaryView === 'rooms' && layout === 'grid') ||
            (primaryView === 'rooms' && layout === 'table' && !!openRoomTableGrid) ||
            (primaryView === 'sections' && !!openSectionGrid)
        );
      }
      writeHash();
      render();
    }

    function archiveHintText() {
      if (actor === 'dean' || actor === 'program_chair') {
        return 'Archived offerings are previous academic years and semesters. You still only see the VPAA-published timetable for your college or programs.';
      }
      if (actor === 'vpaa') {
        return 'Archived offerings are previous academic years and semesters. Open one to review the package that was sent to you or that you published. Approval stays on the live offering.';
      }
      return 'Archived items are whole offerings: sections and the timetable together. Unarchive restores that entire term. Delete removes it permanently. Archive the live offering first if you need to restore an older one.';
    }

    function renderArchivedList() {
      if (!archivedList) return;
      archivedList.innerHTML = '';
      if (!archivedOfferings.length) {
        archivedList.appendChild(
          emptyLine(
            actor === 'dean' || actor === 'program_chair'
              ? 'No archived VPAA-published timetables yet.'
              : 'No archived offerings yet. When a semester ends, archive it here or on the Sections page. That files the sections and timetable together.'
          )
        );
        return;
      }
      archivedOfferings.forEach(function (info) {
        var card = document.createElement('div');
        card.className = 'sched-offering-card';
        var text = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'sched-offering-card__title';
        title.textContent = offeringTitle(info.schoolYear, info.termCode);
        var meta = document.createElement('div');
        meta.className = 'sched-offering-card__meta';
        var bits = [];
        bits.push(info.sectionCount + ' section' + (info.sectionCount === 1 ? '' : 's'));
        bits.push(info.classCount + ' class' + (info.classCount === 1 ? '' : 'es'));
        if (info.published) bits.push('VPAA published');
        if (info.archivedLabel) bits.push('Archived · ' + info.archivedLabel);
        meta.textContent = bits.join(' · ');
        text.appendChild(title);
        text.appendChild(meta);
        var actions = document.createElement('div');
        actions.className = 'sched-offering-card__actions';
        var viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'sched-btn';
        viewBtn.textContent = 'View timetable';
        viewBtn.addEventListener('click', function () {
          archivedPick = { schoolYear: info.schoolYear, termCode: info.termCode };
          selectedVersion = '';
          offeringPane = 'archived';
          fillYears();
          loadSchedule();
        });
        actions.appendChild(viewBtn);
        if (offeringMeta.canUnarchive && canManageOfferings()) {
          var un = document.createElement('button');
          un.type = 'button';
          un.className = 'sched-btn sched-btn--ghost';
          un.textContent = 'Unarchive this offering';
          un.addEventListener('click', function () {
            if (!global.SectionsStore) return;
            un.disabled = true;
            global.SectionsStore.unarchiveTerm(info.schoolYear, info.termCode).then(function (res) {
              un.disabled = false;
              if (!res.ok) {
                alert(res.error || 'Could not unarchive this offering.');
                return;
              }
              offeringPane = 'active';
              archivedPick = null;
              selectedVersion = '';
              if (usesWorkspace) workspace = 'mine';
              loadSchedule();
            });
          });
          actions.appendChild(un);
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'sched-btn sched-btn--danger';
          del.textContent = 'Delete';
          del.addEventListener('click', function () {
            if (!global.SectionsStore) return;
            if (
              !global.confirm(
                'Delete ' +
                  offeringTitle(info.schoolYear, info.termCode) +
                  ' permanently? This removes every section and the timetable for that academic year and semester. This cannot be undone.'
              )
            ) {
              return;
            }
            del.disabled = true;
            global.SectionsStore.deleteTerm(info.schoolYear, info.termCode).then(function (res) {
              del.disabled = false;
              if (!res.ok) {
                alert(res.error || 'Could not delete this offering.');
                return;
              }
              if (
                archivedPick &&
                archivedPick.schoolYear === info.schoolYear &&
                archivedPick.termCode === info.termCode
              ) {
                archivedPick = null;
              }
              selectedVersion = '';
              loadSchedule();
            });
          });
          actions.appendChild(del);
        }
        card.appendChild(text);
        card.appendChild(actions);
        archivedList.appendChild(card);
      });
    }

    function syncOfferingChrome() {
      var showArchivedList = usesWorkspace
        ? workspace === 'archives' && !archivedPick
        : offeringPane === 'archived' && !archivedPick;
      if (segActive) segActive.setAttribute('aria-selected', offeringPane === 'active' ? 'true' : 'false');
      if (segArchived) segArchived.setAttribute('aria-selected', offeringPane === 'archived' ? 'true' : 'false');
      if (qs('schedOfferingBar')) qs('schedOfferingBar').hidden = usesWorkspace;
      if (archiveHint) {
        archiveHint.hidden = !showArchivedList && !(usesWorkspace && workspace === 'archives' && archivedPick);
        archiveHint.textContent = archiveHintText();
      }
      if (archivedList) archivedList.hidden = !showArchivedList;
      if (showArchivedList) renderArchivedList();
      var hideTimetable = showArchivedList || (usesWorkspace && (workspace === 'saves' || (workspace === 'archives' && !archivedPick)));
      if (workspaceEl) workspaceEl.hidden = hideTimetable && usesWorkspace ? showArchivedList || workspace === 'saves' || (workspace === 'archives' && !archivedPick) : showArchivedList;
      if (usesWorkspace && workspaceEl) {
        workspaceEl.hidden = workspace === 'saves' || (workspace === 'archives' && !archivedPick);
      }
      if (bannerEl) {
        if (usesWorkspace && workspace === 'saves') {
          bannerEl.textContent = 'Named versions of this term. Opening one replaces the timetable in My schedule.';
        } else if (offeringPane === 'archived' && archivedPick) {
          bannerEl.innerHTML =
            'Archived offering: <strong>' +
            escapeHtml(offeringTitle(archivedPick.schoolYear, archivedPick.termCode)) +
            '</strong> — read only.';
        } else if (usesWorkspace && workspace === 'archives' && !archivedPick) {
          bannerEl.textContent =
            'Past academic years and semesters, plus named versions you moved out of Saves.';
        } else if (offeringPane === 'archived') {
          bannerEl.textContent =
            'Each archived item is one academic year and semester for the whole campus. Sections and the timetable are filed together.';
        } else if (currentOffering) {
          bannerEl.innerHTML =
            'Current offering: <strong>' +
            escapeHtml(currentOffering.schoolYear) +
            '</strong> · <strong>' +
            escapeHtml(semesterLabel(currentOffering.termCode)) +
            '</strong> — every college and year level.';
        } else {
          bannerEl.textContent =
            'No current offering yet. Set the academic year and semester on the Sections page.';
        }
      }
      if (archiveBtn) archiveBtn.hidden = true;
      if (backArchivedBtn) {
        backArchivedBtn.hidden = !(
          (usesWorkspace && workspace === 'archives' && archivedPick) ||
          (!usesWorkspace && offeringPane === 'archived' && archivedPick)
        );
      }
      syncGenerateChrome();
    }

    function syncTermFilterChrome() {
      var yearField = yearEl && yearEl.closest ? yearEl.closest('.sched-field') : null;
      var semField = semEl && semEl.closest ? semEl.closest('.sched-field') : null;
      var termUsable = !!(yearEl && semEl) && (!yearEl.disabled || !semEl.disabled);
      if (yearField) yearField.hidden = !termUsable;
      if (semField) semField.hidden = !termUsable;
      var form = yearEl && yearEl.closest ? yearEl.closest('.sched-form') : null;
      if (!form) return;
      form.hidden = !termUsable;
    }

    function setOfferingPane(next) {
      offeringPane = next === 'archived' ? 'archived' : 'active';
      archivedPick = null;
      selectedVersion = '';
      classes = [];
      fillYears();
      showView(primaryView, layout);
      loadSchedule();
    }

    function fillYears() {
      if (usesWorkspace && pageKind === 'report') {
        var terms = reportTerms.length ? reportTerms : ((ws().reportTerms) || []);
        var years = [];
        terms.forEach(function (t) {
          if (t.schoolYear && years.indexOf(t.schoolYear) < 0) years.push(t.schoolYear);
        });
        if (!years.length && currentOffering) years.push(currentOffering.schoolYear);
        var keepYear = reportYear || yearEl.value || (currentOffering && currentOffering.schoolYear) || '';
        yearEl.innerHTML = '';
        if (!years.length) {
          yearEl.appendChild(new Option('No published terms yet', ''));
          yearEl.value = '';
          yearEl.disabled = true;
        } else {
          years.forEach(function (y) {
            yearEl.appendChild(new Option(y, y));
          });
          yearEl.value = years.indexOf(keepYear) >= 0 ? keepYear : years[0];
          yearEl.disabled = years.length <= 1;
        }
        reportYear = yearEl.value;
        var semsForYear = terms.filter(function (t) {
          return t.schoolYear === reportYear;
        });
        semEl.innerHTML = '';
        ['1', '2', 'summer'].forEach(function (code) {
          var hit = semsForYear.some(function (t) {
            return t.termCode === code;
          });
          if (!hit && currentOffering && currentOffering.schoolYear === reportYear && currentOffering.termCode === code) {
            hit = true;
          }
          if (hit) semEl.appendChild(new Option(semesterLabel(code), code));
        });
        if (!semEl.options.length) {
          semEl.appendChild(new Option('1st semester', '1'));
        }
        var keepSem = reportSem || semEl.value || (currentOffering && currentOffering.termCode) || '1';
        if (Array.prototype.some.call(semEl.options, function (o) { return o.value === keepSem; })) {
          semEl.value = keepSem;
        } else {
          semEl.selectedIndex = 0;
        }
        semEl.disabled = semEl.options.length <= 1;
        reportSem = semEl.value;
        syncTermFilterChrome();
        return;
      }
      var label = '';
      var code = '';
      if (offeringPane === 'archived' && archivedPick) {
        label = archivedPick.schoolYear;
        code = archivedPick.termCode;
      } else if (currentOffering) {
        label = currentOffering.schoolYear;
        code = currentOffering.termCode;
      }
      yearEl.innerHTML = '';
      if (label) {
        yearEl.appendChild(new Option(label, label));
        yearEl.value = label;
      } else {
        yearEl.appendChild(new Option('No current offering', ''));
        yearEl.value = '';
      }
      yearEl.disabled = true;
      if (code) semEl.value = code;
      semEl.disabled = true;
      syncTermFilterChrome();
    }

    function fillColleges() {
      if (!colEl || !global.OrgStore) return;
      var keep = colEl.value;
      var scoped = scopedColleges();
      var list = scoped.length ? scoped : global.OrgStore.colleges();
      colEl.innerHTML = '';
      if (!scoped.length) colEl.appendChild(new Option('All colleges', ''));
      list.forEach(function (c) {
        colEl.appendChild(new Option(c.name, c.id));
      });
      if (scoped.length === 1) colEl.value = scoped[0].id;
      else if (keep) colEl.value = keep;
      colEl.disabled = scoped.length === 1;
      fillDepartments();
    }

    function fillDepartments() {
      if (!depEl) return;
      var collegeId = colEl ? colEl.value : '';
      var scoped = scopedDepartments();
      var list = listedPrograms();
      if (depWrap) depWrap.hidden = !list.length;
      fillSelectKeep(
        depEl,
        [{ value: '', label: 'All programs' }].concat(
          list.map(function (p) {
            var label =
              collegeId || p.representsCollege ? p.departmentName || p.collegeName : p.label;
            return { value: programFilterValue(p), label: label };
          })
        )
      );
      if (scoped.length === 1) {
        depEl.value = scoped[0].id;
        depEl.disabled = true;
      } else {
        depEl.disabled = false;
      }
    }

    function selectedProgramFilter() {
      if (!depEl || (depWrap && depWrap.hidden)) return '';
      return depEl.value || '';
    }

    function generateCollegeId() {
      var collegeId = colEl ? colEl.value : '';
      var prog = selectedProgramFilter();
      if (prog.indexOf('college:') === 0) return collegeId || prog.slice(8);
      if (collegeId || !prog || !global.OrgStore || typeof global.OrgStore.programs !== 'function') {
        return collegeId;
      }
      var hit = null;
      global.OrgStore.programs().some(function (p) {
        if (p.departmentId === prog) {
          hit = p;
          return true;
        }
        return false;
      });
      return hit ? hit.collegeId : collegeId;
    }

    function generateDepartmentId() {
      var prog = selectedProgramFilter();
      if (!prog || prog.indexOf('college:') === 0) return '';
      return prog;
    }

    function setStatus(text, tone) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.className = 'sched-status' + (tone ? ' sched-status--' + tone : '');
    }

    function setWorkspace(next, skipLoad) {
      var allowed = allowedWorkspaces();
      workspace = allowed.indexOf(next) >= 0 ? next : allowed[0];
      archivedPick = workspace === 'archives' ? archivedPick : null;
      if (usesWorkspace) {
        offeringPane = workspace === 'archives' ? 'archived' : 'active';
        if (workspace !== 'archives') archivedPick = null;
      }
      writeWorkspaceUrl();
      syncWorkspaceTabs();
      fillYears();
      showView(primaryView, layout);
      if (!skipLoad) loadSchedule();
    }

    function syncWorkspaceTabs() {
      document.querySelectorAll('[data-ws-tab]').forEach(function (btn) {
        var id = btn.getAttribute('data-ws-tab');
        btn.classList.toggle('active', id === workspace);
      });
      var titleEl = qs('schedPageTitle');
      var subEl = qs('schedPageSub');
      if (titleEl) titleEl.textContent = workspaceTitle();
      if (subEl) subEl.textContent = workspaceSubtitle();
    }

    function workspaceTitle() {
      if (pageKind === 'report') {
        return workspace === 'awaiting' ? 'Awaiting the VPAA’s approval' : 'Final report';
      }
      return (
        {
          mine: 'My schedule',
          submitted: actor === 'super_admin' ? 'Admin’s submitted schedule' : 'Submitted to Super Admin for Approval',
          saves: 'Saves',
          archives: 'Archives'
        }[workspace] || 'Create schedule'
      );
    }

    function workspaceSubtitle() {
      if (pageKind === 'report') {
        if (actor === 'vpaa') {
          return workspace === 'awaiting'
            ? 'Super Admin sent this copy. Publish it so deans and program chairs can see it, or send it back with a note.'
            : 'This is the timetable after you approve it. Copies waiting for your decision live on the other tab. Filters only change what you see.';
        }
        return workspace === 'awaiting'
          ? 'This copy was approved by Super Admin and is waiting for the VPAA. It cannot be edited here.'
          : 'This is the timetable after the VPAA approves it. Filters only change what you see.';
      }
      return (
        {
          mine: 'This is your working timetable. Named copies go on Saves; share a save if the other registrar should see it. Lunch is 12:00pm–1:00pm.',
          submitted:
            actor === 'super_admin'
              ? 'Read-only copy from Admin. Approve it to send it to the VPAA, or send it back with a note.'
              : 'Read-only copy waiting for Super Admin. Retract it if you need to submit a different version.',
          saves: 'Named versions of this term. Opening one replaces My schedule.',
          archives: 'Past academic years and semesters, plus named versions moved out of Saves. Archive a VPAA-published term from Reports → Final report.'
        }[workspace] || ''
      );
    }

    function applyPayload(res) {
      publication = res.publication || null;
      if (res.version) selectedVersion = res.version;
      classes = (res.classes || []).filter(matchesScope);
      rooms = res.rooms || [];
      roomLabelById = {};
      rooms.forEach(function (r) {
        if (!r || !r.id) return;
        roomLabelById[r.id] = r.label || r.code || '';
      });
      var off = res.offering || {};
      currentOffering = off.current || null;
      archivedOfferings = off.archived || [];
      offeringMeta = {
        canArchive: !!off.canArchive,
        canUnarchive: !!off.canUnarchive,
        viewingLive: off.viewingLive !== false
      };
      if (res.workspace) {
        workspaceState = res.workspace;
        if (res.workspace.id && allowedWorkspaces().indexOf(res.workspace.id) >= 0) {
          workspace = res.workspace.id;
        }
        if (res.workspace.reportTerms) reportTerms = res.workspace.reportTerms;
      }
      if (res.reportTerms) reportTerms = res.reportTerms;
      if (res.generatorSettings) {
        generatorSettings = normalizeGenSettings(res.generatorSettings);
        fillGenSettingsForm();
      }
      fillRoomTableFilters();
      fillClassCollegeFilter();
      fillClassBuildingFilter();
      syncPublicationUi();
      syncWorkspaceUi();
      syncOfferingChrome();
    }

    function fillClassCollegeFilter() {
      if (!classCollegeEl) return;
      var seen = {};
      var scoped = scopedColleges();
      var opts = scoped.length ? [] : [{ value: '', label: 'All colleges' }];
      (scoped.length ? scoped : global.OrgStore ? global.OrgStore.colleges() : []).forEach(function (c) {
        seen[c.id] = true;
        opts.push({ value: c.id, label: c.name });
      });
      classes.forEach(function (c) {
        if (!c.collegeId || seen[c.collegeId]) return;
        seen[c.collegeId] = true;
        opts.push({ value: c.collegeId, label: c.collegeName || c.collegeId });
      });
      fillSelectKeep(classCollegeEl, opts);
      if (scoped.length === 1) classCollegeEl.value = scoped[0].id;
      classCollegeEl.disabled = scoped.length === 1;
    }

    function fillClassBuildingFilter() {
      if (!classBuildingEl) return;
      var seen = {};
      var opts = [{ value: '', label: 'All buildings' }];
      roomsByBuilding().forEach(function (b) {
        seen[b.id] = true;
        opts.push({ value: b.id, label: b.name });
      });
      classes.forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if (!m.buildingId || seen[m.buildingId]) return;
          seen[m.buildingId] = true;
          opts.push({ value: m.buildingId, label: m.buildingName || m.buildingId });
        });
      });
      opts.push({ value: 'off', label: 'Off-campus' });
      fillSelectKeep(classBuildingEl, opts);
    }


    function fillSelectKeep(sel, options, selected) {
      if (!sel) return;
      var keep = selected != null ? String(selected) : sel.value;
      sel.innerHTML = '';
      options.forEach(function (o) {
        sel.appendChild(new Option(o.label, o.value));
      });
      if (keep && Array.prototype.some.call(sel.options, function (o) { return o.value === keep; })) {
        sel.value = keep;
      } else if (sel.options.length) {
        sel.selectedIndex = 0;
      }
    }

    function fillRoomTableFilters() {
      var buildings = roomsByBuilding();
      fillSelectKeep(
        roomBuildingEl,
        [{ value: '', label: 'All buildings' }].concat(
          buildings.map(function (b) {
            return { value: b.id, label: b.name };
          })
        )
      );
      var types = {};
      rooms.forEach(function (r) {
        if (r.typeName) types[r.typeName] = true;
      });
      fillSelectKeep(
        roomTypeEl,
        [{ value: '', label: 'All room types' }].concat(
          Object.keys(types)
            .sort()
            .map(function (t) {
              return { value: t, label: t };
            })
        )
      );
      fillRoomFloorFilter();
    }

    function fillRoomFloorFilter() {
      var buildingId = roomBuildingEl ? roomBuildingEl.value : '';
      var floors = {};
      var hasNone = false;
      rooms.forEach(function (r) {
        if (buildingId && r.buildingId !== buildingId) return;
        if (r.floorNumber == null) hasNone = true;
        else floors[r.floorNumber] = true;
      });
      var opts = [{ value: '', label: 'All floors' }].concat(
        Object.keys(floors)
          .map(function (n) {
            return parseInt(n, 10);
          })
          .sort(function (a, b) {
            return a - b;
          })
          .map(function (n) {
            return { value: String(n), label: 'Floor ' + n };
          })
      );
      if (hasNone) opts.push({ value: 'none', label: 'No floor' });
      fillSelectKeep(roomFloorEl, opts);
    }

    function filteredTableRooms() {
      var buildingId = roomBuildingEl ? roomBuildingEl.value : '';
      var floorVal = roomFloorEl ? roomFloorEl.value : '';
      var typeVal = roomTypeEl ? roomTypeEl.value : '';
      return rooms
        .filter(function (r) {
          if (buildingId && r.buildingId !== buildingId) return false;
          if (typeVal && r.typeName !== typeVal) return false;
          if (floorVal === 'none') return r.floorNumber == null;
          if (floorVal !== '' && String(r.floorNumber) !== floorVal) return false;
          return true;
        })
        .slice()
        .sort(function (a, b) {
          return (
            String(a.buildingName || '').localeCompare(String(b.buildingName || '')) ||
            (a.floorNumber || 0) - (b.floorNumber || 0) ||
            String(a.code || '').localeCompare(String(b.code || ''))
          );
        });
    }

    function loadSchedule() {
      fillYears();
      syncWorkspaceTabs();
      if (!global.McuApi) {
        syncOfferingChrome();
        syncWorkspaceUi();
        return Promise.resolve();
      }
      var q = 'schedule.php?actor=' + encodeURIComponent(actor || 'admin');
      if (usesWorkspace) {
        q += '&page=' + encodeURIComponent(pageKind);
        q += '&workspace=' + encodeURIComponent(workspace);
      }
      if ((offeringPane === 'archived' && archivedPick) || (usesWorkspace && workspace === 'archives' && archivedPick)) {
        q +=
          '&year=' +
          encodeURIComponent(archivedPick.schoolYear) +
          '&sem=' +
          encodeURIComponent(archivedPick.termCode);
      } else if (usesWorkspace && pageKind === 'report' && yearEl.value) {
        q += '&year=' + encodeURIComponent(yearEl.value) + '&sem=' + encodeURIComponent(semEl.value);
      } else {
        q += '&live=1';
      }
      if (selectedVersion && !usesWorkspace) q += '&version=' + encodeURIComponent(selectedVersion);
      return global.McuApi.get(q)
        .then(function (res) {
          applyPayload(res);
          fillYears();
          if ((offeringPane === 'archived' && !archivedPick) || (usesWorkspace && workspace === 'archives' && !archivedPick) || (usesWorkspace && workspace === 'saves')) {
            setStatus('', '');
            render();
            return;
          }
          var s = res.summary || {};
          if (!classes.length) {
            setStatus(emptyScheduleText(false), 'muted');
          } else {
            var ver = usesWorkspace ? ' · ' + workspaceTitle() : selectedVersion ? ' · ' + versionLabel(selectedVersion) : '';
            setStatus(
              s.scheduled +
                ' of ' +
                s.offerings +
                ' classes placed for ' +
                yearEl.value +
                ' ' +
                semesterLabel(semEl.value) +
                ver +
                (s.unscheduled ? ' · ' + s.unscheduled + ' still unscheduled' : ''),
              s.unscheduled ? 'warn' : 'ok'
            );
          }
          render();
        })
        .catch(function (err) {
          setStatus(err.message || String(err), 'bad');
        });
    }

    function canReviewPackage() {
      var pub = publication || {};
      if (pub.canApprove || pub.canReject) return true;
      if (actor === 'super_admin' && pub.status === 'pending_super_admin') return true;
      if (actor === 'vpaa' && pub.status === 'pending_vpaa') return true;
      return false;
    }

    function canSendLivePackage() {
      var pub = publication || {};
      if (actor !== 'super_admin' || !pub.canSendLive) return false;
      if (offeringPane === 'archived') return false;
      if (pub.status === 'pending_super_admin' && !pub.workingDiffersFromSubmitted) return false;
      return true;
    }

    function syncPublicationUi() {
      var bar = qs('schedVersionBar');
      var banner = qs('schedReviewBanner');
      var readyBtn = qs('schedReady');
      var approveBtn = qs('schedApprove');
      var rejectBtn = qs('schedReject');
      var sendLiveBtn = qs('schedSendLive');
      var pub = publication || { versions: [], canReady: false, canApprove: false, canReject: false };
      if (usesWorkspace) {
        if (bar) bar.hidden = true;
        if (banner) banner.hidden = true;
        if (readyBtn) readyBtn.hidden = true;
        if (approveBtn) approveBtn.hidden = true;
        if (rejectBtn) rejectBtn.hidden = true;
        if (sendLiveBtn) sendLiveBtn.hidden = true;
        return;
      }
      if (bar) {
        bar.innerHTML = '';
        var versions = pub.versions || [];
        bar.hidden = versions.length < 2;
        versions.forEach(function (code) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sched-version' + (code === selectedVersion ? ' is-active' : '');
          btn.setAttribute('data-sched-version', code);
          btn.textContent = versionLabel(code);
          btn.addEventListener('click', function () {
            selectedVersion = code;
            loadSchedule();
          });
          bar.appendChild(btn);
        });
      }
      if (banner) {
        var bits = [];
        var vers = pub.versions || [];
        if (actor === 'vpaa') {
          if (pub.lastReject && pub.lastReject.from === 'vpaa' && vers.indexOf('pendingVpaa') < 0) {
            bits.push('You sent this term back to Super Admin.');
          }
          if (vers.indexOf('pendingVpaa') < 0 && vers.indexOf('published') < 0) {
            bits.push(
              'Database is connected. There is no package for you to review until Super Admin sends a campus timetable.'
            );
          } else if (pub.status === 'pending_vpaa') {
            bits.push('This package was sent by Super Admin. Approve it to publish, or send it back to Super Admin.');
          }
        } else if (actor === 'dean' || actor === 'program_chair') {
          if (!vers.length) {
            bits.push(
              'Database is connected. This role only sees a timetable after the VPAA publishes it.'
            );
          }
        } else if (actor !== 'dean' && actor !== 'program_chair') {
          if (pub.lastReject && pub.lastReject.note && actor === 'super_admin') {
            var who = pub.lastReject.from === 'vpaa' ? 'The VPAA' : 'Super Admin';
            bits.push(
              '<strong>' +
                who +
                ' sent this term back.</strong> ' +
                escapeHtml(pub.lastReject.note)
            );
          } else if (pub.lastReject && pub.lastReject.note && actor === 'admin' && !pub.returnedFromVpaa) {
            bits.push(
              '<strong>' +
                (pub.lastReject.from === 'vpaa' ? 'The VPAA' : 'Super Admin') +
                ' sent this term back.</strong> ' +
                escapeHtml(pub.lastReject.note)
            );
          }
          if (pub.workingDiffersFromSubmitted && actor === 'admin') {
            bits.push('Create schedule has changed since this package was sent to Super Admin. Submit again to replace it.');
          } else if (pub.workingDiffersFromSubmitted && actor === 'super_admin') {
            bits.push(
              pub.returnedFromVpaa
                ? 'The live timetable has changed since this package was sent to the VPAA. Use the version tabs to compare, then send the returned package, send the live copy, or send it back to Admin' +
                  (readOnly ? '.' : ' from Final report.')
                : 'The live timetable has changed since Admin submitted. Use the version tabs to compare, then send Admin’s snapshot or the live copy' +
                  (readOnly ? '.' : ' from Final report.')
            );
          }
          if (pub.status === 'pending_super_admin') {
            if (actor === 'super_admin') {
              if (pub.returnedFromVpaa) {
                if (!pub.workingDiffersFromSubmitted) {
                  bits.push(
                    'Send this package back to Admin for changes, or send a timetable to the VPAA again.'
                  );
                }
              } else if (!pub.workingDiffersFromSubmitted) {
                bits.push(
                  'Admin submitted this campus timetable. Approve it to send it to the VPAA, or send it back to Admin with a note.'
                );
              }
            } else {
              bits.push('This campus timetable is waiting for Super Admin.');
            }
          } else if (pub.status === 'pending_vpaa') {
            bits.push('Super Admin sent this package. It is waiting for the VPAA.');
          } else if (pub.status === 'published' && actor !== 'vpaa') {
            bits.push('The VPAA has published this term. Deans and program chairs can see that approved copy.');
          }
          if (actor === 'super_admin' && canSendLivePackage() && pub.status !== 'pending_super_admin') {
            bits.push(
              readOnly
                ? 'You can send the live timetable to the VPAA without waiting for Admin to submit.'
                : 'You can send the live timetable to the VPAA from Final report without waiting for Admin to submit.'
            );
          }
        }
        banner.innerHTML = bits.join('<br />');
        banner.hidden = !bits.length;
      }
      if (readyBtn) {
        readyBtn.hidden = !(actor === 'admin' && pub.canReady);
        readyBtn.disabled = readyBtn.hidden;
      }
      if (approveBtn) {
        approveBtn.hidden = !canReviewPackage();
        approveBtn.disabled = approveBtn.hidden;
        if (actor === 'super_admin' && !approveBtn.hidden) {
          if (pub.returnedFromVpaa) {
            approveBtn.textContent = pub.workingDiffersFromSubmitted
              ? 'Send returned package to VPAA'
              : 'Send to VPAA again';
          } else {
            approveBtn.textContent = pub.workingDiffersFromSubmitted
              ? 'Send Admin’s snapshot to VPAA'
              : 'Approve and send to VPAA';
          }
        }
      }
      var sendLiveBtn = qs('schedSendLive');
      if (sendLiveBtn) {
        sendLiveBtn.hidden = !canSendLivePackage();
        sendLiveBtn.disabled = sendLiveBtn.hidden;
      }
      if (rejectBtn) {
        rejectBtn.hidden = !canReviewPackage();
        rejectBtn.disabled = rejectBtn.hidden;
        if (actor === 'super_admin' && !rejectBtn.hidden) {
          rejectBtn.textContent = 'Send back to Admin';
        }
      }
    }

    function formatStamp(value) {
      if (!value) return '';
      var d = new Date(String(value).replace(' ', 'T'));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    function addActionButton(parent, label, className, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className || 'sched-btn';
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      parent.appendChild(btn);
      return btn;
    }

    function summaryLine(summary) {
      var s = summary || {};
      if (!s.offerings) return 'Empty timetable';
      return (s.scheduled || 0) + ' of ' + s.offerings + ' classes placed';
    }

    function renderSaveCards(list, kind, opts) {
      opts = opts || {};
      var wrap = document.createElement('div');
      wrap.className = 'sched-saves-grid';
      if (!list || !list.length) {
        var empty = document.createElement('p');
        empty.className = 'sched-empty-panel';
        empty.textContent =
          kind === 'archived_save'
            ? 'No named versions have been moved to Archives for this term.'
            : opts.shared
              ? 'No saves have been shared with you yet.'
              : 'No named saves yet. Use Save as on My schedule.';
        wrap.appendChild(empty);
        return wrap;
      }
      list.forEach(function (item) {
        var card = document.createElement('div');
        card.className = 'sched-save-card';
        var text = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'sched-save-card__title';
        title.textContent = item.title || 'Untitled save';
        var meta = document.createElement('div');
        meta.className = 'sched-save-card__meta';
        var bits = [summaryLine(item.summary)];
        if (item.updatedAt) bits.push(formatStamp(item.updatedAt));
        if (opts.shared) bits.push('From ' + (item.ownerLabel || 'the other registrar'));
        else if (item.isShared) bits.push('Shared with ' + (actor === 'super_admin' ? 'Admin' : 'Super Admin'));
        meta.textContent = bits.join(' · ');
        text.appendChild(title);
        text.appendChild(meta);
        var actions = document.createElement('div');
        actions.className = 'sched-save-card__actions';
        addActionButton(actions, 'Open…', 'sched-btn', function () {
          openSavePicker(item.id, item.title);
        });
        if (kind !== 'archived_save' && item.canManage) {
          addActionButton(
            actions,
            item.isShared ? 'Stop sharing' : 'Share with ' + (actor === 'super_admin' ? 'Admin' : 'Super Admin'),
            'sched-btn sched-btn--ghost',
            function () {
              var sharing = !item.isShared;
              askConfirm({
                title: sharing ? 'Share this save?' : 'Stop sharing?',
                message: sharing
                  ? 'The other registrar will see “' + (item.title || 'Untitled save') + '” on Saves and can open it.'
                  : '“' + (item.title || 'Untitled save') + '” will leave the other registrar’s Saves list.',
                yes: sharing ? 'Share' : 'Stop sharing',
                no: 'Cancel'
              }).then(function (ok) {
                if (ok) runPublication('share_save', { saveId: item.id, share: sharing });
              });
            }
          );
          addActionButton(actions, 'Move to Archives', 'sched-btn sched-btn--archive', function () {
            askConfirm({
              title: 'Move this save to Archives?',
              message: '“' + (item.title || 'Untitled save') + '” will leave Saves and appear on Archives.',
              yes: 'Move to Archives',
              no: 'Cancel',
              yesClass: 'sched-btn--archive'
            }).then(function (ok) {
              if (ok) runPublication('archive_save', { saveId: item.id });
            });
          });
        }
        if (item.canManage !== false) {
          addActionButton(actions, 'Delete', 'sched-btn sched-btn--danger', function () {
            askConfirm({
              title: 'Delete this save?',
              message: 'Delete “' + (item.title || 'Untitled save') + '”? This cannot be undone.',
              yes: 'Delete',
              no: 'Cancel',
              yesClass: 'sched-btn--danger'
            }).then(function (ok) {
              if (ok) runPublication('delete_save', { saveId: item.id });
            });
          });
        }
        card.appendChild(text);
        card.appendChild(actions);
        wrap.appendChild(card);
      });
      return wrap;
    }

    function syncWorkspaceUi() {
      syncWorkspaceTabs();
      writeWorkspaceUrl();
      if (workspaceHint) {
        var st = ws();
        var banner = st.tabStatus || {};
        if (banner.label) {
          workspaceHint.className = 'sched-status-banner' + (banner.tone ? ' is-' + banner.tone : '');
          workspaceHint.innerHTML = '<strong>' + escapeHtml(banner.label) + '</strong>' +
            (banner.detail ? ' — ' + escapeHtml(banner.detail) : '');
        } else {
          workspaceHint.className = 'sched-workspace-hint';
          workspaceHint.textContent = '';
        }
      }
      if (savesPanel) {
        var showSaves = usesWorkspace && (workspace === 'saves' || (workspace === 'archives' && !archivedPick));
        savesPanel.hidden = !showSaves;
        savesPanel.innerHTML = '';
        if (showSaves && workspace === 'saves') {
          var mineHead = document.createElement('h3');
          mineHead.className = 'sched-save-card__title';
          mineHead.textContent = 'My saves';
          savesPanel.appendChild(mineHead);
          savesPanel.appendChild(renderSaveCards(ws().saves || [], 'save'));
          var shareHead = document.createElement('h3');
          shareHead.className = 'sched-save-card__title';
          shareHead.textContent = 'Shared with you';
          savesPanel.appendChild(shareHead);
          savesPanel.appendChild(renderSaveCards(ws().sharedSaves || [], 'save', { shared: true }));
        } else if (showSaves && workspace === 'archives') {
          var archivedHeading = document.createElement('h3');
          archivedHeading.className = 'sched-save-card__title';
          archivedHeading.textContent = 'Filed drafts (not past official reports)';
          savesPanel.appendChild(archivedHeading);
          savesPanel.appendChild(renderSaveCards(ws().archivedSaves || [], 'archived_save'));
        }
      }
      if (workspaceActions) {
        workspaceActions.innerHTML = '';
        if (usesWorkspace && pageKind === 'create' && workspace === 'mine') {
          addActionButton(workspaceActions, 'Save as', 'sched-btn sched-btn--ghost', openSaveAsModal);
          addActionButton(workspaceActions, 'Clear schedule', 'sched-btn sched-btn--danger', clearActiveSchedule);
          if (actor === 'admin') {
            addActionButton(workspaceActions, 'Submit to Super Admin for Approval', 'sched-btn sched-btn--ghost', function () {
              submitCurrentToSuperAdmin();
            });
          }
          if (actor === 'super_admin') {
            addActionButton(workspaceActions, 'Submit to the VPAA', 'sched-btn sched-btn--ghost', function () {
              submitCurrentToVpaa();
            });
          }
        }
        if (usesWorkspace && pageKind === 'report' && workspace === 'final' && ws().canArchivePublished) {
          addActionButton(workspaceActions, 'Archive this offering', 'sched-btn sched-btn--archive', archivePublishedOffering);
        }
        if (usesWorkspace && workspace === 'submitted' && actor === 'admin' && ws().canRetractSubmitted) {
          addActionButton(workspaceActions, 'Retract submission', 'sched-btn sched-btn--ghost', function () {
            askConfirm({
              title: 'Retract this submission?',
              message: 'Super Admin will no longer see this pending copy. My schedule stays as it is.',
              yes: 'Retract',
              no: 'Cancel'
            }).then(function (ok) {
              if (ok) runPublication('retract_admin_submission');
            });
          });
        }
        if (usesWorkspace && workspace === 'submitted' && actor === 'super_admin' && ws().canApproveAdminSubmit) {
          addActionButton(workspaceActions, 'Approve and send to VPAA', 'sched-btn', function () {
            var incomplete = vpaaIncompleteMessage();
            if (incomplete) {
              setStatus(incomplete, 'bad');
              return;
            }
            if (ws().hasVpaaPending) {
              setStatus(
                'A timetable is already waiting for the VPAA. Retract that copy on Reports first if you want to send a different one.',
                'bad'
              );
              return;
            }
            askConfirm({
              title: 'Send Admin’s submission to the VPAA?',
              message: 'This copy will appear on Reports → Awaiting the VPAA’s approval. Admin will still see this snapshot here until the VPAA decides.',
              yes: 'Send to VPAA',
              no: 'Cancel'
            }).then(function (ok) {
              if (ok) runPublication('approve_admin_submission');
            });
          });
          addActionButton(workspaceActions, 'Send back to Admin', 'sched-btn sched-btn--danger', openRejectModal);
        }
        if (usesWorkspace && workspace === 'submitted' && actor === 'super_admin' && ws().canOpenReturned) {
          addActionButton(workspaceActions, 'Open in My schedule', 'sched-btn', function () {
            askConfirm({
              title: 'Replace My schedule?',
              message: 'This loads the VPAA-returned copy into My schedule and overwrites whatever is there now.',
              yes: 'Open in My schedule',
              no: 'Cancel'
            }).then(function (ok) {
              if (ok) runPublication('open_returned', { target: 'mine' });
            });
          });
        }
        if (usesWorkspace && workspace === 'submitted' && actor === 'super_admin' && ws().canSendReturnedToAdmin) {
          addActionButton(workspaceActions, 'Send back to Admin', 'sched-btn sched-btn--danger', openRejectModal);
        }
        if (usesWorkspace && workspace === 'awaiting' && actor === 'vpaa' && ws().canDecideVpaa) {
          addActionButton(workspaceActions, 'Publish timetable', 'sched-btn', function () {
            publishVpaaPackage();
          });
          addActionButton(workspaceActions, 'Send back', 'sched-btn sched-btn--danger', openRejectModal);
        }
        if (usesWorkspace && workspace === 'awaiting' && actor === 'super_admin' && ws().canRetractAwaiting) {
          addActionButton(workspaceActions, 'Retract from the VPAA', 'sched-btn sched-btn--ghost', function () {
            askConfirm({
              title: 'Retract this copy?',
              message: 'The VPAA will no longer see this pending timetable. You can submit a different copy from Create schedule.',
              yes: 'Retract',
              no: 'Cancel'
            }).then(function (ok) {
              if (ok) runPublication('retract_vpaa_pending');
            });
          });
        }
        if (!workspaceActions.classList.contains('sched-actions-slot')) {
          workspaceActions.hidden = !workspaceActions.childNodes.length;
        }
      }
      syncSectionFilters();
      syncTermFilterChrome();
    }

    function archivePublishedOffering() {
      if (!ws().canArchivePublished) {
        setStatus(
          'Archive only a VPAA-published timetable on Final report, and only while that term is still the live offering.',
          'bad'
        );
        return;
      }
      askConfirm({
        title: 'Archive this published term?',
        message:
          'Archive ' +
          offeringTitle(yearEl.value, semEl.value) +
          '? This closes the live offering. The VPAA-published timetable stays on Final report. Sections for this academic year and semester are filed with it. Create schedule will be empty until you start a new offering on the Sections page.',
        yes: 'Archive',
        no: 'Cancel',
        yesClass: 'sched-btn--archive'
      }).then(function (ok) {
        if (!ok) return;
        runPublication('archive_published_offering');
      });
    }

    function publishVpaaPackage() {
      if (!ws().canDecideVpaa) {
        setStatus('There is no timetable waiting for your approval.', 'bad');
        return;
      }
      askConfirm({
        title: 'Publish this timetable?',
        message: 'Deans and program chairs will see this copy. Super Admin and Admin will see it on Final report.',
        yes: 'Publish timetable',
        no: 'Cancel'
      }).then(function (ok) {
        if (!ok) return;
        runPublication('vpaa_decide', { accept: true });
      });
    }

    function submitCurrentToSuperAdmin() {
      if (ws().hasAdminSubmitted) {
        setStatus(
          ws().adminSubmittedForwarded || ws().hasVpaaPending
            ? 'A copy of this term is still with Super Admin or the VPAA. Wait for that decision, or ask Super Admin to send it back, before submitting another.'
            : 'A timetable is already waiting for Super Admin. Retract that submission first if you want to send a different copy.',
          'bad'
        );
        return;
      }
      askConfirm({
        title: 'Submit to Super Admin?',
        message:
          'A copy of My schedule will appear on Submitted to Super Admin for Approval. This tab stays as it is.',
        yes: 'Submit',
        no: 'Cancel'
      }).then(function (ok) {
        if (!ok) return;
        runPublication('submit_to_super_admin', { from: 'mine' });
      });
    }

    function vpaaIncompleteMessage() {
      var unscheduled = 0;
      (classes || []).forEach(function (c) {
        if (!(c && classIsScheduled(c))) unscheduled++;
      });
      if (!classes.length) {
        return 'There are no classes to send. Generate a timetable and place every class before submitting it to the VPAA.';
      }
      if (!unscheduled) return '';
      if (unscheduled === 1) {
        return '1 class is still unscheduled. Place every class before submitting this timetable to the VPAA.';
      }
      return unscheduled + ' classes are still unscheduled. Place every class before submitting this timetable to the VPAA.';
    }

    function submitCurrentToVpaa() {
      var incomplete = vpaaIncompleteMessage();
      if (incomplete) {
        setStatus(incomplete, 'bad');
        return;
      }
      if (ws().hasVpaaPending) {
        setStatus(
          'A timetable is already waiting for the VPAA. Retract that copy on Reports first if you want to send a different one.',
          'bad'
        );
        return;
      }
      askConfirm({
        title: 'Submit to the VPAA?',
        message:
          'A copy of My schedule will appear on Reports → Awaiting the VPAA’s approval. This tab stays as it is.',
        yes: 'Submit to the VPAA',
        no: 'Cancel'
      }).then(function (ok) {
        if (!ok) return;
        runPublication('submit_to_vpaa', { from: 'mine' });
      });
    }

    function openSaveAsModal() {
      var modalEl = qs('schedSaveAsModal');
      var nameEl = qs('schedSaveAsName');
      var errEl = qs('schedSaveAsError');
      if (!modalEl) return;
      if (errEl) errEl.textContent = '';
      if (nameEl) nameEl.value = '';
      modalEl.hidden = false;
      if (nameEl) nameEl.focus();
    }

    function closeSaveAsModal() {
      var modalEl = qs('schedSaveAsModal');
      if (modalEl) modalEl.hidden = true;
    }

    function confirmSaveAs() {
      var nameEl = qs('schedSaveAsName');
      var errEl = qs('schedSaveAsError');
      var title = nameEl ? String(nameEl.value || '').trim() : '';
      if (!title) {
        if (errEl) errEl.textContent = 'Give this save a name.';
        return;
      }
      closeSaveAsModal();
      runPublication('save_as', { title: title, from: 'mine' });
    }

    function clearActiveSchedule() {
      askConfirm({
        title: 'Clear My schedule?',
        message:
          'This removes your working timetable from My schedule. Sections, named saves, submissions, and Reports copies stay as they are.',
        yes: 'Clear schedule',
        no: 'Cancel',
        yesClass: 'sched-btn--danger'
      }).then(function (ok) {
        if (!ok) return;
        runPublication('clear_schedule', { from: 'mine' });
      });
    }

    function openSavePicker(saveId, title) {
      pendingSaveId = saveId;
      askConfirm({
        title: 'Replace My schedule?',
        message:
          'Opening “' +
          (title || 'this save') +
          '” replaces the timetable currently in My schedule. Save as first if you still need it.',
        yes: 'Open in My schedule',
        no: 'Cancel'
      }).then(function (ok) {
        if (!ok) {
          pendingSaveId = '';
          return;
        }
        runPublication('open_save', { saveId: saveId, target: 'mine' });
        pendingSaveId = '';
      });
    }

    function closeOpenSaveModal() {
      var modalEl = qs('schedOpenSaveModal');
      if (modalEl) modalEl.hidden = true;
      pendingSaveId = '';
    }

    function openSaveInto() {
      var saveId = pendingSaveId;
      if (!saveId) return;
      closeOpenSaveModal();
      runPublication('open_save', { saveId: saveId, target: 'mine' });
    }

    function publicationBody(extra) {
      var body = {
        actor: actor,
        schoolYear: yearEl.value,
        termCode: semEl.value,
        year: yearEl.value,
        sem: semEl.value,
        workspace: workspace,
        page: pageKind,
        from: 'mine'
      };
      extra = extra || {};
      Object.keys(extra).forEach(function (k) {
        body[k] = extra[k];
      });
      return body;
    }

    function runPublication(action, extra) {
      if (!global.McuApi) return;
      setStatus('Saving…', 'muted');
      var body = publicationBody(extra);
      body.action = action;
      global.McuApi.send('POST', 'schedule.php', body)
        .then(function (res) {
          selectedVersion = res.version || '';
          applyPayload(res);
          var s = res.summary || {};
          if (usesWorkspace && (workspace === 'saves' || (workspace === 'archives' && !archivedPick))) {
            setStatus('', '');
          } else if (!classes.length) {
            setStatus(emptyScheduleText(false), 'muted');
          } else {
            setStatus(
              s.scheduled +
                ' of ' +
                s.offerings +
                ' classes · ' +
                (usesWorkspace ? workspaceTitle() : versionLabel(selectedVersion || 'working')),
              'ok'
            );
          }
          render();
        })
        .catch(function (err) {
          var msg = err && err.message ? String(err.message) : String(err);
          setStatus(msg, 'bad');
        });
    }

    function openRejectModal() {
      var modalEl = qs('schedRejectModal');
      var noteEl = qs('schedRejectNote');
      var hintEl = modalEl ? modalEl.querySelector('.sched-edit-hours') : null;
      var pub = publication || {};
      if (!modalEl) return;
      if (hintEl) {
        hintEl.textContent =
          actor === 'vpaa'
            ? 'Super Admin will see this note on Final report. If you already published an earlier copy, deans and program chairs keep that copy.'
            : 'The Admin will see this note on Final report. If the VPAA already published an earlier copy, deans and program chairs keep that copy.';
      }
      if (noteEl) {
        noteEl.value =
          actor === 'super_admin' && pub.returnedFromVpaa && pub.lastReject && pub.lastReject.note
            ? pub.lastReject.note
            : '';
      }
      modalEl.hidden = false;
      if (noteEl) noteEl.focus();
    }

    function closeRejectModal() {
      var modalEl = qs('schedRejectModal');
      if (modalEl) modalEl.hidden = true;
    }

    function membersOf(cls) {
      if (!cls) return [];
      if (!cls.mergedClassId) return [cls];
      return classes.filter(function (c) {
        return c.mergedClassId === cls.mergedClassId;
      });
    }

    function render() {
      syncGenerateChrome();
      renderRoomCrumb();
      if (primaryView === 'sections') renderSections();
      else if (primaryView === 'rooms') renderRooms();
      else renderClasses();
    }

    function classGroups() {
      var seen = {};
      var out = [];
      classes.forEach(function (c) {
        var key = c.mergedClassId || c.id;
        if (seen[key]) {
          seen[key].members.push(c);
          return;
        }
        seen[key] = {
          id: c.id,
          courseCode: c.courseCode,
          courseTitle: c.courseTitle,
          component: c.component,
          hoursPerWeek: c.hoursPerWeek,
          roomTypeName: c.roomTypeName || '',
          requiresCampusRoom: c.requiresCampusRoom !== false,
          meetings: c.meetings || [],
          status: c.status,
          notes: c.notes,
          merged: !!c.mergedClassId,
          members: [c]
        };
        out.push(seen[key]);
      });
      out.sort(function (a, b) {
        return (
          String(a.courseCode).localeCompare(String(b.courseCode)) ||
          String(a.component).localeCompare(String(b.component))
        );
      });
      return out;
    }

    function filteredClassGroups() {
      var q = classSearchEl ? String(classSearchEl.value || '').trim().toLowerCase() : '';
      var college = classCollegeEl ? classCollegeEl.value : '';
      var comp = classComponentEl ? classComponentEl.value : '';
      var status = classStatusEl ? classStatusEl.value : '';
      var yearLevel = classYearLevelEl ? classYearLevelEl.value : '';
      var building = classBuildingEl ? classBuildingEl.value : '';
      var merged = classMergedEl ? classMergedEl.value : '';
      return classGroups().filter(function (g) {
        if (q) {
          var hay = (g.courseCode + ' ' + g.courseTitle).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        if (comp && g.component !== comp) return false;
        if (status === 'scheduled' && !classIsScheduled(g)) return false;
        if (status === 'unscheduled' && classIsScheduled(g)) return false;
        if (merged === 'merged' && !g.merged) return false;
        if (merged === 'single' && g.merged) return false;
        if (college) {
          var collegeHit = g.members.some(function (m) {
            return m.collegeId === college;
          });
          if (!collegeHit) return false;
        }
        if (yearLevel) {
          var yearHit = g.members.some(function (m) {
            return String(m.yearLevel) === yearLevel;
          });
          if (!yearHit) return false;
        }
        if (building === 'off') {
          var onCampus = (g.meetings || []).some(function (m) {
            return m.roomId || m.buildingId;
          });
          if (onCampus) return false;
        } else if (building) {
          var buildingHit = (g.meetings || []).some(function (m) {
            return m.buildingId === building;
          });
          if (!buildingHit) return false;
        }
        return true;
      });
    }

    function roomById(id) {
      if (!id) return null;
      for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].id === id) return rooms[i];
      }
      return null;
    }

    function sameRoomType(a, b) {
      return String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() ===
        String(b || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function subjectNeedsCampusRoom(cls) {
      if (!cls) return true;
      if (cls.requiresCampusRoom === false) return false;
      var name = String(cls.roomTypeName || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (name === 'no room' || name === 'noroom' || name === 'off campus') return false;
      if (global.RoomTypes && cls.roomTypeName) {
        var t = global.RoomTypes.findByName(cls.roomTypeName);
        if (t && t.requiresCampusRoom === false) return false;
      }
      return true;
    }

    function assignedRoomTypeMismatch(cls, roomId) {
      if (!subjectNeedsCampusRoom(cls) || !roomId) return false;
      var room = roomById(roomId);
      if (!room || !room.typeName || !cls.roomTypeName) return false;
      return !sameRoomType(room.typeName, cls.roomTypeName);
    }

    function classTypeMismatch(cls) {
      if (!subjectNeedsCampusRoom(cls)) return false;
      return (cls.meetings || []).some(function (m) {
        return assignedRoomTypeMismatch(cls, m.roomId);
      });
    }

    function typeCellHtml(cls, roomId) {
      var label = cls.roomTypeName || '—';
      var mismatch = arguments.length > 1
        ? assignedRoomTypeMismatch(cls, roomId)
        : classTypeMismatch(cls);
      var extra = mismatch
        ? ' <span class="sched-badge sched-badge--warn">Mismatch</span>'
        : '';
      return (
        '<span class="sched-type-label" title="' +
        escapeHtml(label) +
        '">' +
        escapeHtml(label) +
        '</span>' +
        extra
      );
    }

    function roomTypeWarning(cls, roomId) {
      if (!cls) return '';
      var need = cls.roomTypeName || 'a campus';
      if (!subjectNeedsCampusRoom(cls)) {
        if (!roomId) return '';
        var used = roomById(roomId);
        return (
          'This subject is ' +
          (cls.roomTypeName || 'Off-campus') +
          ' and does not need a campus room. ' +
          ((used && (used.label || used.code)) || 'That room') +
          ' would still be booked.'
        );
      }
      if (!roomId) {
        return 'This subject needs a ' + need + ' room. You are saving it without a campus room.';
      }
      var room = roomById(roomId);
      if (!room || !room.typeName || sameRoomType(room.typeName, cls.roomTypeName)) return '';
      return (
        'This subject needs a ' +
        need +
        ' room. ' +
        (room.label || room.code) +
        ' is ' +
        room.typeName +
        '.'
      );
    }

    function roomsOccupied(meetings) {
      var seen = {};
      var labels = [];
      (meetings || []).forEach(function (m) {
        var label = meetingRoomLabel(m);
        if (!label || seen[label]) return;
        seen[label] = true;
        labels.push(label);
      });
      if (!meetings || !meetings.length) return '—';
      return labels.length ? labels.join('; ') : 'Off-campus';
    }

    function renderClasses() {
      if (!classView) return;
      classView.innerHTML = '';
      if (!classes.length) {
        classView.appendChild(emptyLine(emptyScheduleText(true)));
        return;
      }
      var groups = filteredClassGroups();
      if (!groups.length) {
        classView.appendChild(emptyLine('No classes match these filters.'));
        return;
      }
      var table = document.createElement('table');
      table.className = 'sched-table';
      table.innerHTML =
        '<colgroup>' +
        '<col class="sched-col-class-code">' +
        '<col class="sched-col-class-title">' +
        '<col class="sched-col-class-comp">' +
        '<col class="sched-col-class-type">' +
        '<col class="sched-col-class-hours">' +
        '<col class="sched-col-class-day">' +
        '<col class="sched-col-class-time">' +
        '<col class="sched-col-class-secs">' +
        '<col class="sched-col-class-students">' +
        '<col class="sched-col-class-rooms">' +
        actionsCol() +
        '</colgroup>' +
        '<thead><tr>' +
        '<th>Course Code</th><th>Subject Title</th><th>Component</th><th>Room type</th><th>Hours</th>' +
        '<th>Day</th><th>Time</th><th>Sections</th><th>Students</th><th>Room / building</th>' +
        actionsHead() +
        '</tr></thead>';
      var tb = document.createElement('tbody');
      groups.forEach(function (g) {
        var sectionText = g.members
          .map(function (m) {
            return sectionLabel(m.sectionName, m.studentCount, m);
          })
          .join('; ');
        var studentTotal = g.members.reduce(function (n, m) {
          return n + (Number(m.studentCount) || 0);
        }, 0);
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="sched-cell-nowrap">' +
          escapeHtml(g.courseCode) +
          '</td><td>' +
          escapeHtml(g.courseTitle) +
          (g.merged ? ' <span class="sched-badge">Merged</span>' : '') +
          '</td><td>' +
          escapeHtml(g.component) +
          '</td><td class="sched-cell-type">' +
          typeCellHtml(g) +
          '</td><td class="sched-cell-nowrap">' +
          g.hoursPerWeek +
          '</td>' +
          meetingColumnHtml(g.meetings, {
            room: false,
            note: g.status && g.status !== 'scheduled' ? g.status : ''
          }) +
          '<td>' +
          escapeHtml(sectionText) +
          '</td><td class="sched-cell-nowrap">' +
          studentTotal +
          '</td><td>' +
          escapeHtml(roomsOccupied(g.meetings)) +
          '</td>' +
          editCell(g.id);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      classView.appendChild(table);
    }









    function renderSections() {
      if (!sectionView) return;
      sectionView.innerHTML = '';
      if (!classes.length) {
        sectionView.appendChild(emptyLine(emptyScheduleText(false)));
        return;
      }
      var bySec = {};
      classes.forEach(function (c) {
        if (!matchesSectionFilters(c)) return;
        if (!bySec[c.sectionName]) bySec[c.sectionName] = [];
        bySec[c.sectionName].push(c);
      });
      if (!Object.keys(bySec).length) {
        sectionView.appendChild(emptyLine('No sections match these filters.'));
        return;
      }
      if (openSectionGrid && !sectionGridStillVisible(bySec, openSectionGrid)) {
        openSectionGrid = '';
        writeHash();
      }
      Object.keys(bySec)
        .sort()
        .forEach(function (name) {
          var rows = bySec[name];
          var shared = [];
          var parts = [];
          rows.forEach(function (c) {
            if (isPartitioned(c)) parts.push(c);
            else shared.push(c);
          });
          parts.sort(function (a, b) {
            var code = String(a.courseCode).localeCompare(String(b.courseCode));
            if (code) return code;
            var comp = String(a.component).localeCompare(String(b.component));
            if (comp) return comp;
            return (Number(a.partitionIndex) || 0) - (Number(b.partitionIndex) || 0);
          });
          var block = document.createElement('div');
          block.className = 'sched-block';
          var head = document.createElement('div');
          head.className = 'sched-block-head';
          var h = document.createElement('h3');
          var first = rows[0];
          var whole = 0;
          rows.forEach(function (c) {
            var n = Number(c.sectionStudentCount);
            if (isFinite(n) && n > whole) whole = n;
          });
          if (!whole) whole = Number(first && first.studentCount) || 0;
          h.textContent = sectionLabel(name, whole);
          if (first && first.isRetake) {
            var badge = document.createElement('span');
            badge.className = 'sched-badge';
            badge.textContent = 'Retake';
            h.appendChild(document.createTextNode(' '));
            h.appendChild(badge);
          }
          head.appendChild(h);
          if (shared.length) head.appendChild(sectionTimetableButton(name));
          block.appendChild(head);
          block.setAttribute('data-section-grid', name);
          if (shared.length) {
            block.appendChild(sectionSubjectTable(shared));
            if (openSectionGrid === name) appendSectionGrid(block, name, shared);
          }
          var groups = partitionGroups(parts);
          var sizeCounts = {};
          groups.forEach(function (group) {
            var sizeKey = group.part + '/' + group.whole;
            sizeCounts[sizeKey] = (sizeCounts[sizeKey] || 0) + 1;
          });
          var set = null;
          var setProfile = '';
          groups.forEach(function (group) {
            if (group.profile !== setProfile) {
              setProfile = group.profile;
              set = document.createElement('div');
              set.className = 'sched-partition-set';
              block.appendChild(set);
            }
            var slice = document.createElement('div');
            slice.className = 'sched-partition';
            var sliceHead = document.createElement('div');
            sliceHead.className = 'sched-block-head';
            var sliceTitle = document.createElement('h3');
            var sizeKey = group.part + '/' + group.whole;
            sliceTitle.textContent = partitionGroupHeading(group, sizeCounts[sizeKey] > 1);
            var sliceKey = partitionGroupKey(name, group);
            sliceHead.appendChild(sliceTitle);
            sliceHead.appendChild(sectionTimetableButton(sliceKey));
            slice.appendChild(sliceHead);
            slice.setAttribute('data-section-grid', sliceKey);
            slice.appendChild(sectionSubjectTable(group.rows));
            if (openSectionGrid === sliceKey) appendSectionGrid(slice, name, group.rows);
            set.appendChild(slice);
          });
          sectionView.appendChild(block);
        });
    }

    function sectionGridStillVisible(bySec, key) {
      if (String(key).indexOf('partition:') === 0) {
        return Object.keys(bySec).some(function (name) {
          return partitionGroups(
            bySec[name].filter(function (c) {
              return isPartitioned(c);
            })
          ).some(function (group) {
            return partitionGroupKey(name, group) === key;
          });
        });
      }
      return !!bySec[key];
    }

    function partitionStudentCount(c) {
      var n = Number(c.partitionStudents);
      if (!isFinite(n)) n = Number(c.studentCount) || 0;
      return n;
    }

    function partitionGroups(parts) {
      var subjects = {};
      (parts || []).forEach(function (c) {
        var key = String(c.courseCode) + '\0' + String(c.component || '');
        if (!subjects[key]) subjects[key] = [];
        subjects[key].push(c);
      });
      var profiles = {};
      Object.keys(subjects).forEach(function (key) {
        var slices = subjects[key].slice().sort(function (a, b) {
          var size = partitionStudentCount(a) - partitionStudentCount(b);
          if (size) return size;
          return (Number(a.partitionIndex) || 0) - (Number(b.partitionIndex) || 0);
        });
        var whole = Number(slices[0].sectionStudentCount);
        if (!isFinite(whole)) whole = 0;
        var profile =
          slices.length + ':' + whole + ':' + slices.map(partitionStudentCount).join(',');
        if (!profiles[profile]) profiles[profile] = [];
        profiles[profile].push(slices);
      });
      var groups = [];
      Object.keys(profiles)
        .sort(function (a, b) {
          var as = a.split(':').pop().split(',').map(Number);
          var bs = b.split(':').pop().split(',').map(Number);
          var n = Math.max(as.length, bs.length);
          for (var i = 0; i < n; i++) {
            var diff = (as[i] || 0) - (bs[i] || 0);
            if (diff) return diff;
          }
          return a.localeCompare(b);
        })
        .forEach(function (profile) {
          var subjectSlices = profiles[profile];
          var slotCount = subjectSlices[0].length;
          for (var i = 0; i < slotCount; i++) {
            var rows = subjectSlices.map(function (slices) {
              return slices[i];
            });
            groups.push({
              profile: profile,
              slot: i,
              rows: rows,
              part: partitionStudentCount(rows[0]),
              whole: Number(rows[0].sectionStudentCount) || partitionStudentCount(rows[0])
            });
          }
        });
      return groups;
    }

    function partitionGroupKey(sectionName, group) {
      return 'partition:' + sectionName + '\u0001' + group.profile + '\u0001' + group.slot;
    }

    function partitionGroupHeading(group, distinguish) {
      var text = group.part + ' of ' + group.whole + ' students';
      if (distinguish) text += ' · partition ' + (group.slot + 1);
      return text;
    }

    function sectionTimetableButton(gridKey) {
      var gridBtn = document.createElement('button');
      gridBtn.type = 'button';
      gridBtn.className = 'sched-link-btn';
      var open = openSectionGrid === gridKey;
      gridBtn.textContent = open ? 'Hide timetable' : 'Timetable';
      gridBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      gridBtn.addEventListener('click', function () {
        openSectionGrid = openSectionGrid === gridKey ? '' : gridKey;
        showView('sections');
        if (openSectionGrid) {
          var esc =
            global.CSS && CSS.escape
              ? CSS.escape(openSectionGrid)
              : openSectionGrid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          var el = sectionView.querySelector('[data-section-grid="' + esc + '"]');
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      return gridBtn;
    }

    function sectionSubjectTable(rows) {
      var table = document.createElement('table');
      table.className = 'sched-table';
      table.innerHTML =
        '<colgroup>' +
        '<col class="sched-col-code">' +
        '<col class="sched-col-title">' +
        '<col class="sched-col-component">' +
        '<col class="sched-col-type">' +
        '<col class="sched-col-hours">' +
        '<col class="sched-col-day">' +
        '<col class="sched-col-time">' +
        '<col class="sched-col-room">' +
        '<col class="sched-col-status">' +
        actionsCol() +
        '</colgroup>' +
        '<thead><tr><th>Course Code</th><th>Subject Title</th><th>Component</th><th>Room type</th><th>Hours</th><th>Day</th><th>Time</th><th>Room</th><th>Status</th>' +
        actionsHead() +
        '</tr></thead>';
      var tb = document.createElement('tbody');
      rows
        .slice()
        .sort(function (a, b) {
          return String(a.courseCode).localeCompare(String(b.courseCode));
        })
        .forEach(function (c) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td class="sched-cell-nowrap">' +
            escapeHtml(c.courseCode) +
            '</td><td>' +
            escapeHtml(c.courseTitle) +
            (c.mergedClassId ? ' <span class="sched-badge">Merged</span>' : '') +
            '</td><td>' +
            escapeHtml(c.component) +
            '</td><td class="sched-cell-type">' +
            typeCellHtml(c) +
            '</td><td class="sched-cell-nowrap">' +
            c.hoursPerWeek +
            '</td>' +
            meetingColumnHtml(c.meetings) +
            '<td>' +
            escapeHtml(c.status) +
            (c.notes ? ' — ' + escapeHtml(c.notes) : '') +
            '</td>' +
            sectionSubjectActions(c);
          tb.appendChild(tr);
        });
      table.appendChild(tb);
      return table;
    }

    function appendSectionGrid(host, name, rows) {
      var wrap = document.createElement('div');
      wrap.className = 'sched-section-grid';
      var blocks = [];
      var leftover = [];
      (rows || []).forEach(function (c) {
        if (!(c.meetings || []).length) leftover.push(c);
        (c.meetings || []).forEach(function (m) {
          blocks.push({
            class: c,
            meeting: m,
            sections: [sectionLabel(c.sectionName, c.studentCount, c)],
            studentCount: Number(c.studentCount) || 0
          });
        });
      });
      wrap.appendChild(
        buildWeeklyGrid(blocks, gridEditOpts('No placed meetings for this section.'))
      );
      if (leftover.length) {
        var p = document.createElement('p');
        p.className = 'sched-unscheduled';
        p.textContent =
          'Unscheduled: ' +
          leftover
            .map(function (c) {
              return c.courseCode + ' ' + c.component;
            })
            .join(', ');
        wrap.appendChild(p);
      }
      host.appendChild(wrap);
    }

    function roomsByBuilding() {
      var map = {};
      rooms.forEach(function (r) {
        var bid = r.buildingId || 'b-none';
        if (!map[bid]) {
          map[bid] = { id: bid, name: r.buildingName || 'Unassigned', rooms: [] };
        }
        map[bid].rooms.push(r);
      });
      return Object.keys(map)
        .sort(function (a, b) {
          return map[a].name.localeCompare(map[b].name);
        })
        .map(function (k) {
          return map[k];
        });
    }

    function roomIsAvailable(r) {
      return !!(r && r.status === 'active' && r.buildingActive !== false);
    }

    function occupancyForRoom(roomId) {
      var n = 0;
      var seen = {};
      classes.forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if (m.roomId !== roomId) return;
          var key = (c.mergedClassId || c.id) + '|' + m.day + '|' + m.start;
          if (seen[key]) return;
          seen[key] = true;
          n += 1;
        });
      });
      return n;
    }

    function isLunchSlot(mins) {
      return mins >= LUNCH_START && mins < LUNCH_END;
    }

    function bookableSlotTotal() {
      var n = 0;
      var rows = slotCount();
      var skipLunch = lunchKeepOn();
      for (var r = 0; r < rows; r++) {
        if (skipLunch && isLunchSlot(GRID_START + r * SLOT)) continue;
        n += 1;
      }
      return n * DAYS.length;
    }

    function occupiedSlotCount(roomId) {
      var occupied = {};
      var rows = slotCount();
      classes.forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if (m.roomId !== roomId) return;
          if (DAYS.indexOf(m.day) < 0) return;
          var start = slotIndex(m.start);
          var end = slotIndex(m.end);
          if (start < 0) start = 0;
          if (end > rows) end = rows;
          for (var i = start; i < end; i++) {
            if (lunchKeepOn() && isLunchSlot(GRID_START + i * SLOT)) continue;
            occupied[m.day + '|' + i] = true;
          }
        });
      });
      return Object.keys(occupied).length;
    }

    function roomFillStatus(roomId) {
      var used = occupiedSlotCount(roomId);
      if (!used) return 'empty';
      if (used >= bookableSlotTotal()) return 'full';
      return 'partial';
    }

    function roomFillBadgeHtml(roomId) {
      var status = roomFillStatus(roomId);
      var label =
        status === 'full' ? 'Fully occupied' : status === 'partial' ? 'Partially occupied' : 'Empty';
      return (
        '<span class="sched-room-fill sched-room-fill--' +
        status +
        '">' +
        escapeHtml(label) +
        '</span>'
      );
    }

    function weeklyBlockHtml(b, opts) {
      opts = opts || {};
      var cls = b.class || {};
      var meets =
        b.meetings && b.meetings.length
          ? b.meetings
          : b.meeting
            ? [b.meeting]
            : [];
      var timeHtml = meets
        .map(function (meet) {
          var time = formatTimeRange(meet.start, meet.end);
          if (opts.showDay) {
            time = (DAY_FULL[meet.day] || meet.day || '') + ' · ' + time;
          }
          return '<div class="wb-time">' + escapeHtml(time) + '</div>';
        })
        .join('');
      if (!timeHtml) {
        timeHtml = '<div class="wb-time"></div>';
      }
      var n = Number(b.studentCount);
      if (!isFinite(n)) n = classStudentCount(cls);
      var countText = studentCountLabel(n);
      return (
        '<div class="wb-count">' +
        escapeHtml(countText) +
        '</div>' +
        timeHtml +
        '<div class="wb-subj">' +
        escapeHtml(cls.courseTitle || cls.courseCode) +
        '</div><div class="wb-code">' +
        escapeHtml(cls.courseCode) +
        ' · ' +
        escapeHtml(cls.component) +
        (cls.mergedClassId ? ' · merged' : '') +
        '</div><div class="wb-section">' +
        escapeHtml((b.sections || [sectionLabel(cls.sectionName, cls.studentCount, cls)]).join(', ')) +
        '</div>'
      );
    }

    function groupBlocksForRoomHover(roomId) {
      var grouped = {};
      var out = [];
      blocksForRoom(roomId).forEach(function (b) {
        var cls = b.class || {};
        var key = String(cls.mergedClassId || cls.id || '');
        if (!grouped[key]) {
          grouped[key] = {
            class: cls,
            meeting: b.meeting,
            meetings: [],
            sections: (b.sections || []).slice(),
            studentCount: isFinite(Number(b.studentCount))
              ? Number(b.studentCount)
              : classStudentCount(cls)
          };
          out.push(grouped[key]);
        }
        var rec = grouped[key];
        if (b.meeting) rec.meetings.push(b.meeting);
        (b.sections || []).forEach(function (s) {
          if (rec.sections.indexOf(s) < 0) rec.sections.push(s);
        });
      });
      out.forEach(function (g) {
        g.meetings.sort(function (a, b) {
          var da = dayOrder(a.day || '') - dayOrder(b.day || '');
          if (da) return da;
          return String(a.start || '').localeCompare(String(b.start || ''));
        });
        g.meeting = g.meetings[0] || g.meeting;
      });
      out.sort(function (a, b) {
        var ma = a.meetings[0] || {};
        var mb = b.meetings[0] || {};
        var da = dayOrder(ma.day || '') - dayOrder(mb.day || '');
        if (da) return da;
        return String(ma.start || '').localeCompare(String(mb.start || ''));
      });
      return out;
    }

    function roomHoverPanel() {
      var el = qs('schedRoomHover');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'schedRoomHover';
      el.className = 'sched-room-hover';
      el.hidden = true;
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Scheduled classes in this room');
      var inner = document.createElement('div');
      inner.className = 'sched-room-hover-inner';
      el.appendChild(inner);
      el.addEventListener('mouseenter', cancelRoomHoverHide);
      el.addEventListener('mouseleave', function (e) {
        if (roomHoverRelated(e.relatedTarget)) return;
        scheduleRoomHoverHide();
      });
      document.body.appendChild(el);
      return el;
    }

    var roomHoverHideTimer = null;
    var roomHoverAnchor = null;

    function roomHoverRelated(target) {
      if (!target || !target.closest) return false;
      if (target.closest('#schedRoomHover')) return true;
      return !!(roomHoverAnchor && (target === roomHoverAnchor || roomHoverAnchor.contains(target)));
    }

    function cancelRoomHoverHide() {
      if (roomHoverHideTimer) {
        clearTimeout(roomHoverHideTimer);
        roomHoverHideTimer = null;
      }
    }

    function scheduleRoomHoverHide() {
      cancelRoomHoverHide();
      roomHoverHideTimer = setTimeout(function () {
        roomHoverHideTimer = null;
        hideRoomHover();
      }, 280);
    }

    function hideRoomHover() {
      cancelRoomHoverHide();
      roomHoverAnchor = null;
      var el = qs('schedRoomHover');
      if (el) el.hidden = true;
    }

    function fillRoomHover(room) {
      var panel = roomHoverPanel();
      var inner = panel.querySelector('.sched-room-hover-inner') || panel;
      var blocks = groupBlocksForRoomHover(room.id);
      inner.innerHTML = '';
      var title = document.createElement('div');
      title.className = 'sched-room-hover-title';
      title.textContent = (room.label || room.code || 'Room') + ' — scheduled classes';
      inner.appendChild(title);
      if (!blocks.length) {
        inner.appendChild(emptyLine('No classes booked in this room for the selected term.'));
        return panel;
      }
      blocks.forEach(function (b) {
        var block = document.createElement('div');
        block.className = 'weekly-schedule-block';
        block.style.background = colorFor(b.class && b.class.courseCode);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wb-inner';
        btn.innerHTML = weeklyBlockHtml(b, { showDay: true });
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          hideRoomHover();
          if (!scheduleLocked()) {
            openEditModal(b.class, b.meeting);
            return;
          }
          selectedBuilding = room.buildingId;
          selectedRoom = room.id;
          showView('rooms', 'grid');
        });
        block.appendChild(btn);
        inner.appendChild(block);
      });
      return panel;
    }

    function showRoomHover(btn, room) {
      cancelRoomHoverHide();
      roomHoverAnchor = btn;
      var panel = fillRoomHover(room);
      var inner = panel.querySelector('.sched-room-hover-inner');
      if (inner) inner.style.maxHeight = '';
      panel.hidden = false;
      var rect = btn.getBoundingClientRect();
      var bridge = 12;
      var left = rect.left;
      var top = rect.bottom - bridge;
      var pw = panel.offsetWidth;
      if (left + pw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - pw - 12);
      var roomBelow = window.innerHeight - rect.bottom - 12;
      if (inner && roomBelow > 80) {
        inner.style.maxHeight = roomBelow + 'px';
      }
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }

    function bindRoomCardHover(btn, room) {
      btn.addEventListener('mouseenter', function () {
        showRoomHover(btn, room);
      });
      btn.addEventListener('mouseleave', function (e) {
        if (roomHoverRelated(e.relatedTarget)) return;
        scheduleRoomHoverHide();
      });
      btn.addEventListener('focus', function () {
        showRoomHover(btn, room);
      });
      btn.addEventListener('blur', scheduleRoomHoverHide);
    }

    function renderRoomCrumb() {
      if (!roomCrumb || primaryView !== 'rooms' || layout !== 'grid') return;
      roomCrumb.innerHTML = '';
      var bld = roomsByBuilding().filter(function (b) {
        return b.id === selectedBuilding;
      })[0];
      var room = rooms.filter(function (r) {
        return r.id === selectedRoom;
      })[0];
      function addBtn(label, fn) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', fn);
        roomCrumb.appendChild(btn);
      }
      function addSep() {
        var sep = document.createElement('span');
        sep.className = 'sched-crumb-sep';
        sep.textContent = '/';
        roomCrumb.appendChild(sep);
      }
      addBtn('Buildings', function () {
        selectedBuilding = '';
        selectedRoom = '';
        showView('rooms', 'grid');
      });
      if (bld) {
        addSep();
        addBtn(bld.name, function () {
          selectedRoom = '';
          showView('rooms', 'grid');
        });
      }
      if (room) {
        addSep();
        var cur = document.createElement('span');
        cur.textContent = room.label || room.code;
        roomCrumb.appendChild(cur);
      }
    }

    function renderRooms() {
      hideRoomHover();
      if (!roomView) return;
      roomView.innerHTML = '';
      if (layout === 'grid') {
        renderRoomBrowser(roomView);
        return;
      }
      renderRoomTable(roomView);
    }

    function tableRowsForRoom(roomId) {
      var rows = [];
      classes.forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if ((m.roomId || '') !== (roomId || '')) return;
          rows.push({
            sectionName: c.sectionName,
            studentCount: c.studentCount,
            partitionCount: c.partitionCount,
            partitionStudents: c.partitionStudents,
            sectionStudentCount: c.sectionStudentCount,
            courseCode: c.courseCode,
            courseTitle: c.courseTitle,
            component: c.component,
            roomTypeName: c.roomTypeName || '',
            requiresCampusRoom: c.requiresCampusRoom !== false,
            day: m.day,
            start: m.start,
            end: m.end,
            merged: !!c.mergedClassId,
            offeringId: c.id,
            meetingId: m.id,
            roomId: m.roomId || ''
          });
        });
      });
      return rows;
    }

    function renderRoomTable(host) {
      var list = filteredTableRooms();
      var offRows = tableRowsForRoom('');
      var buildingId = roomBuildingEl ? roomBuildingEl.value : '';
      var floorVal = roomFloorEl ? roomFloorEl.value : '';
      var typeVal = roomTypeEl ? roomTypeEl.value : '';
      var showOff = !buildingId && !floorVal && !typeVal && offRows.length;
      var ids = {};
      list.forEach(function (r) {
        ids[r.id] = true;
      });
      if (openRoomTableGrid && openRoomTableGrid !== 'off-campus' && !ids[openRoomTableGrid]) {
        openRoomTableGrid = '';
        writeHash();
      }
      if (!list.length && !showOff) {
        host.appendChild(
          emptyLine(
            rooms.length
              ? 'No rooms match these filters.'
              : noRoomsText()
          )
        );
        return;
      }
      list.forEach(function (room) {
        host.appendChild(roomTableBlock(room, tableRowsForRoom(room.id)));
      });
      if (showOff) {
        host.appendChild(
          roomTableBlock(
            { id: 'off-campus', label: 'Off-campus', buildingName: '', floorNumber: null, typeName: '' },
            offRows
          )
        );
      }
    }

    function roomTableBlock(room, rows) {
      var block = document.createElement('div');
      block.className = 'sched-block';
      block.setAttribute('data-room-grid', room.id);
      var head = document.createElement('div');
      head.className = 'sched-block-head';
      var titleWrap = document.createElement('div');
      var h = document.createElement('h3');
      h.textContent = room.label || room.code || 'Room';
      titleWrap.appendChild(h);
      var metaParts = [];
      if (room.buildingName) metaParts.push(room.buildingName);
      if (room.floorNumber != null) metaParts.push('Floor ' + room.floorNumber);
      if (room.typeName) metaParts.push(room.typeName);
      if (room.capacity) metaParts.push('cap ' + room.capacity);
      if (metaParts.length) {
        var meta = document.createElement('div');
        meta.className = 'sched-block-meta';
        meta.textContent = metaParts.join(' · ');
        titleWrap.appendChild(meta);
      }
      var open = openRoomTableGrid === room.id;
      var gridBtn = document.createElement('button');
      gridBtn.type = 'button';
      gridBtn.className = 'sched-link-btn';
      gridBtn.textContent = open ? 'Hide timetable' : 'Timetable';
      gridBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      gridBtn.addEventListener('click', function () {
        openRoomTableGrid = openRoomTableGrid === room.id ? '' : room.id;
        showView('rooms', 'table');
        if (openRoomTableGrid) {
          var esc =
            global.CSS && CSS.escape
              ? CSS.escape(openRoomTableGrid)
              : openRoomTableGrid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          var el = roomView.querySelector('[data-room-grid="' + esc + '"]');
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      head.appendChild(titleWrap);
      head.appendChild(gridBtn);
      block.appendChild(head);
      block.appendChild(roomOccupancyTable(rows));
      if (open) {
        var wrap = document.createElement('div');
        wrap.className = 'sched-section-grid';
        wrap.appendChild(
          buildWeeklyGrid(room.id === 'off-campus' ? blocksForRoom('') : blocksForRoom(room.id), gridEditOpts('This room has no classes in the saved schedule.'))
        );
        block.appendChild(wrap);
      }
      return block;
    }

    function roomOccupancyTable(rows) {
      if (!rows.length) {
        return emptyLine('No classes booked in this room for the selected term.');
      }
      var table = document.createElement('table');
      table.className = 'sched-table';
      table.innerHTML =
        '<colgroup>' +
        '<col class="sched-col-day">' +
        '<col class="sched-col-time">' +
        '<col class="sched-col-section">' +
        '<col class="sched-col-room-code">' +
        '<col class="sched-col-type">' +
        '<col class="sched-col-room-title">' +
        actionsCol() +
        '</colgroup>' +
        '<thead><tr><th>Day</th><th>Time</th><th>Section</th><th>Course Code</th><th>Required type</th><th>Subject Title</th>' +
        actionsHead() +
        '</tr></thead>';
      var tb = document.createElement('tbody');
      rows
        .slice()
        .sort(function (a, b) {
          return dayOrder(a.day) - dayOrder(b.day) || String(a.start).localeCompare(String(b.start));
        })
        .forEach(function (r) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td class="sched-cell-nowrap">' +
            escapeHtml(r.day) +
            '</td><td class="sched-cell-nowrap">' +
            escapeHtml(formatTimeRange(r.start, r.end)) +
            '</td><td>' +
            escapeHtml(sectionLabel(r.sectionName, r.studentCount, r)) +
            '</td><td class="sched-cell-nowrap">' +
            escapeHtml(r.courseCode) +
            '</td><td class="sched-cell-type">' +
            typeCellHtml(r, r.roomId) +
            '</td><td>' +
            escapeHtml(r.courseTitle) +
            ' (' +
            escapeHtml(r.component) +
            ')' +
            (r.merged ? ' <span class="sched-badge">Merged</span>' : '') +
            '</td>' +
            editCell(r.offeringId, r.meetingId || '');
          tb.appendChild(tr);
        });
      table.appendChild(tb);
      return table;
    }

    function renderRoomBrowser(host) {
      var buildings = roomsByBuilding();
      if (!buildings.length) {
        host.appendChild(emptyLine(noRoomsText()));
        return;
      }
      if (!selectedBuilding) {
        var grid = document.createElement('div');
        grid.className = 'sched-building-grid';
        buildings.forEach(function (b) {
          var used = b.rooms.reduce(function (n, r) {
            return n + occupancyForRoom(r.id);
          }, 0);
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sched-building-card';
          var bldgOff = (b.rooms || []).every(function (r) {
            return r.buildingActive === false;
          });
          btn.innerHTML =
            '<span class="sched-building-name">' +
            escapeHtml(b.name) +
            '</span><span class="sched-building-meta">' +
            (bldgOff ? 'Unavailable · ' : '') +
            b.rooms.length +
            ' rooms · ' +
            used +
            ' booked period' +
            (used === 1 ? '' : 's') +
            '</span>';
          btn.addEventListener('click', function () {
            selectedBuilding = b.id;
            selectedRoom = '';
            showView('rooms', 'grid');
          });
          grid.appendChild(btn);
        });
        host.appendChild(grid);
        return;
      }
      var bld = buildings.filter(function (b) {
        return b.id === selectedBuilding;
      })[0];
      if (!bld) {
        selectedBuilding = '';
        renderRoomBrowser(host);
        return;
      }
      if (!selectedRoom) {
        var list = document.createElement('div');
        list.className = 'sched-room-list';
        bld.rooms.forEach(function (r) {
          var n = occupancyForRoom(r.id);
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sched-room-card';
          btn.innerHTML =
            '<span class="sched-room-card-head">' +
            '<span class="sched-room-name">' +
            escapeHtml(r.label || r.code) +
            '</span>' +
            roomFillBadgeHtml(r.id) +
            '</span><span class="sched-room-meta">' +
            (r.buildingActive === false
              ? 'Building unavailable'
              : r.status === 'active'
                ? 'Active'
                : 'Under maintenance') +
            (r.capacity ? ' · cap ' + r.capacity : '') +
            (r.typeName ? ' · ' + escapeHtml(r.typeName) : '') +
            ' · ' +
            n +
            ' period' +
            (n === 1 ? '' : 's') +
            '</span>';
          btn.addEventListener('click', function () {
            hideRoomHover();
            selectedRoom = r.id;
            showView('rooms', 'grid');
          });
          bindRoomCardHover(btn, r);
          list.appendChild(btn);
        });
        host.appendChild(list);
        var spacer = document.createElement('div');
        spacer.className = 'sched-room-hover-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        host.appendChild(spacer);
        return;
      }
      var room = bld.rooms.filter(function (r) {
        return r.id === selectedRoom;
      })[0];
      if (!room) {
        selectedRoom = '';
        renderRoomBrowser(host);
        return;
      }
      var heading = document.createElement('h3');
      heading.textContent = room.label || room.code;
      host.appendChild(heading);
      if (!scheduleLocked()) {
        var hint = document.createElement('p');
        hint.className = 'page-sub';
        hint.textContent = 'Click a class block to change its day, time, or room, or to move a section to another class.';
        host.appendChild(hint);
      }
      host.appendChild(
        buildWeeklyGrid(blocksForRoom(room.id), gridEditOpts('This room has no classes in the saved schedule.'))
      );
    }

    function blocksForRoom(roomId) {
      var seen = {};
      var out = [];
      classes.forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if ((m.roomId || '') !== roomId) return;
          var key = (c.mergedClassId || c.id) + '|' + m.day + '|' + m.start;
          if (seen[key]) {
            seen[key].sections.push(sectionLabel(c.sectionName, c.studentCount, c));
            seen[key].studentCount += Number(c.studentCount) || 0;
            return;
          }
          var rec = {
            class: c,
            meeting: m,
            sections: [sectionLabel(c.sectionName, c.studentCount, c)],
            studentCount: Number(c.studentCount) || 0
          };
          seen[key] = rec;
          out.push(rec);
        });
      });
      return out;
    }

    function buildWeeklyGrid(blocks, opts) {
      opts = opts || {};
      var wrap = document.createElement('div');
      wrap.className = 'weekly-schedule-wrap';
      var rows = slotCount();
      var placed = {};
      DAYS.forEach(function (d) {
        placed[d] = {};
      });
      (blocks || []).forEach(function (b) {
        var m = b.meeting;
        if (!m || !placed[m.day]) return;
        var start = slotIndex(m.start);
        var end = slotIndex(m.end);
        if (start < 0) start = 0;
        if (end > rows) end = rows;
        if (end <= start) return;
        placed[m.day][start] = { block: b, span: end - start };
        for (var i = start + 1; i < end; i++) placed[m.day][i] = { skip: true };
      });

      var table = document.createElement('table');
      table.className = 'weekly-schedule-table';
      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      hr.appendChild(document.createElement('th')).textContent = 'Time';
      DAYS.forEach(function (d) {
        var th = document.createElement('th');
        th.textContent = DAY_LABELS[d];
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = document.createElement('tbody');
      var any = false;
      for (var r = 0; r < rows; r++) {
        var mins = GRID_START + r * SLOT;
        var tr = document.createElement('tr');
        var timeTd = document.createElement('td');
        timeTd.className = 'weekly-schedule-time-col';
        var slotPad = document.createElement('span');
        slotPad.className = 'weekly-schedule-time-slot';
        slotPad.setAttribute('aria-hidden', 'true');
        timeTd.appendChild(slotPad);
        var startLabel = document.createElement('span');
        startLabel.className = 'weekly-schedule-time-label';
        startLabel.textContent = formatClock(mins);
        timeTd.appendChild(startLabel);
        if (r === rows - 1) {
          var endLabel = document.createElement('span');
          endLabel.className = 'weekly-schedule-time-label weekly-schedule-time-label--end';
          endLabel.textContent = formatClock(GRID_END);
          timeTd.appendChild(endLabel);
        }
        tr.appendChild(timeTd);
        DAYS.forEach(function (d) {
          var cell = placed[d][r];
          if (cell && cell.skip) return;
          var td = document.createElement('td');
          if (cell && cell.block) {
            any = true;
            td.className = 'weekly-schedule-block';
            td.rowSpan = cell.span;
            td.style.background = colorFor(cell.block.class.courseCode);
            var inner = document.createElement(opts.onEdit ? 'button' : 'div');
            if (opts.onEdit) inner.type = 'button';
            else inner.className = 'wb-inner';
            inner.innerHTML = weeklyBlockHtml(cell.block);
            if (opts.onEdit) {
              inner.addEventListener('click', function () {
                opts.onEdit(cell.block);
              });
            }
            if (opts.highlightKey) {
              var meet = cell.block.meeting || {};
              var blockKey =
                ((cell.block.class && (cell.block.class.mergedClassId || cell.block.class.id)) || '') +
                '|' +
                (meet.day || '') +
                '|' +
                (meet.start || '');
              if (blockKey === opts.highlightKey) {
                td.classList.add('weekly-schedule-block--current');
              }
            }
            td.appendChild(inner);
          } else {
            td.className =
              mins >= LUNCH_START && mins < LUNCH_END ? 'weekly-schedule-lunch' : 'weekly-schedule-empty';
            td.innerHTML = '<span class="weekly-schedule-time-slot" aria-hidden="true"></span>';
          }
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      wrap.appendChild(table);
      if (!any && opts.empty) {
        wrap.appendChild(emptyLine(opts.empty));
      }
      return wrap;
    }

    function classById(id) {
      for (var i = 0; i < classes.length; i++) {
        if (classes[i].id === id) return classes[i];
      }
      return null;
    }

    function meetingById(cls, meetingId) {
      if (!cls || !meetingId) return (cls && cls.meetings && cls.meetings[0]) || null;
      for (var i = 0; i < (cls.meetings || []).length; i++) {
        if (cls.meetings[i].id === meetingId) return cls.meetings[i];
      }
      return cls.meetings[0] || null;
    }

    function fillTimeSelect(sel, selected, opts) {
      opts = opts || {};
      var min = opts.min != null ? opts.min : GRID_START;
      var max = opts.max != null ? opts.max : GRID_END;
      sel.innerHTML = '';
      for (var m = min; m <= max; m += SLOT) {
        sel.appendChild(new Option(formatClock(m), hhmm(m)));
      }
      if (selected && Array.prototype.some.call(sel.options, function (o) { return o.value === selected; })) {
        sel.value = selected;
      }
    }

    function roomOptionLabel(r) {
      var bits = [r.label || r.code || r.id];
      if (r.typeName) bits.push(r.typeName);
      if (r.capacity) bits.push('cap ' + r.capacity);
      return bits.join(' · ');
    }

    function roomPickerEls(which) {
      if (which === 'planner') {
        return {
          building: qs('schedEditPlannerRoomBuilding'),
          type: qs('schedEditPlannerRoomTypeFilter'),
          room: qs('schedEditPlannerRoom')
        };
      }
      return {
        building: qs('schedEditRoomBuilding'),
        type: qs('schedEditRoomTypeFilter'),
        room: qs('schedEditRoom')
      };
    }

    function fillRoomSelect(sel, selected, filters) {
      if (!sel) return;
      filters = filters || {};
      var list = rooms.filter(function (r) {
        if (!roomIsAvailable(r)) return false;
        if (filters.building && r.buildingId !== filters.building) return false;
        if (filters.type && r.typeName !== filters.type) return false;
        return true;
      });
      sel.innerHTML = '';
      sel.appendChild(new Option('Off-campus', ''));
      var seen = {};
      list.forEach(function (r) {
        seen[r.id] = true;
        sel.appendChild(new Option(roomOptionLabel(r), r.id));
      });
      if (selected && !seen[selected]) {
        var extra = roomById(selected);
        if (extra) sel.appendChild(new Option(roomOptionLabel(extra) + ' (outside filter)', extra.id));
      }
      if (selected && Array.prototype.some.call(sel.options, function (o) { return o.value === selected; })) {
        sel.value = selected;
      }
    }

    function refillRoomPicker(which, keepSelected) {
      var els = roomPickerEls(which);
      var selected = keepSelected != null ? keepSelected : (els.room && els.room.value) || '';
      fillRoomSelect(els.room, selected, {
        building: els.building && els.building.value,
        type: els.type && els.type.value
      });
      if (which !== 'planner') {
        updateRoomLink(els.room && els.room.value);
        refreshEditRoomHint();
      } else {
        refreshPlanner();
      }
    }

    function setupRoomPicker(which, cls, selectedRoomId) {
      var els = roomPickerEls(which);
      var current = roomById(selectedRoomId);
      var buildings = [{ value: '', label: 'All buildings' }].concat(
        roomsByBuilding()
          .filter(function (b) {
            if (current && current.buildingId === b.id) return true;
            return (b.rooms || []).some(roomIsAvailable);
          })
          .map(function (b) {
            return { value: b.id, label: b.name };
          })
      );
      var types = {};
      rooms.forEach(function (r) {
        if (roomIsAvailable(r) && r.typeName) types[r.typeName] = true;
      });
      var typeOpts = [{ value: '', label: 'All types' }].concat(
        Object.keys(types)
          .sort()
          .map(function (t) {
            return { value: t, label: t };
          })
      );
      var preferType = '';
      if (cls && subjectNeedsCampusRoom(cls) && cls.roomTypeName && types[cls.roomTypeName]) {
        preferType = cls.roomTypeName;
      } else if (current && current.typeName) {
        preferType = current.typeName;
      }
      fillSelectKeep(els.building, buildings, current && current.buildingId);
      fillSelectKeep(els.type, typeOpts, preferType);
      fillRoomSelect(els.room, selectedRoomId || '', {
        building: els.building && els.building.value,
        type: els.type && els.type.value
      });
    }

    function targetOptionsFor(cls) {
      if (!cls) return [];
      var seen = {};
      var out = [];
      classes.forEach(function (c) {
        if (c.id === cls.id) return;
        if (cls.mergedClassId && c.mergedClassId === cls.mergedClassId) return;
        if (!(c.meetings && c.meetings.length)) return;
        if (c.courseCode !== cls.courseCode || c.component !== cls.component) return;
        var key = c.mergedClassId || c.id;
        if (seen[key]) return;
        seen[key] = true;
        var members = membersOf(c)
          .map(function (m) {
            return sectionLabel(m.sectionName, m.studentCount, m);
          })
          .join(', ');
        var when = sortedMeetings(c.meetings)
          .map(function (m) {
            return (DAY_LABELS[m.day] || m.day) + ' ' + formatTimeRange(m.start, m.end);
          })
          .join('; ');
        var room = roomsOccupied(c.meetings);
        out.push({
          id: c.id,
          label:
            (c.courseCode || '') +
            ' ' +
            (c.component || '') +
            ' · ' +
            members +
            (c.mergedClassId ? ' (merged)' : '') +
            (when ? ' · ' + when : '') +
            (room && room !== '—' ? ' · ' + room : '')
        });
      });
      out.sort(function (a, b) {
        return String(a.label).localeCompare(String(b.label));
      });
      return out;
    }

    function formatHoursPhrase(hours) {
      var n = Math.round((Number(hours) || 0) * 100) / 100;
      var label = Math.abs(n - Math.round(n)) < 0.001 ? String(Math.round(n)) : String(n);
      return label + (n === 1 ? ' hour' : ' hours');
    }

    function proposedWeeklyMinutes(cls, meetingId, start, end) {
      var total = 0;
      (cls.meetings || []).forEach(function (m) {
        if (m.id === meetingId) {
          total += minutesOf(end) - minutesOf(start);
        } else {
          total += minutesOf(m.end) - minutesOf(m.start);
        }
      });
      return total;
    }

    function hoursMismatchMessage(cls, meetingId, start, end) {
      if (!cls || !meetingId) return '';
      var required = Math.round((Number(cls.hoursPerWeek) || 0) * 60);
      var got = proposedWeeklyMinutes(cls, meetingId, start, end);
      if (got === required) return '';
      return (
        'This class is set for ' +
        formatHoursPhrase(required / 60) +
        ' a week. The new times add up to ' +
        formatHoursPhrase(got / 60) +
        '. Keep the total exact.'
      );
    }

    function hoursMessageForTotal(cls, gotMins) {
      var required = Math.round((Number(cls.hoursPerWeek) || 0) * 60);
      if (gotMins === required) {
        return 'This class needs ' + formatHoursPhrase(cls.hoursPerWeek) + ' a week.';
      }
      return (
        'This class is set for ' +
        formatHoursPhrase(required / 60) +
        ' a week. The new times add up to ' +
        formatHoursPhrase(gotMins / 60) +
        '. Keep the total exact.'
      );
    }

    function refreshEditHoursHint() {
      var hint = qs('schedEditHours');
      if (!editState || !editState.cls || !editState.meetingId) {
        if (hint) hint.textContent = '';
        return;
      }
      var start = qs('schedEditStart') && qs('schedEditStart').value;
      var end = qs('schedEditEnd') && qs('schedEditEnd').value;
      var msg = hoursMismatchMessage(editState.cls, editState.meetingId, start, end);
      if (hint) {
        hint.textContent = msg ||
          'This class needs ' + formatHoursPhrase(editState.cls.hoursPerWeek) + ' a week.';
        hint.classList.toggle('is-warn', !!msg);
      }
      refreshEditRoomHint();
    }

    function refreshEditRoomHint() {
      var hint = qs('schedEditRoomHint');
      if (!hint || !editState || !editState.cls) {
        if (hint) hint.textContent = '';
        return;
      }
      var roomId = qs('schedEditRoom') ? qs('schedEditRoom').value : '';
      var msg = roomTypeWarning(editState.cls, roomId);
      if (msg) {
        hint.textContent = msg;
        hint.classList.add('is-warn');
      } else if (!subjectNeedsCampusRoom(editState.cls)) {
        hint.textContent = 'This subject is ' + (editState.cls.roomTypeName || 'Off-campus') + ' and does not need a campus room.';
        hint.classList.remove('is-warn');
      } else {
        hint.textContent = editState.cls.roomTypeName
          ? 'This subject needs a ' + editState.cls.roomTypeName + ' room.'
          : '';
        hint.classList.remove('is-warn');
      }
    }

    var confirmWaiter = null;

    function closeConfirmModal(answer) {
      var modal = qs('schedConfirmModal');
      if (modal) modal.hidden = true;
      var done = confirmWaiter;
      confirmWaiter = null;
      if (done) done(!!answer);
    }

    function askConfirm(opts) {
      opts = opts || {};
      var message = typeof opts === 'string' ? opts : String(opts.message || '');
      var modal = qs('schedConfirmModal');
      var body = qs('schedConfirmBody');
      var title = qs('schedConfirmTitle');
      var yes = qs('schedConfirmYes');
      var no = qs('schedConfirmNo');
      if (!modal || !body) return Promise.resolve(window.confirm(message));
      if (title) title.textContent = opts.title || 'Please confirm';
      body.textContent = message;
      if (yes) {
        yes.textContent = opts.yes || 'Continue';
        yes.className = 'sched-btn' + (opts.yesClass ? ' ' + opts.yesClass : '');
      }
      if (no) no.textContent = opts.no || 'Cancel';
      modal.hidden = false;
      if (no && no.focus) no.focus();
      return new Promise(function (resolve) {
        confirmWaiter = resolve;
      });
    }

    function askRoomConfirm(message) {
      return askConfirm({
        title: 'Use this room anyway?',
        message: message,
        yes: 'Save anyway',
        no: 'Go back'
      });
    }

    function withRoomConfirm(cls, roomId, next) {
      var warn = roomTypeWarning(cls, roomId);
      if (!warn) {
        next();
        return;
      }
      askRoomConfirm(warn + ' Save anyway?').then(function (ok) {
        if (ok) next();
      });
    }

    function lunchKeepOn() {
      return !!(generatorSettings && generatorSettings.keepLunch !== false);
    }

    function usesLunchHour(start, end) {
      return minutesOf(start) < LUNCH_END && minutesOf(end) > LUNCH_START;
    }

    function withLunchConfirm(start, end, next) {
      if (!lunchKeepOn() || !usesLunchHour(start, end)) {
        next();
        return;
      }
      askConfirm({
        title: 'Use lunch hour (12:00–1:00)?',
        message:
          'Generate schedule keeps 12:00–1:00 vacant. This class would use that hour. Continue only if it should meet during lunch.',
        yes: 'Use 12:00–1:00',
        no: 'Go back'
      }).then(function (ok) {
        if (ok) next();
      });
    }

    function normalizeGenSettings(raw) {
      raw = raw || {};
      var mode = String(raw.mergeMode || raw.merge_mode || 'auto');
      if (['auto', 'manual', 'off'].indexOf(mode) < 0) mode = 'auto';
      var hours = Number(raw.splitHours != null ? raw.splitHours : raw.split_hours);
      if (!isFinite(hours)) hours = 3;
      if (hours < 1) hours = 1;
      if (hours > 6) hours = 6;
      hours = Math.round(hours * 2) / 2;
      var keep = raw.keepLunch;
      if (keep == null) keep = raw.keep_lunch;
      var scope = String(raw.partitionScope != null ? raw.partitionScope : raw.partition_scope || 'small');
      if (['off', 'small', 'medium', 'any'].indexOf(scope) < 0) scope = 'small';
      return {
        mergeMode: mode,
        splitHours: hours,
        keepLunch: keep !== false && keep !== 0 && keep !== '0',
        partitionScope: scope
      };
    }

    function genSettingsScopeText() {
      if (actor === 'super_admin') {
        return 'These settings apply only to Super Admin My schedule.';
      }
      return 'These settings apply only to Admin My schedule.';
    }

    // Partitions are merges, so turning merges off turns this off too. The
    // stored choice is kept so it comes back when merges are turned on again.
    function syncPartitionToggle() {
      if (!genPartitionEl) return;
      var merging = !genMergeEl || genMergeEl.value !== 'off';
      genPartitionEl.value = merging ? generatorSettings.partitionScope : 'off';
      genPartitionEl.disabled = !merging;
    }

    function fillGenSettingsForm() {
      var s = normalizeGenSettings(generatorSettings);
      generatorSettings = s;
      if (genMergeEl) genMergeEl.value = s.mergeMode;
      if (genSplitEl) genSplitEl.value = String(s.splitHours);
      if (genLunchEl) genLunchEl.checked = !!s.keepLunch;
      syncPartitionToggle();
      if (genScopeEl) genScopeEl.textContent = genSettingsScopeText();
    }

    function readGenSettingsFromForm() {
      var hours = genSplitEl ? Number(genSplitEl.value) : generatorSettings.splitHours;
      var s = normalizeGenSettings({
        mergeMode: genMergeEl ? genMergeEl.value : generatorSettings.mergeMode,
        splitHours: hours,
        keepLunch: genLunchEl ? genLunchEl.checked : generatorSettings.keepLunch,
        partitionScope: genPartitionEl && !genPartitionEl.disabled
          ? genPartitionEl.value
          : generatorSettings.partitionScope
      });
      generatorSettings = s;
      return s;
    }

    function toggleGenPanel() {
      if (!genPanel) return;
      var open = !!genPanel.hidden;
      genPanel.hidden = !open;
      if (genSettingsBtn) genSettingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        fillGenSettingsForm();
      }
    }

    function saveGenSettings() {
      if (!global.McuApi || !currentOffering) return;
      var settings = readGenSettingsFromForm();
      if (genSaveBtn) genSaveBtn.disabled = true;
      global.McuApi.send('POST', 'schedule.php', {
        action: 'save_generator_settings',
        actor: actor,
        workspace: workspace,
        page: pageKind,
        schoolYear: currentOffering.schoolYear,
        termCode: currentOffering.termCode,
        mergeMode: settings.mergeMode,
        splitHours: settings.splitHours,
        keepLunch: settings.keepLunch,
        partitionScope: settings.partitionScope
      })
        .then(function (res) {
          if (genSaveBtn) genSaveBtn.disabled = false;
          applyPayload(res);
          render();
          setStatus('Generate settings saved.', 'ok');
          hideGenPanel();
        })
        .catch(function (err) {
          if (genSaveBtn) genSaveBtn.disabled = false;
          setStatus(err.message || String(err), 'bad');
        });
    }

    function classStudentCount(cls) {
      return membersOf(cls).reduce(function (n, m) {
        return n + (Number(m.studentCount) || 0);
      }, 0);
    }

    function groupSectionIds(cls) {
      return membersOf(cls).map(function (m) {
        return m.sectionId;
      });
    }

    // Partition siblings are different students, so they may sit in the same
    // slot. Everything else a section takes still has to stay clear.
    function laneOf(cls) {
      if (!isPartitioned(cls)) return '';
      return 'p:' + cls.sectionId + ':' + cls.courseCode + ':' + cls.component;
    }

    function keyedLane(cls) {
      var lanes = {};
      var lane = laneOf(cls);
      if (lane) lanes[cls.sectionId] = lane;
      return lanes;
    }

    function groupLanes(cls) {
      var lanes = {};
      membersOf(cls).forEach(function (m) {
        var lane = laneOf(m);
        if (lane) lanes[m.sectionId] = lane;
      });
      return lanes;
    }

    function groupMeetingIds(cls) {
      var ids = [];
      membersOf(cls).forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          ids.push(m.id);
        });
      });
      return ids;
    }

    function siblingMeetingIds(cls, meeting) {
      var ids = [];
      if (!meeting) return ids;
      membersOf(cls).forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if (m.day === meeting.day && m.start === meeting.start) ids.push(m.id);
        });
      });
      return ids;
    }

    function classHoursMinutes(cls) {
      var total = 0;
      (cls.meetings || []).forEach(function (m) {
        total += minutesOf(m.end) - minutesOf(m.start);
      });
      return total;
    }

    function remainingHourMinutes(cls) {
      var req = Math.round((Number(cls.hoursPerWeek) || 0) * 60);
      return Math.max(0, req - classHoursMinutes(cls));
    }

    function rangesOverlapMin(a0, a1, b0, b1) {
      return a0 < b1 && b0 < a1;
    }

    function conflictClassLabel(cls, meet) {
      var bits = [
        (cls && cls.courseCode) || 'Class',
        (cls && cls.component) || '',
        '·',
        (cls && cls.sectionName) || 'section'
      ];
      if (meet) {
        bits.push('·', (meet.day || '') + ' ' + formatTimeRange(meet.start, meet.end));
        var roomBit = meetingRoomLabel(meet);
        if (roomBit) bits.push('·', roomBit);
      }
      return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function windowBlocked(day, start, end, sectionIds, roomId, ignoreIds, extraBusy, lanes) {
      var s = minutesOf(start);
      var e = minutesOf(end);
      if (e <= s) return 'End time must be after start time.';
      if (s < GRID_START || e > GRID_END) return 'Meetings must stay between 7:00am and 7:00pm.';
      var ignore = {};
      (ignoreIds || []).forEach(function (id) {
        ignore[id] = true;
      });
      var secs = {};
      (sectionIds || []).forEach(function (id) {
        secs[id] = true;
      });
      var extras = extraBusy || [];
      for (var i = 0; i < extras.length; i++) {
        var x = extras[i];
        if (x.day !== day) continue;
        if (rangesOverlapMin(s, e, minutesOf(x.start), minutesOf(x.end))) {
          return (
            'That time overlaps another meeting for this class. Conflict with: ' +
            (x.day || day) +
            ' ' +
            formatTimeRange(x.start, x.end)
          );
        }
      }
      for (var c = 0; c < classes.length; c++) {
        var other = classes[c];
        var sameSection = !!secs[other.sectionId];
        var meets = other.meetings || [];
        for (var m = 0; m < meets.length; m++) {
          var meet = meets[m];
          if (ignore[meet.id] || meet.day !== day) continue;
          if (!rangesOverlapMin(s, e, minutesOf(meet.start), minutesOf(meet.end))) continue;
          if (sameSection) {
            var lane = (lanes || {})[other.sectionId] || '';
            if (!lane || laneOf(other) !== lane) {
              return (
                'That time overlaps another class for this section. Conflict with: ' +
                conflictClassLabel(other, meet)
              );
            }
          }
          if (roomId && meet.roomId === roomId) {
            return (
              'That room is already booked at this time. Conflict with: ' +
              conflictClassLabel(other, meet)
            );
          }
        }
      }
      return '';
    }

    function openWindowsFor(cls, roomId, durationMins, ignoreIds, extraBusy, preferDay) {
      var sectionIds = groupSectionIds(cls);
      var lanes = groupLanes(cls);
      var out = [];
      DAYS.forEach(function (day) {
        for (var start = GRID_START; start + durationMins <= GRID_END; start += SLOT) {
          var end = start + durationMins;
          if (
            !windowBlocked(day, hhmm(start), hhmm(end), sectionIds, roomId || '', ignoreIds, extraBusy, lanes)
          ) {
            out.push({ day: day, start: hhmm(start), end: hhmm(end) });
          }
        }
      });
      out.sort(function (a, b) {
        var pa = a.day === preferDay ? 0 : 1;
        var pb = b.day === preferDay ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return dayOrder(a.day) - dayOrder(b.day) || minutesOf(a.start) - minutesOf(b.start);
      });
      return out;
    }

    function roomAlternatives(cls, durationMins, ignoreIds, extraBusy, excludeRoomId, preferDay) {
      if (!subjectNeedsCampusRoom(cls)) return [];
      var need = classStudentCount(cls);
      var typeName = cls.roomTypeName || '';
      var excludeBld = '';
      var current = roomById(excludeRoomId);
      if (current) excludeBld = current.buildingId;
      var cands = rooms.filter(function (r) {
        if (!roomIsAvailable(r)) return false;
        if (r.id === excludeRoomId) return false;
        if ((r.capacity || 0) < need) return false;
        if (typeName && r.typeName !== typeName) return false;
        return openWindowsFor(cls, r.id, durationMins, ignoreIds, extraBusy, preferDay).length > 0;
      });
      cands.sort(function (a, b) {
        var sa = a.buildingId === excludeBld ? 0 : 1;
        var sb = b.buildingId === excludeBld ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return (a.capacity || 0) - (b.capacity || 0);
      });
      return cands.slice(0, 6).map(function (r) {
        return {
          room: r,
          sameBuilding: !!excludeBld && r.buildingId === excludeBld,
          windows: openWindowsFor(cls, r.id, durationMins, ignoreIds, extraBusy, preferDay).slice(0, 3)
        };
      });
    }

    function fillDurationSelect(sel, selected, maxMins, minMins) {
      if (!sel) return;
      minMins = minMins || SLOT;
      maxMins = maxMins || 6 * 60;
      if (maxMins < minMins) maxMins = minMins;
      sel.innerHTML = '';
      for (var m = minMins; m <= maxMins; m += SLOT) {
        sel.appendChild(new Option(formatHoursPhrase(m / 60), String(m)));
      }
      if (selected && Array.prototype.some.call(sel.options, function (o) { return o.value === String(selected); })) {
        sel.value = String(selected);
      } else if (sel.options.length) {
        sel.selectedIndex = 0;
      }
    }

    function closeRoomPreview() {
      var modal = qs('schedRoomPreviewModal');
      var grid = qs('schedRoomPreviewGrid');
      if (modal) modal.hidden = true;
      if (grid) grid.innerHTML = '';
    }

    function openRoomPreview(roomId) {
      var modal = qs('schedRoomPreviewModal');
      var grid = qs('schedRoomPreviewGrid');
      var title = qs('schedRoomPreviewTitle');
      var sub = qs('schedRoomPreviewSub');
      var room = roomById(roomId);
      if (!modal || !grid || !room) return;
      var label = room.label || room.code || 'Room';
      if (title) title.textContent = label;
      if (sub) {
        sub.textContent =
          (room.buildingName ? room.buildingName + ' · ' : '') +
          'Saved timetable for this room. Close it to keep editing the class.';
      }
      var highlightKey = '';
      if (editState && editState.cls) {
        var meet = meetingById(editState.cls, editState.meetingId);
        if (meet && (meet.roomId || '') === (room.id || '')) {
          highlightKey =
            (editState.cls.mergedClassId || editState.cls.id || '') +
            '|' +
            (meet.day || '') +
            '|' +
            (meet.start || '');
        }
      }
      grid.innerHTML = '';
      grid.appendChild(
        buildWeeklyGrid(blocksForRoom(room.id), {
          empty: 'This room has no classes in the saved schedule.',
          highlightKey: highlightKey
        })
      );
      modal.hidden = false;
    }

    function updateRoomLink(roomId) {
      var a = qs('schedEditRoomLink');
      if (!a) return;
      var room = roomById(roomId);
      if (!room || !room.buildingId) {
        a.hidden = true;
        a.onclick = null;
        return;
      }
      a.hidden = false;
      a.onclick = function (e) {
        e.preventDefault();
        openRoomPreview(room.id);
      };
    }

    function renderMeetingList(cls, selectedId) {
      var box = qs('schedEditMeetingList');
      if (!box) return;
      box.innerHTML = '';
      (cls.meetings || []).forEach(function (m) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'sched-meet-row' + (m.id === selectedId ? ' is-active' : '');
        row.innerHTML = '<span>' + escapeHtml(meetingLine(m)) + '</span>';
        if (m.id === selectedId) {
          row.disabled = true;
        } else {
          row.addEventListener('click', function () {
            openEditModal(cls, m);
          });
        }
        box.appendChild(row);
      });
      if (!(cls.meetings || []).length) {
        box.appendChild(emptyLine('No meetings yet. Add one to place this class.'));
      }
      var n = (cls.meetings || []).length;
      var selected = meetingById(cls, selectedId);
      var selectedMins = selected ? minutesOf(selected.end) - minutesOf(selected.start) : 0;
      if (qs('schedEditCombine')) qs('schedEditCombine').hidden = n < 2;
      if (qs('schedEditRemove')) qs('schedEditRemove').hidden = n < 2;
      if (qs('schedEditSplit')) qs('schedEditSplit').hidden = !selected || selectedMins < 60;
    }

    function plannerIgnoreIds() {
      if (!editState || !editState.planner) return [];
      if (editState.planner.mode === 'combine') return groupMeetingIds(editState.cls);
      if (editState.planner.mode === 'split') {
        return siblingMeetingIds(editState.cls, meetingById(editState.cls, editState.meetingId));
      }
      return [];
    }

    function plannerExtraBusy() {
      if (!editState || !editState.planner || editState.planner.mode !== 'split') return [];
      var meeting = meetingById(editState.cls, editState.meetingId);
      var durEl = qs('schedEditPlannerDuration');
      if (!meeting || !durEl) return [];
      var dur = parseInt(durEl.value, 10) || 0;
      var orig = minutesOf(meeting.end) - minutesOf(meeting.start);
      var keep = orig - dur;
      if (keep < SLOT) return [];
      return [{ day: meeting.day, start: meeting.start, end: hhmm(minutesOf(meeting.start) + keep) }];
    }

    function preferDayForPlanner() {
      var meeting = editState && meetingById(editState.cls, editState.meetingId);
      if (!meeting) return 'Wed';
      if (editState.planner && editState.planner.mode === 'combine') return meeting.day;
      return PAIR_OF[meeting.day] || meeting.day;
    }

    function renderSlotButtons(host, windows, roomId) {
      host.innerHTML = '';
      var byDay = {};
      windows.forEach(function (w) {
        (byDay[w.day] = byDay[w.day] || []).push(w);
      });
      DAYS.forEach(function (day) {
        var list = byDay[day];
        if (!list) return;
        var wrap = document.createElement('div');
        wrap.className = 'sched-slot-day';
        wrap.innerHTML = '<strong>' + (DAY_FULL[day] || day) + '</strong>';
        var btns = document.createElement('div');
        btns.className = 'sched-slot-btns';
        list.forEach(function (w) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = formatClock(minutesOf(w.start)) + '–' + formatClock(minutesOf(w.end));
          b.addEventListener('click', function () {
            applyPlannerSlot(w, roomId);
          });
          btns.appendChild(b);
        });
        wrap.appendChild(btns);
        host.appendChild(wrap);
      });
    }

    function refreshPlanner() {
      if (!editState || !editState.planner) return;
      var cls = editState.cls;
      var mode = editState.planner.mode;
      var duration = parseInt(qs('schedEditPlannerDuration').value, 10) || SLOT;
      var roomId = qs('schedEditPlannerRoom').value || '';
      var ignore = plannerIgnoreIds();
      var extra = plannerExtraBusy();
      var prefer = preferDayForPlanner();
      var keep = qs('schedEditPlannerKeep');
      var status = qs('schedEditPlannerStatus');
      var slotHost = qs('schedEditPlannerSlots');
      var altHost = qs('schedEditPlannerAlts');
      if (keep) {
        if (mode === 'split') {
          var meeting = meetingById(cls, editState.meetingId);
          var orig = minutesOf(meeting.end) - minutesOf(meeting.start);
          var firstEnd = hhmm(minutesOf(meeting.start) + (orig - duration));
          keep.hidden = false;
          keep.textContent =
            'The first session will be ' +
            (DAY_FULL[meeting.day] || meeting.day) +
            ' ' +
            formatClock(minutesOf(meeting.start)) +
            '–' +
            formatClock(minutesOf(firstEnd)) +
            '. Pick a window for the other ' +
            formatHoursPhrase(duration / 60) +
            '.';
        } else {
          keep.hidden = true;
          keep.textContent = '';
        }
      }
      var got = classHoursMinutes(cls) + (mode === 'add' ? duration : 0);
      var hoursNote = hoursMessageForTotal(cls, got);
      var typeWarn = roomTypeWarning(cls, roomId);
      var windows = openWindowsFor(cls, roomId, duration, ignore, extra, prefer);
      slotHost.innerHTML = '';
      altHost.innerHTML = '';
      if (windows.length) {
        if (status) {
          status.textContent = typeWarn ? hoursNote + ' ' + typeWarn : hoursNote;
          status.classList.toggle('is-warn', /add up to/.test(hoursNote) || !!typeWarn);
        }
        renderSlotButtons(slotHost, windows, roomId);
        return;
      }
      var room = roomById(roomId);
      var roomLabel = room ? room.label || room.code : 'Off-campus';
      if (status) {
        status.textContent =
          roomLabel +
          ' has no free ' +
          formatHoursPhrase(duration / 60) +
          ' window for these sections. ' +
          hoursNote;
        status.classList.add('is-warn');
      }
      var alts = roomAlternatives(cls, duration, ignore, extra, roomId, prefer);
      if (!alts.length) {
        var empty = document.createElement('p');
        empty.className = 'sched-edit-hours is-warn';
        empty.textContent = 'No other room of the right type has an open window either.';
        altHost.appendChild(empty);
        return;
      }
      var heading = document.createElement('p');
      heading.className = 'sched-edit-hours';
      heading.textContent = 'Other rooms with an open window:';
      altHost.appendChild(heading);
      alts.forEach(function (alt) {
        var card = document.createElement('div');
        card.className = 'sched-alt-card';
        var meta = alt.sameBuilding ? 'Same building' : alt.room.buildingName || '';
        if (alt.room.capacity) meta += (meta ? ' · ' : '') + 'cap ' + alt.room.capacity;
        card.innerHTML =
          '<strong>' +
          escapeHtml(alt.room.label || alt.room.code) +
          '</strong><em>' +
          escapeHtml(meta) +
          '</em>';
        var inner = document.createElement('div');
        inner.className = 'sched-slot-days';
        renderSlotButtons(inner, alt.windows, alt.room.id);
        card.appendChild(inner);
        altHost.appendChild(card);
      });
    }

    function openPlanner(mode) {
      if (!editState || !editState.cls) return;
      var cls = editState.cls;
      var meeting = meetingById(cls, editState.meetingId);
      var planner = qs('schedEditPlanner');
      var form = qs('schedEditMeetingForm');
      if (!planner) return;
      if (form) form.hidden = true;
      planner.hidden = false;
      if (qs('schedEditAdd')) qs('schedEditAdd').hidden = true;
      if (qs('schedEditCombine')) qs('schedEditCombine').hidden = true;
      editState.planner = { mode: mode };
      var titles = editClassLayout === 'jobs'
        ? { add: 'Add session', split: 'Split this session', combine: 'Combine sessions' }
        : { add: 'Add meeting', split: 'Split this meeting', combine: 'Combine meetings' };
      qs('schedEditPlannerTitle').textContent = titles[mode] || 'Place meeting';
      var dur = 60;
      var min = SLOT;
      var max = 6 * 60;
      if (mode === 'split' && meeting) {
        var orig = minutesOf(meeting.end) - minutesOf(meeting.start);
        max = orig - SLOT;
        dur = Math.max(SLOT, Math.floor(orig / (2 * SLOT)) * SLOT);
        if (dur > max) dur = max;
      } else if (mode === 'add') {
        var rem = remainingHourMinutes(cls);
        dur = rem >= SLOT ? rem : 60;
        if (dur > max) dur = max;
      } else if (mode === 'combine') {
        dur = classHoursMinutes(cls);
        min = dur;
        max = dur;
      }
      fillDurationSelect(qs('schedEditPlannerDuration'), dur, max, min);
      qs('schedEditPlannerDuration').disabled = mode === 'combine';
      setupRoomPicker('planner', cls, (meeting && meeting.roomId) || '');
      setEditError('');
      refreshPlanner();
      syncEditPane('session');
      if (planner.scrollIntoView) {
        planner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function closePlanner() {
      if (editState) editState.planner = null;
      if (qs('schedEditPlanner')) qs('schedEditPlanner').hidden = true;
      if (qs('schedEditMeetingForm')) qs('schedEditMeetingForm').hidden = !(editState && editState.meetingId);
      if (editState && editState.cls) renderMeetingList(editState.cls, editState.meetingId);
      syncEditPane('session');
    }

    function applyPlannerSlot(win, roomId) {
      if (!editState || !editState.planner || !global.McuApi) return;
      var mode = editState.planner.mode;
      var meeting = meetingById(editState.cls, editState.meetingId);
      withRoomConfirm(editState.cls, roomId || '', function () {
        withLunchConfirm(win.start, win.end, function () {
        if (mode === 'add') {
          postEdit('add_meeting', {
            offeringId: editState.offeringId,
            day: win.day,
            start: win.start,
            end: win.end,
            roomId: roomId || ''
          });
          return;
        }
        if (mode === 'split' && meeting) {
          var orig = minutesOf(meeting.end) - minutesOf(meeting.start);
          var dur = parseInt(qs('schedEditPlannerDuration').value, 10) || 0;
          postEdit('split_meeting', {
            meetingId: editState.meetingId,
            firstEnd: hhmm(minutesOf(meeting.start) + (orig - dur)),
            day: win.day,
            start: win.start,
            end: win.end,
            roomId: roomId || ''
          });
          return;
        }
        postEdit('combine_meetings', {
          offeringId: editState.offeringId,
          day: win.day,
          start: win.start,
          end: win.end,
          roomId: roomId || ''
        });
        });
      });
    }

    function postEdit(action, extra) {
      if (!global.McuApi) return;
      setEditError('');
      var body = {
        action: action,
        schoolYear: yearEl.value,
        termCode: semEl.value,
        actor: actor,
        workspace: workspace,
        page: pageKind,
        from: 'mine'
      };
      Object.keys(extra || {}).forEach(function (k) {
        body[k] = extra[k];
      });
      return global.McuApi.send('POST', 'schedule.php', body)
        .then(function (res) {
          applyPayload(res);
          render();
          if (action === 'unschedule_class') {
            closeEditModal();
            setStatus('Class unscheduled.', 'ok');
            return res;
          }
          var oid = extra.offeringId || (editState && editState.offeringId);
          var cls = classById(oid);
          var mid = res.meetingId || extra.meetingId;
          if (cls) openEditModal(cls, meetingById(cls, mid));
          setStatus('Schedule updated.', 'ok');
          return res;
        })
        .catch(function (err) {
          setEditError(err.message || String(err));
        });
    }

    function startAddMeeting() {
      openPlanner('add');
    }

    function startSplitMeeting() {
      var meeting = editState && meetingById(editState.cls, editState.meetingId);
      if (!meeting) return;
      if (minutesOf(meeting.end) - minutesOf(meeting.start) < 60) {
        setEditError('A meeting needs to be at least 1 hour before it can be split.');
        return;
      }
      openPlanner('split');
    }

    function startCombineMeetings() {
      if (!editState || !editState.cls) return;
      var cls = editState.cls;
      var meeting = meetingById(cls, editState.meetingId);
      if (!meeting || (cls.meetings || []).length < 2) {
        setEditError('There is only one meeting to keep.');
        return;
      }
      var total = classHoursMinutes(cls);
      var start = minutesOf(meeting.start);
      var end = start + total;
      var blocked =
        end > GRID_END ||
        windowBlocked(
          meeting.day,
          meeting.start,
          hhmm(end),
          groupSectionIds(cls),
          meeting.roomId || '',
          groupMeetingIds(cls),
          [],
          groupLanes(cls)
        );
      if (!blocked) {
        withRoomConfirm(cls, meeting.roomId || '', function () {
          withLunchConfirm(meeting.start, hhmm(end), function () {
          postEdit('combine_meetings', {
            offeringId: cls.id,
            day: meeting.day,
            start: meeting.start,
            end: hhmm(end),
            roomId: meeting.roomId || ''
          });
          });
        });
        return;
      }
      openPlanner('combine');
    }

    function removeSelectedMeeting() {
      if (!editState || !editState.meetingId) return;
      if ((editState.cls.meetings || []).length < 2) {
        setEditError('Keep at least one meeting. Combine or change times instead.');
        return;
      }
      postEdit('remove_meeting', { meetingId: editState.meetingId, offeringId: editState.offeringId });
    }

    function fillMemberRow(row, m, members, targets) {
      if (editClassLayout !== 'jobs') {
        if (members.length > 1) {
          var unmerge = document.createElement('button');
          unmerge.type = 'button';
          unmerge.className = 'sched-link-btn';
          unmerge.textContent = 'Remove from class';
          unmerge.addEventListener('click', function () {
            reassignSection(m.id, '');
          });
          row.appendChild(unmerge);
        }
        if (targets.length) {
          var move = document.createElement('button');
          move.type = 'button';
          move.className = 'sched-link-btn';
          move.textContent = 'Merge into…';
          move.addEventListener('click', function () {
            var dest = qs('schedEditTarget').value;
            if (!dest) {
              setEditError('Choose a class to merge this section into.');
              return;
            }
            confirmMergeSection(m, dest);
          });
          row.appendChild(move);
        }
        if (isPartitioned(m)) {
          var rejoin = document.createElement('button');
          rejoin.type = 'button';
          rejoin.className = 'sched-link-btn';
          rejoin.textContent = 'Recombine';
          rejoin.addEventListener('click', function () {
            confirmRecombineSection(m);
          });
          row.appendChild(rejoin);
        } else if (targets.length) {
          for (var p = 2; p <= partitionMaxParts(m); p++) {
            row.appendChild(partitionButton(m, p));
          }
        }
        return;
      }
      var actions = [];
      if (members.length > 1) actions.push({ value: 'remove', label: 'Remove from this class' });
      if (targets.length) actions.push({ value: 'merge', label: 'Merge into the class above' });
      if (isPartitioned(m)) actions.push({ value: 'recombine', label: 'Recombine' });
      else if (targets.length) {
        for (var part = 2; part <= partitionMaxParts(m); part++) {
          actions.push({ value: 'partition:' + part, label: 'Partition into ' + part });
        }
      }
      if (!actions.length) return;
      var sel = document.createElement('select');
      sel.className = 'sched-member-action';
      sel.setAttribute('aria-label', 'Action for ' + sectionLabel(m.sectionName, m.studentCount, m));
      sel.appendChild(new Option('Choose an action', ''));
      actions.forEach(function (action) {
        sel.appendChild(new Option(action.label, action.value));
      });
      var apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'sched-btn sched-btn--ghost';
      apply.textContent = 'Apply';
      apply.addEventListener('click', function () {
        var choice = sel.value;
        if (!choice) {
          setEditError('Choose an action for this section.');
          return;
        }
        if (choice === 'remove') {
          confirmRemoveSection(m);
          return;
        }
        if (choice === 'merge') {
          var dest = qs('schedEditTarget').value;
          if (!dest) {
            setEditError('Choose a class to merge this section into.');
            return;
          }
          confirmMergeSection(m, dest);
          return;
        }
        if (choice === 'recombine') {
          confirmRecombineSection(m);
          return;
        }
        if (choice.indexOf('partition:') === 0) {
          confirmPartitionSection(m, Number(choice.slice('partition:'.length)));
        }
      });
      row.appendChild(sel);
      row.appendChild(apply);
    }

    function syncEditPane(pane) {
      if (!editModal) return;
      if (editClassLayout !== 'jobs') {
        editModal.classList.remove('is-sections', 'is-planning');
        return;
      }
      var planning = !!(editState && editState.planner);
      var showSections = pane === 'sections' && !planning && !!(editState && editState.hasSectionTools);
      editModal.classList.toggle('is-planning', planning);
      editModal.classList.toggle('is-sections', showSections);
      var views = qs('schedEditViews');
      if (views) views.hidden = planning || !(editState && editState.hasSectionTools);
      var sessionBtn = qs('schedEditViewSession');
      var sectionBtn = qs('schedEditViewSections');
      if (sessionBtn) {
        sessionBtn.classList.toggle('is-active', !showSections);
        sessionBtn.setAttribute('aria-pressed', !showSections ? 'true' : 'false');
      }
      if (sectionBtn) {
        sectionBtn.classList.toggle('is-active', showSections);
        sectionBtn.setAttribute('aria-pressed', showSections ? 'true' : 'false');
      }
    }

    function mountEditLayout() {
      if (!editModal) return;
      editModal.classList.add(editClassLayout === 'jobs' ? 'sched-edit--jobs' : 'sched-edit--classic');
      if (editClassLayout !== 'jobs') return;
      var extra = qs('schedEditJobsExtra');
      if (!extra) return;
      ['schedEditAdd', 'schedEditSplit', 'schedEditCombine', 'schedEditRemove'].forEach(function (id) {
        var el = qs(id);
        if (el) extra.appendChild(el);
      });
      if (qs('schedEditAdd')) qs('schedEditAdd').textContent = 'Add session';
      if (qs('schedEditSplit')) qs('schedEditSplit').textContent = 'Split';
      if (qs('schedEditCombine')) qs('schedEditCombine').textContent = 'Combine';
      if (qs('schedEditRemove')) qs('schedEditRemove').textContent = 'Remove';
      if (qs('schedEditSave')) qs('schedEditSave').textContent = 'Save';
    }

    function openEditModal(cls, meeting) {
      if (scheduleLocked() || !editModal || !cls) return;
      editState = { offeringId: cls.id, meetingId: meeting && meeting.id, cls: cls, planner: null };
      var members = membersOf(cls);
      var targets = targetOptionsFor(cls);
      qs('schedEditTitle').textContent = 'Edit class';
      qs('schedEditMeta').innerHTML =
        '<strong>' +
        escapeHtml(cls.courseCode) +
        '</strong> — ' +
        escapeHtml(cls.courseTitle) +
        ' <em>' +
        escapeHtml(cls.component) +
        '</em><br>' +
        escapeHtml(members.map(function (m) { return sectionLabel(m.sectionName, m.studentCount, m); }).join(', ')) +
        (cls.mergedClassId ? ' · merged' : '') +
        (cls.roomTypeName
          ? '<br>Room type: ' + escapeHtml(cls.roomTypeName) +
            (subjectNeedsCampusRoom(cls) ? '' : ' · no campus room')
          : '');
      var meetBox = qs('schedEditMeeting');
      if (meetBox) meetBox.hidden = false;
      renderMeetingList(cls, meeting && meeting.id);
      var form = qs('schedEditMeetingForm');
      var planner = qs('schedEditPlanner');
      if (planner) planner.hidden = true;
      if (meeting) {
        if (form) form.hidden = false;
        qs('schedEditDay').value = meeting.day;
        fillTimeSelect(qs('schedEditStart'), meeting.start, { max: GRID_END - SLOT });
        fillTimeSelect(qs('schedEditEnd'), meeting.end, { min: GRID_START + SLOT });
        setupRoomPicker('edit', cls, meeting.roomId || '');
        updateRoomLink(meeting.roomId || '');
      } else if (form) {
        form.hidden = true;
      }
      var secBox = qs('schedEditSections');
      var list = qs('schedEditMemberList');
      list.innerHTML = '';
      if (members.length > 1 || targets.length || isPartitioned(cls)) {
        secBox.hidden = false;
        members.forEach(function (m) {
          var row = document.createElement('div');
          row.className = 'sched-member-row';
          row.innerHTML = '<span>' + escapeHtml(sectionLabel(m.sectionName, m.studentCount, m)) + '</span>';
          fillMemberRow(row, m, members, targets);
          list.appendChild(row);
        });
        var tgt = qs('schedEditTarget');
        tgt.innerHTML = '';
        tgt.appendChild(new Option('Choose a scheduled class…', ''));
        targets.forEach(function (t) {
          tgt.appendChild(new Option(t.label, t.id));
        });
        qs('schedEditTargetWrap').hidden = !targets.length;
      } else {
        secBox.hidden = true;
      }
      editState.hasSectionTools = !secBox.hidden;
      setEditError('');
      refreshEditHoursHint();
      syncEditPane('session');
      editModal.hidden = false;
    }






    function closeEditModal() {
      closeRoomPreview();
      closeConfirmModal(false);
      if (editModal) {
        editModal.classList.remove('is-sections', 'is-planning');
        editModal.hidden = true;
      }
      editState = null;
    }

    function setEditError(text) {
      var el = qs('schedEditError');
      if (!el) return;
      el.textContent = text || '';
      if (text && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }

    function saveMeeting() {
      if (!editState || !editState.meetingId || !global.McuApi) return;
      var start = qs('schedEditStart').value;
      var end = qs('schedEditEnd').value;
      var roomId = qs('schedEditRoom').value;
      setEditError('');
      refreshEditRoomHint();
      withRoomConfirm(editState.cls, roomId, function () {
      withLunchConfirm(start, end, function () {
      qs('schedEditSave').disabled = true;
      global.McuApi.send('POST', 'schedule.php', {
        action: 'move_meeting',
        actor: actor,
        workspace: workspace,
        page: pageKind,
        schoolYear: yearEl.value,
        termCode: semEl.value,
        meetingId: editState.meetingId,
        day: qs('schedEditDay').value,
        start: start,
        end: end,
        roomId: roomId
      })
        .then(function (res) {
          applyPayload(res);
          qs('schedEditSave').disabled = false;
          var cls = classById(editState.offeringId);
          setStatus('Meeting updated.', 'ok');
          render();
          if (cls) openEditModal(cls, meetingById(cls, editState.meetingId));
        })
        .catch(function (err) {
          qs('schedEditSave').disabled = false;
          setEditError(err.message || String(err));
        });
      });
      });
    }

    function destRoomId(cls) {
      var rid = '';
      membersOf(cls).forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if (!rid && m.roomId) rid = m.roomId;
        });
      });
      return rid;
    }

    function mergeIgnoreIds(src, dest) {
      var ids = [];
      membersOf(src).concat(membersOf(dest)).forEach(function (c) {
        (c.meetings || []).forEach(function (m) {
          if (m.id) ids.push(m.id);
        });
      });
      return ids;
    }

    function confirmMergeSection(src, destId) {
      var dest = classById(destId);
      if (!src || !dest) {
        setEditError('That class is no longer on the timetable.');
        return;
      }
      if (!(dest.meetings && dest.meetings.length)) {
        setEditError('Choose a class that is already scheduled.');
        return;
      }
      if (src.courseCode !== dest.courseCode || src.component !== dest.component) {
        setEditError('Only classes with the same course code and component can be merged.');
        return;
      }
      var destMembers = membersOf(dest);
      var combined = destMembers.reduce(function (n, c) {
        return n + (Number(c.studentCount) || 0);
      }, 0) + (Number(src.studentCount) || 0);
      var roomId = destRoomId(dest);
      var room = roomById(roomId);
      if (room && Number(room.capacity) > 0 && combined > Number(room.capacity)) {
        setEditError(
          'The target room holds ' +
            room.capacity +
            ' students; the combined class would have ' +
            combined +
            '.'
        );
        return;
      }
      var when = sortedMeetings(dest.meetings)
        .map(function (m) {
          return (DAY_FULL[m.day] || m.day) + ' ' + formatTimeRange(m.start, m.end);
        })
        .join('; ');
      var roomLabel = room ? room.label || room.code : '';
      var destPeople = destMembers
        .map(function (c) {
          return sectionLabel(c.sectionName, c.studentCount, c);
        })
        .join(', ');
      var lines = [
        sectionLabel(src.sectionName, src.studentCount, src) +
          ' will join ' +
          destPeople +
          '.',
        src.courseCode +
          ' ' +
          src.component +
          ' will follow this class: ' +
          dest.courseCode +
          ' ' +
          dest.component +
          (when ? ', ' + when : '') +
          (roomLabel ? ' in ' + roomLabel : '') +
          '.',
        'Combined class: ' + combined + ' students' + (room && room.capacity ? ' (room holds ' + room.capacity + ')' : '') + '.'
      ];
      var ignore = mergeIgnoreIds(src, dest);
      var clashes = [];
      dest.meetings.forEach(function (m) {
        var hit = windowBlocked(
          m.day,
          m.start,
          m.end,
          [src.sectionId],
          '',
          ignore,
          [],
          keyedLane(src)
        );
        if (hit && clashes.indexOf(hit) < 0) clashes.push(hit);
      });
      clashes.forEach(function (hit) {
        lines.push('Warning: ' + hit);
      });
      askConfirm({
        title: 'Merge into this class?',
        message: lines.join('\n\n'),
        yes: 'Merge',
        no: 'Cancel'
      }).then(function (ok) {
        if (ok) reassignSection(src.id, dest.id);
      });
    }

    function partitionMaxParts(cls) {
      var total = Number(cls && (cls.sectionStudentCount || cls.studentCount)) || 0;
      return Math.min(3, Math.floor(total / 5));
    }

    function partitionSizes(total, parts) {
      var base = Math.floor(total / parts);
      var extra = total % parts;
      var sizes = [];
      for (var i = 0; i < parts; i++) {
        sizes.push(base + (i < extra ? 1 : 0));
      }
      return sizes;
    }

    function partitionButton(src, parts) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sched-link-btn';
      btn.textContent = 'Split in ' + parts;
      btn.addEventListener('click', function () {
        confirmPartitionSection(src, parts);
      });
      return btn;
    }

    function confirmPartitionSection(src, parts) {
      var total = Number(src.sectionStudentCount || src.studentCount) || 0;
      var sizes = partitionSizes(total, parts);
      askConfirm({
        title: 'Partition this section?',
        message: [
          src.sectionName +
            ' takes ' +
            src.courseCode +
            ' ' +
            src.component +
            ' as ' +
            parts +
            ' partitions of ' +
            sizes.join(' and ') +
            ' students instead of one class of ' +
            total +
            '.',
          'The first partition keeps this timetable slot. The ' +
            (parts > 2 ? 'others' : 'other') +
            ' start unscheduled; use "Merge into…" to put each one in another class of the same subject.',
          'Partitions of one section may share a time slot with each other, but not with anything else the section takes.'
        ].join('\n\n'),
        yes: 'Partition',
        no: 'Cancel'
      }).then(function (ok) {
        if (ok) postPartitionChange('partition_section', { offeringId: src.id, parts: parts }, 'Section partitioned.');
      });
    }

    function confirmRecombineSection(src) {
      var total = Number(src.sectionStudentCount || src.studentCount) || 0;
      askConfirm({
        title: 'Recombine this section?',
        message: [
          src.sectionName +
            ' goes back to one class of ' +
            total +
            ' students for ' +
            src.courseCode +
            ' ' +
            src.component +
            '.',
          'The other partitions are removed and their students join this one, so the room has to hold the whole section at this time.'
        ].join('\n\n'),
        yes: 'Recombine',
        no: 'Cancel'
      }).then(function (ok) {
        if (ok) postPartitionChange('recombine_section', { offeringId: src.id }, 'Section recombined.');
      });
    }

    function postPartitionChange(action, extra, okText) {
      if (!global.McuApi) return;
      setEditError('');
      var body = {
        action: action,
        actor: actor,
        workspace: workspace,
        page: pageKind,
        schoolYear: yearEl.value,
        termCode: semEl.value
      };
      Object.keys(extra).forEach(function (k) {
        body[k] = extra[k];
      });
      global.McuApi.send('POST', 'schedule.php', body)
        .then(function (res) {
          applyPayload(res);
          closeEditModal();
          setStatus(okText, 'ok');
          render();
        })
        .catch(function (err) {
          setEditError(err.message || String(err));
        });
    }

    function confirmRemoveSection(src) {
      var label = sectionLabel(src.sectionName, src.studentCount, src);
      askConfirm({
        title: 'Remove this section?',
        message:
          label +
          ' will leave the merged class and become unscheduled. Its meetings are removed. Place it later with Add session, or merge it into another class.',
        yes: 'Remove',
        no: 'Cancel'
      }).then(function (ok) {
        if (ok) reassignSection(src.id, '');
      });
    }

    function reassignSection(offeringId, targetOfferingId) {
      if (!global.McuApi) return;
      setEditError('');
      global.McuApi.send('POST', 'schedule.php', {
        action: 'reassign_section',
        actor: actor,
        workspace: workspace,
        page: pageKind,
        schoolYear: yearEl.value,
        termCode: semEl.value,
        offeringId: offeringId,
        targetOfferingId: targetOfferingId || ''
      })
        .then(function (res) {
          applyPayload(res);
          closeEditModal();
          setStatus(
            targetOfferingId ? 'Section merged into the other class.' : 'Section removed from the merged class.',
            'ok'
          );
          render();
        })
        .catch(function (err) {
          setEditError(err.message || String(err));
        });
    }

    function showProposal(res) {
      runId = res.runId;
      if (!modal || !modalBody) return;
      var p = res.proposal || {};
      var lines = (p.members || [])
        .map(function (m) {
          return sectionLabel(m.name, m.studentCount) + ' · ' + m.collegeName;
        })
        .join('\n');
      modalBody.innerHTML =
        '<p>Merge <strong>' +
        escapeHtml(p.courseCode) +
        '</strong> — ' +
        escapeHtml(p.courseTitle) +
        ' <em>' +
        escapeHtml(p.component) +
        '</em>?</p>' +
        '<p>' +
        p.combinedCount +
        ' students' +
        (p.roomCode ? ' in ' + escapeHtml(p.roomCode) + ' (cap ' + p.roomCapacity + ')' : '') +
        (p.sameCollege ? '. Same college.' : '. Includes another college.') +
        '</p><pre class="sched-merge-list">' +
        escapeHtml(lines) +
        '</pre>' +
        '<p class="page-sub">' +
        (res.remaining || 1) +
        ' merge decision' +
        ((res.remaining || 1) === 1 ? '' : 's') +
        ' remaining.</p>';
      modal.hidden = false;
    }

    function handleGenerateResult(res) {
      if (runBtn) runBtn.disabled = false;
      if (remainingBtn) remainingBtn.disabled = false;
      if (res.status === 'needs_merge') {
        setStatus('Confirm this merge, then scheduling continues.', 'warn');
        showProposal(res);
        return;
      }
      if (modal) modal.hidden = true;
      applyPayload(res);
      var s = res.summary || {};
      var msg = res.remainingOnly
        ? 'Scheduled remaining classes where rooms were free. ' +
          s.scheduled +
          ' of ' +
          s.offerings +
          ' classes are placed.'
        : 'Placed ' + s.scheduled + ' of ' + s.offerings + ' classes.';
      setStatus(msg, s.unscheduled ? 'warn' : 'ok');
      render();
    }

    function generate(onlyUnscheduled) {
      if (scheduleLocked() || !currentOffering) return;
      if (!global.McuApi) {
        alert('MySQL is not connected.');
        return;
      }
      if (workspace !== 'mine') {
        setStatus('Generate only runs on My schedule.', 'bad');
        return;
      }
      var remaining = !!onlyUnscheduled;
      if (remaining) {
        var hasUnscheduled = classes.some(function (c) {
          return !(c.meetings && c.meetings.length);
        });
        if (!hasUnscheduled) {
          setStatus('There are no unscheduled classes to place.', 'muted');
          return;
        }
      }
      var settings = readGenSettingsFromForm();
      var start = function () {
        hideGenPanel();
        if (runBtn) runBtn.disabled = true;
        if (remainingBtn) remainingBtn.disabled = true;
        setStatus(remaining ? 'Scheduling remaining classes…' : 'Generating schedule…');
        var payload = {
          action: 'generate',
          actor: actor,
          workspace: workspace,
          page: pageKind,
          schoolYear: currentOffering.schoolYear,
          termCode: currentOffering.termCode,
          mergeMode: settings.mergeMode,
          splitHours: settings.splitHours,
          keepLunch: settings.keepLunch,
          partitionScope: settings.partitionScope,
          collegeId: generateCollegeId(),
          departmentId: generateDepartmentId(),
          yearLevel: ylEl ? ylEl.value : ''
        };
        if (remaining) payload.onlyUnscheduled = true;
        global.McuApi.send('POST', 'schedule.php', payload)
          .then(handleGenerateResult)
          .catch(function (err) {
            if (runBtn) runBtn.disabled = false;
            if (remainingBtn) remainingBtn.disabled = false;
            setStatus(err.message || String(err), 'bad');
          });
      };
      start();
    }

    function confirmUnscheduleClass(cls) {
      if (!cls || scheduleLocked()) return;
      var label =
        (cls.courseCode || 'Class') +
        ' ' +
        (cls.component || '') +
        ' · ' +
        sectionLabel(cls.sectionName, cls.studentCount, cls);
      askConfirm({
        title: 'Unschedule?',
        message:
          label +
          ' will become unscheduled. Other sections in a merged class keep their timetable.' +
          (cls.mergedClassId ? ' This section leaves the merge.' : ''),
        yes: 'Unschedule',
        no: 'Cancel'
      }).then(function (ok) {
        if (!ok) return;
        postEdit('unschedule_class', { offeringId: cls.id });
      });
    }

    function decide(accept) {
      if (!runId || !global.McuApi) return;
      modalYes.disabled = true;
      modalNo.disabled = true;
      global.McuApi.send('POST', 'schedule.php', {
        action: 'decide',
        actor: actor,
        workspace: workspace,
        page: pageKind,
        schoolYear: yearEl.value,
        termCode: semEl.value,
        runId: runId,
        accept: accept
      })
        .then(function (res) {
          modalYes.disabled = false;
          modalNo.disabled = false;
          handleGenerateResult(res);
        })
        .catch(function (err) {
          modalYes.disabled = false;
          modalNo.disabled = false;
          setStatus(err.message || String(err), 'bad');
        });
    }

    document.querySelectorAll('[data-sched-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-sched-view');
        if (next === 'rooms' && primaryView !== 'rooms') {
          selectedBuilding = '';
          selectedRoom = '';
          showView('rooms', defaultRoomLayout());
          return;
        }
        showView(next, layout);
      });
    });
    document.querySelectorAll('[data-sched-layout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-sched-layout') === 'table') {
          selectedBuilding = '';
          selectedRoom = '';
        }
        showView(primaryView, btn.getAttribute('data-sched-layout'));
      });
    });
    if (colEl) {
      colEl.addEventListener('change', function () {
        fillDepartments();
        if (primaryView === 'sections') render();
      });
    }
    if (depEl) {
      depEl.addEventListener('change', function () {
        if (primaryView === 'sections') render();
      });
    }
    if (ylEl) {
      ylEl.addEventListener('change', function () {
        if (primaryView === 'sections') render();
      });
    }
    if (sectionStatusEl) {
      sectionStatusEl.addEventListener('change', function () {
        if (primaryView === 'sections') render();
      });
    }
    if (roomBuildingEl) {
      roomBuildingEl.addEventListener('change', function () {
        fillRoomFloorFilter();
        showView('rooms', 'table');
      });
    }
    if (roomFloorEl) {
      roomFloorEl.addEventListener('change', function () {
        showView('rooms', 'table');
      });
    }
    if (roomTypeEl) {
      roomTypeEl.addEventListener('change', function () {
        showView('rooms', 'table');
      });
    }
    if (classSearchEl) {
      classSearchEl.addEventListener('input', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (classCollegeEl) {
      classCollegeEl.addEventListener('change', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (classComponentEl) {
      classComponentEl.addEventListener('change', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (classStatusEl) {
      classStatusEl.addEventListener('change', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (classYearLevelEl) {
      classYearLevelEl.addEventListener('change', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (classBuildingEl) {
      classBuildingEl.addEventListener('change', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (classMergedEl) {
      classMergedEl.addEventListener('change', function () {
        if (primaryView === 'classes') renderClasses();
      });
    }
    if (segActive) {
      segActive.addEventListener('click', function () {
        setOfferingPane('active');
      });
    }
    if (segArchived) {
      segArchived.addEventListener('click', function () {
        setOfferingPane('archived');
      });
    }
    document.querySelectorAll('[data-ws-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setWorkspace(btn.getAttribute('data-ws-tab'));
      });
    });
    if (qs('schedSaveAsConfirm')) qs('schedSaveAsConfirm').addEventListener('click', confirmSaveAs);
    if (qs('schedSaveAsCancel')) qs('schedSaveAsCancel').addEventListener('click', closeSaveAsModal);
    if (qs('schedSaveAsModal')) {
      qs('schedSaveAsModal').addEventListener('click', function (e) {
        if (e.target === qs('schedSaveAsModal')) closeSaveAsModal();
      });
    }
    if (qs('schedSaveAsName')) {
      qs('schedSaveAsName').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmSaveAs();
        }
      });
    }
    if (qs('schedOpenSaveMine')) {
      qs('schedOpenSaveMine').addEventListener('click', function () {
        openSaveInto();
      });
    }
    if (qs('schedOpenSaveCancel')) qs('schedOpenSaveCancel').addEventListener('click', closeOpenSaveModal);
    if (qs('schedOpenSaveModal')) {
      qs('schedOpenSaveModal').addEventListener('click', function (e) {
        if (e.target === qs('schedOpenSaveModal')) closeOpenSaveModal();
      });
    }
    if (backArchivedBtn) {
      backArchivedBtn.addEventListener('click', function () {
        archivedPick = null;
        selectedVersion = '';
        fillYears();
        showView(primaryView, layout);
        loadSchedule();
      });
    }
    if (archiveBtn) {
      archiveBtn.addEventListener('click', function () {
        if (!currentOffering || !global.SectionsStore) return;
        var title = offeringTitle(currentOffering.schoolYear, currentOffering.termCode);
        askConfirm({
          title: 'Archive this offering?',
          message:
            'Archive ' +
            title +
            '? This files the sections and timetable together. They stay under Archived and can be restored later.',
          yes: 'Archive',
          no: 'Cancel',
          yesClass: 'sched-btn--archive'
        }).then(function (ok) {
          if (!ok) return;
          archiveBtn.disabled = true;
          global.SectionsStore.archiveTerm(currentOffering.schoolYear, currentOffering.termCode).then(function (res) {
            archiveBtn.disabled = false;
            if (!res.ok) {
              alert(res.error || 'Could not archive this offering.');
              return;
            }
            currentOffering = null;
            classes = [];
            offeringPane = 'archived';
            archivedPick = null;
            selectedVersion = '';
            if (usesWorkspace) workspace = 'archives';
            loadSchedule();
          });
        });
      });
    }
    yearEl.addEventListener('change', function () {
      selectedVersion = '';
      if (pageKind === 'report') reportYear = yearEl.value;
      loadSchedule();
    });
    global.addEventListener('scroll', function (e) {
      var panel = qs('schedRoomHover');
      if (panel && e.target && (e.target === panel || (panel.contains && panel.contains(e.target)))) {
        return;
      }
      hideRoomHover();
    }, true);
    global.addEventListener('resize', hideRoomHover);
    semEl.addEventListener('change', function () {
      selectedVersion = '';
      if (pageKind === 'report') reportSem = semEl.value;
      loadSchedule();
    });
    if (qs('schedReady')) {
      qs('schedReady').addEventListener('click', function () {
        if (actor !== 'admin') return;
        var pub = publication || {};
        var msg =
          pub.status === 'pending_super_admin'
            ? 'Replace the package Super Admin is reviewing with the current Create schedule timetable for this whole campus term?'
            : 'Send the current Create schedule timetable for this whole campus term to Super Admin?';
        if (!global.confirm(msg)) return;
        runPublication('ready_for_super_admin');
      });
    }
    if (qs('schedApprove')) {
      qs('schedApprove').addEventListener('click', function () {
        if (actor === 'vpaa') {
          if (!global.confirm('Publish this campus timetable for deans and program chairs?')) return;
          runPublication('vpaa_decide', { accept: true });
          return;
        }
        var pub = publication || {};
        var msg;
        if (pub.returnedFromVpaa) {
          msg = pub.workingDiffersFromSubmitted
            ? 'Send the package the VPAA returned, not the live timetable?'
            : 'Send this package to the VPAA again?';
        } else {
          msg = pub.workingDiffersFromSubmitted
            ? 'Send Admin’s submitted snapshot to the VPAA? The live timetable has changed since they submitted.'
            : 'Approve the package Admin submitted and send it to the VPAA?';
        }
        askConfirm({
          title: 'Send to VPAA?',
          message: msg,
          yes: 'Send to VPAA',
          no: 'Cancel'
        }).then(function (ok) {
          if (!ok) return;
          runPublication('super_admin_decide', { accept: true });
        });
      });
    }
    if (qs('schedSendLive')) {
      qs('schedSendLive').addEventListener('click', function () {
        if (actor !== 'super_admin') return;
        var pub = publication || {};
        var differs = !!pub.workingDiffersFromSubmitted && pub.status === 'pending_super_admin';
        var msg;
        if (pub.returnedFromVpaa && differs) {
          msg = 'Send the live timetable to the VPAA instead of the package they returned? This freezes Create schedule as it is now.';
        } else if (differs) {
          msg = 'Send the live timetable to the VPAA instead of Admin’s submitted snapshot? This freezes Create schedule as it is now.';
        } else {
          msg = 'Send the current live timetable to the VPAA? Admin does not need to submit first. This freezes Create schedule as it is now.';
        }
        askConfirm({
          title: 'Send live timetable to VPAA?',
          message: msg,
          yes: 'Send live timetable',
          no: 'Cancel'
        }).then(function (ok) {
          if (!ok) return;
          runPublication('super_admin_send_live');
        });
      });
    }
    if (qs('schedReject')) {
      qs('schedReject').addEventListener('click', openRejectModal);
    }
    if (qs('schedRejectCancel')) {
      qs('schedRejectCancel').addEventListener('click', closeRejectModal);
    }
    if (qs('schedRejectSend')) {
      qs('schedRejectSend').addEventListener('click', function () {
        var note = qs('schedRejectNote') ? String(qs('schedRejectNote').value || '').trim() : '';
        if (!note) {
          setStatus(
            actor === 'vpaa' ? 'Say what Super Admin should revise.' : 'Say what the Admin should revise.',
            'bad'
          );
          return;
        }
        closeRejectModal();
        runPublication(actor === 'vpaa' ? 'vpaa_decide' : 'super_admin_decide', { accept: false, note: note });
      });
    }
    if (qs('schedRejectModal')) {
      qs('schedRejectModal').addEventListener('click', function (e) {
        if (e.target === qs('schedRejectModal')) closeRejectModal();
      });
    }
    if (runBtn) runBtn.addEventListener('click', function () {
      generate(false);
    });
    if (remainingBtn) {
      remainingBtn.addEventListener('click', function () {
        generate(true);
      });
    }
    if (genSettingsBtn) genSettingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleGenPanel();
    });
    if (genSaveBtn) genSaveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      saveGenSettings();
    });
    if (genMergeEl) {
      genMergeEl.addEventListener('change', syncPartitionToggle);
    }
    if (genPartitionEl) {
      genPartitionEl.addEventListener('change', function () {
        if (!genPartitionEl.disabled) {
          generatorSettings.partitionScope = genPartitionEl.value;
        }
      });
    }
    var genInfo = qs('schedGenInfo');
    var genInfoBtn = qs('schedGenInfoBtn');
    var genInfoPop = qs('schedGenInfoPop');
    if (genInfoBtn && genInfo) {
      genInfoBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !genInfo.classList.contains('is-open');
        genInfo.classList.toggle('is-open', open);
        genInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    if (genInfoPop) {
      genInfoPop.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
    }
    if (genPanel) {
      genPanel.addEventListener('click', function (e) {
        e.stopPropagation();
        if (genInfo && !genInfo.contains(e.target)) hideGenInfo();
      });
    }
    document.addEventListener('click', function (e) {
      if (!genPanel || genPanel.hidden || !genSettingsWrap) return;
      if (genSettingsWrap.contains(e.target)) return;
      hideGenPanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideGenPanel();
    });
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        window.print();
      });
    }
    if (modalYes) modalYes.addEventListener('click', function () { decide(true); });
    if (modalNo) modalNo.addEventListener('click', function () { decide(false); });
    if (qs('schedEditSave')) qs('schedEditSave').addEventListener('click', saveMeeting);
    if (qs('schedEditCancel')) qs('schedEditCancel').addEventListener('click', closeEditModal);
    if (qs('schedEditAdd')) qs('schedEditAdd').addEventListener('click', startAddMeeting);
    if (qs('schedEditSplit')) qs('schedEditSplit').addEventListener('click', startSplitMeeting);
    if (qs('schedEditCombine')) qs('schedEditCombine').addEventListener('click', startCombineMeetings);
    if (qs('schedEditRemove')) qs('schedEditRemove').addEventListener('click', removeSelectedMeeting);
    if (qs('schedEditPlannerCancel')) qs('schedEditPlannerCancel').addEventListener('click', closePlanner);
    if (qs('schedEditViewSession')) {
      qs('schedEditViewSession').addEventListener('click', function () {
        syncEditPane('session');
      });
    }
    if (qs('schedEditViewSections')) {
      qs('schedEditViewSections').addEventListener('click', function () {
        syncEditPane('sections');
      });
    }
    mountEditLayout();
    ['schedEditStart', 'schedEditEnd'].forEach(function (id) {
      if (qs(id)) qs(id).addEventListener('change', refreshEditHoursHint);
    });
    if (qs('schedEditRoom')) {
      qs('schedEditRoom').addEventListener('change', function () {
        updateRoomLink(qs('schedEditRoom').value);
        refreshEditRoomHint();
      });
    }
    ['schedEditRoomBuilding', 'schedEditRoomTypeFilter'].forEach(function (id) {
      var el = qs(id);
      if (!el) return;
      el.addEventListener('change', function () {
        refillRoomPicker('edit');
      });
    });
    ['schedEditPlannerRoomBuilding', 'schedEditPlannerRoomTypeFilter'].forEach(function (id) {
      var el = qs(id);
      if (!el) return;
      el.addEventListener('change', function () {
        refillRoomPicker('planner');
      });
    });
    if (qs('schedConfirmYes')) qs('schedConfirmYes').addEventListener('click', function () { closeConfirmModal(true); });
    if (qs('schedConfirmNo')) qs('schedConfirmNo').addEventListener('click', function () { closeConfirmModal(false); });
    if (qs('schedConfirmModal')) {
      qs('schedConfirmModal').addEventListener('click', function (e) {
        if (e.target === qs('schedConfirmModal')) closeConfirmModal(false);
      });
    }
    if (qs('schedEditPlannerDuration')) qs('schedEditPlannerDuration').addEventListener('change', refreshPlanner);
    if (qs('schedEditPlannerRoom')) qs('schedEditPlannerRoom').addEventListener('change', refreshPlanner);
    if (qs('schedRoomPreviewClose')) qs('schedRoomPreviewClose').addEventListener('click', closeRoomPreview);
    if (qs('schedRoomPreviewModal')) {
      qs('schedRoomPreviewModal').addEventListener('click', function (e) {
        if (e.target === qs('schedRoomPreviewModal')) closeRoomPreview();
      });
    }
    if (editModal) {
      editModal.addEventListener('click', function (e) {
        if (e.target === editModal) closeEditModal();
      });
    }
    document.addEventListener('click', function (e) {
      if (scheduleLocked()) return;
      var unscheduleBtn = e.target.closest && e.target.closest('[data-unschedule-offering]');
      if (unscheduleBtn) {
        var drop = classById(unscheduleBtn.getAttribute('data-unschedule-offering'));
        if (drop) confirmUnscheduleClass(drop);
        return;
      }
      var btn = e.target.closest && e.target.closest('[data-edit-offering]');
      if (!btn) return;
      var cls = classById(btn.getAttribute('data-edit-offering'));
      if (!cls) return;
      openEditModal(cls, meetingById(cls, btn.getAttribute('data-edit-meeting')));
    });

    applyHash();
    fillYears();
    fillColleges();
    syncWorkspaceTabs();
    showView(primaryView, layout);
    loadSchedule();
    if (global.OrgStore) {
      global.OrgStore.onChange(function () {
        fillColleges();
        fillClassCollegeFilter();
      });
    }
    if (global.SectionsStore) {
      global.SectionsStore.onChange(function () {
        loadSchedule();
      });
    }
  });
})(typeof window !== 'undefined' ? window : this);
