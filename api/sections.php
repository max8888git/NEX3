<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_retake_schema($pdo);
ensure_term_archive_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok(sections_payload($pdo));
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? 'plan');
  try {
    $pdo->beginTransaction();
    if ($action === 'setTerm') {
      $saved = set_current_offering($pdo, $body);
    } elseif ($action === 'archiveTerm') {
      $saved = archive_offering($pdo, $body);
    } elseif ($action === 'unarchiveTerm') {
      $saved = unarchive_offering($pdo, $body);
    } elseif ($action === 'deleteTerm') {
      $saved = delete_archived_offering($pdo, $body);
    } elseif ($action === 'clearActive') {
      $saved = clear_active_sections($pdo);
    } elseif ($action === 'retake') {
      $saved = save_retake_section($pdo, $body);
    } else {
      $saved = save_section_plan($pdo, $body);
    }
    $pdo->commit();
    json_ok(($saved ?: []) + sections_payload($pdo));
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

if ($method === 'PATCH') {
  $body = json_input();
  $id = parse_id((string) ($body['id'] ?? $_GET['id'] ?? ''), 's');
  if (!$id) {
    json_error('Section id is required');
  }
  $count = isset($body['studentCount']) ? (int) $body['studentCount'] : null;
  if ($count === null || $count < 0) {
    json_error('Student count must be 0 or more.');
  }
  try {
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('UPDATE sections SET student_count = ? WHERE section_id = ?');
    $stmt->execute([$count, $id]);
    if ($stmt->rowCount() === 0) {
      $check = $pdo->prepare('SELECT 1 FROM sections WHERE section_id = ?');
      $check->execute([$id]);
      if (!$check->fetchColumn()) {
        throw new RuntimeException('Section not found.');
      }
    }
    $pdo->commit();
    json_ok(['sections' => list_sections($pdo)] + sections_payload($pdo));
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

if ($method === 'DELETE') {
  $body = json_input();
  $action = (string) ($body['action'] ?? '');
  try {
    $pdo->beginTransaction();
    if ($action === 'yearLevel') {
      $removed = delete_year_level_sections($pdo, $body);
    } else {
      $id = parse_id((string) ($body['id'] ?? $_GET['id'] ?? ''), 's');
      if (!$id) {
        throw new RuntimeException('Section id is required');
      }
      $removed = delete_one_section($pdo, $id);
    }
    $pdo->commit();
    json_ok([
      'removed' => $removed,
    ] + sections_payload($pdo));
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);

function sections_payload(PDO $pdo): array
{
  $sy = ensure_current_school_year($pdo);
  $current = current_offering_term($pdo);
  return [
    'schoolYear' => ['id' => public_id('sy', $sy['id']), 'label' => $sy['label']],
    'schoolYears' => list_school_years($pdo),
    'currentTerm' => $current
      ? ['schoolYear' => $current['schoolYear'], 'termCode' => $current['termCode']]
      : null,
    'archivedTerms' => list_archived_offerings($pdo),
    'sections' => list_sections($pdo),
  ];
}

function set_current_offering(PDO $pdo, array $body): array
{
  $label = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $termCode = normalize_term_code((string) ($body['termCode'] ?? ''));
  if ($label === '') {
    throw new RuntimeException('Academic year must look like 2026-2027.');
  }
  $current = current_offering_term($pdo);
  if (
    $current
    && ($current['schoolYear'] !== $label || $current['termCode'] !== $termCode)
    && term_section_count($pdo, $current['termId']) > 0
  ) {
    throw new RuntimeException(
      'Archive the current offering (' . $current['schoolYear'] . ' ' . $current['termCode'] . ') before starting a new academic year or semester.'
    );
  }
  $id = ensure_school_year($pdo, $label);
  $pdo->prepare(
    'UPDATE school_years SET is_current = CASE WHEN school_year_id = ? THEN 1 ELSE 0 END'
  )->execute([$id]);
  $termId = ensure_term($pdo, $id, $termCode);
  deactivate_all_terms($pdo);
  $pdo->prepare('UPDATE terms SET is_active = 1, archived_label = NULL WHERE term_id = ?')->execute([$termId]);
  return ['setTerm' => true];
}

function archive_offering(PDO $pdo, array $body): array
{
  $current = current_offering_term($pdo);
  $label = trim((string) ($body['schoolYear'] ?? ''));
  $termCode = trim((string) ($body['termCode'] ?? ''));
  if ($label === '' || $termCode === '') {
    if (!$current) {
      throw new RuntimeException('There is no current offering to archive.');
    }
    $label = $current['schoolYear'];
    $termCode = $current['termCode'];
  }
  $syId = ensure_school_year($pdo, parse_school_year_label($label));
  $termId = ensure_term($pdo, $syId, $termCode);
  $pdo->prepare('UPDATE terms SET is_active = 0, archived_label = ? WHERE term_id = ?')
    ->execute([offering_archive_label(), $termId]);
  return ['archived' => true, 'sectionCount' => term_section_count($pdo, $termId)];
}

function unarchive_offering(PDO $pdo, array $body): array
{
  $label = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $termCode = normalize_term_code((string) ($body['termCode'] ?? ''));
  if ($label === '') {
    throw new RuntimeException('Academic year is required to unarchive an offering.');
  }
  $current = current_offering_term($pdo);
  $syId = ensure_school_year($pdo, $label);
  $termId = ensure_term($pdo, $syId, $termCode);
  if (
    $current
    && ($current['termId'] !== $termId)
    && term_section_count($pdo, $current['termId']) > 0
  ) {
    throw new RuntimeException(
      'Archive the current offering (' . $current['schoolYear'] . ') before restoring another academic year or semester.'
    );
  }
  $pdo->prepare(
    'UPDATE school_years SET is_current = CASE WHEN school_year_id = ? THEN 1 ELSE 0 END'
  )->execute([$syId]);
  deactivate_all_terms($pdo);
  $pdo->prepare('UPDATE terms SET is_active = 1, archived_label = NULL WHERE term_id = ?')->execute([$termId]);
  return ['unarchived' => true];
}

function clear_active_sections(PDO $pdo): array
{
  $current = current_offering_term($pdo);
  if (!$current) {
    throw new RuntimeException('There is no current offering to clear.');
  }
  $termId = (int) $current['termId'];
  $count = term_section_count($pdo, $termId);
  if (schema_table_exists($pdo, 'meeting_slots')) {
    $pdo->prepare('DELETE FROM meeting_slots WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'class_meetings')) {
    $pdo->prepare('DELETE FROM class_meetings WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'merged_class_members') && schema_table_exists($pdo, 'class_offerings')) {
    $pdo->prepare(
      'DELETE mem FROM merged_class_members mem
       INNER JOIN class_offerings o ON o.offering_id = mem.offering_id
       WHERE o.term_id = ?'
    )->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'merged_classes')) {
    $pdo->prepare('DELETE FROM merged_classes WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'class_offerings')) {
    $pdo->prepare('DELETE FROM class_offerings WHERE term_id = ?')->execute([$termId]);
  }
  $pdo->prepare('DELETE FROM sections WHERE term_id = ?')->execute([$termId]);
  if (schema_table_exists($pdo, 'section_plans')) {
    $pdo->prepare('DELETE FROM section_plans WHERE term_id = ?')->execute([$termId]);
  }
  return [
    'cleared' => true,
    'removed' => $count,
    'schoolYear' => $current['schoolYear'],
    'termCode' => $current['termCode'],
  ];
}

function delete_archived_offering(PDO $pdo, array $body): array
{
  $label = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $termCode = normalize_term_code((string) ($body['termCode'] ?? ''));
  if ($label === '') {
    throw new RuntimeException('Choose an archived offering to delete.');
  }
  $termId = find_offering_term_id($pdo, ['schoolYear' => $label, 'termCode' => $termCode]);
  $current = current_offering_term($pdo);
  if ($current && (int) $current['termId'] === $termId) {
    throw new RuntimeException('Archive this offering first. The live offering cannot be deleted from Archived.');
  }
  $active = $pdo->prepare('SELECT is_active FROM terms WHERE term_id = ?');
  $active->execute([$termId]);
  if ((int) $active->fetchColumn() === 1) {
    throw new RuntimeException('Only archived offerings can be deleted.');
  }

  $sectionCount = term_section_count($pdo, $termId);
  $classCount = 0;
  if (schema_table_exists($pdo, 'class_offerings')) {
    $cls = $pdo->prepare('SELECT COUNT(*) FROM class_offerings WHERE term_id = ?');
    $cls->execute([$termId]);
    $classCount = (int) $cls->fetchColumn();
  }

  if (schema_table_exists($pdo, 'meeting_slots')) {
    $pdo->prepare('DELETE FROM meeting_slots WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'class_meetings')) {
    $pdo->prepare('DELETE FROM class_meetings WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'merged_class_members') && schema_table_exists($pdo, 'class_offerings')) {
    $pdo->prepare(
      'DELETE mem FROM merged_class_members mem
       INNER JOIN class_offerings o ON o.offering_id = mem.offering_id
       WHERE o.term_id = ?'
    )->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'merged_classes')) {
    $pdo->prepare('DELETE FROM merged_classes WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'class_offerings')) {
    $pdo->prepare('DELETE FROM class_offerings WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'section_subject_overrides') && schema_table_exists($pdo, 'sections')) {
    $pdo->prepare(
      'DELETE ovr FROM section_subject_overrides ovr
       INNER JOIN sections s ON s.section_id = ovr.section_id
       WHERE s.term_id = ?'
    )->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'sections')) {
    $pdo->prepare('DELETE FROM sections WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'section_plans')) {
    $pdo->prepare('DELETE FROM section_plans WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'schedule_runs')) {
    $pdo->prepare('DELETE FROM schedule_runs WHERE term_id = ?')->execute([$termId]);
  }
  if (schema_table_exists($pdo, 'term_schedule_approvals')) {
    $pdo->prepare('DELETE FROM term_schedule_approvals WHERE term_id = ?')->execute([$termId]);
  }

  $del = $pdo->prepare('DELETE FROM terms WHERE term_id = ? AND is_active = 0');
  $del->execute([$termId]);
  if ($del->rowCount() === 0) {
    throw new RuntimeException('Could not delete that offering.');
  }

  return [
    'deleted' => true,
    'sectionCount' => $sectionCount,
    'classCount' => $classCount,
  ];
}

function resolve_locked_offering_term(PDO $pdo, array $body): array
{
  $sy = resolve_offering_school_year($pdo, $body);
  $termCode = (string) ($body['termCode'] ?? '1');
  $termId = ensure_term($pdo, $sy['id'], $termCode);
  $current = current_offering_term($pdo);
  if ($current && (int) $current['termId'] !== $termId) {
    throw new RuntimeException(
      'Sections can only be created in the current offering (' .
      $current['schoolYear'] .
      '). Archive that offering before starting a new academic year or semester.'
    );
  }
  if (!$current) {
    set_current_offering($pdo, [
      'schoolYear' => $sy['label'],
      'termCode' => $termCode,
    ]);
    $termId = ensure_term($pdo, $sy['id'], $termCode);
  }
  return ['sy' => $sy, 'termId' => $termId];
}

function ensure_retake_schema(PDO $pdo): void
{
  $hasCol = $pdo->query(
    "SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sections' AND COLUMN_NAME = 'is_retake'"
  )->fetchColumn();
  if (!(int) $hasCol) {
    $pdo->exec(
      'ALTER TABLE sections
       ADD COLUMN is_retake BOOLEAN NOT NULL DEFAULT FALSE
       COMMENT \'TRUE = dedicated off-semester / retake section\''
    );
  }
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS section_subject_overrides (
      override_id            INT PRIMARY KEY AUTO_INCREMENT,
      section_id             INT NOT NULL,
      curriculum_course_id   INT NOT NULL,
      reason                 VARCHAR(255) NULL,
      created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_sso_section FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
      CONSTRAINT fk_sso_course  FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(curriculum_course_id) ON DELETE RESTRICT,
      UNIQUE KEY uq_sso (section_id, curriculum_course_id),
      KEY idx_sso_course (curriculum_course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
}

function override_subjects_by_section(PDO $pdo): array
{
  $rows = $pdo->query(
    'SELECT o.section_id, o.reason,
            cc.curriculum_course_id, cc.course_id, cc.course_title, cc.year_level, cc.term_code,
            cu.curriculum_id, cu.curriculum_name, cu.academic_year
     FROM section_subject_overrides o
     JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
     JOIN curricula cu ON cu.curriculum_id = cc.curriculum_id'
  )->fetchAll();
  $out = [];
  foreach ($rows as $row) {
    $sid = (int) $row['section_id'];
    if (!isset($out[$sid])) {
      $out[$sid] = [];
    }
    $out[$sid][] = [
      'id' => public_id('cc', (int) $row['curriculum_course_id']),
      'courseId' => $row['course_id'],
      'title' => $row['course_title'],
      'yearLevel' => (int) $row['year_level'],
      'termCode' => $row['term_code'],
      'curriculumId' => public_id('cur', (int) $row['curriculum_id']),
      'curriculumName' => $row['curriculum_name'] ?: $row['academic_year'],
      'reason' => $row['reason'] ?: '',
    ];
  }
  return $out;
}

function list_sections(PDO $pdo): array
{
  $overrides = override_subjects_by_section($pdo);
  $rows = $pdo->query(
    'SELECT s.section_id, s.term_id, s.program_id, s.curriculum_id, s.year_level, s.section_code,
            s.student_count, s.section_plan_id, s.is_retake,
            p.program_name, p.represents_college, p.college_id,
            d.department_name,
            c.college_name, c.college_code,
            cu.curriculum_name, cu.academic_year,
            t.term_code, sy.label AS school_year
     FROM sections s
     JOIN programs p ON p.program_id = s.program_id
     LEFT JOIN departments d ON d.department_id = p.department_id
     JOIN colleges c ON c.college_id = p.college_id
     JOIN curricula cu ON cu.curriculum_id = s.curriculum_id
     JOIN terms t ON t.term_id = s.term_id
     JOIN school_years sy ON sy.school_year_id = t.school_year_id
     ORDER BY c.college_name, p.program_name, t.term_order, s.year_level, s.is_retake,
              CAST(s.section_code AS UNSIGNED), s.section_code'
  )->fetchAll();

  $out = [];
  foreach ($rows as $row) {
    $out[] = section_public($row, $overrides[(int) $row['section_id']] ?? []);
  }
  return $out;
}

function section_public(array $row, array $subjects = []): array
{
  $represents = (int) $row['represents_college'] === 1;
  $programName = $represents ? (string) $row['college_name'] : (string) $row['program_name'];
  $orgDepartment = trim((string) ($row['department_name'] ?? ''));
  if ($orgDepartment === '') {
    $orgDepartment = $programName;
  }
  $year = (int) $row['year_level'];
  $code = (string) $row['section_code'];
  return [
    'id' => public_id('s', (int) $row['section_id']),
    'name' => $programName . ' ' . $year . '-' . $code,
    'sectionCode' => $code,
    'isRetake' => (int) ($row['is_retake'] ?? 0) === 1,
    'collegeId' => public_id('c', (int) $row['college_id']),
    'collegeName' => $row['college_name'],
    'programId' => $represents ? null : public_id('d', (int) $row['program_id']),
    'programName' => $programName,
    'departmentId' => $represents ? null : public_id('d', (int) $row['program_id']),
    'departmentName' => $represents ? '' : $orgDepartment,
    'orgDepartmentName' => $orgDepartment,
    'termCode' => $row['term_code'],
    'yearLevel' => $year,
    'curriculumId' => public_id('cur', (int) $row['curriculum_id']),
    'curriculumName' => $row['curriculum_name'] ?: $row['academic_year'],
    'studentCount' => (int) $row['student_count'],
    'planId' => $row['section_plan_id'] ? public_id('sp', (int) $row['section_plan_id']) : null,
    'schoolYear' => $row['school_year'],
    'subjects' => $subjects,
  ];
}

function resolve_program_id_for_sections(PDO $pdo, array $body): int
{
  $departmentId = parse_id((string) ($body['departmentId'] ?? ''), 'd');
  if ($departmentId) {
    $stmt = $pdo->prepare('SELECT program_id FROM programs WHERE program_id = ? AND is_active = 1');
    $stmt->execute([$departmentId]);
    $id = $stmt->fetchColumn();
    if (!$id) {
      throw new RuntimeException('Program not found.');
    }
    return (int) $id;
  }
  $collegeId = parse_id((string) ($body['collegeId'] ?? ''), 'c');
  if (!$collegeId) {
    throw new RuntimeException('Select a college.');
  }
  $stmt = $pdo->prepare(
    'SELECT program_id FROM programs
     WHERE college_id = ? AND represents_college = 1 AND is_active = 1
     LIMIT 1'
  );
  $stmt->execute([$collegeId]);
  $id = $stmt->fetchColumn();
  if ($id) {
    return (int) $id;
  }
  $fallback = $pdo->prepare(
    'SELECT program_id FROM programs WHERE college_id = ? AND is_active = 1 ORDER BY program_id LIMIT 1'
  );
  $fallback->execute([$collegeId]);
  $id = $fallback->fetchColumn();
  if (!$id) {
    throw new RuntimeException('This college has no program yet.');
  }
  return (int) $id;
}

function even_split_counts(int $students, int $cap = 40): array
{
  if ($students <= 0) {
    return [];
  }
  $sections = (int) ceil($students / $cap);
  $base = intdiv($students, $sections);
  $rem = $students % $sections;
  $out = [];
  for ($i = 0; $i < $sections; $i++) {
    $out[] = $base + ($i < $rem ? 1 : 0);
  }
  return $out;
}

function save_section_plan(PDO $pdo, array $body): array
{
  $yearLevel = (int) ($body['yearLevel'] ?? 0);
  if ($yearLevel < 1 || $yearLevel > 6) {
    throw new RuntimeException('Year level must be between 1 and 6.');
  }
  $curriculumId = parse_id((string) ($body['curriculumId'] ?? ''), 'cur');
  if (!$curriculumId) {
    throw new RuntimeException('Select a curriculum.');
  }
  $programId = resolve_program_id_for_sections($pdo, $body);

  $cur = $pdo->prepare(
    'SELECT curriculum_id, program_id, curriculum_name FROM curricula WHERE curriculum_id = ?'
  );
  $cur->execute([$curriculumId]);
  $curriculum = $cur->fetch();
  if (!$curriculum) {
    throw new RuntimeException('Curriculum not found.');
  }
  if ((int) $curriculum['program_id'] !== $programId) {
    throw new RuntimeException('That curriculum does not belong to this program.');
  }

  $studentCount = (int) ($body['studentCount'] ?? 0);
  if ($studentCount < 1) {
    throw new RuntimeException('Enter a positive number of students.');
  }

  $rows = [];
  if (isset($body['sections']) && is_array($body['sections']) && $body['sections']) {
    $seen = [];
    foreach ($body['sections'] as $i => $sec) {
      $code = trim((string) ($sec['code'] ?? ($i + 1)));
      if ($code === '') {
        $code = (string) ($i + 1);
      }
      if (isset($seen[$code])) {
        throw new RuntimeException('Section numbers must be unique.');
      }
      $seen[$code] = true;
      $count = (int) ($sec['studentCount'] ?? 0);
      if ($count < 0) {
        $count = 0;
      }
      $rows[] = ['code' => $code, 'studentCount' => $count];
    }
  } else {
    foreach (even_split_counts($studentCount) as $i => $count) {
      $rows[] = ['code' => (string) ($i + 1), 'studentCount' => $count];
    }
  }
  if (!$rows) {
    throw new RuntimeException('No sections to save.');
  }

  $locked = resolve_locked_offering_term($pdo, $body);
  $sy = $locked['sy'];
  $termId = $locked['termId'];

  $existing = $pdo->prepare(
    'SELECT COUNT(*) FROM sections
     WHERE term_id = ? AND program_id = ? AND year_level = ? AND is_retake = 0'
  );
  $existing->execute([$termId, $programId, $yearLevel]);
  $replaced = (int) $existing->fetchColumn() > 0;
  if ($replaced) {
    $pdo->prepare(
      'DELETE FROM sections
       WHERE term_id = ? AND program_id = ? AND year_level = ? AND is_retake = 0'
    )->execute([$termId, $programId, $yearLevel]);
  }

  $computed = count(even_split_counts($studentCount));
  $effective = count($rows);
  $planStmt = $pdo->prepare(
    'SELECT section_plan_id FROM section_plans WHERE term_id = ? AND program_id = ? AND year_level = ?'
  );
  $planStmt->execute([$termId, $programId, $yearLevel]);
  $planId = $planStmt->fetchColumn();
  $override = $effective !== $computed ? $effective : null;
  if ($planId) {
    $pdo->prepare(
      'UPDATE section_plans
       SET student_count = ?, computed_sections = ?, override_sections = ?, updated_at = CURRENT_TIMESTAMP
       WHERE section_plan_id = ?'
    )->execute([$studentCount, $computed, $override, (int) $planId]);
    $planId = (int) $planId;
  } else {
    $insPlan = $pdo->prepare(
      'INSERT INTO section_plans
        (term_id, program_id, year_level, student_count, students_per_section, meetings_per_week,
         computed_sections, override_sections)
       VALUES (?, ?, ?, ?, 40, 3, ?, ?)'
    );
    $insPlan->execute([$termId, $programId, $yearLevel, $studentCount, $computed, $override]);
    $planId = (int) $pdo->lastInsertId();
  }

  $ins = $pdo->prepare(
    'INSERT INTO sections
      (term_id, program_id, curriculum_id, year_level, section_code, student_count, is_retake, section_plan_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  );
  foreach ($rows as $row) {
    $ins->execute([
      $termId,
      $programId,
      $curriculumId,
      $yearLevel,
      $row['code'],
      $row['studentCount'],
      $planId,
    ]);
  }

  return ['replaced' => $replaced, 'savedCount' => count($rows)];
}

function resolve_curriculum_course(PDO $pdo, int $programId, array $subject): int
{
  $ccId = parse_id((string) ($subject['id'] ?? $subject['curriculumCourseId'] ?? ''), 'cc');
  if ($ccId) {
    $stmt = $pdo->prepare(
      'SELECT cc.curriculum_course_id
       FROM curriculum_courses cc
       JOIN curricula cu ON cu.curriculum_id = cc.curriculum_id
       WHERE cc.curriculum_course_id = ? AND cu.program_id = ?'
    );
    $stmt->execute([$ccId, $programId]);
    $found = $stmt->fetchColumn();
    if ($found) {
      return (int) $found;
    }
  }

  $curriculumId = parse_id((string) ($subject['curriculumId'] ?? ''), 'cur');
  $courseId = trim((string) ($subject['courseId'] ?? ''));
  if (!$curriculumId || $courseId === '') {
    throw new RuntimeException('Each retake subject needs a curriculum and course.');
  }
  $stmt = $pdo->prepare(
    'SELECT cc.curriculum_course_id
     FROM curriculum_courses cc
     JOIN curricula cu ON cu.curriculum_id = cc.curriculum_id
     WHERE cc.curriculum_id = ? AND cc.course_id = ? AND cu.program_id = ?'
  );
  $stmt->execute([$curriculumId, $courseId, $programId]);
  $found = $stmt->fetchColumn();
  if (!$found) {
    throw new RuntimeException('Subject ' . $courseId . ' is not on that curriculum for this program.');
  }
  return (int) $found;
}

function next_retake_code(PDO $pdo, int $termId, int $programId, int $yearLevel): string
{
  $stmt = $pdo->prepare(
    'SELECT section_code FROM sections
     WHERE term_id = ? AND program_id = ? AND year_level = ? AND is_retake = 1'
  );
  $stmt->execute([$termId, $programId, $yearLevel]);
  $max = 0;
  foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $code) {
    if (preg_match('/^R(\d+)$/i', (string) $code, $m)) {
      $max = max($max, (int) $m[1]);
    }
  }
  return 'R' . ($max + 1);
}

function save_retake_section(PDO $pdo, array $body): array
{
  $yearLevel = (int) ($body['yearLevel'] ?? 0);
  if ($yearLevel < 1 || $yearLevel > 6) {
    throw new RuntimeException('Year level must be between 1 and 6.');
  }
  $studentCount = (int) ($body['studentCount'] ?? 0);
  if ($studentCount < 1) {
    throw new RuntimeException('Enter a positive number of students for the retake section.');
  }
  $subjects = is_array($body['subjects'] ?? null) ? $body['subjects'] : [];
  if (!$subjects) {
    throw new RuntimeException('Add at least one subject that is not in this semester.');
  }

  $programId = resolve_program_id_for_sections($pdo, $body);
  $courseIds = [];
  $homeCurriculumId = null;
  foreach ($subjects as $subject) {
    $ccId = resolve_curriculum_course($pdo, $programId, is_array($subject) ? $subject : []);
    if (isset($courseIds[$ccId])) {
      continue;
    }
    $courseIds[$ccId] = true;
    if ($homeCurriculumId === null) {
      $home = $pdo->prepare('SELECT curriculum_id FROM curriculum_courses WHERE curriculum_course_id = ?');
      $home->execute([$ccId]);
      $homeCurriculumId = (int) $home->fetchColumn();
    }
  }
  if (!$courseIds || !$homeCurriculumId) {
    throw new RuntimeException('Add at least one valid subject.');
  }

  $locked = resolve_locked_offering_term($pdo, $body);
  $sy = $locked['sy'];
  $termId = $locked['termId'];
  $code = next_retake_code($pdo, $termId, $programId, $yearLevel);
  $reason = trim((string) ($body['reason'] ?? 'Retake'));
  if ($reason === '') {
    $reason = 'Retake';
  }

  $ins = $pdo->prepare(
    'INSERT INTO sections
      (term_id, program_id, curriculum_id, year_level, section_code, student_count, is_retake, section_plan_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL)'
  );
  $ins->execute([$termId, $programId, $homeCurriculumId, $yearLevel, $code, $studentCount]);
  $sectionId = (int) $pdo->lastInsertId();

  $insOvr = $pdo->prepare(
    'INSERT INTO section_subject_overrides (section_id, curriculum_course_id, reason) VALUES (?, ?, ?)'
  );
  foreach (array_keys($courseIds) as $ccId) {
    $insOvr->execute([$sectionId, $ccId, $reason]);
  }

  return ['savedCount' => 1, 'sectionCode' => $code];
}

function find_offering_term_id(PDO $pdo, array $body): int
{
  $label = trim((string) ($body['schoolYear'] ?? ''));
  if ($label === '') {
    throw new RuntimeException('Academic year is required.');
  }
  $label = parse_school_year_label($label);
  $stmt = $pdo->prepare('SELECT school_year_id FROM school_years WHERE label = ?');
  $stmt->execute([$label]);
  $syId = $stmt->fetchColumn();
  if (!$syId) {
    throw new RuntimeException('Academic year not found.');
  }
  $termCode = normalize_term_code((string) ($body['termCode'] ?? '1'));
  $term = $pdo->prepare('SELECT term_id FROM terms WHERE school_year_id = ? AND term_code = ?');
  $term->execute([(int) $syId, $termCode]);
  $termId = $term->fetchColumn();
  if (!$termId) {
    throw new RuntimeException('No sections for that semester.');
  }
  return (int) $termId;
}

function delete_one_section(PDO $pdo, int $id): int
{
  $plan = $pdo->prepare('SELECT section_plan_id FROM sections WHERE section_id = ?');
  $plan->execute([$id]);
  $planId = $plan->fetchColumn();
  if ($planId === false) {
    throw new RuntimeException('Section not found.');
  }
  $pdo->prepare('DELETE FROM sections WHERE section_id = ?')->execute([$id]);
  if ($planId) {
    $left = $pdo->prepare('SELECT COUNT(*) FROM sections WHERE section_plan_id = ?');
    $left->execute([(int) $planId]);
    if ((int) $left->fetchColumn() === 0) {
      $pdo->prepare('DELETE FROM section_plans WHERE section_plan_id = ?')->execute([(int) $planId]);
    }
  }
  return 1;
}

function delete_year_level_sections(PDO $pdo, array $body): int
{
  $yearLevel = (int) ($body['yearLevel'] ?? 0);
  if ($yearLevel < 1 || $yearLevel > 6) {
    throw new RuntimeException('Year level must be between 1 and 6.');
  }
  $programId = resolve_program_id_for_sections($pdo, $body);
  $termId = find_offering_term_id($pdo, $body);
  $countStmt = $pdo->prepare(
    'SELECT COUNT(*) FROM sections WHERE term_id = ? AND program_id = ? AND year_level = ?'
  );
  $countStmt->execute([$termId, $programId, $yearLevel]);
  $count = (int) $countStmt->fetchColumn();
  if ($count === 0) {
    throw new RuntimeException('No sections found for that year level.');
  }
  $pdo->prepare(
    'DELETE FROM sections WHERE term_id = ? AND program_id = ? AND year_level = ?'
  )->execute([$termId, $programId, $yearLevel]);
  $pdo->prepare(
    'DELETE FROM section_plans WHERE term_id = ? AND program_id = ? AND year_level = ?'
  )->execute([$termId, $programId, $yearLevel]);
  return $count;
}
