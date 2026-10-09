/**
 * College-first curriculum browser for the Curriculums page.
 *
 * The page opens on an overview of colleges instead of a subject table.
 * Clicking a college opens a dialog of the curriculums filed under it; opening
 * one of those then mounts CurriculumView for that record only.
 *
 * Depends on org-store.js, curriculum-store.js and curriculum-view.js.
 */
(function (global) {
  'use strict';

  if (global.CurriculumBrowser) return;

  var doc = global.document;
  var STYLE_ID = 'cb-browser-styles';

  function injectStyles() {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;}',
      '.cb-card{display:flex;flex-direction:column;align-items:flex-start;text-align:left;width:100%;padding:1.1rem 1.15rem 1.15rem;border:1px solid #e3d9f0;border-radius:12px;background:#fff;box-shadow:0 6px 18px rgba(45,22,63,.05);cursor:pointer;font-family:inherit;color:inherit;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease;}',
      '.cb-card:hover,.cb-card:focus{border-color:#5c267e;box-shadow:0 10px 24px rgba(92,38,126,.14);outline:none;transform:translateY(-1px);}',
      '.cb-card__code{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7a6992;margin-bottom:.35rem;}',
      '.cb-card__title{font-size:1.05rem;font-weight:600;color:#5c267e;line-height:1.3;margin-bottom:.45rem;}',
      '.cb-card__meta{font-size:.84rem;color:#6b7280;line-height:1.45;}',
      '.cb-card__cta{margin-top:.85rem;font-size:.8rem;font-weight:600;color:#5c267e;}',
      '.cb-empty{padding:2.2rem 1.4rem;text-align:center;border:2px dashed #e5e7eb;border-radius:12px;color:#6b7280;}',
      '.cb-empty h3{margin:0 0 .4rem;font-size:1rem;color:#374151;font-weight:600;}',
      '.cb-empty p{margin:0 auto;max-width:34rem;font-size:.88rem;line-height:1.55;}',
      '.cb-back{display:inline-flex;align-items:center;gap:.35rem;margin-bottom:1rem;padding:.4rem .75rem;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font:inherit;font-size:.86rem;font-weight:600;cursor:pointer;}',
      '.cb-back:hover{background:#f6f1fc;border-color:#d4c4e8;color:#5c267e;}',
      '.cb-overlay{position:fixed;inset:0;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1.25rem;}',
      '.cb-dialog{background:#fff;border-radius:14px;width:100%;max-width:680px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 45px rgba(0,0,0,.25);}',
      '.cb-dialog__head{padding:1.2rem 1.35rem .85rem;border-bottom:1px solid #e5e7eb;}',
      '.cb-dialog__head h2{margin:0 0 .25rem;font-size:1.1rem;color:#111827;font-weight:600;}',
      '.cb-dialog__head p{margin:0;font-size:.85rem;color:#6b7280;line-height:1.45;}',
      '.cb-seg{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.9rem;}',
      '.cb-seg__btn{padding:.4rem 1rem;font-size:.82rem;font-weight:600;font-family:inherit;border-radius:999px;border:1px solid #e3d9f0;background:#fff;color:#7a6992;cursor:pointer;}',
      '.cb-seg__btn:hover{border-color:#c4b3dc;color:#1f1230;}',
      '.cb-seg__btn[aria-selected="true"]{background:#5c267e;color:#fff;border-color:#5c267e;}',
      '.cb-archive-hint{font-size:.85rem;color:#6b7280;margin:0 0 .9rem;line-height:1.5;}',
      '.cb-dialog__body{padding:1rem 1.35rem;overflow:auto;flex:1;}',
      '.cb-dialog__foot{padding:.85rem 1.35rem 1.1rem;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;}',
      '.cb-group{margin-bottom:1rem;}',
      '.cb-group:last-child{margin-bottom:0;}',
      '.cb-group__label{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7a6992;margin:0 0 .45rem;}',
      '.cb-list{display:flex;flex-direction:column;gap:.5rem;}',
      '.cb-item{display:flex;align-items:center;justify-content:space-between;gap:.75rem;width:100%;padding:.75rem .85rem;border:1px solid #ece4f2;border-radius:10px;background:#faf7fc;text-align:left;font:inherit;color:inherit;}',
      '.cb-item--archived{border-style:dashed;background:#fffbeb;}',
      '.cb-item__name{font-size:.92rem;font-weight:600;color:#1f1230;}',
      '.cb-item__meta{display:block;margin-top:.15rem;font-size:.78rem;color:#6b7280;}',
      '.cb-item__actions{display:flex;flex-wrap:wrap;gap:.4rem;flex-shrink:0;justify-content:flex-end;}',
      '.cb-item__btn{padding:.32rem .7rem;font-size:.78rem;font-weight:600;font-family:inherit;border-radius:.4rem;cursor:pointer;border:1px solid #e3d9f0;background:#fff;color:#1f1230;}',
      '.cb-item__btn:hover{background:#f6f1fc;border-color:#d4c4e8;color:#5c267e;}',
      '.cb-item__btn--archive{border-color:#e8d5b0;background:#fffbeb;color:#92400e;}',
      '.cb-item__btn--archive:hover{background:#fef3c7;border-color:#fcd34d;color:#78350f;}',
      '.cb-item__btn--unarchive{border-color:#86efac;background:#ecfdf5;color:#047857;}',
      '.cb-item__btn--unarchive:hover{background:#d1fae5;border-color:#6ee7b7;color:#065f46;}',
      '.cb-btn{padding:.5rem .95rem;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;border:1px solid #d1d5db;background:#fff;color:#374151;font-family:inherit;}',
      '.cb-btn:hover{background:#f6f1fc;}'
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

  function countWord(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function isArchived(c) {
    if (global.CurriculumStore && typeof CurriculumStore.isArchived === 'function') {
      return CurriculumStore.isArchived(c);
    }
    return !!(c && c.status === 'archived');
  }

  function allCurriculumsForCollege(collegeId) {
    return global.CurriculumStore.list({ includeArchived: true }).filter(function (c) {
      return c.collegeId === collegeId;
    });
  }

  function orphanCurriculums() {
    var known = Object.create(null);
    global.OrgStore.colleges().forEach(function (c) {
      known[c.id] = true;
    });
    return global.CurriculumStore.list({ includeArchived: true }).filter(function (c) {
      return !c.collegeId || !known[c.collegeId];
    });
  }

  function programName(cur) {
    return cur.departmentName || cur.collegeName || 'Curriculum';
  }

  function formatArchivedWhen(c) {
    var raw = c && (c.updatedAt || c.createdAt);
    if (!raw) return '';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function splitCurriculums(currs) {
    var active = [];
    var archived = [];
    (currs || []).forEach(function (c) {
      if (isArchived(c)) archived.push(c);
      else active.push(c);
    });
    return { active: active, archived: archived };
  }

  function groupCurriculums(currs, college) {
    var depts = college && college.useDepartments ? college.departments || [] : [];
    var groups = [];
    var seen = Object.create(null);

    function add(key, label, items) {
      if (!items.length) return;
      groups.push({ key: key, label: label, items: items });
    }

    var collegeLevel = currs.filter(function (c) {
      return !c.departmentId;
    });
    add('college', college ? college.name : 'College', collegeLevel);
    collegeLevel.forEach(function (c) {
      seen[c.id] = true;
    });

    depts.forEach(function (d) {
      var items = currs.filter(function (c) {
        return c.departmentId === d.id;
      });
      add(d.id, d.name, items);
      items.forEach(function (c) {
        seen[c.id] = true;
      });
    });

    var leftover = currs.filter(function (c) {
      return !seen[c.id];
    });
    if (leftover.length) add('other', 'Other programs', leftover);
    return groups;
  }

  function mount(root, options) {
    if (!root) return null;
    injectStyles();
    options = options || {};

    root.innerHTML =
      '<div id="cbOverview"></div>' +
      '<div id="cbDetail" hidden>' +
        '<button type="button" class="cb-back" id="cbBack">← All colleges</button>' +
        '<div id="cbView"></div>' +
      '</div>';

    var overview = root.querySelector('#cbOverview');
    var detail = root.querySelector('#cbDetail');
    var viewRoot = root.querySelector('#cbView');
    var backBtn = root.querySelector('#cbBack');
    var view = null;
    var overlay = null;
    var dialogCtx = null;

    function showOverview() {
      detail.hidden = true;
      overview.hidden = false;
      renderOverview();
    }

    function openCurriculum(id) {
      closeDialog();
      overview.hidden = true;
      detail.hidden = false;
      if (!view) {
        view = global.CurriculumView.mount(viewRoot, {
          autoSelectFirst: false,
          hidePicker: true,
          selectedId: id,
          onChange: function (cur) {
            if (!cur) showOverview();
          }
        });
      }
      view.select(id);
    }

    function closeDialog() {
      if (!overlay) return;
      doc.removeEventListener('keydown', onDialogKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      dialogCtx = null;
    }

    function onDialogKey(e) {
      if (e.key === 'Escape') closeDialog();
    }

    function dialogSubtitle(parts) {
      var activeN = parts.active.length;
      var archivedN = parts.archived.length;
      if (!activeN && !archivedN) return 'No curriculums have been uploaded for this college yet.';
      var bits = [];
      if (activeN) bits.push(countWord(activeN, 'curriculum', 'curriculums') + ' uploaded for this college.');
      else bits.push('No active curriculums for this college.');
      if (archivedN) bits.push(countWord(archivedN, 'archived curriculum', 'archived curriculums') + '.');
      return bits.join(' ');
    }

    function itemRowHtml(c, archivedPane) {
      var meta = esc(c.academicYear) + ' · ' + countWord(c.courses.length, 'subject', 'subjects');
      if (archivedPane) {
        var when = formatArchivedWhen(c);
        if (when) meta += ' · Archived · ' + esc(when);
        else meta += ' · Archived';
      }
      var actions = archivedPane
        ? '<button type="button" class="cb-item__btn" data-open="' +
          esc(c.id) +
          '">Open</button>' +
          '<button type="button" class="cb-item__btn cb-item__btn--unarchive" data-unarchive="' +
          esc(c.id) +
          '">Unarchive</button>'
        : '<button type="button" class="cb-item__btn" data-open="' +
          esc(c.id) +
          '">Open</button>' +
          '<button type="button" class="cb-item__btn cb-item__btn--archive" data-archive="' +
          esc(c.id) +
          '">Archive</button>';
      return (
        '<div class="cb-item' +
        (archivedPane ? ' cb-item--archived' : '') +
        '">' +
        '<span><span class="cb-item__name">' +
        esc(programName(c)) +
        '</span><span class="cb-item__meta">' +
        meta +
        '</span></span>' +
        '<span class="cb-item__actions">' +
        actions +
        '</span></div>'
      );
    }

    function groupsHtml(currs, collegeId, archivedPane) {
      if (!currs.length) {
        if (archivedPane) {
          return (
            '<p class="cb-archive-hint">Archived curriculums do not appear when assigning sections or generating schedules. Unarchive one to use it again.</p>' +
            '<div class="cb-empty"><h3>No archived curriculums</h3>' +
            '<p>When you archive a curriculum from the Active list, it will show up here.</p></div>'
          );
        }
        return (
          '<div class="cb-empty">' +
            '<h3>No curriculums in this college yet</h3>' +
            '<p>Use <strong>Add curriculum</strong> at the top of this page and assign the file to this college.</p>' +
          '</div>'
        );
      }
      var hint = archivedPane
        ? '<p class="cb-archive-hint">Archived curriculums do not appear when assigning sections or generating schedules. Unarchive one to use it again.</p>'
        : '';
      var groups = groupCurriculums(currs, global.OrgStore.findCollege(collegeId));
      var body = groups
        .map(function (g) {
          var rows = g.items
            .map(function (c) {
              return itemRowHtml(c, archivedPane);
            })
            .join('');
          return (
            '<div class="cb-group">' +
            (groups.length > 1 ? '<p class="cb-group__label">' + esc(g.label) + '</p>' : '') +
            '<div class="cb-list">' +
            rows +
            '</div></div>'
          );
        })
        .join('');
      return hint + body;
    }

    function bindListActions() {
      if (!overlay) return;
      var bodyEl = overlay.querySelector('.cb-dialog__body');
      if (!bodyEl) return;
      var openBtns = bodyEl.querySelectorAll('[data-open]');
      for (var i = 0; i < openBtns.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            openCurriculum(btn.getAttribute('data-open'));
          });
        })(openBtns[i]);
      }
      var archiveBtns = bodyEl.querySelectorAll('[data-archive]');
      for (var a = 0; a < archiveBtns.length; a++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-archive');
            if (
              !global.confirm(
                'Archive this curriculum and move it to the Archived list? It will no longer appear when assigning sections or generating schedules.'
              )
            ) {
              return;
            }
            global.CurriculumStore.setStatus(id, 'archived').then(function (res) {
              if (res && res.ok === false) {
                global.alert(res.error || 'Could not archive this curriculum.');
              }
            });
          });
        })(archiveBtns[a]);
      }
      var unarchiveBtns = bodyEl.querySelectorAll('[data-unarchive]');
      for (var u = 0; u < unarchiveBtns.length; u++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-unarchive');
            global.CurriculumStore.setStatus(id, 'active').then(function (res) {
              if (res && res.ok === false) {
                global.alert(res.error || 'Could not unarchive this curriculum.');
              }
            });
          });
        })(unarchiveBtns[u]);
      }
    }

    function refreshDialog() {
      if (!overlay || !dialogCtx) return;
      var currs =
        dialogCtx.collegeId === '__orphan__'
          ? orphanCurriculums()
          : dialogCtx.collegeId
            ? allCurriculumsForCollege(dialogCtx.collegeId)
            : [];
      var parts = splitCurriculums(currs);
      if (dialogCtx.pane !== 'archived' && dialogCtx.pane !== 'active') {
        dialogCtx.pane = parts.active.length || !parts.archived.length ? 'active' : 'archived';
      }
      var archivedPane = dialogCtx.pane === 'archived';
      var list = archivedPane ? parts.archived : parts.active;
      var sub = overlay.querySelector('[data-dialog-sub]');
      if (sub) sub.textContent = dialogSubtitle(parts);
      var segs = overlay.querySelectorAll('[data-pane]');
      for (var i = 0; i < segs.length; i++) {
        segs[i].setAttribute('aria-selected', segs[i].getAttribute('data-pane') === dialogCtx.pane ? 'true' : 'false');
      }
      var bodyEl = overlay.querySelector('.cb-dialog__body');
      if (bodyEl) {
        bodyEl.innerHTML = groupsHtml(
          list,
          dialogCtx.collegeId === '__orphan__' ? null : dialogCtx.collegeId,
          archivedPane
        );
      }
      bindListActions();
    }

    function openCollegeDialog(collegeId, title, currs) {
      closeDialog();
      var parts = splitCurriculums(currs);
      dialogCtx = {
        collegeId: collegeId,
        title: title,
        pane: parts.active.length || !parts.archived.length ? 'active' : 'archived'
      };
      overlay = doc.createElement('div');
      overlay.className = 'cb-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', title);

      overlay.innerHTML =
        '<div class="cb-dialog">' +
          '<div class="cb-dialog__head">' +
            '<h2>' + esc(title) + '</h2>' +
            '<p data-dialog-sub>' + esc(dialogSubtitle(parts)) + '</p>' +
            '<div class="cb-seg" role="tablist" aria-label="Active or archived curriculums">' +
              '<button type="button" class="cb-seg__btn" role="tab" data-pane="active" aria-selected="' +
              (dialogCtx.pane === 'active' ? 'true' : 'false') +
              '">Active</button>' +
              '<button type="button" class="cb-seg__btn" role="tab" data-pane="archived" aria-selected="' +
              (dialogCtx.pane === 'archived' ? 'true' : 'false') +
              '">Archived</button>' +
            '</div>' +
          '</div>' +
          '<div class="cb-dialog__body"></div>' +
          '<div class="cb-dialog__foot">' +
            '<button type="button" class="cb-btn" data-close>Close</button>' +
          '</div>' +
        '</div>';

      doc.body.appendChild(overlay);
      doc.addEventListener('keydown', onDialogKey);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeDialog();
      });
      overlay.querySelector('[data-close]').addEventListener('click', closeDialog);
      var segs = overlay.querySelectorAll('[data-pane]');
      for (var s = 0; s < segs.length; s++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            if (!dialogCtx) return;
            dialogCtx.pane = btn.getAttribute('data-pane') === 'archived' ? 'archived' : 'active';
            refreshDialog();
          });
        })(segs[s]);
      }
      refreshDialog();
      var focusEl =
        overlay.querySelector('[data-open], [data-unarchive], [data-archive], [data-close]');
      if (focusEl) focusEl.focus();
    }

    function renderOverview() {
      var colleges = global.OrgStore.colleges();
      var orphans = orphanCurriculums();
      if (!colleges.length && !orphans.length) {
        overview.innerHTML =
          '<div class="cb-empty">' +
            '<h3>No colleges yet</h3>' +
            '<p>Add colleges on the College and departments page. Curriculums uploaded with Add curriculum will then appear under the college they belong to.</p>' +
          '</div>';
        return;
      }

      var cards = colleges
        .map(function (c) {
          var parts = splitCurriculums(allCurriculumsForCollege(c.id));
          var n = parts.active.length;
          var archivedN = parts.archived.length;
          var deptCount = c.useDepartments ? (c.departments || []).length : 0;
          var meta = countWord(n, 'curriculum', 'curriculums');
          if (archivedN) meta += ' · ' + countWord(archivedN, 'archived', 'archived');
          if (deptCount) meta += ' · ' + countWord(deptCount, 'department', 'departments');
          return (
            '<button type="button" class="cb-card" data-college="' + esc(c.id) + '">' +
              '<span class="cb-card__code">' + esc(c.code || 'College') + '</span>' +
              '<span class="cb-card__title">' + esc(c.name) + '</span>' +
              '<span class="cb-card__meta">' + esc(meta) + '</span>' +
              '<span class="cb-card__cta">View curriculums →</span>' +
            '</button>'
          );
        })
        .join('');

      if (orphans.length) {
        var orphanParts = splitCurriculums(orphans);
        cards +=
          '<button type="button" class="cb-card" data-college="__orphan__">' +
            '<span class="cb-card__code">Unlisted</span>' +
            '<span class="cb-card__title">Other uploaded curriculums</span>' +
            '<span class="cb-card__meta">' +
              esc(
                countWord(orphanParts.active.length, 'curriculum', 'curriculums') +
                  (orphanParts.archived.length
                    ? ' · ' + countWord(orphanParts.archived.length, 'archived', 'archived')
                    : '') +
                  ' whose college is no longer listed'
              ) +
            '</span>' +
            '<span class="cb-card__cta">View curriculums →</span>' +
          '</button>';
      }

      overview.innerHTML = '<div class="cb-grid">' + cards + '</div>';
    }

    overview.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-college]');
      if (!btn) return;
      var id = btn.getAttribute('data-college');
      if (id === '__orphan__') {
        openCollegeDialog('__orphan__', 'Other uploaded curriculums', orphanCurriculums());
        return;
      }
      var college = global.OrgStore.findCollege(id);
      if (!college) return;
      openCollegeDialog(id, college.name, allCurriculumsForCollege(id));
    });

    backBtn.addEventListener('click', showOverview);

    if (global.CurriculumStore.onChange) {
      global.CurriculumStore.onChange(function () {
        if (!overview.hidden) renderOverview();
        if (overlay && dialogCtx) refreshDialog();
      });
    }
    if (global.OrgStore.onChange) {
      global.OrgStore.onChange(function () {
        if (!overview.hidden) renderOverview();
        if (overlay && dialogCtx) refreshDialog();
      });
    }

    showOverview();
    return { refresh: renderOverview };
  }

  global.CurriculumBrowser = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
