(function () {
  'use strict';

  var yearSel = document.getElementById('flYear');
  var semSel = document.getElementById('flSemester');
  var crumb = document.getElementById('flCrumb');
  var hint = document.getElementById('flHint');
  var stage = document.getElementById('flStage');
  var overlay = document.getElementById('flOverlay');
  var sheet = document.getElementById('flSheet');
  if (!yearSel || !semSel || !crumb || !stage || !overlay || !sheet || !window.FacultyLoadingStore) return;

  var termBar = yearSel.closest('.fl-term');
  if (termBar) {
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'dm-btn-sm dm-btn-sm--archive fl-clear';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', function () {
      if (!window.confirm('Clear every faculty loading? This removes all faculty and sends the chain back to the start. Sections and the schedule stay as they are.')) return;
      clearBtn.disabled = true;
      FacultyLoadingStore.clear().then(function (res) {
        closeSheet();
        browse = { mode: 'root', collegeId: '', departmentId: '' };
        openFacultyId = '';
        applyPayload(res);
      }).catch(function (err) {
        window.alert(err.message || 'Could not clear faculty loading.');
      }).then(function () {
        clearBtn.disabled = false;
      });
    });
    termBar.appendChild(clearBtn);
  }

  var actor = null;
  var documents = [];
  var browse = { mode: 'root', collegeId: '', departmentId: '' };
  var openFacultyId = '';

  function semesterLabel(code) {
    if (code === '2') return '2nd semester';
    if (code === 'summer') return 'Summer';
    return '1st semester';
  }

  function fallbackYear() {
    var now = new Date();
    var y = now.getFullYear();
    if (now.getMonth() < 5) y -= 1;
    return y + '-' + (y + 1);
  }

  function collegeById(id) {
    return window.OrgStore ? OrgStore.findCollege(id) : null;
  }

  function collegeHasDepartments(col) {
    return !!(col && col.useDepartments && col.departments && col.departments.length);
  }

  function departmentById(col, id) {
    if (!col || !id) return null;
    var list = col.departments || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function visibleColleges() {
    var all = window.OrgStore ? OrgStore.colleges() : [];
    if (!actor) return [];
    if (actor.role === 'dean' || actor.role === 'program_chair') {
      return all.filter(function (col) { return col.id === actor.collegeId; });
    }
    return all;
  }

  function termDocs() {
    return documents.filter(function (doc) {
      return doc.schoolYear === yearSel.value && doc.termCode === semSel.value;
    });
  }

  function findDoc(collegeId, departmentId) {
    var dept = departmentId || '';
    var list = termDocs();
    for (var i = 0; i < list.length; i++) {
      if (list[i].collegeId === collegeId && (list[i].departmentId || '') === dept) return list[i];
    }
    return null;
  }

  function statusText(doc, collegeLevel) {
    if (!doc) return 'Not started';
    if (doc.status === 'draft') return collegeLevel ? 'Draft, with the Dean' : 'Draft, with the Program Chair';
    if (doc.status === 'pending_dean') return 'With the Dean';
    if (doc.status === 'pending_registrar') return 'With the Registrar';
    if (doc.status === 'pending_vpaa') return 'With the VPAA';
    if (doc.status === 'accepted') return 'Accepted';
    return doc.status;
  }

  function applyPayload(res) {
    actor = res.actor;
    documents = res.documents || [];
    if (actor && actor.role === 'program_chair' && actor.departmentId) {
      browse = { mode: 'faculty', collegeId: actor.collegeId, departmentId: actor.departmentId };
    } else if (actor && actor.role === 'dean' && !actor.hasDepartments) {
      browse = { mode: 'faculty', collegeId: actor.collegeId, departmentId: '' };
    } else if (actor && actor.role === 'dean' && actor.hasDepartments && browse.mode === 'root') {
      browse = { mode: 'college', collegeId: actor.collegeId, departmentId: '' };
    }
    render();
  }

  function refresh() {
    return FacultyLoadingStore.load().then(applyPayload).catch(function (err) {
      stage.innerHTML = '';
      stage.appendChild(el('p', 'page-sub', err.message || 'Could not load faculty loading.'));
    });
  }

  function fillTerms() {
    var seen = {};
    function add(label) {
      var clean = String(label || '').trim();
      if (clean) seen[clean] = true;
    }
    if (window.SectionsStore) {
      (SectionsStore.schoolYears() || []).forEach(function (y) { add(y.label); });
      var current = SectionsStore.currentTerm();
      if (current) add(current.schoolYear);
      (SectionsStore.archivedTerms() || []).forEach(function (t) { add(t.schoolYear); });
    }
    documents.forEach(function (doc) { add(doc.schoolYear); });
    add(fallbackYear());
    var currentTerm = window.SectionsStore ? SectionsStore.currentTerm() : null;
    var year = yearSel.value || (currentTerm && currentTerm.schoolYear) || '';
    var code = semSel.value || (currentTerm && currentTerm.termCode) || '1';
    yearSel.innerHTML = '';
    Object.keys(seen).sort(function (a, b) { return b.localeCompare(a); }).forEach(function (label) {
      var opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      yearSel.appendChild(opt);
    });
    if (year) yearSel.value = year;
    if (yearSel.selectedIndex < 0) yearSel.selectedIndex = 0;
    semSel.value = code === '2' || code === 'summer' ? code : '1';
  }

  function canEditCurrent() {
    if (!actor || browse.mode !== 'faculty') return false;
    var doc = findDoc(browse.collegeId, browse.departmentId);
    if (doc && doc.status !== 'draft') return false;
    if (actor.creates === 'department') return browse.departmentId === actor.departmentId;
    if (actor.creates === 'college') return !browse.departmentId && browse.collegeId === actor.collegeId;
    return false;
  }

  function renderHint() {
    if (!hint || !actor) return;
    if (actor.creates === 'department') {
      hint.textContent = 'You work at department level. Prepare this department’s faculty loading, then send it to the Dean.';
    } else if (actor.role === 'dean' && actor.hasDepartments) {
      hint.textContent = 'You work at college level. Approve the departments your Program Chairs have sent. That sends the college on to the Registrar.';
    } else if (actor.creates === 'college') {
      hint.textContent = 'This college has no departments, so you prepare its faculty loading and send it to the Registrar.';
    } else if (actor.role === 'admin' || actor.role === 'super_admin') {
      hint.textContent = 'You are the Registrar. You work at university level and verify what the Deans have approved.';
    } else if (actor.role === 'vpaa') {
      hint.textContent = 'You work at university level. Accept what the Registrar has verified.';
    } else {
      hint.textContent = 'Faculty loading stays on this page. It does not change sections or the schedule.';
    }
  }

  function isRegistrar() {
    return actor && (actor.role === 'admin' || actor.role === 'super_admin');
  }

  function renderCrumb() {
    crumb.innerHTML = '';
    if (!actor) return;
    if (actor.role === 'program_chair') {
      crumb.appendChild(el('span', '', (actor.collegeName || 'College') + ' / ' + (actor.departmentName || 'Department')));
      return;
    }
    if (actor.role === 'dean') {
      crumb.appendChild(el('span', '', actor.collegeName || 'College'));
      if (browse.mode === 'faculty' && browse.departmentId) {
        var own = collegeById(browse.collegeId);
        var ownDept = departmentById(own, browse.departmentId);
        crumb.appendChild(el('span', '', ' / ' + (ownDept ? ownDept.name : 'Department')));
        var backOwn = document.createElement('button');
        backOwn.type = 'button';
        backOwn.textContent = 'Back to college';
        backOwn.addEventListener('click', function () {
          browse = { mode: 'college', collegeId: actor.collegeId, departmentId: '' };
          closeSheet();
          render();
        });
        crumb.appendChild(backOwn);
      }
      return;
    }
    var root = document.createElement('button');
    root.type = 'button';
    root.textContent = 'University';
    root.addEventListener('click', function () {
      browse = { mode: 'root', collegeId: '', departmentId: '' };
      closeSheet();
      render();
    });
    crumb.appendChild(root);
    if (browse.mode === 'root') return;
    var col = collegeById(browse.collegeId);
    crumb.appendChild(el('span', '', ' / ' + (col ? col.name : 'College')));
    if (browse.departmentId) {
      var dept = departmentById(col, browse.departmentId);
      crumb.appendChild(el('span', '', ' / ' + (dept ? dept.name : 'Department')));
    }
  }

  function waitingStatus(action) {
    if (action === 'approve') return 'pending_dean';
    if (action === 'verify') return 'pending_registrar';
    if (action === 'accept') return 'pending_vpaa';
    return '';
  }

  function actOn(action, docs, note) {
    var list = (docs || []).filter(function (doc) { return doc && doc.id; });
    if (!list.length) {
      window.alert('Nothing is waiting for that.');
      return;
    }
    var chain = Promise.resolve();
    list.forEach(function (doc) {
      chain = chain.then(function () {
        return FacultyLoadingStore.act(action, doc.id, note || '');
      });
    });
    chain.then(applyPayload).catch(function (err) {
      window.alert(err.message || 'Could not update faculty loading.');
      refresh();
    });
  }

  function reviewUnit(collegeId, departmentId) {
    browse = { mode: 'faculty', collegeId: collegeId, departmentId: departmentId || '' };
    closeSheet();
    render();
  }

  function unitsIn(col) {
    var units = [];
    if (collegeHasDepartments(col)) {
      col.departments.forEach(function (dept) {
        units.push({
          name: dept.name,
          meta: 'Department',
          collegeId: col.id,
          departmentId: dept.id,
          doc: findDoc(col.id, dept.id)
        });
      });
    } else {
      units.push({
        name: 'College faculty loading',
        meta: 'No departments',
        collegeId: col.id,
        departmentId: '',
        doc: findDoc(col.id, '')
      });
    }
    return units;
  }

  function queueRow(name, meta, doc, collegeId, departmentId, actionName, actionLabel) {
    var waiting = !!(doc && actionName && doc.status === waitingStatus(actionName));
    var row = el('div', 'fl-queue-row' + (waiting ? ' is-waiting' : ''));
    var main = el('div', 'fl-queue-main');
    main.appendChild(el('strong', '', name));
    if (meta) main.appendChild(el('span', 'fl-queue-meta', meta));
    main.appendChild(el('span', 'fl-queue-status', statusText(doc, !departmentId)));
    row.appendChild(main);
    var actions = el('div', 'fl-queue-actions');
    var review = document.createElement('button');
    review.type = 'button';
    review.className = 'dm-btn-sm';
    review.textContent = 'Review';
    review.addEventListener('click', function () { reviewUnit(collegeId, departmentId); });
    actions.appendChild(review);
    if (waiting) {
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'dm-btn-add';
      go.textContent = actionLabel;
      go.addEventListener('click', function () { actOn(actionName, [doc], ''); });
      actions.appendChild(go);
      var note = document.createElement('input');
      note.type = 'text';
      note.placeholder = 'Note if you send it back';
      note.maxLength = 240;
      note.setAttribute('aria-label', 'Note if you send this back');
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'dm-btn-sm';
      back.textContent = 'Return';
      back.addEventListener('click', function () { actOn('return', [doc], note.value); });
      actions.appendChild(note);
      actions.appendChild(back);
    }
    row.appendChild(actions);
    return row;
  }

  function levelBar(title, detail, actionName, actionLabel, docs) {
    var head = el('div', 'fl-level');
    var text = el('div', 'fl-level-text');
    text.appendChild(el('h2', '', title));
    text.appendChild(el('p', '', detail));
    head.appendChild(text);
    if (actionName && docs.length) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dm-btn-add';
      btn.textContent = docs.length === 1 ? actionLabel : actionLabel + ' (' + docs.length + ')';
      btn.addEventListener('click', function () { actOn(actionName, docs, ''); });
      head.appendChild(btn);
    }
    stage.appendChild(head);
  }

  function renderCollegeBoard() {
    var col = collegeById((actor && actor.collegeId) || browse.collegeId);
    if (!col) {
      stage.appendChild(el('p', 'page-sub', 'No college is assigned to this account.'));
      return;
    }
    var units = unitsIn(col);
    var waiting = [];
    units.forEach(function (unit) {
      if (unit.doc && unit.doc.status === 'pending_dean') waiting.push(unit.doc);
    });
    levelBar(
      col.name,
      waiting.length
        ? 'Approving sends every department that is with you on to the Registrar. A department still with its Program Chair stays put.'
        : 'Nothing in this college is waiting for you. A department shows up here after its Program Chair submits it.',
      'approve',
      'Approve this college',
      waiting
    );
    var list = el('div', 'fl-queue');
    units.forEach(function (unit) {
      list.appendChild(queueRow(unit.name, unit.meta, unit.doc, unit.collegeId, unit.departmentId, 'approve', 'Approve'));
    });
    stage.appendChild(list);
  }

  function renderUniversity() {
    var actionName = isRegistrar() ? 'verify' : (actor.role === 'vpaa' ? 'accept' : '');
    var actionLabel = actionName === 'accept' ? 'Accept the university' : 'Verify the university';
    var rowLabel = actionName === 'accept' ? 'Accept' : 'Verify';
    var want = waitingStatus(actionName);
    var colleges = visibleColleges();
    var waiting = [];
    colleges.forEach(function (col) {
      unitsIn(col).forEach(function (unit) {
        if (want && unit.doc && unit.doc.status === want) waiting.push(unit.doc);
      });
    });
    var detail = actionName === 'accept'
      ? (waiting.length
        ? 'Accepting finishes the chain for everything the Registrar has verified.'
        : 'Nothing at the university is waiting for the VPAA.')
      : (waiting.length
        ? 'Verifying sends everything a Dean has approved on to the VPAA.'
        : 'Nothing at the university is waiting for the Registrar.');
    levelBar('University', detail, actionName, actionLabel, waiting);
    if (!colleges.length) {
      stage.appendChild(el('p', 'page-sub', 'No colleges are on file.'));
      return;
    }
    colleges.forEach(function (col) {
      var block = el('section', 'fl-college-block');
      block.appendChild(el('h3', '', col.name));
      var list = el('div', 'fl-queue');
      unitsIn(col).forEach(function (unit) {
        list.appendChild(queueRow(unit.name, unit.meta, unit.doc, unit.collegeId, unit.departmentId, actionName, rowLabel));
      });
      block.appendChild(list);
      stage.appendChild(block);
    });
  }

  function stepsFor(collegeLevel) {
    return collegeLevel
      ? ['Created by Dean', 'Approved by Dean', 'Verified by Registrar', 'Accepted by VPAA']
      : ['Created by Program Chair', 'Approved by Dean', 'Verified by Registrar', 'Accepted by VPAA'];
  }

  function stepIndex(status) {
    if (status === 'pending_dean') return 1;
    if (status === 'pending_registrar') return 2;
    if (status === 'pending_vpaa') return 3;
    if (status === 'accepted') return 4;
    return 0;
  }

  function renderFlow(doc, collegeLevel) {
    var flow = el('ol', 'fl-flow');
    var index = stepIndex(doc && doc.status);
    stepsFor(collegeLevel).forEach(function (label, i) {
      var item = el('li', 'fl-step', label);
      if (i < index) item.classList.add('is-done');
      else if (i === index && (!doc || doc.status !== 'accepted')) item.classList.add('is-current');
      else if (doc && doc.status === 'accepted') item.classList.add('is-done');
      flow.appendChild(item);
    });
    stage.appendChild(flow);
    stage.appendChild(el('p', 'fl-status', statusText(doc, collegeLevel)));
  }

  function renderActions(doc, collegeLevel) {
    if (!actor) return;
    var bar = el('div', 'fl-actions');
    var note = document.createElement('input');
    note.type = 'text';
    note.placeholder = 'Note when sending it back';
    note.maxLength = 240;
    note.setAttribute('aria-label', 'Note when sending it back');
    function go(action) {
      if (!doc || !doc.id) {
        window.alert('Add at least one faculty member before sending this on.');
        return;
      }
      FacultyLoadingStore.act(action, doc.id, note.value).then(applyPayload).catch(function (err) {
        window.alert(err.message || 'Could not update this faculty loading.');
      });
    }
    function button(label, className, action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener('click', function () { go(action); });
      bar.appendChild(btn);
    }
    var status = doc ? doc.status : 'draft';
    if (canEditCurrent() && (!doc || !doc.id || status === 'draft')) {
      button(collegeLevel ? 'Submit to Registrar' : 'Submit to Dean', 'dm-btn-add', 'submit');
    }
    if (doc && doc.id && actor.role === 'dean' && status === 'pending_dean') {
      button('Approve', 'dm-btn-add', 'approve');
      bar.appendChild(note);
      button('Return', 'dm-btn-sm', 'return');
    }
    if (doc && doc.id && (actor.role === 'admin' || actor.role === 'super_admin') && status === 'pending_registrar') {
      button('Verify', 'dm-btn-add', 'verify');
      bar.appendChild(note);
      button('Return', 'dm-btn-sm', 'return');
    }
    if (doc && doc.id && actor.role === 'vpaa' && status === 'pending_vpaa') {
      button('Accept', 'dm-btn-add', 'accept');
      bar.appendChild(note);
      button('Return', 'dm-btn-sm', 'return');
    }
    if (bar.childNodes.length) stage.appendChild(bar);
    if (doc && doc.history && doc.history.length) {
      var list = el('ul', 'fl-history');
      doc.history.slice().reverse().forEach(function (item) {
        var line = item.action + (item.name ? ' · ' + item.name : '');
        if (item.note) line += ' — ' + item.note;
        list.appendChild(el('li', '', line));
      });
      stage.appendChild(list);
    }
  }

  function renderFaculty() {
    var col = collegeById(browse.collegeId);
    var collegeLevel = !browse.departmentId;
    var doc = findDoc(browse.collegeId, browse.departmentId);
    var people = doc ? doc.faculty : [];
    renderFlow(doc, collegeLevel);
    renderActions(doc, collegeLevel);
    if (!people.length) {
      stage.appendChild(el('p', 'page-sub', canEditCurrent() ? 'No faculty in this list yet.' : 'No faculty have been added for this term.'));
    } else {
      var list = el('ul', 'fl-people');
      people.forEach(function (person) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fl-person';
        btn.textContent = person.name;
        btn.addEventListener('click', function () { openSheet(person.id); });
        li.appendChild(btn);
        list.appendChild(li);
      });
      stage.appendChild(list);
    }
    if (canEditCurrent()) {
      var form = el('form', 'fl-add');
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Faculty name';
      input.setAttribute('aria-label', 'Faculty name');
      input.maxLength = 120;
      var add = document.createElement('button');
      add.type = 'submit';
      add.className = 'dm-btn-add';
      add.textContent = 'Add faculty';
      form.appendChild(input);
      form.appendChild(add);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = String(input.value || '').replace(/\s+/g, ' ').trim();
        if (!name) return;
        var next = people.map(function (person) { return { id: person.id, name: person.name }; });
        next.push({ id: 'fl-' + Date.now().toString(36), name: name });
        FacultyLoadingStore.save({
          schoolYear: yearSel.value,
          termCode: semSel.value,
          faculty: next,
          rows: doc ? doc.rows : []
        }).then(applyPayload).catch(function (err) {
          window.alert(err.message || 'Could not add that faculty member.');
        });
      });
      stage.appendChild(form);
    }
  }

  function closeSheet() {
    openFacultyId = '';
    overlay.hidden = true;
    sheet.innerHTML = '';
  }

  function openSheet(id) {
    openFacultyId = id;
    overlay.hidden = false;
    paintSheet();
  }

  function paintSheet() {
    var doc = findDoc(browse.collegeId, browse.departmentId);
    var person = null;
    (doc ? doc.faculty : []).forEach(function (item) {
      if (item.id === openFacultyId) person = item;
    });
    sheet.innerHTML = '';
    if (!person || !doc) {
      closeSheet();
      return;
    }
    var col = collegeById(doc.collegeId);
    var dept = departmentById(col, doc.departmentId);
    var editable = canEditCurrent();
    var closeRow = el('div', 'fl-sheet-close');
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dm-btn-sm';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeSheet);
    closeRow.appendChild(closeBtn);
    sheet.appendChild(closeRow);

    var head = el('div', 'fl-letterhead');
    var center = el('div', 'fl-letterhead-center');
    center.appendChild(el('div', 'fl-university', 'Manila Central University'));
    center.appendChild(el('div', 'fl-address', 'Caloocan City'));
    var logo = document.createElement('img');
    logo.className = 'fl-logo';
    logo.src = '../Attri/mculogo.jpg';
    logo.alt = 'Manila Central University logo';
    head.appendChild(el('div'));
    head.appendChild(center);
    head.appendChild(logo);
    sheet.appendChild(head);
    sheet.appendChild(el('div', 'fl-faculty-name', person.name));
    var scope = (col && col.name) || doc.collegeName || '';
    var deptName = (dept && dept.name) || doc.departmentName || '';
    if (deptName) scope += (scope ? ' · ' : '') + deptName;
    scope += (scope ? ' · ' : '') + doc.schoolYear + ' · ' + semesterLabel(doc.termCode);
    sheet.appendChild(el('div', 'fl-faculty-scope', scope));

    var rows = (doc.rows || []).filter(function (row) { return row.facultyId === person.id; });
    var columns = [
      { label: 'Room', cls: 'fl-col-room' },
      { label: 'Section', cls: 'fl-col-section' },
      { label: 'Subject', cls: 'fl-col-subject' },
      { label: 'Number of students', cls: 'fl-col-students' }
    ];
    var wrap = el('div', 'fl-table-wrap');
    var table = el('table', 'fl-table');
    var colgroup = document.createElement('colgroup');
    columns.forEach(function (col) {
      var colEl = document.createElement('col');
      colEl.className = col.cls;
      colgroup.appendChild(colEl);
    });
    if (editable) {
      var actionCol = document.createElement('col');
      actionCol.className = 'fl-col-action';
      colgroup.appendChild(actionCol);
    }
    table.appendChild(colgroup);
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    columns.forEach(function (col) {
      hr.appendChild(el('th', col.cls, col.label));
    });
    if (editable) hr.appendChild(el('th', 'fl-col-action', ''));
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    if (!rows.length) {
      var empty = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = editable ? 5 : 4;
      td.textContent = 'No classes recorded for this academic year and semester.';
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      ['room', 'section', 'subject', 'students'].forEach(function (field, index) {
        var cell = document.createElement('td');
        cell.className = columns[index].cls;
        var input = document.createElement('input');
        input.type = field === 'students' ? 'number' : 'text';
        input.disabled = !editable;
        if (field === 'students') input.min = '0';
        input.value = String(row[field] == null ? '' : row[field]);
        input.setAttribute('aria-label', field);
        input.addEventListener('change', function () {
          var next = doc.rows.map(function (item) {
            if (item.id !== row.id) return item;
            var copy = {
              id: item.id,
              facultyId: item.facultyId,
              room: item.room,
              section: item.section,
              subject: item.subject,
              students: item.students
            };
            copy[field] = input.value;
            return copy;
          });
          FacultyLoadingStore.save({
            schoolYear: doc.schoolYear,
            termCode: doc.termCode,
            faculty: doc.faculty,
            rows: next
          }).then(applyPayload).catch(function (err) {
            window.alert(err.message || 'Could not save that row.');
          });
        });
        cell.appendChild(input);
        tr.appendChild(cell);
      });
      if (editable) {
        var act = document.createElement('td');
        act.className = 'fl-col-action';
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dm-btn-sm';
        remove.textContent = 'Remove';
        remove.addEventListener('click', function () {
          FacultyLoadingStore.save({
            schoolYear: doc.schoolYear,
            termCode: doc.termCode,
            faculty: doc.faculty,
            rows: doc.rows.filter(function (item) { return item.id !== row.id; })
          }).then(function (res) {
            applyPayload(res);
            openSheet(person.id);
          });
        });
        act.appendChild(remove);
        tr.appendChild(act);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    if (editable) {
      var tfoot = document.createElement('tfoot');
      var addRow = document.createElement('tr');
      function field(placeholder, type, cls) {
        var cell = document.createElement('td');
        cell.className = cls;
        var input = document.createElement('input');
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        if (type) input.type = type;
        if (type === 'number') input.min = '0';
        cell.appendChild(input);
        return { cell: cell, input: input };
      }
      var room = field('Room', '', 'fl-col-room');
      var section = field('Section', '', 'fl-col-section');
      var subject = field('Subject', '', 'fl-col-subject');
      var students = field('Students', 'number', 'fl-col-students');
      var addCell = document.createElement('td');
      addCell.className = 'fl-col-action';
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'dm-btn-add';
      save.textContent = 'Add row';
      addCell.appendChild(save);
      addRow.appendChild(room.cell);
      addRow.appendChild(section.cell);
      addRow.appendChild(subject.cell);
      addRow.appendChild(students.cell);
      addRow.appendChild(addCell);
      function addClassRow() {
        if (!String(subject.input.value || '').trim()) {
          window.alert('Enter a subject.');
          subject.input.focus();
          return;
        }
        var next = (doc.rows || []).slice();
        next.push({
          id: 'flr-' + Date.now().toString(36),
          facultyId: person.id,
          room: room.input.value,
          section: section.input.value,
          subject: subject.input.value,
          students: students.input.value
        });
        FacultyLoadingStore.save({
          schoolYear: doc.schoolYear,
          termCode: doc.termCode,
          faculty: doc.faculty,
          rows: next
        }).then(function (res) {
          applyPayload(res);
          openSheet(person.id);
        }).catch(function (err) {
          window.alert(err.message || 'Could not add that row.');
        });
      }
      save.addEventListener('click', addClassRow);
      [room, section, subject, students].forEach(function (item) {
        item.input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            addClassRow();
          }
        });
      });
      tfoot.appendChild(addRow);
      table.appendChild(tfoot);
    }
    wrap.appendChild(table);
    sheet.appendChild(wrap);

    if (editable) {
      var foot = el('div', 'fl-sheet-foot');
      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'dm-btn-sm dm-btn-sm--archive';
      drop.textContent = 'Remove faculty';
      drop.addEventListener('click', function () {
        if (!window.confirm('Remove ' + person.name + ' from this faculty loading?')) return;
        FacultyLoadingStore.save({
          schoolYear: doc.schoolYear,
          termCode: doc.termCode,
          faculty: doc.faculty.filter(function (item) { return item.id !== person.id; }),
          rows: doc.rows.filter(function (item) { return item.facultyId !== person.id; })
        }).then(function (res) {
          closeSheet();
          applyPayload(res);
        });
      });
      foot.appendChild(drop);
      sheet.appendChild(foot);
    }
  }

  function render() {
    fillTerms();
    renderHint();
    renderCrumb();
    stage.innerHTML = '';
    if (!actor) return;
    if (actor.role === 'program_chair' && !actor.departmentId) {
      stage.appendChild(el('p', 'page-sub', 'This account is not assigned to a department, so it cannot prepare faculty loading.'));
      return;
    }
    if (browse.mode === 'faculty') renderFaculty();
    else if (actor.role === 'dean') renderCollegeBoard();
    else if (isRegistrar() || actor.role === 'vpaa') renderUniversity();
    else stage.appendChild(el('p', 'page-sub', 'Faculty loading is not available for this account.'));
    if (openFacultyId) paintSheet();
  }

  yearSel.addEventListener('change', function () {
    closeSheet();
    render();
  });
  semSel.addEventListener('change', function () {
    closeSheet();
    render();
  });
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.hidden) closeSheet();
  });

  function start() {
    refresh();
  }
  if (window.MCUNexReady) window.MCUNexReady.then(start).catch(start);
  else start();
})();
