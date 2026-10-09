/**
 * Super Admin / Admin account list and creation against api/users.php.
 * #amPage data-actor chooses who may create which roles.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (global.MCUNexReady) return global.MCUNexReady.then(fn);
    fn();
  }

  function qs(id) {
    return document.getElementById(id);
  }

  function actor() {
    var el = qs('amPage') || document.querySelector('[data-actor]');
    return (el && el.getAttribute('data-actor')) || 'super_admin';
  }

  var ROLE_LABEL = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    vpaa: 'VPAA',
    dean: 'Dean',
    program_chair: 'Program Chair'
  };

  var users = [];
  var creatable = [];
  var editingId = null;

  function roleLabel(role) {
    return ROLE_LABEL[role] || role;
  }

  function needsCollege(role) {
    return role === 'dean' || role === 'program_chair';
  }

  function setStatus(el, message, tone) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-bad', tone === 'bad');
    el.classList.toggle('is-ok', tone === 'ok');
  }

  function selectedDepartment(boxId) {
    var sel = qs(boxId + '-dept');
    return sel ? sel.value : '';
  }

  function fillRoleSelect(sel, selected, includeCurrent) {
    if (!sel) return;
    var keep = includeCurrent && selected === 'super_admin' ? ['super_admin'].concat(creatable) : creatable.slice();
    sel.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select role';
    sel.appendChild(blank);
    keep.forEach(function (role) {
      var o = document.createElement('option');
      o.value = role;
      o.textContent = roleLabel(role);
      sel.appendChild(o);
    });
    if (selected) sel.value = selected;
  }

  function fillProgramChecks(boxId, collegeId, selectedIds) {
    var box = qs(boxId);
    if (!box) return false;
    box.innerHTML = '';
    var selected = {};
    (selectedIds || []).forEach(function (id) {
      selected[id] = true;
    });
    var depts =
      global.OrgStore && collegeId && global.OrgStore.orgDepartments
        ? global.OrgStore.orgDepartments(collegeId)
        : [];
    if (!depts.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'This college has no departments, so it can have a Dean only.';
      box.appendChild(empty);
      return false;
    }
    var sel = document.createElement('select');
    sel.id = boxId + '-dept';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select department…';
    sel.appendChild(blank);
    depts.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      var programs = (d.programs || []).map(function (p) { return p.name; }).filter(Boolean);
      opt.textContent = programs.length && programs.join(', ') !== d.name
        ? d.name + ' (' + programs.join(', ') + ')'
        : d.name;
      if (selected[d.id]) opt.selected = true;
      sel.appendChild(opt);
    });
    box.appendChild(sel);
    return true;
  }

  function syncScopeFields(prefix) {
    var roleSel = qs(prefix === 'edit' ? 'edit-role' : 'user-role');
    var collegeWrap = qs(prefix === 'edit' ? 'edit-college-wrapper' : 'college-wrapper');
    var progWrap = qs(prefix === 'edit' ? 'edit-programs-wrapper' : 'programs-wrapper');
    var collegeSel = qs(prefix === 'edit' ? 'edit-college' : 'user-college');
    var hint = qs(prefix === 'edit' ? 'edit-programs-hint' : 'user-programs-hint');
    var role = roleSel ? roleSel.value : '';
    var showCollege = needsCollege(role);
    if (collegeWrap) collegeWrap.style.display = showCollege ? '' : 'none';
    if (!showCollege && collegeSel) collegeSel.value = '';
    var collegeId = collegeSel ? collegeSel.value : '';
    var showPrograms = role === 'program_chair' && !!collegeId;
    if (progWrap) progWrap.style.display = showPrograms ? '' : 'none';
    if (showPrograms) {
      var hasDepts = fillProgramChecks(prefix === 'edit' ? 'edit-programs' : 'user-programs', collegeId, []);
      if (hint) {
        hint.textContent = hasDepts
          ? 'A department has one Program Chair, who covers every program in that department.'
          : 'This college has no departments. Create a Dean instead.';
      }
    } else if (prefix !== 'edit') {
      fillProgramChecks('user-programs', '', []);
    }
  }

  function fillColleges() {
    if (!global.OrgStore) return;
    global.OrgStore.fillCollegeSelect(qs('user-college'), qs('user-college') && qs('user-college').value);
    global.OrgStore.fillCollegeSelect(qs('edit-college'), qs('edit-college') && qs('edit-college').value);
  }

  function renderUsers() {
    var tbody = document.querySelector('#account-panel-users .users-table tbody');
    var countEl = qs('inactiveUsersCount');
    if (!tbody) return;
    var inactive = users.filter(function (u) {
      return !u.isActive;
    }).length;
    if (countEl) countEl.textContent = String(inactive);
    tbody.innerHTML = '';
    if (!users.length) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="5">No accounts yet. Use Account creation to add Admin, VPAA, Dean, or Program Chair.</td>';
      tbody.appendChild(empty);
      return;
    }
    users.forEach(function (u) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-user-id', u.id);
      if (!u.isActive) tr.setAttribute('data-inactive', 'true');
      var scope = u.scopeLabel ? ' — ' + u.scopeLabel : '';
      tr.innerHTML =
        '<td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = u.name;
      cells[1].textContent = u.email;
      cells[2].textContent = u.roleLabel + scope;
      var st = document.createElement('span');
      st.className = 'user-status ' + (u.isActive ? 'active' : 'inactive');
      st.textContent = u.isActive ? 'Active' : 'Inactive';
      cells[3].appendChild(st);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'user-edit-btn';
      btn.textContent = 'Edit';
      btn.addEventListener('click', function () {
        openEdit(u.id);
      });
      cells[4].appendChild(btn);
      tbody.appendChild(tr);
    });
    syncInactiveFilter();
  }

  function syncInactiveFilter() {
    var btn = qs('am-inactive-filter');
    var tbody = document.querySelector('#account-panel-users .users-table tbody');
    if (!btn || !tbody) return;
    var inactiveOnly = btn.getAttribute('aria-pressed') === 'true';
    tbody.querySelectorAll('tr').forEach(function (tr) {
      var isInactive = tr.getAttribute('data-inactive') === 'true';
      if (!tr.getAttribute('data-user-id')) {
        tr.style.display = '';
        return;
      }
      tr.style.display = inactiveOnly ? (isInactive ? '' : 'none') : isInactive ? 'none' : '';
    });
  }

  function loadUsers() {
    if (!global.McuApi) {
      setStatus(qs('am-list-status'), 'MySQL is not available, so accounts cannot be loaded.', 'bad');
      return Promise.resolve();
    }
    return global.McuApi.get('users.php?actor=' + encodeURIComponent(actor()))
      .then(function (res) {
        users = res.users || [];
        creatable = res.roles || [];
        fillRoleSelect(qs('user-role'), qs('user-role') && qs('user-role').value);
        renderUsers();
        setStatus(qs('am-list-status'), '', '');
      })
      .catch(function (err) {
        setStatus(qs('am-list-status'), err.message || String(err), 'bad');
      });
  }

  function setTab(tab) {
    var isCreate = tab === 'create';
    var panelUsers = qs('account-panel-users');
    var panelCreate = qs('account-panel-create');
    var tabUsers = qs('am-tab-users');
    var tabCreate = qs('am-tab-create');
    if (panelUsers) panelUsers.classList.toggle('am-panel-hidden', isCreate);
    if (panelCreate) panelCreate.classList.toggle('am-panel-hidden', !isCreate);
    if (tabUsers) tabUsers.classList.toggle('active', !isCreate);
    if (tabCreate) tabCreate.classList.toggle('active', isCreate);
    try {
      var url = new URL(global.location.href);
      if (isCreate) url.searchParams.set('tab', 'create');
      else url.searchParams.delete('tab');
      global.history.replaceState({}, '', url);
    } catch (e) {
      /* ignore */
    }
  }

  function clearCreate() {
    var form = qs('account-create-form');
    if (form) form.reset();
    fillRoleSelect(qs('user-role'), '');
    fillColleges();
    syncScopeFields('create');
    setStatus(qs('am-form-status'), '', '');
  }

  function createAccount() {
    var password = (qs('user-password') || {}).value || '';
    var confirm = (qs('user-password-confirm') || {}).value || '';
    var role = (qs('user-role') || {}).value || '';
    var body = {
      action: 'create',
      actor: actor(),
      name: (qs('user-name') || {}).value || '',
      email: (qs('user-email') || {}).value || '',
      password: password,
      passwordConfirm: confirm,
      role: role,
      collegeId: (qs('user-college') || {}).value || '',
      departmentId: selectedDepartment('user-programs'),
      isActive: true
    };
    if (!global.McuApi) {
      setStatus(qs('am-form-status'), 'MySQL is not available.', 'bad');
      return;
    }
    global.McuApi.send('POST', 'users.php', body)
      .then(function (res) {
        users = res.users || users;
        renderUsers();
        clearCreate();
        setTab('users');
        setStatus(qs('am-list-status'), 'Account created.', 'ok');
      })
      .catch(function (err) {
        setStatus(qs('am-form-status'), err.message || String(err), 'bad');
      });
  }

  function findUser(id) {
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }

  function openEdit(id) {
    var u = findUser(id);
    if (!u) return;
    editingId = id;
    qs('edit-name').value = u.name;
    qs('edit-email').value = u.email;
    qs('edit-password').value = '';
    qs('edit-password-confirm').value = '';
    qs('edit-current-password').value = '';
    qs('edit-active-toggle').checked = !!u.isActive;
    fillRoleSelect(qs('edit-role'), u.role, true);
    qs('edit-role').disabled = u.role === 'super_admin';
    fillColleges();
    if (qs('edit-college')) qs('edit-college').value = u.collegeId || '';
    syncScopeFields('edit');
    if (u.role === 'program_chair') {
      fillProgramChecks('edit-programs', u.collegeId, u.departmentId ? [u.departmentId] : []);
    }
    qs('userEditTitle').textContent = 'Edit user – ' + u.name;
    var overlay = qs('userEditModal');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    setStatus(qs('am-edit-status'), '', '');
  }

  function closeEdit() {
    var overlay = qs('userEditModal');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    editingId = null;
    if (qs('edit-role')) qs('edit-role').disabled = false;
  }

  function saveEdit() {
    if (!editingId) return;
    var u = findUser(editingId);
    var role = (qs('edit-role') || {}).value || (u && u.role) || '';
    var body = {
      action: 'update',
      actor: actor(),
      id: editingId,
      name: (qs('edit-name') || {}).value || '',
      email: (qs('edit-email') || {}).value || '',
      password: (qs('edit-password') || {}).value || '',
      passwordConfirm: (qs('edit-password-confirm') || {}).value || '',
      confirmPassword: (qs('edit-current-password') || {}).value || '',
      role: role,
      collegeId: (qs('edit-college') || {}).value || '',
      departmentId: selectedDepartment('edit-programs'),
      isActive: !!(qs('edit-active-toggle') && qs('edit-active-toggle').checked)
    };
    global.McuApi.send('POST', 'users.php', body)
      .then(function (res) {
        users = res.users || users;
        renderUsers();
        closeEdit();
        setStatus(qs('am-list-status'), 'Account updated.', 'ok');
      })
      .catch(function (err) {
        setStatus(qs('am-edit-status'), err.message || String(err), 'bad');
      });
  }

  ready(function () {
    fillColleges();
    if (global.OrgStore && typeof global.OrgStore.onChange === 'function') {
      global.OrgStore.onChange(function () {
        fillColleges();
        syncScopeFields('create');
      });
    }
    var params = new URLSearchParams(global.location.search);
    setTab(params.get('tab') === 'create' ? 'create' : 'users');
    loadUsers().then(function () {
      syncScopeFields('create');
    });

    var roleSelect = qs('user-role');
    if (roleSelect) {
      roleSelect.addEventListener('change', function () {
        syncScopeFields('create');
      });
    }
    var collegeSelect = qs('user-college');
    if (collegeSelect) {
      collegeSelect.addEventListener('change', function () {
        syncScopeFields('create');
      });
    }
    var editRole = qs('edit-role');
    if (editRole) {
      editRole.addEventListener('change', function () {
        syncScopeFields('edit');
      });
    }
    var editCollege = qs('edit-college');
    if (editCollege) {
      editCollege.addEventListener('change', function () {
        syncScopeFields('edit');
      });
    }
    var createBtn = qs('am-create-btn');
    if (createBtn) createBtn.addEventListener('click', createAccount);
    var clearBtn = qs('am-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', clearCreate);
    var tabUsers = qs('am-tab-users');
    if (tabUsers) {
      tabUsers.addEventListener('click', function (e) {
        e.preventDefault();
        setTab('users');
      });
    }
    var tabCreate = qs('am-tab-create');
    if (tabCreate) {
      tabCreate.addEventListener('click', function (e) {
        e.preventDefault();
        setTab('create');
      });
    }
    var filterBtn = qs('am-inactive-filter');
    if (filterBtn) {
      filterBtn.addEventListener('click', function () {
        var on = filterBtn.getAttribute('aria-pressed') === 'true';
        var next = !on;
        filterBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        filterBtn.classList.toggle('am-inactive-filter--active', next);
        filterBtn.setAttribute(
          'aria-label',
          next ? 'Showing inactive users only. Click to return to the main list.' : 'Show inactive users only'
        );
        filterBtn.title = next ? 'Click to return to the main user list' : 'Click to list inactive users only';
        syncInactiveFilter();
      });
    }
    var overlay = qs('userEditModal');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeEdit();
      });
    }
    var cancel = qs('am-edit-cancel');
    if (cancel) cancel.addEventListener('click', closeEdit);
    var save = qs('am-edit-save');
    if (save) save.addEventListener('click', saveEdit);
  });
})(typeof window !== 'undefined' ? window : this);
