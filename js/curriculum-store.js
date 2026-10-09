/**
 * Curriculum CSV parsing, validation, and storage.
 *
 * Mirrors curricula, curriculum_courses and course_room_requirements from
 * database_schema.sql. One saved curriculum belongs to one program (a college,
 * or a department within a college) for one academic year, and owns a flat list
 * of courses each carrying its own year level and term. A subject with both
 * lecture and lab units stays as one row. lecture_room_type and lab_room_type
 * are chosen separately. Up to three prerequisites sit in prerequisite_1..3
 * so one cell never holds more than one course id.
 *
 * Persistence is localStorage because there is no backend yet; swapping
 * readStore/writeStore for API calls is the only change needed later.
 */
(function (global) {
  'use strict';

  if (global.CurriculumStore) return;

  var STORAGE_KEY = 'mcu-nex-curricula-v1';

  // Contact hours default from units when the file omits hours per week:
  // 1 lecture unit = 1 hour per week, 1 lab unit = 3 hours per week, over
  // an 18-week semester. That produces the hours-per-term total. Summer keeps
  // the same total and packs it into 6 weeks, so weekly hours rise.
  // If the file names hours per week, those hours are kept even when they
  // disagree with the units, and a warning is shown instead of rejecting the row.
  var HOURS_PER_LECTURE_UNIT = 1;
  var HOURS_PER_LAB_UNIT = 3;
  var WEEKS_PER_REGULAR_TERM = 18;
  var WEEKS_PER_SUMMER_TERM = 6;

  function weeksForTerm(sem) {
    return sem === 'summer' ? WEEKS_PER_SUMMER_TERM : WEEKS_PER_REGULAR_TERM;
  }

  /**
   * Units define an 18-week load. Summer keeps that same hours-per-semester
   * total and packs it into 6 weeks, so weekly hours rise.
   * 2 lec + 1 lab → 90 hours/semester either way; 5 hrs/week in a regular term,
   * 15 hrs/week in summer.
   * When the sheet already named hours per week, those values win.
   */
  function contactHours(lec, lab, sem, storedWeek, storedSem) {
    var regularWeekly = round2(
      (Number(lec) || 0) * HOURS_PER_LECTURE_UNIT + (Number(lab) || 0) * HOURS_PER_LAB_UNIT
    );
    var weeks = weeksForTerm(sem);
    var hoursSem = round2(regularWeekly * WEEKS_PER_REGULAR_TERM);
    var hoursWeek = weeks > 0 ? round2(hoursSem / weeks) : regularWeekly;
    var fileWeek = storedWeek == null || storedWeek === '' ? null : Number(storedWeek);
    if (fileWeek !== null && !isNaN(fileWeek) && fileWeek > 0) {
      hoursWeek = round2(fileWeek);
      var fileSem = storedSem == null || storedSem === '' ? null : Number(storedSem);
      hoursSem =
        fileSem !== null && !isNaN(fileSem) && fileSem > 0
          ? round2(fileSem)
          : round2(hoursWeek * weeks);
    }
    return {
      regularWeekly: regularWeekly,
      weeks: weeks,
      hoursSem: hoursSem,
      hoursWeek: hoursWeek
    };
  }

  var curricula = null;
  var listeners = [];

  // ------------------------------------------------------------- CSV parsing

  /**
   * RFC 4180 style reader: handles quoted fields containing commas, escaped
   * doubled quotes, CRLF or LF line endings, and a leading byte order mark.
   */
  function parseCsv(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;

    function endField() {
      row.push(field);
      field = '';
    }
    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (i < s.length) {
      var ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ',') {
        endField();
        i++;
        continue;
      }
      if (ch === '\r') {
        if (s.charAt(i + 1) === '\n') i++;
        endRow();
        i++;
        continue;
      }
      if (ch === '\n') {
        endRow();
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    if (field.length || row.length) endRow();

    return rows.filter(function (r) {
      return r.some(function (c) {
        return String(c).trim() !== '';
      });
    });
  }

  // ------------------------------------------------------------ header names

  function headerKey(name) {
    return String(name == null ? '' : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  // Canonical names match the sheet. Older headers still map here so a file
  // saved under the previous layout is not rejected.
  var FIELD_ALIASES = {
    course_id: ['courseid', 'coursecode', 'code', 'subjectcode', 'classcode', 'subjcode'],
    course_title: ['coursetitle', 'title', 'subject', 'subjecttitle', 'descriptivetitle', 'description'],
    lecture_units: ['lectureunits', 'lecunits', 'lec', 'lecture', 'unitslec'],
    lab_units: ['labunits', 'lab', 'laboratory', 'laboratoryunits', 'unitslab'],
    total_units: ['totalunits', 'units', 'totalunit', 'ttlunits'],
    total_hours_week: ['totalhoursweek', 'totalhourweek', 'hoursweek', 'hrsweek', 'hoursperweek', 'totalhrsweek'],
    total_hours_sem: ['totalhourssem', 'totalhoursem', 'hourssem', 'hrssem', 'hourspersem', 'totalhrssem', 'totalhourssemester'],
    year_level: ['yearlevel', 'year', 'yr', 'level'],
    semester: ['semester', 'sem', 'term'],
    lecture_room_type: ['lectureroomtype', 'lectureroom', 'lecturetype', 'lectureroomrequirement'],
    lab_room_type: [
      'labroomtype',
      'labroom',
      'laboratorytype',
      'laboratorytypes',
      'laboratorytyperequirement',
      'labtype',
      'labtypes',
      'labtyperequirement',
      'roomtyperequirement',
      'roomtype',
      'roomrequirement',
      'roomtypereq',
      'roomneeded'
    ],
    prerequisite_1: ['prerequisite1', 'prereq1', 'prerequisite', 'prerequisites', 'prereq', 'prerequisit', 'requisite'],
    prerequisite_2: ['prerequisite2', 'prereq2'],
    prerequisite_3: ['prerequisite3', 'prereq3']
  };

  var FIELDS = Object.keys(FIELD_ALIASES);

  function matchField(headerCell) {
    var key = headerKey(headerCell);
    if (!key) return null;
    for (var f = 0; f < FIELDS.length; f++) {
      var field = FIELDS[f];
      if (headerKey(field) === key) return field;
      if (FIELD_ALIASES[field].indexOf(key) >= 0) return field;
    }
    return null;
  }

  /**
   * Works out which column is which. A recognisable header row is used when
   * present; otherwise the columns are assumed to be in the documented order,
   * and the first row is treated as data rather than being thrown away.
   */
  function mapColumns(rows) {
    if (!rows.length) return { map: {}, dataStart: 0, hasHeader: false, unknown: [] };

    var first = rows[0];
    var map = {};
    var unknown = [];
    var matched = 0;

    first.forEach(function (cell, idx) {
      var field = matchField(cell);
      if (field && map[field] == null) {
        map[field] = idx;
        matched++;
      } else if (String(cell).trim()) {
        unknown.push(String(cell).trim());
      }
    });

    if (matched >= 3) return { map: map, dataStart: 1, hasHeader: true, unknown: unknown };

    var positional = {};
    FIELDS.forEach(function (field, idx) {
      if (idx < first.length) positional[field] = idx;
    });
    return { map: positional, dataStart: 0, hasHeader: false, unknown: [] };
  }

  // -------------------------------------------------------------- normalising

  var ORDINAL_WORDS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, one: 1, two: 2, three: 3,
    four: 4, five: 5, six: 6, seven: 7, eight: 8
  };

  function parseYearLevel(value) {
    var raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw) return null;
    var digits = raw.match(/\d+/);
    if (digits) {
      var n = parseInt(digits[0], 10);
      return n >= 1 && n <= 8 ? n : null;
    }
    var words = raw.replace(/[^a-z]+/g, ' ').trim().split(' ');
    for (var i = 0; i < words.length; i++) {
      if (ORDINAL_WORDS[words[i]]) return ORDINAL_WORDS[words[i]];
    }
    return null;
  }

  /** Returns '1', '2' or 'summer'. A third term of any spelling is summer. */
  function parseSemester(value) {
    var raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw) return null;
    if (/sum|^s$/.test(raw)) return 'summer';
    var digits = raw.match(/\d+/);
    if (digits) {
      var n = parseInt(digits[0], 10);
      if (n === 1) return '1';
      if (n === 2) return '2';
      if (n === 3) return 'summer';
      return null;
    }
    if (/\bfirst\b|\bone\b/.test(raw)) return '1';
    if (/\bsecond\b|\btwo\b/.test(raw)) return '2';
    if (/\bthird\b|\bthree\b/.test(raw)) return 'summer';
    return null;
  }

  function parseNumber(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    var cleaned = raw.replace(/,/g, '');
    if (!/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
    return parseFloat(cleaned);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function semesterLabel(sem) {
    if (sem === '1') return '1st Semester';
    if (sem === '2') return '2nd Semester';
    return 'Summer';
  }

  function yearLevelLabel(year) {
    var suffix = year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th';
    return year + suffix + ' Year';
  }

  function cleanText(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  }

  function isLectureName(name) {
    if (global.RoomTypes && typeof global.RoomTypes.isBaselineName === 'function') {
      return global.RoomTypes.isBaselineName(name);
    }
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() === 'lecture';
  }

  /**
   * Splits a cell that still uses list punctuation. The live model keeps one
   * value per field; this is only for migrating older sheets and for warning
   * when a new file packs several ids into one column.
   */
  function splitAtomicValues(raw) {
    var parts = Array.isArray(raw)
      ? raw
      : String(raw == null ? '' : raw).split(/\s*(?:\/|,|;|\||\bor\b)\s*/i);
    var seen = Object.create(null);
    var out = [];
    parts.forEach(function (p) {
      var name = cleanText(p);
      if (!name) return;
      var key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(name);
    });
    return out;
  }

  function firstAtomic(raw) {
    return splitAtomicValues(raw)[0] || '';
  }

  function cellHasMultipleAtomics(raw) {
    return splitAtomicValues(raw).length > 1;
  }

  function courseIdOf(course) {
    if (!course) return '';
    return cleanText(course.course_id || course.course_code);
  }

  function canonicalRoomTypeName(name) {
    var clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    if (global.RoomTypes && typeof global.RoomTypes.canonicalName === 'function') {
      return global.RoomTypes.canonicalName(clean);
    }
    var key = clean
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (key === 'off campus' || key === 'no room' || key === 'noroom') return 'Off-campus';
    return clean;
  }

  /**
   * One lecture room type, never inferred. Older rows had no such column
   * because lecture hours were forced onto "Lecture"; those stay blank so
   * staff can pick the type they actually need.
   */
  function lectureRoomTypeOf(course) {
    return canonicalRoomTypeName(firstAtomic((course || {}).lecture_room_type));
  }

  /**
   * One laboratory room type. Older rows stored this as laboratory_type,
   * laboratory_types, or room_type_requirement, sometimes as a slash-separated
   * list; only the first name is kept.
   */
  function labRoomTypeOf(course) {
    var c = course || {};
    var named = firstAtomic(c.lab_room_type);
    if (named) return canonicalRoomTypeName(named);
    if (Array.isArray(c.laboratory_types) && c.laboratory_types.length) {
      return canonicalRoomTypeName(firstAtomic(c.laboratory_types));
    }
    return canonicalRoomTypeName(firstAtomic(c.laboratory_type || c.room_type_requirement || ''));
  }

  /**
   * Three atomic prerequisite slots. A legacy single "prerequisite" cell that
   * still holds "MATH 101, ENG 102" is split across the empty slots so the
   * saved curriculum does not keep a multi-value field.
   */
  function prerequisitesOf(course) {
    var c = course || {};
    var slots = [
      firstAtomic(c.prerequisite_1),
      firstAtomic(c.prerequisite_2),
      firstAtomic(c.prerequisite_3)
    ];
    if (!slots[0] && !slots[1] && !slots[2]) {
      var leftover = splitAtomicValues(c.prerequisite);
      slots[0] = leftover[0] || '';
      slots[1] = leftover[1] || '';
      slots[2] = leftover[2] || '';
    }
    return slots;
  }

  function normalizeCourse(course) {
    var c = course || {};
    if (c.id && String(c.id).indexOf('cc-') !== 0) {
      delete c.id;
    }
    var id = courseIdOf(c);
    var slots = prerequisitesOf(c);
    c.course_id = id;
    c.course_code = id;
    c.lecture_room_type = lectureRoomTypeOf(c);
    c.lab_room_type = labRoomTypeOf(c);
    c.prerequisite_1 = slots[0];
    c.prerequisite_2 = slots[1];
    c.prerequisite_3 = slots[2];
    delete c.prerequisite;
    delete c.laboratory_type;
    delete c.laboratory_types;
    delete c.room_type_requirement;
    var lec = Number(c.lecture_units) || 0;
    var lab = Number(c.lab_units) || 0;
    var contact = contactHours(lec, lab, c.semester, c.total_hours_week, c.total_hours_sem);
    c.weeks_in_term = contact.weeks;
    c.total_units = round2(lec + lab);
    c.total_hours_week = contact.hoursWeek;
    c.total_hours_sem = contact.hoursSem;
    return c;
  }

  // -------------------------------------------------------------- validation

  /**
   * Turns raw CSV rows into normalised course records plus per-row messages.
   * Nothing is rejected outright: every row comes back with a status so the
   * preview can show what is wrong and the user can decide.
   *
   * Derived values are recomputed rather than trusted when the file omits
   * hours. Where units and hours per week disagree, hours per week from the
   * file are kept and the row is flagged — the curriculum is still saved.
   */
  function buildRows(rows, columns) {
    var out = [];
    var seenCodes = Object.create(null);

    for (var r = columns.dataStart; r < rows.length; r++) {
      var cells = rows[r];
      var get = function (field) {
        var idx = columns.map[field];
        if (idx == null || idx >= cells.length) return '';
        return String(cells[idx] == null ? '' : cells[idx]).trim();
      };

      var messages = [];
      var status = 'valid';
      function fail(msg) {
        messages.push({ level: 'error', text: msg });
        status = 'error';
      }
      function warn(msg) {
        messages.push({ level: 'warning', text: msg });
        if (status !== 'error') status = 'warning';
      }

      var code = get('course_id') || get('course_code');
      var title = get('course_title');
      if (!code) fail('Missing course id.');
      if (!title) fail('Missing course title.');

      var lec = parseNumber(get('lecture_units'));
      var lab = parseNumber(get('lab_units'));
      if (lec === null) lec = 0;
      if (lab === null) lab = 0;
      if (isNaN(lec) || lec < 0) {
        fail('Lecture units must be a number of 0 or more.');
        lec = 0;
      }
      if (isNaN(lab) || lab < 0) {
        fail('Lab units must be a number of 0 or more.');
        lab = 0;
      }

      var year = parseYearLevel(get('year_level'));
      if (year === null) fail('Year level could not be read from "' + get('year_level') + '".');

      var sem = parseSemester(get('semester'));
      if (sem === null) fail('Semester could not be read from "' + get('semester') + '".');

      var totalUnits = round2(lec + lab);
      var computed = contactHours(lec, lab, sem);
      var hoursWeek = computed.hoursWeek;
      var hoursSem = computed.hoursSem;
      var weeks = computed.weeks;
      var hoursRule =
        lec + ' lec × ' + HOURS_PER_LECTURE_UNIT + ' hr' +
        (HOURS_PER_LECTURE_UNIT === 1 ? '' : 's') +
        ' + ' + lab + ' lab × ' + HOURS_PER_LAB_UNIT + ' hrs';

      var fileUnits = parseNumber(get('total_units'));
      if (fileUnits !== null && !isNaN(fileUnits) && round2(fileUnits) !== totalUnits) {
        warn('File says ' + fileUnits + ' total units; ' + totalUnits + ' computed from ' + lec + ' lec + ' + lab + ' lab. Using ' + totalUnits + '.');
      }
      var fileHoursWeek = parseNumber(get('total_hours_week'));
      var usedFileHours = false;
      if (fileHoursWeek !== null && !isNaN(fileHoursWeek) && fileHoursWeek > 0) {
        if (round2(fileHoursWeek) !== computed.hoursWeek) {
          var weekWhy =
            sem === 'summer'
              ? computed.hoursSem + ' hours/semester condensed into 6 summer weeks'
              : hoursRule + ' (1 lecture unit = 1 hour/week, 1 lab unit = 3 hours/week)';
          warn(
            'File says ' + fileHoursWeek + ' hours a week; units compute to ' + computed.hoursWeek +
            ' from ' + weekWhy + '. Using the file hours (' + fileHoursWeek + ' per week).'
          );
        }
        hoursWeek = round2(fileHoursWeek);
        hoursSem = round2(hoursWeek * weeks);
        usedFileHours = true;
      }
      var fileHoursSem = parseNumber(get('total_hours_sem'));
      if (fileHoursSem !== null && !isNaN(fileHoursSem) && fileHoursSem > 0 && round2(fileHoursSem) !== hoursSem) {
        if (usedFileHours) {
          warn(
            'File says ' + fileHoursSem + ' hours per semester; using ' + hoursSem +
            ' from hours per week × ' + weeks + ' weeks.'
          );
        } else {
          warn(
            'File says ' + fileHoursSem + ' hours per semester; ' + hoursSem +
            ' computed from ' + hoursRule + ' over an 18-week equivalent' +
            (sem === 'summer' ? ', then taught in 6 weeks' : '') +
            '. Using ' + hoursSem + '.'
          );
        }
      }

      if (code) {
        var key = code.toLowerCase();
        if (seenCodes[key]) {
          warn('Course id ' + code + ' also appears on row ' + seenCodes[key] + '.');
        } else {
          seenCodes[key] = r + 1;
        }
      }

      var rawLectureType = get('lecture_room_type');
      var rawLabType = get('lab_room_type') || get('laboratory_type');
      var lectureType = canonicalRoomTypeName(firstAtomic(rawLectureType));
      var labType = canonicalRoomTypeName(firstAtomic(rawLabType));
      if (labType && isLectureName(labType) && !cellHasMultipleAtomics(rawLabType)) {
        warn('Lab room type is "Lecture". Choose the laboratory this subject actually uses.');
        labType = '';
      } else if (isLectureName(labType)) {
        labType = firstAtomic(
          splitAtomicValues(rawLabType).filter(function (name) {
            return !isLectureName(name);
          })
        );
      }

      if (cellHasMultipleAtomics(rawLectureType)) {
        warn('lecture_room_type must be a single room type. Using "' + lectureType + '" and ignoring the rest.');
      }
      if (cellHasMultipleAtomics(rawLabType)) {
        warn('lab_room_type must be a single room type. Using "' + labType + '" and ignoring the rest.');
      }
      if (lec > 0 && !lectureType) {
        warn('This subject has lecture units, so a lecture room type is needed before those hours can be scheduled.');
      }
      if (lab > 0 && !labType) {
        warn('This subject has lab units, so a lab room type is needed before those hours can be scheduled.');
      }
      if (lec === 0 && lectureType) {
        warn('Lecture room type is set but this subject has 0 lecture units.');
      }
      if (lab === 0 && labType) {
        warn('Lab room type is set but this subject has 0 lab units.');
      }

      var prereqCells = [get('prerequisite_1'), get('prerequisite_2'), get('prerequisite_3')];
      if (!prereqCells[0] && !prereqCells[1] && !prereqCells[2]) {
        prereqCells[0] = get('prerequisite');
      }
      var prereqSlots = ['', '', ''];
      var overflow = [];
      var packed = false;
      prereqCells.forEach(function (cell, idx) {
        var parts = splitAtomicValues(cell);
        if (parts.length > 1) packed = true;
        if (!parts.length) return;
        if (!prereqSlots[idx]) prereqSlots[idx] = parts[0];
        overflow = overflow.concat(parts.slice(prereqSlots[idx] === parts[0] ? 1 : 0));
      });
      for (var s = 0; s < 3 && overflow.length; s++) {
        if (!prereqSlots[s]) prereqSlots[s] = overflow.shift();
      }
      if (packed) {
        warn('Each prerequisite column must hold one course id. Extra values were moved into empty prerequisite slots.');
      }
      if (overflow.length) {
        warn(
          'Only three prerequisites are stored. These were not kept: ' + overflow.join(', ') + '.'
        );
      }

      out.push({
        sourceRow: r + 1,
        status: status,
        messages: messages,
        course: normalizeCourse({
          course_id: code,
          course_title: title,
          lecture_units: lec,
          lab_units: lab,
          total_units: totalUnits,
          total_hours_week: hoursWeek,
          total_hours_sem: hoursSem,
          weeks_in_term: weeks,
          year_level: year,
          semester: sem,
          lecture_room_type: lectureType,
          lab_room_type: labType,
          prerequisite_1: prereqSlots[0],
          prerequisite_2: prereqSlots[1],
          prerequisite_3: prereqSlots[2]
        })
      });
    }
    return out;
  }

  /** Full pipeline from file text to reviewable rows. */
  function parse(text) {
    var grid = parseCsv(text);
    if (!grid.length) {
      return { ok: false, error: 'That file has no rows in it.', rows: [], columns: null };
    }
    var columns = mapColumns(grid);
    var missing = ['course_id', 'course_title', 'year_level', 'semester'].filter(function (f) {
      return columns.map[f] == null;
    });
    if (missing.length) {
      return {
        ok: false,
        error: 'These required columns were not found: ' + missing.join(', ') + '.',
        rows: [],
        columns: columns
      };
    }
    var rows = buildRows(grid, columns);
    if (!rows.length) {
      return { ok: false, error: 'The file has headers but no course rows.', rows: [], columns: columns };
    }
    return { ok: true, rows: rows, columns: columns };
  }

  /** Distinct room types named by the file that the registry does not have yet. */
  function unknownRoomTypes(rows) {
    var known = Object.create(null);
    if (global.RoomTypes) {
      global.RoomTypes.list().forEach(function (t) {
        known[global.RoomTypes.normalizeName(t.name)] = true;
      });
    }
    var out = [];
    var seen = Object.create(null);
    rows.forEach(function (r) {
      [lectureRoomTypeOf(r.course), labRoomTypeOf(r.course)].forEach(function (name) {
        name = cleanText(name);
        if (!name) return;
        var key = global.RoomTypes ? global.RoomTypes.normalizeName(name) : name.toLowerCase();
        if (known[key] || seen[key]) return;
        seen[key] = true;
        out.push(name);
      });
    });
    return out;
  }

  // ------------------------------------------------------------- persistence

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Returns false when the browser refused the write, which happens in private
   * browsing, when the quota is full, or when storage is blocked for the page's
   * origin. Callers must surface that: silently swallowing it made a failed
   * save report success, and the curriculum then vanished on the next page.
   */
  function writeStore() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(curricula));
      return true;
    } catch (e) {
      return false;
    }
  }

  var useApi = false;

  function applyList(list) {
    curricula = (Array.isArray(list) ? list : []).map(function (cur) {
      if (cur && Array.isArray(cur.courses)) {
        cur.courses = cur.courses.map(normalizeCourse);
      }
      if (cur && cur.status !== 'archived') cur.status = 'active';
      return cur;
    });
    return curricula;
  }

  function hydrate() {
    if (!global.McuApi) {
      load();
      return Promise.resolve(curricula);
    }
    return global.McuApi.health().then(function (h) {
      if (!h.configured || !h.installed) {
        load();
        return curricula;
      }
      useApi = true;
      return global.McuApi.get('curricula.php').then(function (res) {
        applyList(res.curricula);
        try {
          global.localStorage.setItem(STORAGE_KEY, JSON.stringify(curricula));
        } catch (e) { /* cache only */ }
        notify();
        return curricula;
      });
    }).catch(function () {
      load();
      return curricula;
    });
  }

  function storageWorks() {
    if (useApi) return true;
    try {
      var probe = STORAGE_KEY + '-probe';
      global.localStorage.setItem(probe, '1');
      var ok = global.localStorage.getItem(probe) === '1';
      global.localStorage.removeItem(probe);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function load() {
    if (curricula) return curricula;
    curricula = readStore().map(function (cur) {
      if (cur && Array.isArray(cur.courses)) {
        cur.courses = cur.courses.map(normalizeCourse);
      }
      if (cur && cur.status !== 'archived') cur.status = 'active';
      return cur;
    });
    return curricula;
  }

  function isArchived(c) {
    return !!(c && c.status === 'archived');
  }

  function list(opts) {
    opts = opts || {};
    return load()
      .filter(function (c) {
        if (opts.includeArchived) return true;
        if (opts.archived === true) return isArchived(c);
        return !isArchived(c);
      })
      .sort(function (a, b) {
        if (a.collegeName !== b.collegeName) return a.collegeName.localeCompare(b.collegeName);
        if ((a.departmentName || '') !== (b.departmentName || '')) {
          return (a.departmentName || '').localeCompare(b.departmentName || '');
        }
        return String(b.academicYear).localeCompare(String(a.academicYear));
      });
  }

  function get(id) {
    var all = load();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  /** An existing curriculum for the same program and year, which upload replaces. */
  function findExisting(collegeId, departmentId, academicYear) {
    var all = load();
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (
        c.collegeId === collegeId &&
        (c.departmentId || null) === (departmentId || null) &&
        String(c.academicYear) === String(academicYear)
      ) {
        return c;
      }
    }
    return null;
  }

  function save(meta, courses, options) {
    options = options || {};
    var all = load();
    var existing = findExisting(meta.collegeId, meta.departmentId, meta.academicYear);
    var now = new Date().toISOString();
    courses = (courses || []).map(normalizeCourse);

    var STORAGE_BLOCKED =
      'The browser refused to save. This usually means private browsing, a full storage quota, ' +
      'or the pages being opened straight from disk with site data blocked. Serving the folder ' +
      'over a local web server fixes it.';

    if (existing && options.replace) {
      var before = existing.courses;
      existing.courses = courses;
      existing.sourceFileName = meta.sourceFileName || existing.sourceFileName;
      existing.status = 'active';
      existing.updatedAt = now;
      if (useApi && global.McuApi) {
        return global.McuApi.send('POST', 'curricula.php', {
          meta: meta,
          courses: courses,
          replace: true
        })
          .then(function (res) {
            if (res.conflict) return { ok: false, conflict: res.conflict };
            var idx = all.indexOf(existing);
            if (idx >= 0) all[idx] = res.curriculum;
            writeStore();
            notify();
            return { ok: true, curriculum: res.curriculum, replaced: true };
          })
          .catch(function (err) {
            existing.courses = before;
            return { ok: false, error: err.message || String(err) };
          });
      }
      if (!writeStore()) {
        existing.courses = before;
        return Promise.resolve({ ok: false, error: STORAGE_BLOCKED });
      }
      notify();
      return Promise.resolve({ ok: true, curriculum: existing, replaced: true });
    }
    if (existing && !options.replace) {
      return Promise.resolve({ ok: false, conflict: existing });
    }

    if (useApi && global.McuApi) {
      return global.McuApi.send('POST', 'curricula.php', {
        meta: meta,
        courses: courses,
        replace: false
      })
        .then(function (res) {
          if (res.conflict) return { ok: false, conflict: res.conflict };
          all.push(res.curriculum);
          writeStore();
          notify();
          return { ok: true, curriculum: res.curriculum, replaced: !!res.replaced };
        })
        .catch(function (err) {
          return { ok: false, error: err.message || String(err) };
        });
    }

    var record = {
      id: 'cur-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      collegeId: meta.collegeId,
      collegeName: meta.collegeName,
      departmentId: meta.departmentId || null,
      departmentName: meta.departmentName || null,
      academicYear: meta.academicYear,
      sourceFileName: meta.sourceFileName || '',
      createdAt: now,
      updatedAt: now,
      status: 'active',
      courses: courses
    };
    all.push(record);
    if (!writeStore()) {
      all.pop();
      return Promise.resolve({ ok: false, error: STORAGE_BLOCKED });
    }
    notify();
    return Promise.resolve({ ok: true, curriculum: record, replaced: false });
  }

  function updateCourses(id, courses) {
    var c = get(id);
    if (!c) return Promise.resolve(false);
    c.courses = (courses || []).map(normalizeCourse);
    c.updatedAt = new Date().toISOString();
    writeStore();
    notify();
    if (!useApi || !global.McuApi) return Promise.resolve(true);
    return global.McuApi.send('PATCH', 'curricula.php', { id: id, courses: c.courses })
      .then(function (res) {
        if (res.curriculum) {
          var all = load();
          for (var i = 0; i < all.length; i++) {
            if (all[i].id === id) all[i] = res.curriculum;
          }
          writeStore();
        }
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function setStatus(id, status) {
    var c = get(id);
    if (!c) return Promise.resolve({ ok: false, error: 'Curriculum not found' });
    var next = status === 'archived' ? 'archived' : 'active';
    var prev = c.status === 'archived' ? 'archived' : 'active';
    c.status = next;
    c.updatedAt = new Date().toISOString();
    writeStore();
    notify();
    if (!useApi || !global.McuApi) return Promise.resolve({ ok: true, curriculum: c });
    return global.McuApi.send('PATCH', 'curricula.php', { id: id, status: next })
      .then(function (res) {
        if (res.curriculum) {
          var all = load();
          for (var i = 0; i < all.length; i++) {
            if (all[i].id === id) all[i] = res.curriculum;
          }
          writeStore();
          notify();
        }
        return { ok: true, curriculum: res.curriculum || c };
      })
      .catch(function (err) {
        c.status = prev;
        writeStore();
        notify();
        return { ok: false, error: err.message || String(err) };
      });
  }

  function remove(id) {
    var all = load();
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) idx = i;
    }
    if (idx < 0) return Promise.resolve({ ok: false, error: 'Curriculum not found.' });
    var removed = all.splice(idx, 1)[0];
    writeStore();
    notify();
    if (!useApi || !global.McuApi) return Promise.resolve({ ok: true });
    return global.McuApi.send('DELETE', 'curricula.php?id=' + encodeURIComponent(id))
      .then(function () {
        return { ok: true };
      })
      .catch(function (err) {
        all.splice(idx, 0, removed);
        writeStore();
        notify();
        return { ok: false, error: err.message || String(err) };
      });
  }

  /**
   * Orders courses into year level then term blocks, generated from whatever the
   * data contains. A program with six years produces six blocks; summer appears
   * only where it exists.
   */
  function groupCourses(courses) {
    var order = { '1': 1, '2': 2, summer: 3 };
    var buckets = {};
    (courses || []).forEach(function (c) {
      var key = c.year_level + '|' + c.semester;
      if (!buckets[key]) {
        buckets[key] = {
          year_level: c.year_level,
          semester: c.semester,
          label: yearLevelLabel(c.year_level) + ' · ' + semesterLabel(c.semester),
          courses: []
        };
      }
      buckets[key].courses.push(c);
    });
    return Object.keys(buckets)
      .map(function (k) {
        return buckets[k];
      })
      .sort(function (a, b) {
        if (a.year_level !== b.year_level) return a.year_level - b.year_level;
        return (order[a.semester] || 9) - (order[b.semester] || 9);
      });
  }

  function totals(courses) {
    var t = { lecture_units: 0, lab_units: 0, total_units: 0, total_hours_week: 0, total_hours_sem: 0 };
    (courses || []).forEach(function (c) {
      t.lecture_units += Number(c.lecture_units) || 0;
      t.lab_units += Number(c.lab_units) || 0;
      t.total_units += Number(c.total_units) || 0;
      t.total_hours_week += Number(c.total_hours_week) || 0;
      t.total_hours_sem += Number(c.total_hours_sem) || 0;
    });
    Object.keys(t).forEach(function (k) {
      t[k] = round2(t[k]);
    });
    return t;
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function notify() {
    listeners.forEach(function (cb) {
      try {
        cb();
      } catch (e) {
        /* one bad listener must not stop the others */
      }
    });
  }

  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) return;
      curricula = null;
      load();
      notify();
    });
  }

  global.CurriculumStore = {
    STORAGE_KEY: STORAGE_KEY,
    FIELDS: FIELDS,
    HOURS_PER_LECTURE_UNIT: HOURS_PER_LECTURE_UNIT,
    HOURS_PER_LAB_UNIT: HOURS_PER_LAB_UNIT,
    WEEKS_PER_REGULAR_TERM: WEEKS_PER_REGULAR_TERM,
    WEEKS_PER_SUMMER_TERM: WEEKS_PER_SUMMER_TERM,
    weeksForTerm: weeksForTerm,
    contactHours: contactHours,
    storageWorks: storageWorks,
    hydrate: hydrate,
    parseCsv: parseCsv,
    parse: parse,
    parseYearLevel: parseYearLevel,
    parseSemester: parseSemester,
    unknownRoomTypes: unknownRoomTypes,
    courseIdOf: courseIdOf,
    lectureRoomTypeOf: lectureRoomTypeOf,
    labRoomTypeOf: labRoomTypeOf,
    prerequisitesOf: prerequisitesOf,
    normalizeCourse: normalizeCourse,
    semesterLabel: semesterLabel,
    yearLevelLabel: yearLevelLabel,
    list: list,
    get: get,
    findExisting: findExisting,
    save: save,
    updateCourses: updateCourses,
    setStatus: setStatus,
    isArchived: isArchived,
    remove: remove,
    groupCourses: groupCourses,
    totals: totals,
    onChange: onChange
  };
})(typeof window !== 'undefined' ? window : this);
