-- =====================================================================
-- ROOM MANAGEMENT / REGISTRAR ALLOCATION SYSTEM
-- Target: MySQL 8.0.16 or newer (CHECK constraints + stored generated columns)
-- =====================================================================

SET NAMES utf8mb4;


-- =====================================================================
-- SECTION 1 - ORGANIZATION
-- =====================================================================

CREATE TABLE colleges (
  college_id      INT PRIMARY KEY AUTO_INCREMENT,
  college_code    VARCHAR(20)  NOT NULL,
  college_name    VARCHAR(255) NOT NULL,
  use_departments BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'TRUE = this college lists departments, each with one or more programs',
  archived_label  VARCHAR(40)  NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_colleges_code (college_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- A department belongs to one college and has one or more programs.
-- One department has at most one active Program Chair (users.department_id).
CREATE TABLE departments (
  department_id    INT PRIMARY KEY AUTO_INCREMENT,
  college_id       INT          NOT NULL,
  department_code  VARCHAR(30)  NOT NULL,
  department_name  VARCHAR(255) NOT NULL,
  archived_label   VARCHAR(40)  NULL,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_departments_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE CASCADE,
  UNIQUE KEY uq_departments_code (department_code),
  KEY idx_departments_college (college_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- A program owns the curriculum and enrolls sections. represents_college
-- remains for a college that is itself a single program.
CREATE TABLE programs (
  program_id         INT PRIMARY KEY AUTO_INCREMENT,
  college_id         INT          NOT NULL,
  department_id      INT          NULL,
  program_code       VARCHAR(30)  NOT NULL,
  program_name       VARCHAR(255) NOT NULL COMMENT 'Program name, e.g. Occupational Therapy',
  degree_title       VARCHAR(255) NULL COMMENT 'e.g. Bachelor of Science in Occupational Therapy',
  represents_college BOOLEAN      NOT NULL DEFAULT FALSE,
  normal_years       TINYINT      NOT NULL COMMENT 'No default: a 5-year or 6-year program must not silently inherit 4',
  archived_label     VARCHAR(40)  NULL,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sole_program_flag  TINYINT GENERATED ALWAYS AS (IF(represents_college, 1, NULL)) STORED,
  CONSTRAINT fk_programs_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE CASCADE,
  CONSTRAINT fk_programs_department FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL,
  UNIQUE KEY uq_programs_code (program_code),
  UNIQUE KEY uq_programs_sole (college_id, sole_program_flag),
  KEY idx_programs_college (college_id),
  KEY idx_programs_department (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- SECTION 2 - ACADEMIC CALENDAR
-- =====================================================================

CREATE TABLE school_years (
  school_year_id INT PRIMARY KEY AUTO_INCREMENT,
  label          VARCHAR(9) NOT NULL COMMENT 'e.g. 2025-2026',
  start_year     SMALLINT   NOT NULL,
  is_current     BOOLEAN    NOT NULL DEFAULT FALSE,
  UNIQUE KEY uq_school_years_label (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- One row per (school year, term). Summer is simply a third term row; it only
-- carries data for the year levels that actually offer summer courses.
-- weeks_in_term is generated from term_code: 1st/2nd semester = 18 weeks,
-- summer = 6. A summer subject keeps the same hours-per-semester total as it
-- would in a regular term; those hours are taught in one-third the weeks.
-- is_active is TRUE for the one current offering. Archive the whole term
-- (every section in that academic year + semester) when the semester ends.
CREATE TABLE terms (
  term_id        INT PRIMARY KEY AUTO_INCREMENT,
  school_year_id INT NOT NULL,
  term_code      ENUM('1','2','summer') NOT NULL,
  weeks_in_term  TINYINT GENERATED ALWAYS AS (CASE term_code WHEN 'summer' THEN 6 ELSE 18 END) STORED,
  start_date     DATE NULL,
  end_date       DATE NULL,
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  archived_label VARCHAR(40) NULL,
  term_order     TINYINT GENERATED ALWAYS AS
                   (CASE term_code WHEN '1' THEN 1 WHEN '2' THEN 2 ELSE 3 END) STORED,
  CONSTRAINT fk_terms_school_year FOREIGN KEY (school_year_id) REFERENCES school_years(school_year_id) ON DELETE CASCADE,
  UNIQUE KEY uq_terms (school_year_id, term_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- SECTION 3 - CURRICULUM
-- =====================================================================

-- The curriculum points only at program_id. The college is reached through the
-- program, so a curriculum can never claim a college that contradicts its
-- program.
CREATE TABLE curricula (
  curriculum_id     INT PRIMARY KEY AUTO_INCREMENT,
  program_id        INT          NOT NULL,
  curriculum_name   VARCHAR(255) NOT NULL COMMENT 'e.g. BSOT Curriculum 2024-2025',
  academic_year     VARCHAR(9)   NOT NULL COMMENT 'e.g. 2026-2027, the year this snapshot belongs to',
  effective_year    SMALLINT     NOT NULL COMMENT 'Start year of academic_year, e.g. 2026',
  status            ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  source_file_name  VARCHAR(255) NULL,
  source_import_id  INT NULL COMMENT 'Set when created by an Excel upload; lets you undo a bad import',
  notes             TEXT NULL,
  created_by        INT NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_curricula_program FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE,
  UNIQUE KEY uq_curricula_version (program_id, academic_year),
  KEY idx_curricula_program (program_id),
  KEY idx_curricula_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- A course row belongs to exactly one curriculum. Course ids are unique
-- within a curriculum, not globally: two programs may legitimately use the same
-- id for different subjects, and the 2024 version of a subject may carry
-- different units than the 2023 version. Each curriculum is therefore an
-- independent, immutable snapshot and editing one never mutates another.
--
-- lecture_room_type and lab_room_type are named on the sheet. Lecture hours
-- are never forced onto a "Lecture" room. Up to three prerequisites sit in
-- prerequisite_1..3 so one column never holds more than one course id.
--
-- year_level and term_code live here, not in a shared catalog, because
-- "3rd year, 1st semester" is a property of the placement of a subject inside a
-- curriculum rather than a property of the subject itself.
--
-- The three total_* columns: total_units always follows lecture + lab.
-- Hours per week are stored (not generated) so a sheet can name weekly hours
-- that do not match the unit formula. Those file hours are kept, with a warning.
-- If hours are omitted they default to:
--   1 lecture unit = 1 hr/week, 1 lab unit = 3 hrs/week over 18 weeks.
-- Hours per term follow hours per week × weeks_in_term (18, or 6 in summer).
CREATE TABLE curriculum_courses (
  curriculum_course_id INT PRIMARY KEY AUTO_INCREMENT,
  curriculum_id        INT          NOT NULL,
  year_level           TINYINT      NOT NULL,
  term_code            ENUM('1','2','summer') NOT NULL,
  course_id            VARCHAR(30)  NOT NULL,
  course_title         VARCHAR(255) NOT NULL,
  lecture_units        DECIMAL(4,2) NOT NULL DEFAULT 0,
  lab_units            DECIMAL(4,2) NOT NULL DEFAULT 0,
  weeks_in_term        TINYINT GENERATED ALWAYS AS (CASE term_code WHEN 'summer' THEN 6 ELSE 18 END) STORED,
  lecture_room_type    VARCHAR(120) NULL COMMENT 'Named on the sheet; never inferred as Lecture',
  lab_room_type        VARCHAR(120) NULL COMMENT 'Named on the sheet; one laboratory type, not a list',
  prerequisite_1       VARCHAR(30)  NULL COMMENT 'One course id; never a comma-separated list',
  prerequisite_2       VARCHAR(30)  NULL,
  prerequisite_3       VARCHAR(30)  NULL,
  is_elective          BOOLEAN      NOT NULL DEFAULT FALSE,
  display_order        SMALLINT     NOT NULL DEFAULT 0,
  total_units          DECIMAL(5,2) GENERATED ALWAYS AS (lecture_units + lab_units) STORED,
  total_hours_week     DECIMAL(6,2) NOT NULL DEFAULT 0,
  total_hours_sem      DECIMAL(7,2) NOT NULL DEFAULT 0,
  term_order           TINYINT GENERATED ALWAYS AS
                         (CASE term_code WHEN '1' THEN 1 WHEN '2' THEN 2 ELSE 3 END) STORED,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cc_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(curriculum_id) ON DELETE CASCADE,
  CONSTRAINT chk_cc_units CHECK (lecture_units >= 0 AND lab_units >= 0),
  CONSTRAINT chk_cc_year CHECK (year_level BETWEEN 1 AND 8),
  UNIQUE KEY uq_cc_code (curriculum_id, course_id),
  KEY idx_cc_placement (curriculum_id, year_level, term_order, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Resolved prerequisites. prerequisite_1..3 above keep the raw course ids from
-- the sheet so an import never fails on a code that is not yet in this
-- curriculum; this table is filled in afterwards (automatically where the id
-- matches, manually otherwise) and is what you query for real prerequisite
-- logic. slot records which of the three columns the edge came from.
CREATE TABLE course_prerequisites (
  curriculum_course_id INT NOT NULL,
  prereq_course_id     INT NOT NULL,
  slot                 TINYINT NOT NULL COMMENT '1, 2 or 3 matching prerequisite_1..3',
  PRIMARY KEY (curriculum_course_id, slot),
  UNIQUE KEY uq_prereq_pair (curriculum_course_id, prereq_course_id),
  CONSTRAINT fk_prereq_course FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(curriculum_course_id) ON DELETE CASCADE,
  CONSTRAINT fk_prereq_target FOREIGN KEY (prereq_course_id)     REFERENCES curriculum_courses(curriculum_course_id) ON DELETE CASCADE,
  CONSTRAINT chk_prereq_not_self CHECK (curriculum_course_id <> prereq_course_id),
  CONSTRAINT chk_prereq_slot CHECK (slot BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- SECTION 4 - EXCEL IMPORT STAGING
-- =====================================================================

-- One row per uploaded file. Nothing is written to curriculum_courses until the
-- user confirms the preview, so a malformed sheet cannot corrupt live data.
CREATE TABLE curriculum_imports (
  import_id      INT PRIMARY KEY AUTO_INCREMENT,
  program_id     INT NOT NULL,
  curriculum_id  INT NULL COMMENT 'Filled in once the import is committed',
  original_name  VARCHAR(255) NOT NULL,
  stored_path    VARCHAR(512) NOT NULL,
  file_hash      CHAR(64) NULL COMMENT 'SHA-256, to detect re-uploads of the same file',
  status         ENUM('uploaded','parsed','needs_review','committed','failed','rolled_back') NOT NULL DEFAULT 'uploaded',
  row_count      SMALLINT NOT NULL DEFAULT 0,
  error_count    SMALLINT NOT NULL DEFAULT 0,
  error_log      JSON NULL,
  uploaded_by    INT NULL,
  uploaded_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at   TIMESTAMP NULL,
  CONSTRAINT fk_imports_program    FOREIGN KEY (program_id)    REFERENCES programs(program_id) ON DELETE CASCADE,
  CONSTRAINT fk_imports_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(curriculum_id) ON DELETE SET NULL,
  KEY idx_imports_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Every cell arrives as text, exactly as read from the sheet, so no row is ever
-- rejected at parse time. Validation errors are recorded per row and shown on a
-- preview screen; the user fixes them in the browser and commits. The columns
-- mirror the destination table one-to-one, which is what makes a plain
-- header-to-column mapping possible.
CREATE TABLE curriculum_import_rows (
  import_row_id        INT PRIMARY KEY AUTO_INCREMENT,
  import_id            INT NOT NULL,
  sheet_name           VARCHAR(120) NULL,
  source_row_number    SMALLINT NOT NULL,
  raw_year_level       VARCHAR(60)  NULL COMMENT 'e.g. "FIRST YEAR", read from a section header',
  raw_term             VARCHAR(60)  NULL COMMENT 'e.g. "FIRST SEMESTER", "SUMMER"',
  raw_course_id        VARCHAR(120) NULL,
  raw_course_title     VARCHAR(500) NULL,
  raw_lecture_units    VARCHAR(60)  NULL,
  raw_lab_units        VARCHAR(60)  NULL,
  raw_total_units      VARCHAR(60)  NULL,
  raw_hours_week       VARCHAR(60)  NULL,
  raw_hours_sem        VARCHAR(60)  NULL,
  raw_lecture_room_type VARCHAR(120) NULL,
  raw_lab_room_type    VARCHAR(120) NULL,
  raw_prerequisite_1   VARCHAR(120) NULL,
  raw_prerequisite_2   VARCHAR(120) NULL,
  raw_prerequisite_3   VARCHAR(120) NULL,
  parsed_year_level    TINYINT NULL,
  parsed_term_code     ENUM('1','2','summer') NULL,
  row_status           ENUM('pending','valid','warning','error','skipped','committed') NOT NULL DEFAULT 'pending',
  messages             JSON NULL COMMENT 'Per-field validation messages for the preview screen',
  curriculum_course_id INT NULL COMMENT 'Set on commit; makes the import reversible',
  CONSTRAINT fk_import_rows_import FOREIGN KEY (import_id) REFERENCES curriculum_imports(import_id) ON DELETE CASCADE,
  CONSTRAINT fk_import_rows_course FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(curriculum_course_id) ON DELETE SET NULL,
  UNIQUE KEY uq_import_row (import_id, sheet_name, source_row_number),
  KEY idx_import_rows_status (import_id, row_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE curricula
  ADD CONSTRAINT fk_curricula_import FOREIGN KEY (source_import_id) REFERENCES curriculum_imports(import_id) ON DELETE SET NULL;


-- =====================================================================
-- SECTION 5 - FACILITIES
-- =====================================================================

CREATE TABLE buildings (
  building_id          INT PRIMARY KEY AUTO_INCREMENT,
  building_code        VARCHAR(20)  NOT NULL,
  building_name        VARCHAR(255) NOT NULL,
  uses_floors          BOOLEAN      NOT NULL DEFAULT TRUE COMMENT 'FALSE = rooms are not grouped by floor in the UI',
  exclusive_college_id INT NULL COMMENT 'When set, only this college may use the building',
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_buildings_college FOREIGN KEY (exclusive_college_id) REFERENCES colleges(college_id) ON DELETE SET NULL,
  UNIQUE KEY uq_buildings_code (building_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Walking distance between buildings, used to suggest nearby rooms when a
-- schedule has to be moved. Store one row per ordered pair.
CREATE TABLE building_proximity (
  building_id      INT NOT NULL,
  near_building_id INT NOT NULL,
  rank_order       TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (building_id, near_building_id),
  CONSTRAINT fk_prox_building FOREIGN KEY (building_id)      REFERENCES buildings(building_id) ON DELETE CASCADE,
  CONSTRAINT fk_prox_near     FOREIGN KEY (near_building_id) REFERENCES buildings(building_id) ON DELETE CASCADE,
  CONSTRAINT chk_prox_not_self CHECK (building_id <> near_building_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Always create at least one floor per building, even when uses_floors = FALSE.
-- That keeps rooms.floor_id NOT NULL and removes a nullable branch from every
-- room query.
CREATE TABLE floors (
  floor_id     INT PRIMARY KEY AUTO_INCREMENT,
  building_id  INT NOT NULL,
  floor_number TINYINT NOT NULL,
  floor_label  VARCHAR(60) NULL COMMENT 'e.g. Ground, Mezzanine',
  CONSTRAINT fk_floors_building FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE,
  UNIQUE KEY uq_floors (building_id, floor_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- A lookup table rather than an ENUM, so the registrar can add a laboratory
-- kind the moment they meet one instead of the list having to be known up front.
-- Adding a row is an ordinary INSERT; an ENUM would need an ALTER TABLE on a
-- live table for every new kind.
--
-- The name is the whole classification. There is deliberately no separate
-- category column: "Chemistry Laboratory" already says it is a laboratory, and a
-- second field saying so could only ever agree redundantly or disagree wrongly.
-- Where a subject can use more than one kind of room, that is expressed by
-- listing each acceptable type in course_room_requirements rather than by
-- grouping types here.
--
-- room_type_name is uniquely indexed, and because the table collation is
-- utf8mb4_unicode_ci that check is case- and accent-insensitive: "Computer Lab"
-- and "computer lab" collide, so staff cannot create both. It cannot stop
-- "Computer Lab" and "Computer Laboratory" from coexisting as separate types,
-- which the UI has to handle by suggesting close existing names before it
-- creates anything.
--
-- Section 9 seeds one row, "Lecture". It is the default selection in the room
-- editor, which is what makes it impossible to save a room with no type.
-- Off-campus is also reserved: it occupies student time but never books a campus
-- room. Staff add, rename, and delete other types from the Facilities Room types
-- list only. A delete reassigns rooms and curriculum lecture/lab names to a
-- replacement type first; ON DELETE RESTRICT still blocks a raw delete while
-- those references remain. Renaming updates room_type_name and the matching
-- VARCHAR tags on curriculum_courses.
CREATE TABLE room_types (
  room_type_id   INT PRIMARY KEY AUTO_INCREMENT,
  room_type_name VARCHAR(120) NOT NULL,
  room_type_code VARCHAR(40) NULL COMMENT 'Optional short code; NULL when created inline, since a quick add should not ask the user to invent one',
  requires_campus_room BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'FALSE = Off-campus: occupy student time but no campus room',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     INT NULL COMMENT 'Who introduced this type, for cleaning up near-duplicates later',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_room_types_name (room_type_name),
  UNIQUE KEY uq_room_types_code (room_type_code),
  KEY idx_room_types_active (is_active, room_type_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE rooms (
  room_id          INT PRIMARY KEY AUTO_INCREMENT,
  floor_id         INT NOT NULL,
  room_type_id     INT NOT NULL,
  room_code        VARCHAR(30)  NOT NULL,
  room_name        VARCHAR(255) NULL,
  capacity         SMALLINT     NOT NULL,
  status           ENUM('active','vacant','under_maintenance') NOT NULL DEFAULT 'active',
  owner_college_id INT NULL COMMENT 'Priority holder; NULL = general-use room',
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rooms_floor   FOREIGN KEY (floor_id)         REFERENCES floors(floor_id) ON DELETE CASCADE,
  CONSTRAINT fk_rooms_type    FOREIGN KEY (room_type_id)     REFERENCES room_types(room_type_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rooms_college FOREIGN KEY (owner_college_id) REFERENCES colleges(college_id) ON DELETE SET NULL,
  CONSTRAINT chk_rooms_capacity CHECK (capacity > 0),
  UNIQUE KEY uq_rooms_floor_code (floor_id, room_code),
  KEY idx_rooms_type (room_type_id),
  KEY idx_rooms_floor (floor_id),
  KEY idx_rooms_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Optional per-floor college whitelist, matching the Facilities page. A floor
-- with no rows here is open to every college.
CREATE TABLE floor_college_access (
  floor_id   INT NOT NULL,
  college_id INT NOT NULL,
  PRIMARY KEY (floor_id, college_id),
  CONSTRAINT fk_fca_floor   FOREIGN KEY (floor_id)   REFERENCES floors(floor_id) ON DELETE CASCADE,
  CONSTRAINT fk_fca_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- UI-only campus extras that have no table of their own: room timetables
-- (until class_meetings is the live source), multi-college room sharing, and
-- the Facilities page's building-card order. One row, always id 1.
CREATE TABLE facilities_ui_state (
  state_id   TINYINT PRIMARY KEY,
  extras     JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- A subject with both lecture and lab units stays as one curriculum_courses
-- row. The two halves of the timetable are derived from the units, not from
-- splitting the subject. Room types are named on the sheet, never inferred:
--
--   lecture hours     Use lecture_room_type. "Lecture" is a valid choice, not
--                     the automatic default. lecture_units > 0 without a type
--                     is unresolved.
--
--   laboratory hours  Use lab_room_type. One type per subject; a second
--                     acceptable lab is a later change, not a list in the cell.
--
-- Rows here are optional, so "we do not know yet which room this subject uses"
-- is a legal state. A component with units but no row is unresolved, and the
-- scheduler must refuse to guess: putting a chemistry class in a computer lab
-- is worse than leaving it unscheduled. The second-to-last query in Section 10
-- lists exactly these.
--
-- This is also why there is no category column on room_types. The curriculum
-- names the type it needs; "any laboratory" would wrongly include the computer
-- lab.
CREATE TABLE course_room_requirements (
  requirement_id       INT PRIMARY KEY AUTO_INCREMENT,
  curriculum_course_id INT NOT NULL,
  component            ENUM('lecture','laboratory') NOT NULL,
  room_type_id         INT NOT NULL,
  priority             TINYINT NOT NULL DEFAULT 1 COMMENT '1 = preferred, higher = fallback',
  CONSTRAINT fk_crr_course FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(curriculum_course_id) ON DELETE CASCADE,
  CONSTRAINT fk_crr_type   FOREIGN KEY (room_type_id)         REFERENCES room_types(room_type_id) ON DELETE RESTRICT,
  UNIQUE KEY uq_crr (curriculum_course_id, component, room_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- SECTION 6 - SECTIONS
-- =====================================================================

-- The Sections page writes one row here per calculation: the head count the user
-- typed and the section count that was derived from it. Keeping the inputs makes
-- the number auditable and re-runnable instead of a figure nobody can explain
-- six months later.
CREATE TABLE section_plans (
  section_plan_id    INT PRIMARY KEY AUTO_INCREMENT,
  term_id            INT NOT NULL,
  program_id         INT NOT NULL,
  year_level         TINYINT NOT NULL,
  student_count      SMALLINT NOT NULL,
  students_per_section SMALLINT NOT NULL DEFAULT 40,
  meetings_per_week  TINYINT NOT NULL DEFAULT 3,
  computed_sections  SMALLINT NOT NULL,
  override_sections  SMALLINT NULL COMMENT 'Manual override from the UI',
  effective_sections SMALLINT GENERATED ALWAYS AS (COALESCE(override_sections, computed_sections)) STORED,
  created_by         INT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_plans_term    FOREIGN KEY (term_id)    REFERENCES terms(term_id) ON DELETE CASCADE,
  CONSTRAINT fk_plans_program FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE,
  CONSTRAINT chk_plans_counts CHECK (student_count >= 0 AND students_per_section > 0 AND computed_sections >= 0),
  UNIQUE KEY uq_plans (term_id, program_id, year_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- One row per real section, e.g. BSOT 1-A for 1st sem 2025-2026.
-- The extra unique key on (section_id, term_id) exists so class_offerings can
-- carry a composite foreign key and never drift to a different term.
CREATE TABLE sections (
  section_id      INT PRIMARY KEY AUTO_INCREMENT,
  term_id         INT NOT NULL,
  program_id      INT NOT NULL,
  curriculum_id   INT NOT NULL COMMENT 'Which curriculum version this section follows',
  year_level      TINYINT NOT NULL,
  section_code    VARCHAR(10) NOT NULL COMMENT '1, 2, 3… or R1, R2… for a dedicated retake section',
  student_count   SMALLINT NOT NULL DEFAULT 0,
  is_retake       BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'TRUE = dedicated off-semester / retake section with its own headcount',
  section_plan_id INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sections_term       FOREIGN KEY (term_id)         REFERENCES terms(term_id) ON DELETE CASCADE,
  CONSTRAINT fk_sections_program    FOREIGN KEY (program_id)      REFERENCES programs(program_id) ON DELETE CASCADE,
  CONSTRAINT fk_sections_curriculum FOREIGN KEY (curriculum_id)   REFERENCES curricula(curriculum_id) ON DELETE RESTRICT,
  CONSTRAINT fk_sections_plan       FOREIGN KEY (section_plan_id) REFERENCES section_plans(section_plan_id) ON DELETE SET NULL,
  UNIQUE KEY uq_sections (term_id, program_id, year_level, section_code),
  UNIQUE KEY uq_sections_term (section_id, term_id),
  KEY idx_sections_lookup (term_id, program_id, year_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Extra subjects a retake section offers this term. The curriculum row stays
-- on its original semester (e.g. MATH 101 remains 1st semester). This table is
-- the exception: this section, this term, also runs that subject. Courses may
-- come from an older curriculum of the same program.
CREATE TABLE section_subject_overrides (
  override_id            INT PRIMARY KEY AUTO_INCREMENT,
  section_id             INT NOT NULL,
  curriculum_course_id   INT NOT NULL,
  reason                 VARCHAR(255) NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sso_section FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
  CONSTRAINT fk_sso_course  FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(curriculum_course_id) ON DELETE RESTRICT,
  UNIQUE KEY uq_sso (section_id, curriculum_course_id),
  KEY idx_sso_course (curriculum_course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- SECTION 7 - SCHEDULING
-- =====================================================================

-- The 24 half-hour slots between 07:00 and 19:00. This table is what makes the
-- timetable grid trivial to render and, more importantly, what lets the database
-- itself reject double-bookings (see meeting_slots).
CREATE TABLE time_slots (
  slot_index TINYINT PRIMARY KEY COMMENT '0 = 07:00-07:30 ... 23 = 18:30-19:00',
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  UNIQUE KEY uq_time_slots_start (start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO time_slots (slot_index, start_time, end_time) VALUES
  ( 0, '07:00', '07:30'), ( 1, '07:30', '08:00'), ( 2, '08:00', '08:30'), ( 3, '08:30', '09:00'),
  ( 4, '09:00', '09:30'), ( 5, '09:30', '10:00'), ( 6, '10:00', '10:30'), ( 7, '10:30', '11:00'),
  ( 8, '11:00', '11:30'), ( 9, '11:30', '12:00'), (10, '12:00', '12:30'), (11, '12:30', '13:00'),
  (12, '13:00', '13:30'), (13, '13:30', '14:00'), (14, '14:00', '14:30'), (15, '14:30', '15:00'),
  (16, '15:00', '15:30'), (17, '15:30', '16:00'), (18, '16:00', '16:30'), (19, '16:30', '17:00'),
  (20, '17:00', '17:30'), (21, '17:30', '18:00'), (22, '18:00', '18:30'), (23, '18:30', '19:00');


-- One offering per (section, subject, component). A subject with 3 lecture units
-- and 1 lab unit produces two offerings for the same section: a 3 hr/week
-- lecture that needs a lecture room and a 3 hr/week lab that needs a specific
-- laboratory. Treating them as one schedulable unit is the single most common
-- modelling mistake here, because the two halves need different room types and
-- usually meet on different days.
CREATE TABLE class_offerings (
  offering_id          INT PRIMARY KEY AUTO_INCREMENT,
  term_id              INT NOT NULL,
  section_id           INT NOT NULL,
  curriculum_course_id INT NOT NULL,
  component            ENUM('lecture','laboratory') NOT NULL,
  partition_index      TINYINT NOT NULL DEFAULT 1 COMMENT '1 for a whole section; 1..n when the section is partitioned for this subject',
  partition_count      TINYINT NOT NULL DEFAULT 1 COMMENT '1 = not partitioned',
  partition_students   SMALLINT NULL COMMENT 'Headcount for this partition; NULL = the whole section count',
  hours_per_week       DECIMAL(5,2) NOT NULL,
  status               ENUM('unscheduled','partial','scheduled') NOT NULL DEFAULT 'unscheduled',
  notes                VARCHAR(255) NULL COMMENT 'Why a class could not be placed, if unscheduled',
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_off_section FOREIGN KEY (section_id, term_id) REFERENCES sections(section_id, term_id) ON DELETE CASCADE,
  CONSTRAINT fk_off_course  FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(curriculum_course_id) ON DELETE CASCADE,
  UNIQUE KEY uq_offerings (section_id, curriculum_course_id, component, partition_index),
  UNIQUE KEY uq_offerings_term (offering_id, term_id),
  KEY idx_offerings_term (term_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- One row per day the class meets, so an MWF class is three rows sharing an
-- offering. The CHECK constraints are what actually enforce your rule that a
-- class runs between 07:00 and 19:00 and starts and ends on the hour or the
-- half hour: 07:00-08:15 is rejected by the database, not just by the form.
CREATE TABLE class_meetings (
  meeting_id  INT PRIMARY KEY AUTO_INCREMENT,
  offering_id INT NOT NULL,
  term_id     INT NOT NULL,
  day_of_week ENUM('Mon','Tue','Wed','Thu','Fri','Sat') NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  room_id     INT NULL COMMENT 'NULL while the class is awaiting room allocation',
  start_slot  TINYINT GENERATED ALWAYS AS ((TIME_TO_SEC(start_time) - 25200) DIV 1800) STORED,
  end_slot    TINYINT GENERATED ALWAYS AS ((TIME_TO_SEC(end_time)   - 25200) DIV 1800) STORED,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_meet_offering FOREIGN KEY (offering_id, term_id) REFERENCES class_offerings(offering_id, term_id) ON DELETE CASCADE,
  CONSTRAINT fk_meet_room     FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE SET NULL,
  CONSTRAINT chk_meet_grid  CHECK (MINUTE(start_time) IN (0, 30) AND MINUTE(end_time) IN (0, 30)
                                   AND SECOND(start_time) = 0 AND SECOND(end_time) = 0),
  CONSTRAINT chk_meet_hours CHECK (start_time >= '07:00:00' AND end_time <= '19:00:00' AND end_time > start_time),
  UNIQUE KEY uq_meetings_term (meeting_id, term_id),
  KEY idx_meet_room_day (room_id, day_of_week, start_time),
  KEY idx_meet_offering (offering_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- The half-hour cells each meeting occupies, maintained automatically by the
-- triggers below. The unique keys are the point of this table: MySQL has no
-- exclusion constraints, so this is the only way to make the engine guarantee
-- that a room is never booked twice and a section is never in two places at
-- once. Rows with room_id NULL are ignored by uq_room_busy, so unassigned
-- classes do not block a room.
CREATE TABLE meeting_slots (
  meeting_id  INT NOT NULL,
  term_id     INT NOT NULL,
  slot_index  TINYINT NOT NULL,
  day_of_week ENUM('Mon','Tue','Wed','Thu','Fri','Sat') NOT NULL,
  room_id     INT NULL,
  section_id  INT NOT NULL,
  PRIMARY KEY (meeting_id, slot_index),
  CONSTRAINT fk_ms_meeting FOREIGN KEY (meeting_id, term_id) REFERENCES class_meetings(meeting_id, term_id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_slot    FOREIGN KEY (slot_index) REFERENCES time_slots(slot_index),
  -- SET NULL here mirrors class_meetings.room_id, so deleting a room leaves the
  -- class scheduled but unassigned. It must match, because MySQL does not fire
  -- triggers for foreign key cascade actions and the two tables would otherwise
  -- fall out of sync.
  CONSTRAINT fk_ms_room    FOREIGN KEY (room_id)    REFERENCES rooms(room_id) ON DELETE SET NULL,
  CONSTRAINT fk_ms_section FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
  UNIQUE KEY uq_room_busy    (term_id, room_id, day_of_week, slot_index),
  UNIQUE KEY uq_section_busy (term_id, section_id, day_of_week, slot_index),
  KEY idx_ms_room_grid (room_id, term_id, day_of_week, slot_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Named Save As copies, private My-schedule workspaces, Admin submissions,
-- and VPAA pending/final snapshots. Shared schedule stays in class_meetings.
-- Archives of named versions use kind=archived_save; past academic terms stay
-- on the offering archive (terms.is_active = 0, terms.archived_label).
CREATE TABLE schedule_copies (
  copy_id INT PRIMARY KEY AUTO_INCREMENT,
  term_id INT NOT NULL,
  slot VARCHAR(40) NOT NULL,
  kind ENUM('workspace','save','archived_save') NOT NULL DEFAULT 'workspace',
  owner_role ENUM('admin','super_admin') NULL,
  is_shared TINYINT(1) NOT NULL DEFAULT 0,
  title VARCHAR(120) NULL,
  payload LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sc_term_slot (term_id, slot, kind),
  KEY idx_sc_owner (owner_role, kind),
  CONSTRAINT fk_sc_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generate-schedule options. slot=admin_private / sa_private apply only to that
-- actor's My schedule; slot=shared is read as a fallback for older terms.
CREATE TABLE schedule_generator_settings (
  setting_id INT PRIMARY KEY AUTO_INCREMENT,
  term_id INT NOT NULL,
  slot VARCHAR(40) NOT NULL,
  merge_mode ENUM('auto','manual','off') NOT NULL DEFAULT 'auto',
  split_hours DECIMAL(3,1) NOT NULL DEFAULT 3.0,
  keep_lunch TINYINT(1) NOT NULL DEFAULT 1,
  partition_scope ENUM('off','small','medium','any') NOT NULL DEFAULT 'small'
    COMMENT 'How large a section may be and still be split across other classes of the same subject',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sgs_term_slot (term_id, slot),
  CONSTRAINT fk_sgs_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE schedule_open_requests (
  request_id INT PRIMARY KEY AUTO_INCREMENT,
  copy_id INT NOT NULL,
  term_id INT NOT NULL,
  status ENUM('pending','granted','denied') NOT NULL DEFAULT 'pending',
  shared_fingerprint VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  KEY idx_sor_status (status),
  CONSTRAINT fk_sor_copy FOREIGN KEY (copy_id) REFERENCES schedule_copies(copy_id) ON DELETE CASCADE,
  CONSTRAINT fk_sor_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- One campus-term package. Create schedule always writes the live working copy.
-- Admin marks that copy ready; Super Admin then VPAA freeze snapshots. Deans and
-- program chairs only see published_json after VPAA approval. Sending a package
-- back does not unpublish an earlier VPAA-approved copy.
CREATE TABLE term_schedule_approvals (
  term_id INT PRIMARY KEY,
  status ENUM('draft','pending_super_admin','pending_vpaa','published') NOT NULL DEFAULT 'draft',
  pending_sa_json LONGTEXT NULL,
  pending_sa_at DATETIME NULL,
  pending_vpaa_json LONGTEXT NULL,
  pending_vpaa_at DATETIME NULL,
  published_json LONGTEXT NULL,
  published_at DATETIME NULL,
  last_reject_from ENUM('super_admin','vpaa') NULL,
  last_reject_note TEXT NULL,
  last_reject_at DATETIME NULL,
  CONSTRAINT fk_tsa_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- One row each time a campus timetable is sent or sent back among Admin,
-- Super Admin, and VPAA. Requests pages list these as a simple record.
CREATE TABLE schedule_request_records (
  record_id INT PRIMARY KEY AUTO_INCREMENT,
  term_id INT NOT NULL,
  kind ENUM('send','send_back') NOT NULL,
  from_role ENUM('admin','super_admin','vpaa') NOT NULL,
  to_role ENUM('admin','super_admin','vpaa') NOT NULL,
  copy_label VARCHAR(32) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_srr_term (term_id),
  KEY idx_srr_created (created_at),
  CONSTRAINT fk_srr_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Dean and program chair text notes about schedule changes. A program chair
-- sends to the Dean; the Dean may forward that note to Admin, or send their
-- own note to Admin directly.
CREATE TABLE text_schedule_requests (
  request_id INT PRIMARY KEY AUTO_INCREMENT,
  from_role ENUM('dean','program_chair') NOT NULL,
  from_user_id INT NULL,
  from_name VARCHAR(255) NOT NULL,
  college_id INT NULL,
  college_name VARCHAR(255) NULL,
  body TEXT NOT NULL,
  class_ref VARCHAR(40) NULL,
  class_label VARCHAR(255) NULL,
  meeting_label VARCHAR(255) NULL,
  change_kind VARCHAR(32) NULL,
  requested_label VARCHAR(255) NULL,
  topics TEXT NULL,
  classes_json TEXT NULL,
  status ENUM('pending_dean','pending_admin','held','done','sent_back') NOT NULL,
  forwarded_by_name VARCHAR(255) NULL,
  forwarded_at DATETIME NULL,
  hold_note TEXT NULL,
  forward_note TEXT NULL,
  admin_reply TEXT NULL,
  replied_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tsr_status (status),
  KEY idx_tsr_college (college_id),
  KEY idx_tsr_from_user (from_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- SECTION - ACCOUNTS
-- Super Admin creates Admin, VPAA, Dean, and Program Chair (never another
-- Super Admin). A Dean is assigned one college. A Program Chair covers one or
-- more programs in a college that uses departments. Colleges without
-- departments have a Dean only.
-- =====================================================================

CREATE TABLE users (
  user_id        INT PRIMARY KEY AUTO_INCREMENT,
  full_name      VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('super_admin','admin','vpaa','dean','program_chair') NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  college_id     INT NULL COMMENT 'Required for dean and program_chair',
  department_id  INT NULL COMMENT 'The one department a Program Chair leads',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_college (college_id),
  CONSTRAINT fk_users_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE RESTRICT,
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE user_programs (
  user_id    INT NOT NULL,
  program_id INT NOT NULL,
  PRIMARY KEY (user_id, program_id),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_up_program FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Faculty loading is its own record. It does not write sections or schedules.
-- One row is one department for one term, or the whole college when that
-- college has no departments. department_id NULL is the college-level row.
-- Status moves Created → Dean → Registrar → VPAA.
CREATE TABLE faculty_loadings (
  loading_id     INT PRIMARY KEY AUTO_INCREMENT,
  college_id     INT NOT NULL,
  department_id  INT NULL,
  school_year    VARCHAR(9) NOT NULL,
  term_code      ENUM('1','2','summer') NOT NULL,
  status         ENUM('draft','pending_dean','pending_registrar','pending_vpaa','accepted') NOT NULL DEFAULT 'draft',
  faculty_json   LONGTEXT NOT NULL,
  rows_json      LONGTEXT NOT NULL,
  history_json   LONGTEXT NOT NULL,
  dept_key       INT GENERATED ALWAYS AS (IFNULL(department_id, 0)) STORED,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fl_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE CASCADE,
  CONSTRAINT fk_fl_department FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE,
  UNIQUE KEY uq_faculty_loading (college_id, dept_key, school_year, term_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- One row per recipient. Only the users in that send, approval, or send-back
-- receive a copy. Opening the bell marks items read for that signed-in user.
CREATE TABLE user_notifications (
  notification_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  kind VARCHAR(40) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  page VARCHAR(40) NOT NULL DEFAULT 'requests',
  badge VARCHAR(40) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_un_user_read (user_id, is_read, created_at),
  CONSTRAINT fk_un_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


DELIMITER $$

CREATE TRIGGER trg_meeting_slots_ins AFTER INSERT ON class_meetings
FOR EACH ROW
BEGIN
  DECLARE v_section_id INT;
  SELECT section_id INTO v_section_id FROM class_offerings WHERE offering_id = NEW.offering_id;
  INSERT INTO meeting_slots (meeting_id, term_id, slot_index, day_of_week, room_id, section_id)
  SELECT NEW.meeting_id, NEW.term_id, t.slot_index, NEW.day_of_week, NEW.room_id, v_section_id
  FROM time_slots t
  WHERE t.start_time >= NEW.start_time AND t.end_time <= NEW.end_time;
END$$

CREATE TRIGGER trg_meeting_slots_upd AFTER UPDATE ON class_meetings
FOR EACH ROW
BEGIN
  DECLARE v_section_id INT;
  SELECT section_id INTO v_section_id FROM class_offerings WHERE offering_id = NEW.offering_id;
  DELETE FROM meeting_slots WHERE meeting_id = NEW.meeting_id;
  INSERT INTO meeting_slots (meeting_id, term_id, slot_index, day_of_week, room_id, section_id)
  SELECT NEW.meeting_id, NEW.term_id, t.slot_index, NEW.day_of_week, NEW.room_id, v_section_id
  FROM time_slots t
  WHERE t.start_time >= NEW.start_time AND t.end_time <= NEW.end_time;
END$$

DELIMITER ;


-- =====================================================================
-- SECTION 8 - VIEWS
-- =====================================================================

-- Program list with the label the UI should show: the college name for a
-- single-program college, the department name otherwise.
CREATE OR REPLACE VIEW v_programs AS
SELECT p.program_id,
       p.program_code,
       c.college_id,
       c.college_code,
       c.college_name,
       p.program_name,
       p.represents_college,
       IF(p.represents_college, c.college_name, p.program_name) AS display_name,
       p.is_active
FROM programs p
JOIN colleges c ON c.college_id = p.college_id;


-- Everything needed to draw one room's weekly timetable.
CREATE OR REPLACE VIEW v_room_timetable AS
SELECT m.term_id,
       r.room_id,
       r.room_code,
       b.building_code,
       f.floor_number,
       rt.room_type_name,
       m.day_of_week,
       m.start_time,
       m.end_time,
       m.start_slot,
       m.end_slot,
       cc.course_id,
       cc.course_title,
       o.component,
       CONCAT(pr.program_code, ' ', s.year_level, '-', s.section_code) AS section_label,
       s.student_count,
       o.status
FROM class_meetings m
JOIN class_offerings o     ON o.offering_id = m.offering_id
JOIN sections s            ON s.section_id = o.section_id
JOIN programs pr           ON pr.program_id = s.program_id
JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
JOIN rooms r               ON r.room_id = m.room_id
JOIN floors f              ON f.floor_id = r.floor_id
JOIN buildings b           ON b.building_id = f.building_id
JOIN room_types rt         ON rt.room_type_id = r.room_type_id;


-- Curriculum sheet in printable order, including summer terms where they exist.
CREATE OR REPLACE VIEW v_curriculum_sheet AS
SELECT cu.curriculum_id,
       cu.curriculum_name,
       vp.display_name AS program_display_name,
       vp.college_name,
       cc.year_level,
       cc.term_code,
       cc.course_id,
       cc.course_title,
       cc.lecture_units,
       cc.lab_units,
       cc.total_units,
       cc.total_hours_week,
       cc.total_hours_sem,
       cc.lecture_room_type,
       cc.lab_room_type,
       cc.prerequisite_1,
       cc.prerequisite_2,
       cc.prerequisite_3
FROM curriculum_courses cc
JOIN curricula cu ON cu.curriculum_id = cc.curriculum_id
JOIN v_programs vp ON vp.program_id = cu.program_id
ORDER BY cu.curriculum_id, cc.year_level, cc.term_order, cc.display_order;


-- =====================================================================
-- SECTION 9 - FIRST-RUN SETUP
-- =====================================================================
--
-- This file inserts no institutional data. Running it produces an empty
-- database: no colleges, programs, curricula, buildings, rooms, sections or
-- schedules. Everything is created by the registrar through the UI.
--
-- Two tables are pre-populated, and both are structure rather than example data:
--
--   time_slots  The 24 half-hour cells between 07:00 and 19:00. Fixed by the
--               scheduling rules, referenced by a foreign key, never edited.
--
--   room_types  A single "Lecture" row. rooms.room_type_id is required, so an
--               empty table would make it impossible to create the first room;
--               Lecture is also the default selection in the UI, which is what
--               guarantees a room can never end up with no type. Every other
--               type, and all the laboratory kinds in particular, is added by
--               staff as they encounter them.
--
-- Setup order, because of the foreign keys:
--   1. school_years, then terms for each school year
--   2. colleges, then programs
--   3. buildings, then floors, then rooms
--   4. curricula and curriculum_courses (typed in or uploaded from Excel)
--   5. course_room_requirements for laboratory hours only (lecture hours
--      always use the Lecture type and do not need a row here)
--   6. section_plans and sections, then class_offerings and class_meetings
--
-- Room types must be user-managed, not hardcoded in a form: which laboratories
-- exist is a fact about the campus, and it is why room_types is a table rather
-- than an ENUM.

INSERT INTO room_types (room_type_name, room_type_code, requires_campus_room) VALUES
  ('Lecture', 'LEC', 1),
  ('Off-campus', 'OFF', 0);


-- =====================================================================
-- SECTION 10 - QUERIES YOU WILL NEED
-- =====================================================================

-- Rooms free for a given term, day and time range, of an acceptable type and
-- big enough for the section. Uses the slot table, so no overlap arithmetic.
--
-- SELECT r.room_id, r.room_code, r.capacity
-- FROM rooms r
-- JOIN course_room_requirements req
--   ON req.room_type_id = r.room_type_id
--  AND req.curriculum_course_id = :curriculum_course_id
--  AND req.component = :component
-- WHERE r.status = 'active'
--   AND r.capacity >= :student_count
--   AND NOT EXISTS (
--         SELECT 1 FROM meeting_slots ms
--         JOIN time_slots t ON t.slot_index = ms.slot_index
--         WHERE ms.room_id = r.room_id
--           AND ms.term_id = :term_id
--           AND ms.day_of_week = :day
--           AND t.start_time >= :start_time
--           AND t.end_time   <= :end_time)
-- ORDER BY req.priority, r.capacity;

-- Number of sections still needed vs already created for a term.
--
-- SELECT sp.program_id, sp.year_level, sp.effective_sections,
--        COUNT(s.section_id) AS created
-- FROM section_plans sp
-- LEFT JOIN sections s
--        ON s.term_id = sp.term_id AND s.program_id = sp.program_id
--       AND s.year_level = sp.year_level
-- WHERE sp.term_id = :term_id
-- GROUP BY sp.section_plan_id;

-- Offerings whose scheduled hours do not yet match the curriculum requirement.
--
-- SELECT o.offering_id, cc.course_id, o.component, o.hours_per_week,
--        COALESCE(SUM(TIME_TO_SEC(m.end_time) - TIME_TO_SEC(m.start_time)) / 3600, 0) AS scheduled_hours
-- FROM class_offerings o
-- JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
-- LEFT JOIN class_meetings m ON m.offering_id = o.offering_id
-- WHERE o.term_id = :term_id
-- GROUP BY o.offering_id
-- HAVING scheduled_hours <> o.hours_per_week;

-- Subjects that have hours but nobody has named a room type for that component.
-- Leave them unset, and let this list tell you what is still outstanding.
-- Lecture is not implied: a lecture-unit subject with no lecture_room_type is
-- as unresolved as a lab-unit subject with no lab_room_type.
--
-- SELECT cc.course_id, cc.course_title, cc.year_level, cc.term_code,
--        cc.lecture_units, cc.lab_units, cc.lecture_room_type, cc.lab_room_type
-- FROM curriculum_courses cc
-- WHERE cc.curriculum_id = :curriculum_id
--   AND (
--         (cc.lecture_units > 0 AND (cc.lecture_room_type IS NULL OR cc.lecture_room_type = ''))
--      OR (cc.lab_units > 0 AND (cc.lab_room_type IS NULL OR cc.lab_room_type = ''))
--       )
-- ORDER BY cc.year_level, cc.term_order, cc.course_id;

-- Room types nobody uses. Run this occasionally to catch near-duplicates created
-- by inline adds, e.g. "Computer Lab" alongside "Computer Laboratory". Rename or
-- deactivate the loser; if it has rooms, repoint them first.
--
-- SELECT rt.room_type_id, rt.room_type_name, rt.created_at,
--        COUNT(DISTINCT r.room_id)  AS rooms_using,
--        COUNT(DISTINCT crr.requirement_id) AS subjects_requiring
-- FROM room_types rt
-- LEFT JOIN rooms r                     ON r.room_type_id = rt.room_type_id
-- LEFT JOIN course_room_requirements crr ON crr.room_type_id = rt.room_type_id
-- GROUP BY rt.room_type_id
-- ORDER BY rooms_using, subjects_requiring, rt.room_type_name;
