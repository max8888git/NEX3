/**
 * Schedule-change requests.
 * A request is a note plus any number of topic tags and published classes.
 * Program Chair → Dean, Dean → Admin. Dean may forward a chair request.
 * Done and Send back record a reply. They do not edit the timetable.
 */
(function (global) {
  'use strict';

  var classChoices = [];
  var latestRows = [];
  var TOPICS = [
    { id: 'time', label: 'Change day or time' },
    { id: 'room', label: 'Change room' },
    { id: 'meetings', label: 'Split a session or add a meeting' },
    { id: 'merge', label: 'Merge' },
    { id: 'unmerge', label: 'Unmerge' },
    { id: 'partition', label: 'Section partition' },
    { id: 'remove', label: 'Remove schedule' },
    { id: 'other', label: 'Other' },
  ];

  function roleFromPage() {
    var path = String(global.location.pathname || '').replace(/\\/g, '/');
    if (path.indexOf('/viewing-program-head/') !== -1) return 'program_chair';
    if (path.indexOf('/viewing-with-approval/') !== -1) return 'vpaa';
    if (path.indexOf('/super-admin/') !== -1) return 'super_admin';
    if (path.indexOf('/admin/') !== -1) return 'admin';
    if (path.indexOf('/viewing/') !== -1) return 'dean';
    return '';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function emptyHtml(message) {
    return '<p class="req-empty">' + escapeHtml(message) + '</p>';
  }

  function statusClass(status) {
    if (status === 'pending_dean') return 'status-pending';
    if (status === 'held' || status === 'sent_back') return 'status-declined';
    if (status === 'done') return 'status-approved';
    return 'status-under-review';
  }

  function changeKindLabel(kind) {
    if (kind === 'move_time') return 'Move the day or time';
    if (kind === 'move_room') return 'Move the room';
    if (kind === 'remove') return 'Take the class off the timetable';
    return '';
  }

  function topicChips(labels) {
    if (!labels || !labels.length) return '';
    return (
      '<div class="req-topic-row">' +
      labels
        .map(function (label) {
          return '<span class="req-topic">' + escapeHtml(label) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  function classLines(classes, className) {
    return (classes || [])
      .map(function (item) {
        var text = item.label || '';
        if (item.meeting) text += ' — ' + item.meeting;
        if (!text) return '';
        return '<div class="' + className + '">' + escapeHtml(text) + '</div>';
      })
      .join('');
  }

  function metaLine(row) {
    var bits = [];
    if (row.collegeName) bits.push(row.collegeName);
    if (row.atLabel) bits.push(row.atLabel);
    return bits.join(' · ');
  }

  function detailLines(row, className) {
    var lines = [];
    function line(label, value) {
      if (!value) return;
      lines.push(
        '<div class="' + className + '"><strong>' + label + ':</strong> ' + escapeHtml(value) + '</div>'
      );
    }
    var topics = row.topicLabels || [];
    var classes = row.classes || [];
    var legacyChange = changeKindLabel(row.changeKind);
    if (legacyChange && row.requestedLabel) legacyChange += ' → ' + row.requestedLabel;
    var structured = topics.length || classes.length || row.classLabel || row.changeKind;
    if (!structured) {
      lines.push('<div class="' + className + '">' + escapeHtml(row.body) + '</div>');
    } else {
      if (topics.length) lines.push(topicChips(topics));
      if (classes.length) lines.push(classLines(classes, className));
      else {
        line('Class', row.classLabel);
        line('Now', row.meetingLabel);
      }
      if (!topics.length) line('Change', legacyChange);
      line('Request', row.body);
    }
    line('Dean’s note', row.forwardNote);
    line('Dean’s suggestion', row.holdNote);
    if (row.adminReply) {
      line(row.status === 'sent_back' ? 'Sent back' : 'Admin', row.adminReply);
    }
    return lines.join('');
  }

  function renderAdminItem(row) {
    return (
      '<button type="button" class="item request-item req-summary" data-request-id="' +
      String(row.id) +
      '">' +
      '<span class="item-title">' +
      escapeHtml(row.title) +
      '</span>' +
      topicChips(row.topicLabels || []) +
      '<span class="item-meta">' +
      '<span class="tag tag-dean">' +
      escapeHtml(row.statusLabel) +
      '</span>' +
      '<span class="req-when">' +
      escapeHtml(row.atLabel || '') +
      '</span>' +
      '</span>' +
      '</button>'
    );
  }

  function renderViewerItem(row, withActions) {
    var content =
      '<div class="request-item-content">' +
      '<div class="request-item-title">' +
      escapeHtml(row.title) +
      '</div>' +
      '<div class="request-item-meta">' +
      escapeHtml(metaLine(row)) +
      '</div>' +
      detailLines(row, 'ph-request-detail') +
      '</div>';
    if (withActions) {
      var footer = row.canForward
        ? '<div class="ph-request-footer">' +
          '<span class="ph-status-badge ph-status--pending">' +
          escapeHtml(row.statusLabel) +
          '</span>' +
          '<div class="ph-request-actions">' +
          '<button type="button" class="btn-ph btn-ph-approve" data-text-action="forward" data-id="' +
          String(row.id) +
          '">Forward to Admin</button>' +
          '<button type="button" class="btn-ph btn-ph-decline" data-text-action="hold" data-id="' +
          String(row.id) +
          '">Do not forward</button>' +
          '</div></div>'
        : '<div class="ph-request-footer"><span class="ph-status-badge">' +
          escapeHtml(row.statusLabel) +
          '</span></div>';
      return '<div class="ph-request-item">' + content + footer + '</div>';
    }
    return (
      '<div class="request-item">' +
      content +
      '<span class="request-item-status ' +
      statusClass(row.status) +
      '">' +
      escapeHtml(row.statusLabel) +
      '</span>' +
      '</div>'
    );
  }

  function fillList(el, rows, emptyMessage, mode) {
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = emptyHtml(emptyMessage);
      return;
    }
    el.innerHTML = rows
      .map(function (row) {
        if (mode === 'admin') return renderAdminItem(row);
        return renderViewerItem(row, mode === 'chairInbox');
      })
      .join('');
  }

  function applyLists(rows) {
    latestRows = rows || [];
    var role = roleFromPage();
    var mine = document.getElementById('textRequestList');
    var inbox = document.getElementById('chairRequestList');
    var adminMode = role === 'admin' || role === 'super_admin';
    if (mine) {
      var mineRows = rows.filter(function (row) {
        if (adminMode) {
          var closed = row.status === 'pending_admin' || row.status === 'done' || row.status === 'sent_back';
          var allowed = row.fromRole === 'dean' || (row.fromRole === 'program_chair' && row.forwardedByName);
          return closed && allowed;
        }
        if (role === 'dean') return row.fromRole === 'dean';
        return true;
      });
      fillList(
        mine,
        mineRows,
        adminMode
          ? 'No schedule-change requests yet.'
          : role === 'dean'
            ? 'You have not sent a request to Admin yet.'
            : 'You have not sent a request to your Dean yet.',
        adminMode ? 'admin' : 'mine'
      );
    }
    if (inbox) {
      fillList(
        inbox,
        rows.filter(function (row) {
          return row.fromRole === 'program_chair';
        }),
        'No program chair requests yet.',
        'chairInbox'
      );
    }
  }

  function setStatus(message, ok) {
    var el = document.getElementById('textRequestStatus');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('visible', !!message);
    el.style.color = ok ? '' : '#a12a2a';
  }

  function checkedValues(root, selector) {
    if (!root) return [];
    return Array.prototype.map.call(root.querySelectorAll(selector), function (el) {
      return el.value;
    });
  }

  function updateClassCount() {
    var countEl = document.getElementById('textRequestClassCount');
    var box = document.getElementById('textRequestClasses');
    if (!countEl || !box) return;
    var n = box.querySelectorAll('input:checked').length;
    countEl.hidden = n === 0;
    countEl.textContent = n === 1 ? '1 class selected' : n + ' classes selected';
  }

  function applyClassFilter() {
    var filter = document.getElementById('textRequestClassFilter');
    var box = document.getElementById('textRequestClasses');
    if (!filter || !box) return;
    var q = String(filter.value || '').toLowerCase();
    Array.prototype.forEach.call(box.querySelectorAll('label'), function (label) {
      var text = String(label.textContent || '').toLowerCase();
      label.hidden = q !== '' && text.indexOf(q) === -1;
    });
  }

  function fillTopics() {
    var box = document.getElementById('textRequestTopics');
    if (!box || box.childElementCount) return;
    TOPICS.forEach(function (topic) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = topic.id;
      label.appendChild(input);
      label.appendChild(document.createTextNode(topic.label));
      box.appendChild(label);
    });
  }

  function fillClasses() {
    var box = document.getElementById('textRequestClasses');
    var empty = document.getElementById('textRequestEmpty');
    var send = document.getElementById('textRequestSend');
    var filter = document.getElementById('textRequestClassFilter');
    if (!box) return;
    var selected = {};
    checkedValues(box, 'input:checked').forEach(function (id) {
      selected[id] = true;
    });
    box.innerHTML = '';
    classChoices.forEach(function (choice) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = choice.id;
      input.checked = !!selected[choice.id];
      var text = document.createElement('span');
      text.textContent = choice.label;
      if (choice.meeting) {
        var meta = document.createElement('span');
        meta.className = 'text-req-class-meta';
        meta.textContent = choice.meeting;
        text.appendChild(meta);
      }
      label.appendChild(input);
      label.appendChild(text);
      box.appendChild(label);
    });
    var none = classChoices.length === 0;
    if (empty) empty.hidden = !none;
    if (filter) filter.hidden = none;
    if (send) send.disabled = none;
    updateClassCount();
    applyClassFilter();
  }

  function load() {
    if (!global.McuApi) return;
    var mine = document.getElementById('textRequestList');
    var inbox = document.getElementById('chairRequestList');
    if (!mine && !inbox) return;
    if (mine) mine.innerHTML = emptyHtml('Loading…');
    if (inbox) inbox.innerHTML = emptyHtml('Loading…');
    global.McuApi.get('requests.php?actor=' + encodeURIComponent(roleFromPage()))
      .then(function (res) {
        classChoices = res.classes || [];
        fillTopics();
        fillClasses();
        applyLists(res.textRequests || res.requests || []);
      })
      .catch(function (err) {
        var msg = emptyHtml(err.message || String(err));
        if (mine) mine.innerHTML = msg;
        if (inbox) inbox.innerHTML = msg;
      });
  }

  function bindForm() {
    var form = document.getElementById('textRequestForm');
    var ta = document.getElementById('textRequestBody');
    var topics = document.getElementById('textRequestTopics');
    var classes = document.getElementById('textRequestClasses');
    var filter = document.getElementById('textRequestClassFilter');
    if (!form || !ta || !topics || !classes) return;
    fillTopics();
    var openBtn = document.getElementById('textRequestOpen');
    function setRequestPanel(open) {
      var panel = document.getElementById('textRequestPanel');
      if (!panel) return;
      if (open) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
      if (openBtn) openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        var panel = document.getElementById('textRequestPanel');
        setRequestPanel(!(panel && !panel.hasAttribute('hidden')));
      });
    }
    if (filter) {
      filter.addEventListener('input', applyClassFilter);
      filter.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });
    }
    classes.addEventListener('change', updateClassCount);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!classChoices.length) {
        setStatus('There is no published timetable to request against yet.', false);
        return;
      }
      var topicIds = checkedValues(topics, 'input:checked');
      var classIds = checkedValues(classes, 'input:checked');
      var text = String(ta.value || '').trim();
      if (!topicIds.length) {
        setStatus('Choose at least one topic.', false);
        return;
      }
      if (!classIds.length) {
        setStatus('Choose at least one class.', false);
        return;
      }
      if (!text) {
        ta.focus();
        setStatus('Describe the change.', false);
        return;
      }
      setStatus('Sending…', true);
      global.McuApi.send('POST', 'requests.php', {
        action: 'create',
        topics: topicIds,
        classIds: classIds,
        body: text,
      })
        .then(function (res) {
          Array.prototype.forEach.call(form.querySelectorAll('input[type="checkbox"]'), function (input) {
            input.checked = false;
          });
          ta.value = '';
          if (filter) filter.value = '';
          applyClassFilter();
          updateClassCount();
          setStatus('', true);
          setRequestPanel(false);
          applyLists(res.requests || res.textRequests || []);
        })
        .catch(function (err) {
          setStatus(err.message || String(err), false);
        });
    });
  }

  function openNoteModal(modal, noteEl, errEl) {
    if (noteEl) noteEl.value = '';
    if (errEl) errEl.textContent = '';
    if (!modal) return false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (noteEl && noteEl.focus) noteEl.focus();
    return true;
  }

  function closeNoteModal(modal, noteEl, errEl, sendBtn, clearId) {
    if (sendBtn) sendBtn.disabled = false;
    if (clearId) clearId();
    if (!modal) return;
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    if (noteEl) noteEl.value = '';
    if (errEl) errEl.textContent = '';
  }

  function bindInbox() {
    var inbox = document.getElementById('chairRequestList');
    if (!inbox) return;
    var holdId = 0;
    var forwardId = 0;
    var holdModal = document.getElementById('holdRequestModal');
    var holdNote = document.getElementById('holdRequestNote');
    var holdSend = document.getElementById('holdRequestSend');
    var holdErr = document.getElementById('holdRequestError');
    var forwardModal = document.getElementById('forwardRequestModal');
    var forwardNote = document.getElementById('forwardRequestNote');
    var forwardSend = document.getElementById('forwardRequestSend');
    var forwardErr = document.getElementById('forwardRequestError');

    function closeHold() {
      closeNoteModal(holdModal, holdNote, holdErr, holdSend, function () { holdId = 0; });
    }
    function closeForward() {
      closeNoteModal(forwardModal, forwardNote, forwardErr, forwardSend, function () { forwardId = 0; });
    }

    if (holdModal) {
      document.querySelectorAll('[data-close-hold-modal]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target === el) closeHold();
        });
      });
      if (holdSend) {
        holdSend.addEventListener('click', function () {
          if (!holdId) return;
          var note = holdNote ? String(holdNote.value || '').trim() : '';
          holdSend.disabled = true;
          global.McuApi.send('POST', 'requests.php', { action: 'hold', id: holdId, note: note })
            .then(function (res) {
              closeHold();
              applyLists(res.requests || res.textRequests || []);
            })
            .catch(function (err) {
              holdSend.disabled = false;
              if (holdErr) holdErr.textContent = err.message || String(err);
              else global.alert(err.message || String(err));
            });
        });
      }
    }

    if (forwardModal) {
      document.querySelectorAll('[data-close-forward-modal]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target === el) closeForward();
        });
      });
      if (forwardSend) {
        forwardSend.addEventListener('click', function () {
          if (!forwardId) return;
          var note = forwardNote ? String(forwardNote.value || '').trim() : '';
          forwardSend.disabled = true;
          global.McuApi.send('POST', 'requests.php', { action: 'forward', id: forwardId, note: note })
            .then(function (res) {
              closeForward();
              applyLists(res.requests || res.textRequests || []);
            })
            .catch(function (err) {
              forwardSend.disabled = false;
              if (forwardErr) forwardErr.textContent = err.message || String(err);
              else global.alert(err.message || String(err));
            });
        });
      }
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (holdModal && !holdModal.hasAttribute('hidden')) closeHold();
      if (forwardModal && !forwardModal.hasAttribute('hidden')) closeForward();
    });

    inbox.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-text-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-text-action');
      var id = parseInt(btn.getAttribute('data-id') || '0', 10);
      if ((action !== 'forward' && action !== 'hold') || !id) return;
      if (action === 'hold') {
        holdId = id;
        if (openNoteModal(holdModal, holdNote, holdErr)) return;
        return;
      }
      forwardId = id;
      if (openNoteModal(forwardModal, forwardNote, forwardErr)) return;
    });
  }

  function adminDetailBody(row) {
    var parts = [];
    if (row.collegeName) {
      parts.push('<p class="req-detail-college">' + escapeHtml(row.collegeName) + '</p>');
    }
    var topics = row.topicLabels || [];
    if (topics.length) {
      parts.push(
        '<div class="req-detail-label">Topic:</div>' + topicChips(topics)
      );
    }
    var classes = row.classes || [];
    var classHtml = '';
    if (classes.length) {
      classHtml = classLines(classes, 'req-detail-class');
    } else if (row.classLabel) {
      var legacy = row.classLabel;
      if (row.meetingLabel) legacy += ' — ' + row.meetingLabel;
      classHtml = '<div class="req-detail-class">' + escapeHtml(legacy) + '</div>';
    }
    if (classHtml) {
      parts.push('<div class="req-detail-label">Classes Concerned:</div>' + classHtml);
    }
    function note(label, value) {
      if (!value) return;
      parts.push(
        '<p class="req-detail-note"><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(value) + '</p>'
      );
    }
    note('Dean’s note', row.forwardNote);
    note('Dean’s suggestion', row.holdNote);
    if (row.adminReply) note(row.status === 'sent_back' ? 'Sent back' : 'Admin', row.adminReply);
    if (row.body) {
      parts.push(
        '<div class="req-detail-label">Request:</div>' +
        '<div class="req-detail-class">' + escapeHtml(row.body) + '</div>'
      );
    }
    return parts.join('');
  }

  function bindAdmin() {
    var list = document.getElementById('textRequestList');
    var role = roleFromPage();
    var modal = document.getElementById('textRequestDetail');
    if (!list || (role !== 'admin' && role !== 'super_admin')) return;

    function findRow(id) {
      for (var i = 0; i < latestRows.length; i++) {
        if (latestRows[i].id === id) return latestRows[i];
      }
      return null;
    }

    function closeDetail() {
      if (!modal) return;
      modal.setAttribute('hidden', '');
      modal.setAttribute('aria-hidden', 'true');
    }

    function openDetail(row) {
      var title = document.getElementById('textRequestDetailTitle');
      var body = document.getElementById('textRequestDetailBody');
      if (!modal || !title || !body || !row) return;
      title.textContent = row.title || 'Request';
      var reply = '';
      if (row.status === 'pending_admin') {
        reply =
          '<div class="req-reply">' +
          '<input type="text" class="req-reply-note" maxlength="4000" placeholder="Reply (optional)" aria-label="Reply">' +
          '<button type="button" class="btn-primary" data-text-action="done" data-id="' +
          String(row.id) +
          '">Done</button>' +
          '<button type="button" class="btn-quiet" data-text-action="send_back" data-id="' +
          String(row.id) +
          '">Send back</button>' +
          '</div>';
      }
      var where = adminDetailBody(row);
      body.innerHTML = where + reply;
      modal.removeAttribute('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }

    list.addEventListener('click', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.req-summary') : null;
      if (!card) return;
      openDetail(findRow(parseInt(card.getAttribute('data-request-id') || '0', 10)));
    });

    if (!modal) return;
    modal.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-close-request-detail]')) {
        closeDetail();
        return;
      }
      var btn = e.target && e.target.closest ? e.target.closest('[data-text-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-text-action');
      var id = parseInt(btn.getAttribute('data-id') || '0', 10);
      if ((action !== 'done' && action !== 'send_back') || !id) return;
      var noteEl = modal.querySelector('.req-reply-note');
      var note = noteEl ? String(noteEl.value || '').trim() : '';
      btn.disabled = true;
      global.McuApi.send('POST', 'requests.php', { action: action, id: id, note: note })
        .then(function (res) {
          closeDetail();
          applyLists(res.requests || res.textRequests || []);
        })
        .catch(function (err) {
          btn.disabled = false;
          global.alert(err.message || String(err));
        });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hasAttribute('hidden')) closeDetail();
    });
  }

  function boot() {
    if (!document.getElementById('textRequestList') && !document.getElementById('chairRequestList')) {
      return;
    }
    bindForm();
    bindInbox();
    bindAdmin();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
