<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function start_app_session(): void
{
  if (session_status() === PHP_SESSION_ACTIVE) {
    return;
  }
  session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
  session_start();
}

start_app_session();

function account_role_label(string $role): string
{
  return [
    'super_admin' => 'Super Admin',
    'admin' => 'Admin',
    'vpaa' => 'VPAA',
    'dean' => 'Dean',
    'program_chair' => 'Program Chair',
  ][$role] ?? $role;
}

function role_home_path(string $role): string
{
  return [
    'super_admin' => 'super-admin/home-dashboard.html',
    'admin' => 'admin/home-dashboard.html',
    'vpaa' => 'viewing-with-approval/dashboard.html',
    'dean' => 'viewing/dashboard.html',
    'program_chair' => 'viewing-program-head/dashboard.html',
  ][$role] ?? 'index.html';
}

function current_session_user_id(): ?int
{
  start_app_session();
  $id = $_SESSION['user_id'] ?? null;
  if ($id === null || $id === '') {
    return null;
  }
  $id = (int) $id;
  return $id > 0 ? $id : null;
}

function login_session(int $userId): void
{
  start_app_session();
  session_regenerate_id(true);
  $_SESSION['user_id'] = $userId;
}

function logout_session(): void
{
  start_app_session();
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(
      session_name(),
      '',
      time() - 42000,
      $params['path'] ?? '/',
      $params['domain'] ?? '',
      (bool) ($params['secure'] ?? false),
      (bool) ($params['httponly'] ?? true)
    );
  }
  session_destroy();
}

function session_user_payload(PDO $pdo, ?int $userId = null): ?array
{
  if (!schema_table_exists($pdo, 'users')) {
    return null;
  }
  $id = $userId ?? current_session_user_id();
  if (!$id) {
    return null;
  }
  $stmt = $pdo->prepare(
    'SELECT u.user_id, u.full_name, u.email, u.role, u.is_active, u.college_id, c.college_name
     FROM users u
     LEFT JOIN colleges c ON c.college_id = u.college_id
     WHERE u.user_id = ?'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  if (!$row || (int) $row['is_active'] !== 1) {
    if ($userId === null) {
      logout_session();
    }
    return null;
  }
  $programIds = [];
  $programNames = [];
  $departmentId = null;
  $departmentName = null;
  if (schema_column_exists($pdo, 'users', 'department_id')) {
    $deptStmt = $pdo->prepare(
      'SELECT u.department_id, d.department_name
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.user_id = ?'
    );
    $deptStmt->execute([$id]);
    $deptRow = $deptStmt->fetch();
    if ($deptRow && !empty($deptRow['department_id'])) {
      $departmentId = public_id('dept', (int) $deptRow['department_id']);
      $departmentName = (string) ($deptRow['department_name'] ?? '');
    }
  }
  if ($departmentId) {
    $prog = $pdo->prepare(
      'SELECT p.program_id, p.program_name
       FROM programs p
       JOIN users u ON u.department_id = p.department_id
       WHERE u.user_id = ? AND p.is_active = 1
       ORDER BY p.program_name'
    );
  } else {
    $prog = $pdo->prepare(
      'SELECT p.program_id, p.program_name
       FROM user_programs up
       JOIN programs p ON p.program_id = up.program_id
       WHERE up.user_id = ?
       ORDER BY p.program_name'
    );
  }
  $prog->execute([$id]);
  foreach ($prog->fetchAll() as $p) {
    $programIds[] = public_id('d', (int) $p['program_id']);
    $programNames[] = (string) $p['program_name'];
  }
  $role = (string) $row['role'];
  return [
    'id' => public_id('u', (int) $row['user_id']),
    'name' => $row['full_name'],
    'email' => $row['email'],
    'role' => $role,
    'roleLabel' => account_role_label($role),
    'isActive' => true,
    'collegeId' => !empty($row['college_id']) ? public_id('c', (int) $row['college_id']) : null,
    'collegeName' => $row['college_name'] ?? null,
    'departmentId' => $departmentId,
    'departmentName' => $departmentName,
    'programIds' => $programIds,
    'programNames' => $programNames,
    'home' => role_home_path($role),
  ];
}

function config_path(): string
{
  return __DIR__ . '/config.php';
}

function load_config(): ?array
{
  $path = config_path();
  if (!is_file($path)) {
    return null;
  }
  $cfg = require $path;
  return is_array($cfg) ? $cfg : null;
}

function json_input(): array
{
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') {
    return [];
  }
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function json_ok(array $payload = []): void
{
  http_response_code(200);
  echo json_encode(['ok' => true] + $payload, JSON_UNESCAPED_UNICODE);
  exit;
}

function json_error(string $message, int $status = 400, array $extra = []): void
{
  http_response_code($status);
  echo json_encode(['ok' => false, 'error' => $message] + $extra, JSON_UNESCAPED_UNICODE);
  exit;
}

function pdo_from_config(array $cfg, bool $withDatabase = true): PDO
{
  $host = $cfg['host'] ?? '127.0.0.1';
  $port = (int) ($cfg['port'] ?? 3306);
  $name = $cfg['name'] ?? 'mcu_nex';
  $user = $cfg['user'] ?? 'root';
  $pass = (string) ($cfg['pass'] ?? '');
  $charset = $cfg['charset'] ?? 'utf8mb4';
  $dsn = $withDatabase
    ? "mysql:host={$host};port={$port};dbname={$name};charset={$charset}"
    : "mysql:host={$host};port={$port};charset={$charset}";
  $pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
  $pdo->exec("SET NAMES {$charset}");
  return $pdo;
}

function db(): PDO
{
  static $pdo = null;
  if ($pdo instanceof PDO) {
    return $pdo;
  }
  $cfg = load_config();
  if (!$cfg) {
    json_error('MySQL is not configured. Open /api/install.php to create the database.', 503);
  }
  try {
    $pdo = pdo_from_config($cfg, true);
  } catch (PDOException $e) {
    json_error('Could not connect to MySQL: ' . $e->getMessage(), 503);
  }
  return $pdo;
}

function public_id(string $prefix, int $id): string
{
  return $prefix . '-' . $id;
}

function parse_id(?string $value, string $prefix): ?int
{
  if ($value === null || $value === '') {
    return null;
  }
  if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', $value, $m)) {
    return (int) $m[1];
  }
  return null;
}

function unique_code(PDO $pdo, string $table, string $column, string $wanted, ?int $ignoreId = null, string $idColumn = ''): string
{
  $base = strtoupper(preg_replace('/[^A-Z0-9]+/i', '', $wanted) ?: 'X');
  $base = substr($base, 0, 16);
  $code = $base;
  $n = 2;
  while (true) {
    $sql = "SELECT 1 FROM {$table} WHERE {$column} = ?";
    $params = [$code];
    if ($ignoreId !== null && $idColumn !== '') {
      $sql .= " AND {$idColumn} <> ?";
      $params[] = $ignoreId;
    }
    $sql .= ' LIMIT 1';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    if (!$stmt->fetch()) {
      return $code;
    }
    $code = substr($base, 0, 12) . $n;
    $n++;
  }
}

function code_from_name(string $name, int $max = 8): string
{
  $words = preg_split('/\s+/', trim($name)) ?: [];
  $code = '';
  foreach ($words as $w) {
    if ($w === '') {
      continue;
    }
    $code .= strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $w) ?: 'X', 0, 1));
  }
  if ($code === '') {
    $code = 'X';
  }
  return substr($code, 0, $max);
}

function ensure_school_year(PDO $pdo, string $label): int
{
  $stmt = $pdo->prepare('SELECT school_year_id FROM school_years WHERE label = ?');
  $stmt->execute([$label]);
  $id = $stmt->fetchColumn();
  if ($id) {
    return (int) $id;
  }
  $start = (int) substr($label, 0, 4);
  $ins = $pdo->prepare('INSERT INTO school_years (label, start_year, is_current) VALUES (?, ?, 0)');
  $ins->execute([$label, $start]);
  return (int) $pdo->lastInsertId();
}

function parse_school_year_label(string $label): string
{
  $label = trim($label);
  if (!preg_match('/^(\d{4})-(\d{4})$/', $label, $m) || (int) $m[2] !== (int) $m[1] + 1) {
    throw new RuntimeException('Academic year must look like 2026-2027.');
  }
  return $label;
}

function list_school_years(PDO $pdo): array
{
  ensure_current_school_year($pdo);
  $rows = $pdo->query(
    'SELECT school_year_id, label, is_current FROM school_years ORDER BY start_year DESC, label DESC'
  )->fetchAll();
  $out = [];
  foreach ($rows as $row) {
    $out[] = [
      'id' => public_id('sy', (int) $row['school_year_id']),
      'label' => $row['label'],
      'isCurrent' => (int) $row['is_current'] === 1,
    ];
  }
  return $out;
}

function resolve_offering_school_year(PDO $pdo, array $body): array
{
  $label = trim((string) ($body['schoolYear'] ?? ''));
  if ($label === '') {
    return ensure_current_school_year($pdo);
  }
  $label = parse_school_year_label($label);
  $id = ensure_school_year($pdo, $label);
  $stmt = $pdo->prepare('SELECT label FROM school_years WHERE school_year_id = ?');
  $stmt->execute([$id]);
  return ['id' => $id, 'label' => (string) $stmt->fetchColumn()];
}

function school_year_label_now(): string
{
  $year = (int) date('Y');
  $month = (int) date('n');
  $start = $month >= 6 ? $year : $year - 1;
  return $start . '-' . ($start + 1);
}

function ensure_current_school_year(PDO $pdo): array
{
  $stmt = $pdo->query(
    'SELECT school_year_id, label FROM school_years WHERE is_current = 1 LIMIT 1'
  );
  $row = $stmt->fetch();
  if ($row) {
    return ['id' => (int) $row['school_year_id'], 'label' => (string) $row['label']];
  }
  $label = school_year_label_now();
  $id = ensure_school_year($pdo, $label);
  $pdo->prepare(
    'UPDATE school_years SET is_current = CASE WHEN school_year_id = ? THEN 1 ELSE 0 END'
  )->execute([$id]);
  return ['id' => $id, 'label' => $label];
}

function normalize_term_code(string $code): string
{
  $code = strtolower(trim($code));
  if ($code === 'summer' || $code === '3') {
    return 'summer';
  }
  if ($code === '2' || $code === '2nd') {
    return '2';
  }
  return '1';
}

function ensure_term(PDO $pdo, int $schoolYearId, string $termCode): int
{
  $termCode = normalize_term_code($termCode);
  $stmt = $pdo->prepare('SELECT term_id FROM terms WHERE school_year_id = ? AND term_code = ?');
  $stmt->execute([$schoolYearId, $termCode]);
  $id = $stmt->fetchColumn();
  if ($id) {
    return (int) $id;
  }
  $ins = $pdo->prepare('INSERT INTO terms (school_year_id, term_code, is_active) VALUES (?, ?, 0)');
  $ins->execute([$schoolYearId, $termCode]);
  return (int) $pdo->lastInsertId();
}

function ensure_term_archive_schema(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'terms')) {
    return;
  }
  if (!schema_column_exists($pdo, 'terms', 'archived_label')) {
    $pdo->exec('ALTER TABLE terms ADD COLUMN archived_label VARCHAR(40) NULL');
  }
}

function offering_archive_label(): string
{
  return date('M Y');
}

function current_offering_term(PDO $pdo): ?array
{
  ensure_term_archive_schema($pdo);
  $row = $pdo->query(
    'SELECT t.term_id, t.term_code, sy.label
     FROM terms t
     JOIN school_years sy ON sy.school_year_id = t.school_year_id
     WHERE t.is_active = 1
     LIMIT 1'
  )->fetch();
  if (!$row) {
    return null;
  }
  return [
    'termId' => (int) $row['term_id'],
    'schoolYear' => (string) $row['label'],
    'termCode' => (string) $row['term_code'],
  ];
}

function list_archived_offerings(PDO $pdo): array
{
  ensure_term_archive_schema($pdo);
  $hasOfferings = schema_table_exists($pdo, 'class_offerings');
  $hasApprovals = schema_table_exists($pdo, 'term_schedule_approvals');
  $sql = "SELECT sy.label AS school_year, t.term_code, t.archived_label, t.term_order,
                 COUNT(DISTINCT s.section_id) AS section_count";
  $sql .= $hasOfferings
    ? ", COUNT(DISTINCT o.offering_id) AS class_count"
    : ", 0 AS class_count";
  if ($hasApprovals) {
    $sql .= ", tsa.status AS approval_status,
              CASE WHEN tsa.published_json IS NOT NULL AND TRIM(tsa.published_json) <> '' THEN 1 ELSE 0 END AS has_published,
              CASE WHEN tsa.pending_vpaa_json IS NOT NULL AND TRIM(tsa.pending_vpaa_json) <> '' THEN 1 ELSE 0 END AS has_pending_vpaa";
  } else {
    $sql .= ", NULL AS approval_status, 0 AS has_published, 0 AS has_pending_vpaa";
  }
  $sql .= " FROM terms t
     JOIN school_years sy ON sy.school_year_id = t.school_year_id
     LEFT JOIN sections s ON s.term_id = t.term_id";
  if ($hasOfferings) {
    $sql .= " LEFT JOIN class_offerings o ON o.term_id = t.term_id";
  }
  if ($hasApprovals) {
    $sql .= " LEFT JOIN term_schedule_approvals tsa ON tsa.term_id = t.term_id";
  }
  $sql .= " WHERE t.is_active = 0
     GROUP BY t.term_id, sy.label, t.term_code, t.archived_label, t.term_order";
  if ($hasApprovals) {
    $sql .= ", tsa.status, tsa.published_json, tsa.pending_vpaa_json";
  }
  $sql .= " HAVING (COUNT(DISTINCT s.section_id) > 0";
  if ($hasOfferings) {
    $sql .= " OR COUNT(DISTINCT o.offering_id) > 0";
  }
  $sql .= " OR t.archived_label IS NOT NULL)
     ORDER BY sy.label DESC, t.term_order";
  $rows = $pdo->query($sql)->fetchAll();
  $out = [];
  foreach ($rows as $row) {
    $out[] = [
      'schoolYear' => (string) $row['school_year'],
      'termCode' => (string) $row['term_code'],
      'archivedLabel' => $row['archived_label'] ? (string) $row['archived_label'] : '',
      'sectionCount' => (int) $row['section_count'],
      'classCount' => (int) ($row['class_count'] ?? 0),
      'status' => $row['approval_status'] ? (string) $row['approval_status'] : '',
      'published' => (int) ($row['has_published'] ?? 0) === 1,
      'hasPendingVpaa' => (int) ($row['has_pending_vpaa'] ?? 0) === 1,
    ];
  }
  return $out;
}

function offering_term_is_live(PDO $pdo, int $termId): bool
{
  $cur = current_offering_term($pdo);
  return $cur && (int) $cur['termId'] === $termId;
}

function require_live_offering_term(PDO $pdo, int $termId): void
{
  if (offering_term_is_live($pdo, $termId)) {
    return;
  }
  $cur = current_offering_term($pdo);
  if (!$cur) {
    throw new RuntimeException('Set the current academic year and semester on the Sections page before changing a timetable.');
  }
  throw new RuntimeException(
    'That offering is archived. Unarchive it before changing the timetable. The live offering is ' .
    $cur['schoolYear'] . '.'
  );
}

function term_section_count(PDO $pdo, int $termId): int
{
  $stmt = $pdo->prepare('SELECT COUNT(*) FROM sections WHERE term_id = ?');
  $stmt->execute([$termId]);
  return (int) $stmt->fetchColumn();
}

function deactivate_all_terms(PDO $pdo): void
{
  $pdo->exec('UPDATE terms SET is_active = 0');
}

function canonical_room_type_name(string $name): string
{
  $name = trim(preg_replace('/\s+/', ' ', $name) ?? '');
  if ($name === '') {
    return '';
  }
  $key = strtolower($name);
  $key = preg_replace('/[_-]+/', ' ', $key) ?? $key;
  $key = trim(preg_replace('/\s+/', ' ', $key) ?? $key);
  if ($key === 'off campus' || $key === 'no room' || $key === 'noroom') {
    return 'Off-campus';
  }
  return $name;
}

function is_off_campus_room_type_name(string $name): bool
{
  return canonical_room_type_name($name) === 'Off-campus';
}

function find_room_type_id(PDO $pdo, string $name): ?int
{
  $name = trim($name);
  if ($name === '') {
    return null;
  }
  $canon = canonical_room_type_name($name);
  $stmt = $pdo->prepare('SELECT room_type_id FROM room_types WHERE room_type_name = ?');
  $stmt->execute([$canon]);
  $id = $stmt->fetchColumn();
  if ($id) {
    return (int) $id;
  }
  if ($canon !== $name) {
    $stmt->execute([$name]);
    $id = $stmt->fetchColumn();
    if ($id) {
      return (int) $id;
    }
  }
  return null;
}

function reassign_room_type_id(PDO $pdo, int $sourceId, int $keepId): void
{
  if ($sourceId === $keepId) {
    return;
  }
  if (schema_table_exists($pdo, 'rooms')) {
    $pdo->prepare('UPDATE rooms SET room_type_id = ? WHERE room_type_id = ?')->execute([$keepId, $sourceId]);
  }
  if (schema_table_exists($pdo, 'course_room_requirements')) {
    $pdo->prepare(
      'DELETE crr FROM course_room_requirements crr
       INNER JOIN course_room_requirements keep
         ON keep.curriculum_course_id = crr.curriculum_course_id
        AND keep.component = crr.component
        AND keep.room_type_id = ?
      WHERE crr.room_type_id = ?'
    )->execute([$keepId, $sourceId]);
    $pdo->prepare('UPDATE course_room_requirements SET room_type_id = ? WHERE room_type_id = ?')
      ->execute([$keepId, $sourceId]);
  }
}

function collapse_off_campus_room_type_aliases(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'room_types')) {
    return;
  }
  $keepId = ensure_room_type($pdo, 'Off-campus');
  if (!$keepId) {
    return;
  }
  if (schema_column_exists($pdo, 'room_types', 'requires_campus_room')) {
    $pdo->prepare(
      'UPDATE room_types SET requires_campus_room = 0 WHERE room_type_id = ?'
    )->execute([$keepId]);
  }

  $rows = $pdo->query('SELECT room_type_id, room_type_name FROM room_types')->fetchAll();
  foreach ($rows as $row) {
    $id = (int) $row['room_type_id'];
    if ($id === $keepId) {
      continue;
    }
    if (canonical_room_type_name((string) $row['room_type_name']) !== 'Off-campus') {
      continue;
    }
    reassign_room_type_id($pdo, $id, $keepId);
    $pdo->prepare('DELETE FROM room_types WHERE room_type_id = ?')->execute([$id]);
  }

  if (!schema_table_exists($pdo, 'curriculum_courses')) {
    return;
  }
  foreach (['lecture_room_type', 'lab_room_type'] as $col) {
    $pdo->exec(
      "UPDATE curriculum_courses
       SET {$col} = 'Off-campus'
       WHERE {$col} IS NOT NULL AND {$col} <> '' AND {$col} <> 'Off-campus'
         AND LOWER(TRIM(REPLACE(REPLACE({$col}, '_', ' '), '-', ' '))) IN ('off campus', 'no room', 'noroom')"
    );
  }
}

function ensure_room_type(PDO $pdo, string $name): ?int
{
  $name = canonical_room_type_name(trim($name));
  if ($name === '') {
    return null;
  }
  $id = find_room_type_id($pdo, $name);
  if ($id) {
    return $id;
  }
  $campus = campus_room_required_for_type_name($name) ? 1 : 0;
  if (schema_column_exists($pdo, 'room_types', 'requires_campus_room')) {
    $ins = $pdo->prepare(
      'INSERT INTO room_types (room_type_name, room_type_code, is_active, requires_campus_room) VALUES (?, NULL, 1, ?)'
    );
    $ins->execute([$name, $campus]);
  } else {
    $ins = $pdo->prepare('INSERT INTO room_types (room_type_name, room_type_code, is_active) VALUES (?, NULL, 1)');
    $ins->execute([$name]);
  }
  return (int) $pdo->lastInsertId();
}

function schema_column_exists(PDO $pdo, string $table, string $column): bool
{
  $stmt = $pdo->prepare(
    'SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
  );
  $stmt->execute([$table, $column]);
  return (int) $stmt->fetchColumn() > 0;
}

// Section partitioning splits one section's headcount across several classes of
// the same subject, so a section needs more than one offering row per subject.
// uq_offerings has to grow a partition column or the second partition is
// rejected as a duplicate.
function ensure_section_partition_schema(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'class_offerings')) {
    return;
  }
  if (!schema_column_exists($pdo, 'class_offerings', 'partition_index')) {
    $pdo->exec(
      'ALTER TABLE class_offerings
         ADD COLUMN partition_index TINYINT NOT NULL DEFAULT 1 AFTER component,
         ADD COLUMN partition_count TINYINT NOT NULL DEFAULT 1 AFTER partition_index,
         ADD COLUMN partition_students SMALLINT NULL AFTER partition_count'
    );
  }
  if (schema_index_exists($pdo, 'class_offerings', 'uq_offerings')) {
    $stmt = $pdo->prepare(
      'SELECT COUNT(*) FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute(['class_offerings', 'uq_offerings', 'partition_index']);
    if ((int) $stmt->fetchColumn() === 0) {
      $pdo->exec(
        'ALTER TABLE class_offerings
           DROP INDEX uq_offerings,
           ADD UNIQUE KEY uq_offerings (section_id, curriculum_course_id, component, partition_index)'
      );
    }
  }
}

function schema_index_exists(PDO $pdo, string $table, string $index): bool
{
  $stmt = $pdo->prepare(
    'SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?'
  );
  $stmt->execute([$table, $index]);
  return (int) $stmt->fetchColumn() > 0;
}

function schema_column_is_generated(PDO $pdo, string $table, string $column): bool
{
  if (!schema_column_exists($pdo, $table, $column)) {
    return false;
  }
  $stmt = $pdo->prepare(
    'SELECT EXTRA FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
  );
  $stmt->execute([$table, $column]);
  return stripos((string) $stmt->fetchColumn(), 'generated') !== false;
}

/**
 * Hours per week can differ from the unit formula, so these columns cannot stay
 * generated. Existing rows keep the formula values until a curriculum is saved
 * with file hours.
 */
function ensure_curriculum_hours_writable(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'curriculum_courses')) {
    return;
  }
  $weekGen = schema_column_is_generated($pdo, 'curriculum_courses', 'total_hours_week');
  $semGen = schema_column_is_generated($pdo, 'curriculum_courses', 'total_hours_sem');
  if ($weekGen || $semGen) {
    if ($weekGen) {
      $pdo->exec('ALTER TABLE curriculum_courses DROP COLUMN total_hours_week');
    }
    if ($semGen) {
      $pdo->exec('ALTER TABLE curriculum_courses DROP COLUMN total_hours_sem');
    }
  }
  if (!schema_column_exists($pdo, 'curriculum_courses', 'total_hours_week')) {
    $pdo->exec(
      'ALTER TABLE curriculum_courses
       ADD COLUMN total_hours_week DECIMAL(6,2) NOT NULL DEFAULT 0'
    );
  }
  if (!schema_column_exists($pdo, 'curriculum_courses', 'total_hours_sem')) {
    $pdo->exec(
      'ALTER TABLE curriculum_courses
       ADD COLUMN total_hours_sem DECIMAL(7,2) NOT NULL DEFAULT 0'
    );
  }
  $pdo->exec(
    'UPDATE curriculum_courses
     SET total_hours_week = ROUND(((lecture_units * 1 + lab_units * 3) * 18) / weeks_in_term, 2),
         total_hours_sem = ROUND((lecture_units * 1 + lab_units * 3) * 18, 2)
     WHERE total_hours_week = 0 AND total_hours_sem = 0
       AND (lecture_units > 0 OR lab_units > 0)'
  );
}

function schema_table_exists(PDO $pdo, string $table): bool
{
  $stmt = $pdo->prepare(
    'SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
  );
  $stmt->execute([$table]);
  return (int) $stmt->fetchColumn() > 0;
}

function campus_room_required_for_type_name(string $name): bool
{
  return !is_off_campus_room_type_name($name);
}

function ensure_schedule_schema(PDO $pdo): void
{
  ensure_curriculum_hours_writable($pdo);
  if (schema_table_exists($pdo, 'room_types') && !schema_column_exists($pdo, 'room_types', 'requires_campus_room')) {
    $pdo->exec(
      'ALTER TABLE room_types
       ADD COLUMN requires_campus_room BOOLEAN NOT NULL DEFAULT TRUE
       COMMENT \'FALSE = Off-campus: occupy student time but no campus room\''
    );
  }
  if (schema_table_exists($pdo, 'room_types')) {
    $seed = $pdo->prepare(
      'INSERT IGNORE INTO room_types (room_type_name, room_type_code, is_active, requires_campus_room)
       VALUES (?, ?, 1, 0)'
    );
    $seed->execute(['Off-campus', 'OFF']);
    collapse_off_campus_room_type_aliases($pdo);
  }

  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS merged_classes (
      merged_class_id INT PRIMARY KEY AUTO_INCREMENT,
      term_id INT NOT NULL,
      course_code VARCHAR(30) NOT NULL,
      component ENUM('lecture','laboratory') NOT NULL,
      room_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_merged_term (term_id),
      CONSTRAINT fk_mc_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE,
      CONSTRAINT fk_mc_room FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS merged_class_members (
      merged_class_id INT NOT NULL,
      offering_id INT NOT NULL,
      PRIMARY KEY (merged_class_id, offering_id),
      CONSTRAINT fk_mcm_class FOREIGN KEY (merged_class_id) REFERENCES merged_classes(merged_class_id) ON DELETE CASCADE,
      CONSTRAINT fk_mcm_off FOREIGN KEY (offering_id) REFERENCES class_offerings(offering_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS schedule_runs (
      run_id INT PRIMARY KEY AUTO_INCREMENT,
      term_id INT NOT NULL,
      merge_mode ENUM('auto','manual') NOT NULL DEFAULT 'auto',
      status ENUM('merging','done','failed') NOT NULL DEFAULT 'merging',
      payload_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_srun_term FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );

  if (schema_table_exists($pdo, 'class_offerings') && !schema_column_exists($pdo, 'class_offerings', 'notes')) {
    $pdo->exec('ALTER TABLE class_offerings ADD COLUMN notes VARCHAR(255) NULL');
  }
  ensure_section_partition_schema($pdo);
  if (schema_table_exists($pdo, 'sections') && !schema_column_exists($pdo, 'sections', 'is_retake')) {
    $pdo->exec(
      'ALTER TABLE sections
       ADD COLUMN is_retake BOOLEAN NOT NULL DEFAULT FALSE
       COMMENT \'TRUE = dedicated off-semester / retake section\''
    );
  }
  if (schema_table_exists($pdo, 'sections') && schema_table_exists($pdo, 'curriculum_courses')) {
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

  if (schema_table_exists($pdo, 'terms')) {
    $pdo->exec(
      "CREATE TABLE IF NOT EXISTS term_schedule_approvals (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
      "CREATE TABLE IF NOT EXISTS schedule_request_records (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
      "CREATE TABLE IF NOT EXISTS text_schedule_requests (
        request_id INT PRIMARY KEY AUTO_INCREMENT,
        from_role ENUM('dean','program_chair') NOT NULL,
        from_user_id INT NULL,
        from_name VARCHAR(255) NOT NULL,
        college_id INT NULL,
        college_name VARCHAR(255) NULL,
        body TEXT NOT NULL,
        status ENUM('pending_dean','pending_admin','held') NOT NULL,
        forwarded_by_name VARCHAR(255) NULL,
        forwarded_at DATETIME NULL,
        hold_note TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tsr_status (status),
        KEY idx_tsr_college (college_id),
        KEY idx_tsr_from_user (from_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    if (schema_table_exists($pdo, 'text_schedule_requests') && !schema_column_exists($pdo, 'text_schedule_requests', 'hold_note')) {
      $pdo->exec('ALTER TABLE text_schedule_requests ADD COLUMN hold_note TEXT NULL');
    }
    ensure_text_request_details($pdo);
  }
  ensure_notifications_schema($pdo);
  if (function_exists('ensure_schedule_workspace_schema')) {
    ensure_schedule_workspace_schema($pdo);
  } elseif (is_file(__DIR__ . '/schedule-workspaces.php')) {
    require_once __DIR__ . '/schedule-workspaces.php';
    ensure_schedule_workspace_schema($pdo);
  }
}

function term_offering_label(string $year, string $termCode): string
{
  $sem = $termCode === '2' ? '2nd semester' : ($termCode === 'summer' ? 'Summer' : '1st semester');
  $year = trim($year);
  return $year !== '' ? $year . ' ' . $sem : $sem;
}

function record_schedule_handoff(
  PDO $pdo,
  int $termId,
  string $kind,
  string $fromRole,
  string $toRole,
  string $note = '',
  string $copy = ''
): void {
  if ($termId < 1 || !schema_table_exists($pdo, 'schedule_request_records')) {
    return;
  }
  $kind = $kind === 'send_back' ? 'send_back' : 'send';
  $allowed = ['admin', 'super_admin', 'vpaa'];
  if (!in_array($fromRole, $allowed, true) || !in_array($toRole, $allowed, true)) {
    return;
  }
  $pdo->prepare(
    'INSERT INTO schedule_request_records (term_id, kind, from_role, to_role, copy_label, note)
     VALUES (?, ?, ?, ?, ?, ?)'
  )->execute([
    $termId,
    $kind,
    $fromRole,
    $toRole,
    $copy !== '' ? $copy : null,
    $note !== '' ? $note : null,
  ]);
}

function list_schedule_request_records(PDO $pdo, string $actor): array
{
  if (!schema_table_exists($pdo, 'schedule_request_records')) {
    return [];
  }
  $allowed = ['admin', 'super_admin', 'vpaa'];
  if (!in_array($actor, $allowed, true)) {
    $session = session_user_payload($pdo);
    $actor = is_array($session) ? (string) ($session['role'] ?? '') : '';
  }
  if (!in_array($actor, $allowed, true)) {
    return [];
  }
  $stmt = $pdo->query(
    "SELECT r.record_id, r.kind, r.from_role, r.to_role, r.copy_label, r.note, r.created_at,
            sy.label AS school_year, t.term_code
     FROM schedule_request_records r
     JOIN terms t ON t.term_id = r.term_id
     JOIN school_years sy ON sy.school_year_id = t.school_year_id
     ORDER BY r.created_at DESC, r.record_id DESC
     LIMIT 200"
  );
  $out = [];
  foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $out[] = public_schedule_handoff($row);
  }
  return $out;
}

function public_schedule_handoff(array $row): array
{
  $from = account_role_label((string) ($row['from_role'] ?? ''));
  $to = account_role_label((string) ($row['to_role'] ?? ''));
  $kind = (string) ($row['kind'] ?? 'send');
  $copy = (string) ($row['copy_label'] ?? '');
  $term = term_offering_label((string) ($row['school_year'] ?? ''), (string) ($row['term_code'] ?? '1'));
  $what = $term . ' timetable';
  if ($copy === 'live') {
    $what = $term . ' live timetable';
  } elseif ($copy === 'snapshot') {
    $what = $term . ' timetable (Admin’s snapshot)';
  } elseif ($copy === 'returned') {
    $what = $term . ' timetable (package the VPAA returned)';
  }
  $summary = $kind === 'send_back'
    ? $from . ' sent the ' . $what . ' back to ' . $to . '.'
    : $from . ' sent the ' . $what . ' to ' . $to . '.';
  $created = (string) ($row['created_at'] ?? '');
  $ts = $created !== '' ? strtotime($created) : false;
  return [
    'id' => (int) ($row['record_id'] ?? 0),
    'kind' => $kind,
    'fromRole' => $row['from_role'] ?? '',
    'toRole' => $row['to_role'] ?? '',
    'title' => $kind === 'send_back' ? 'Sent back by ' . $from : 'From ' . $from,
    'summary' => $summary,
    'note' => trim((string) ($row['note'] ?? '')),
    'at' => $ts ? date('c', $ts) : $created,
    'atLabel' => $ts ? date('M j, Y g:i A', $ts) : $created,
  ];
}

function session_db_user(PDO $pdo): ?array
{
  $id = current_session_user_id();
  if (!$id || !schema_table_exists($pdo, 'users')) {
    return null;
  }
  $stmt = $pdo->prepare(
    'SELECT u.user_id, u.full_name, u.role, u.college_id, c.college_name
     FROM users u
     LEFT JOIN colleges c ON c.college_id = u.college_id
     WHERE u.user_id = ? AND u.is_active = 1'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

function text_request_status_label(string $status): string
{
  if ($status === 'pending_dean') {
    return 'With Dean';
  }
  if ($status === 'held') {
    return 'Not forwarded';
  }
  if ($status === 'done') {
    return 'Done';
  }
  if ($status === 'sent_back') {
    return 'Sent back';
  }
  return 'Pending';
}

function ensure_text_request_details(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'text_schedule_requests')) {
    return;
  }
  $columns = [
    'class_ref' => 'VARCHAR(40) NULL',
    'class_label' => 'VARCHAR(255) NULL',
    'meeting_label' => 'VARCHAR(255) NULL',
    'change_kind' => 'VARCHAR(32) NULL',
    'requested_label' => 'VARCHAR(255) NULL',
    'topics' => 'TEXT NULL',
    'classes_json' => 'TEXT NULL',
    'forward_note' => 'TEXT NULL',
    'admin_reply' => 'TEXT NULL',
    'replied_at' => 'DATETIME NULL',
  ];
  foreach ($columns as $name => $definition) {
    if (!schema_column_exists($pdo, 'text_schedule_requests', $name)) {
      $pdo->exec('ALTER TABLE text_schedule_requests ADD COLUMN ' . $name . ' ' . $definition);
    }
  }
  $pdo->exec(
    "ALTER TABLE text_schedule_requests
     MODIFY status ENUM('pending_dean','pending_admin','held','done','sent_back') NOT NULL"
  );
}

function request_meeting_label(array $class): string
{
  $parts = [];
  foreach ($class['meetings'] ?? [] as $meeting) {
    if (!is_array($meeting)) {
      continue;
    }
    $day = trim((string) ($meeting['day'] ?? ''));
    $start = substr(trim((string) ($meeting['start'] ?? '')), 0, 5);
    $end = substr(trim((string) ($meeting['end'] ?? '')), 0, 5);
    $room = trim((string) ($meeting['roomCode'] ?? ''));
    $bit = trim($day . ' ' . $start . '–' . $end);
    if ($room !== '') {
      $bit .= ' · ' . $room;
    }
    if ($bit !== '' && $bit !== '–') {
      $parts[] = $bit;
    }
  }
  return implode('; ', $parts);
}

function request_class_label(array $class): string
{
  $section = trim((string) ($class['sectionName'] ?? ''));
  $code = trim((string) ($class['courseCode'] ?? ''));
  $component = trim((string) ($class['component'] ?? ''));
  if ($component === 'laboratory') {
    $component = 'Laboratory';
  } elseif ($component === 'lecture') {
    $component = 'Lecture';
  }
  $subject = trim($code . ' ' . $component);
  if ($section !== '' && $subject !== '') {
    return $section . ' · ' . $subject;
  }
  return $section !== '' ? $section : $subject;
}

function published_schedule_classes(PDO $pdo): array
{
  $term = current_offering_term($pdo);
  if (!$term) {
    return [];
  }
  $termId = (int) $term['termId'];
  if ($termId < 1 || !schema_table_exists($pdo, 'term_schedule_approvals')) {
    return [];
  }
  $stmt = $pdo->prepare('SELECT published_json FROM term_schedule_approvals WHERE term_id = ?');
  $stmt->execute([$termId]);
  $raw = $stmt->fetchColumn();
  if (!is_string($raw) || trim($raw) === '') {
    return [];
  }
  $decoded = json_decode($raw, true);
  $classes = is_array($decoded) ? ($decoded['classes'] ?? null) : null;
  return is_array($classes) ? $classes : [];
}

function request_class_choices(PDO $pdo): array
{
  $user = session_db_user($pdo);
  if (!$user) {
    return [];
  }
  $role = (string) ($user['role'] ?? '');
  if ($role !== 'dean' && $role !== 'program_chair') {
    return [];
  }
  $session = session_user_payload($pdo);
  if (!$session) {
    return [];
  }
  $collegeId = (string) ($session['collegeId'] ?? '');
  $programIds = is_array($session['programIds'] ?? null) ? $session['programIds'] : [];
  $out = [];
  foreach (published_schedule_classes($pdo) as $class) {
    if (!is_array($class) || (string) ($class['collegeId'] ?? '') !== $collegeId) {
      continue;
    }
    if ($role === 'program_chair') {
      $dept = (string) ($class['departmentId'] ?? '');
      if ($dept === '' || !in_array($dept, $programIds, true)) {
        continue;
      }
    }
    $meetings = $class['meetings'] ?? [];
    $id = trim((string) ($class['id'] ?? ''));
    if ($id === '' || !is_array($meetings) || $meetings === []) {
      continue;
    }
    $out[] = [
      'id' => $id,
      'label' => request_class_label($class),
      'meeting' => request_meeting_label($class),
    ];
  }
  usort($out, static function (array $a, array $b): int {
    return strcasecmp($a['label'], $b['label']);
  });
  return $out;
}

function request_topic_catalog(): array
{
  return [
    'time' => 'Change day or time',
    'room' => 'Change room',
    'meetings' => 'Split a session or add a meeting',
    'merge' => 'Merge',
    'unmerge' => 'Unmerge',
    'partition' => 'Section partition',
    'remove' => 'Remove schedule',
    'other' => 'Other',
  ];
}

function request_json_list($raw): array
{
  if (!is_string($raw) || trim($raw) === '') {
    return [];
  }
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function request_topics_from_row(array $row): array
{
  $catalog = request_topic_catalog();
  $keys = [];
  foreach (request_json_list($row['topics'] ?? null) as $key) {
    $key = (string) $key;
    if (isset($catalog[$key]) && !in_array($key, $keys, true)) {
      $keys[] = $key;
    }
  }
  return $keys;
}

function request_classes_from_row(array $row): array
{
  $out = [];
  foreach (request_json_list($row['classes_json'] ?? null) as $item) {
    if (!is_array($item)) {
      continue;
    }
    $label = trim((string) ($item['label'] ?? ''));
    if ($label === '') {
      continue;
    }
    $out[] = [
      'id' => trim((string) ($item['id'] ?? '')),
      'label' => $label,
      'meeting' => trim((string) ($item['meeting'] ?? '')),
    ];
  }
  if (!$out) {
    $label = trim((string) ($row['class_label'] ?? ''));
    if ($label !== '') {
      $out[] = [
        'id' => trim((string) ($row['class_ref'] ?? '')),
        'label' => $label,
        'meeting' => trim((string) ($row['meeting_label'] ?? '')),
      ];
    }
  }
  return $out;
}

function public_text_schedule_request(array $row, string $viewerRole): array
{
  $fromRole = (string) ($row['from_role'] ?? '');
  $fromName = trim((string) ($row['from_name'] ?? ''));
  $fromLabel = account_role_label($fromRole);
  $status = (string) ($row['status'] ?? 'pending_admin');
  $college = trim((string) ($row['college_name'] ?? ''));
  $forwardedBy = trim((string) ($row['forwarded_by_name'] ?? ''));
  $title = 'From ' . $fromLabel . ($fromName !== '' ? ' (' . $fromName . ')' : '');
  if ($fromRole === 'program_chair' && $forwardedBy !== '' && in_array($status, ['pending_admin', 'done', 'sent_back'], true)) {
    $title = 'From Dean (' . $forwardedBy . '), forwarded from Program Chair' . ($fromName !== '' ? ' (' . $fromName . ')' : '');
  }
  $created = (string) ($row['created_at'] ?? '');
  $ts = $created !== '' ? strtotime($created) : false;
  return [
    'id' => (int) ($row['request_id'] ?? 0),
    'fromRole' => $fromRole,
    'fromName' => $fromName,
    'collegeName' => $college,
    'body' => (string) ($row['body'] ?? ''),
    'classLabel' => trim((string) ($row['class_label'] ?? '')),
    'meetingLabel' => trim((string) ($row['meeting_label'] ?? '')),
    'changeKind' => trim((string) ($row['change_kind'] ?? '')),
    'requestedLabel' => trim((string) ($row['requested_label'] ?? '')),
    'topics' => request_topics_from_row($row),
    'topicLabels' => array_map(
      static function (string $key): string {
        return request_topic_catalog()[$key];
      },
      request_topics_from_row($row)
    ),
    'classes' => request_classes_from_row($row),
    'status' => $status,
    'statusLabel' => text_request_status_label($status),
    'forwardedByName' => $forwardedBy,
    'holdNote' => trim((string) ($row['hold_note'] ?? '')),
    'forwardNote' => trim((string) ($row['forward_note'] ?? '')),
    'adminReply' => trim((string) ($row['admin_reply'] ?? '')),
    'title' => $title,
    'at' => $ts ? date('c', $ts) : $created,
    'atLabel' => $ts ? date('M j, Y g:i A', $ts) : $created,
    'canForward' => $viewerRole === 'dean' && $status === 'pending_dean',
  ];
}

function list_text_schedule_requests(PDO $pdo): array
{
  if (!schema_table_exists($pdo, 'text_schedule_requests')) {
    return [];
  }
  $user = session_db_user($pdo);
  if (!$user) {
    return [];
  }
  $role = (string) ($user['role'] ?? '');
  $sql = 'SELECT * FROM text_schedule_requests';
  $args = [];
  if ($role === 'admin' || $role === 'super_admin') {
    $sql .= " WHERE status IN ('pending_admin','done','sent_back') AND (from_role = 'dean' OR (from_role = 'program_chair' AND forwarded_by_name IS NOT NULL AND forwarded_by_name <> ''))";
  } elseif ($role === 'dean') {
    $sql .= ' WHERE from_user_id = ? OR (from_role = \'program_chair\' AND college_id <=> ?)';
    $args = [(int) $user['user_id'], $user['college_id'] !== null ? (int) $user['college_id'] : null];
  } elseif ($role === 'program_chair') {
    $sql .= ' WHERE from_user_id = ?';
    $args = [(int) $user['user_id']];
  } else {
    return [];
  }
  $sql .= ' ORDER BY created_at DESC, request_id DESC LIMIT 200';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($args);
  $out = [];
  foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $out[] = public_text_schedule_request($row, $role);
  }
  return $out;
}

function create_text_schedule_request(PDO $pdo, array $input): array
{
  $user = session_db_user($pdo);
  if (!$user) {
    throw new RuntimeException('Sign in to send a request.');
  }
  $role = (string) ($user['role'] ?? '');
  if ($role !== 'dean' && $role !== 'program_chair') {
    throw new RuntimeException('Only a Dean or Program Chair can send this request.');
  }
  $body = trim((string) ($input['body'] ?? ''));
  if ($body === '') {
    throw new RuntimeException('Describe the change.');
  }
  if (strlen($body) > 4000) {
    throw new RuntimeException('Keep the request under 4000 characters.');
  }
  $catalog = request_topic_catalog();
  $topicInput = $input['topics'] ?? [];
  if (!is_array($topicInput)) {
    $topicInput = [$topicInput];
  }
  $topics = [];
  foreach ($topicInput as $key) {
    $key = trim((string) $key);
    if ($key === '' || isset($topics[$key])) {
      continue;
    }
    if (!isset($catalog[$key])) {
      throw new RuntimeException('Choose a topic from the list.');
    }
    $topics[$key] = true;
  }
  if (!$topics) {
    throw new RuntimeException('Choose at least one topic.');
  }
  $allowed = [];
  foreach (request_class_choices($pdo) as $choice) {
    $allowed[$choice['id']] = $choice;
  }
  $classInput = $input['classIds'] ?? [];
  if (!is_array($classInput)) {
    $classInput = [$classInput];
  }
  $picked = [];
  foreach ($classInput as $classId) {
    $classId = trim((string) $classId);
    if ($classId === '' || isset($picked[$classId])) {
      continue;
    }
    if (!isset($allowed[$classId])) {
      throw new RuntimeException('Choose classes from the published timetable.');
    }
    $picked[$classId] = [
      'id' => $allowed[$classId]['id'],
      'label' => $allowed[$classId]['label'],
      'meeting' => $allowed[$classId]['meeting'],
    ];
  }
  if (!$picked) {
    throw new RuntimeException('Choose at least one class.');
  }
  if (count($picked) > 200) {
    throw new RuntimeException('Keep a request to 200 classes.');
  }
  $collegeId = $user['college_id'] !== null ? (int) $user['college_id'] : null;
  if (!$collegeId) {
    throw new RuntimeException('Your account is not assigned to a college. Ask Super Admin to set that first.');
  }
  $status = $role === 'dean' ? 'pending_admin' : 'pending_dean';
  $pdo->prepare(
    'INSERT INTO text_schedule_requests
     (from_role, from_user_id, from_name, college_id, college_name, body, topics, classes_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )->execute([
    $role,
    (int) $user['user_id'],
    (string) $user['full_name'],
    $collegeId,
    $user['college_name'] !== null ? (string) $user['college_name'] : null,
    $body,
    json_encode(array_keys($topics), JSON_UNESCAPED_UNICODE),
    json_encode(array_values($picked), JSON_UNESCAPED_UNICODE),
    $status,
  ]);
  $name = (string) $user['full_name'];
  $collegeName = (string) ($user['college_name'] ?? 'their college');
  if ($role === 'program_chair') {
    notify_roles(
      $pdo,
      ['dean'],
      'text_request',
      'Program Chair sent a schedule request',
      $name . ' sent a schedule-change request for ' . $collegeName . '.',
      'requests',
      'Requests',
      $collegeId
    );
  } else {
    notify_roles(
      $pdo,
      ['admin'],
      'text_request',
      'Dean sent a schedule request',
      $name . ' sent a schedule-change request for ' . $collegeName . '.',
      'requests',
      'Requests'
    );
  }
  return ['requests' => list_text_schedule_requests($pdo)];
}

function decide_text_schedule_request(PDO $pdo, int $id, bool $forward, string $note = ''): array
{
  $user = session_db_user($pdo);
  if (!$user || (string) ($user['role'] ?? '') !== 'dean') {
    throw new RuntimeException('Only a Dean can forward or hold a program chair request.');
  }
  if ($id < 1) {
    throw new RuntimeException('That request was not found.');
  }
  $stmt = $pdo->prepare('SELECT * FROM text_schedule_requests WHERE request_id = ?');
  $stmt->execute([$id]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$row || (string) ($row['from_role'] ?? '') !== 'program_chair' || (string) ($row['status'] ?? '') !== 'pending_dean') {
    throw new RuntimeException('There is no program chair request waiting for you.');
  }
  $deanCollege = $user['college_id'] !== null ? (int) $user['college_id'] : 0;
  if ((int) ($row['college_id'] ?? 0) !== $deanCollege) {
    throw new RuntimeException('That request belongs to another college.');
  }
  $note = trim($note);
  if (strlen($note) > 4000) {
    throw new RuntimeException('Keep the suggestion under 4000 characters.');
  }
  if ($forward) {
    $pdo->prepare(
      "UPDATE text_schedule_requests
       SET status = 'pending_admin', forwarded_by_name = ?, forwarded_at = NOW(), forward_note = ?
       WHERE request_id = ?"
    )->execute([(string) $user['full_name'], $note !== '' ? $note : null, $id]);
  } else {
    $pdo->prepare(
      "UPDATE text_schedule_requests
       SET status = 'held', forwarded_by_name = ?, forwarded_at = NOW(), hold_note = ?
       WHERE request_id = ?"
    )->execute([(string) $user['full_name'], $note !== '' ? $note : null, $id]);
  }
  $chairId = (int) ($row['from_user_id'] ?? 0);
  $collegeName = trim((string) ($row['college_name'] ?? ''));
  $deanName = (string) $user['full_name'];
  if ($forward) {
    notify_roles(
      $pdo,
      ['admin'],
      'text_forwarded',
      'Dean forwarded a schedule request',
      $deanName . ' forwarded a Program Chair request' . ($collegeName !== '' ? ' from ' . $collegeName : '') . '.',
      'requests',
      'Requests'
    );
    if ($chairId > 0) {
      notify_user_ids(
        $pdo,
        [$chairId],
        'text_forwarded',
        'Your request was forwarded to Admin',
        $deanName . ' forwarded your schedule-change request to Admin.',
        'requests',
        'Requests'
      );
    }
  } elseif ($chairId > 0) {
    $msg = $deanName . ' did not forward your schedule-change request.';
    $snip = notify_note_snippet($note);
    if ($snip !== '') {
      $msg .= ' Suggestion: ' . $snip;
    }
    notify_user_ids(
      $pdo,
      [$chairId],
      'text_held',
      'Dean did not forward your request',
      $msg,
      'requests',
      'Requests'
    );
  }
  return ['requests' => list_text_schedule_requests($pdo)];
}

function reply_text_schedule_request(PDO $pdo, int $id, bool $done, string $note): array
{
  $user = session_db_user($pdo);
  if (!$user) {
    throw new RuntimeException('Sign in to answer a request.');
  }
  $role = (string) ($user['role'] ?? '');
  if ($role !== 'admin' && $role !== 'super_admin') {
    throw new RuntimeException('Only Admin can close or send back a request.');
  }
  if ($id < 1) {
    throw new RuntimeException('That request was not found.');
  }
  $stmt = $pdo->prepare('SELECT * FROM text_schedule_requests WHERE request_id = ?');
  $stmt->execute([$id]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  $fromRole = (string) ($row['from_role'] ?? '');
  $forwarded = trim((string) ($row['forwarded_by_name'] ?? ''));
  $visible = $fromRole === 'dean' || ($fromRole === 'program_chair' && $forwarded !== '');
  if (!$row || (string) ($row['status'] ?? '') !== 'pending_admin' || !$visible) {
    throw new RuntimeException('That request is not waiting for Admin.');
  }
  $note = trim($note);
  if (strlen($note) > 4000) {
    throw new RuntimeException('Keep the reply under 4000 characters.');
  }
  $next = $done ? 'done' : 'sent_back';
  $pdo->prepare(
    'UPDATE text_schedule_requests
     SET status = ?, admin_reply = ?, replied_at = NOW()
     WHERE request_id = ?'
  )->execute([$next, $note !== '' ? $note : null, $id]);
  $actor = (string) ($user['full_name'] ?? 'Admin');
  $labels = [];
  foreach (request_classes_from_row($row) as $class) {
    if ($class['label'] !== '') {
      $labels[] = $class['label'];
    }
  }
  $about = '';
  if ($labels) {
    $about = ' about ' . implode('; ', array_slice($labels, 0, 2));
    if (count($labels) > 2) {
      $about .= ' and ' . (count($labels) - 2) . ' more';
    }
  }
  $title = $done ? 'Admin marked your request done' : 'Admin sent your request back';
  $msg = $done
    ? $actor . ' marked your schedule-change request' . $about . ' as done. The timetable itself was not changed.'
    : $actor . ' sent your schedule-change request' . $about . ' back.';
  $snip = notify_note_snippet($note);
  if ($snip !== '') {
    $msg .= ' Reply: ' . $snip;
  }
  $fromUser = (int) ($row['from_user_id'] ?? 0);
  if ($fromUser > 0) {
    notify_user_ids($pdo, [$fromUser], 'text_reply', $title, $msg, 'requests', 'Requests');
  }
  if ($fromRole === 'program_chair') {
    $collegeId = (int) ($row['college_id'] ?? 0);
    $deanIds = $collegeId > 0 ? user_ids_by_role($pdo, 'dean', $collegeId) : [];
    if ($deanIds) {
      notify_user_ids(
        $pdo,
        $deanIds,
        'text_reply',
        $done ? 'Admin marked a forwarded request done' : 'Admin sent a forwarded request back',
        $msg,
        'requests',
        'Requests'
      );
    }
  }
  return ['requests' => list_text_schedule_requests($pdo)];
}

function ensure_notifications_schema(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'users')) {
    return;
  }
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS user_notifications (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
}

function notification_href_for_role(string $role, string $page): string
{
  $folder = [
    'super_admin' => 'super-admin',
    'admin' => 'admin',
    'vpaa' => 'viewing-with-approval',
    'dean' => 'viewing',
    'program_chair' => 'viewing-program-head',
  ][$role] ?? '';
  if ($folder === '') {
    return 'index.html';
  }
  if ($page === 'final-report' || strpos($page, 'final-report') === 0) {
    $query = '';
    $qPos = strpos($page, '?');
    if ($qPos !== false) {
      $query = substr($page, $qPos);
    }
    return $folder . '/final-report.html' . $query;
  }
  if ($role === 'vpaa' || $role === 'dean' || $role === 'program_chair') {
    return $folder . '/viewer-requests.html';
  }
  return $folder . '/requests.html';
}

function notify_note_snippet(string $note): string
{
  $note = trim($note);
  if ($note === '') {
    return '';
  }
  if (function_exists('mb_strlen') && mb_strlen($note) > 140) {
    return mb_substr($note, 0, 140) . '…';
  }
  if (strlen($note) > 140) {
    return substr($note, 0, 140) . '…';
  }
  return $note;
}

function user_ids_by_role(PDO $pdo, string $role, ?int $collegeId = null): array
{
  if (!schema_table_exists($pdo, 'users')) {
    return [];
  }
  if ($collegeId) {
    $stmt = $pdo->prepare(
      'SELECT user_id FROM users WHERE role = ? AND is_active = 1 AND college_id = ?'
    );
    $stmt->execute([$role, $collegeId]);
  } else {
    $stmt = $pdo->prepare('SELECT user_id FROM users WHERE role = ? AND is_active = 1');
    $stmt->execute([$role]);
  }
  $ids = [];
  foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) {
    $ids[] = (int) $id;
  }
  return $ids;
}

function notify_user_ids(
  PDO $pdo,
  array $userIds,
  string $kind,
  string $title,
  string $body,
  string $page,
  string $badge,
  ?int $exceptUserId = null
): void {
  try {
    ensure_notifications_schema($pdo);
    if (!schema_table_exists($pdo, 'user_notifications')) {
      return;
    }
    $exceptUserId = $exceptUserId ?? current_session_user_id();
    $seen = [];
    $stmt = $pdo->prepare(
      'INSERT INTO user_notifications (user_id, kind, title, body, page, badge)
       VALUES (?, ?, ?, ?, ?, ?)'
    );
    $active = $pdo->prepare('SELECT 1 FROM users WHERE user_id = ? AND is_active = 1');
    foreach ($userIds as $uid) {
      $uid = (int) $uid;
      if ($uid < 1 || ($exceptUserId && $uid === $exceptUserId) || isset($seen[$uid])) {
        continue;
      }
      $active->execute([$uid]);
      if (!$active->fetchColumn()) {
        continue;
      }
      $seen[$uid] = true;
      $stmt->execute([$uid, $kind, $title, $body, $page, $badge]);
    }
  } catch (Throwable $e) {
    // A notify failure must not block the send, approval, or send-back itself.
  }
}

function notify_roles(
  PDO $pdo,
  array $roles,
  string $kind,
  string $title,
  string $body,
  string $page,
  string $badge,
  ?int $collegeId = null
): void {
  $ids = [];
  foreach ($roles as $role) {
    foreach (user_ids_by_role($pdo, (string) $role, $collegeId) as $id) {
      $ids[] = $id;
    }
  }
  notify_user_ids($pdo, $ids, $kind, $title, $body, $page, $badge);
}

function list_user_notifications(PDO $pdo): array
{
  ensure_notifications_schema($pdo);
  $userId = current_session_user_id();
  if (!$userId || !schema_table_exists($pdo, 'user_notifications')) {
    return ['notifications' => [], 'unreadCount' => 0];
  }
  $roleRow = session_db_user($pdo);
  $role = is_array($roleRow) ? (string) ($roleRow['role'] ?? '') : '';
  $stmt = $pdo->prepare(
    'SELECT notification_id, kind, title, body, page, badge, is_read, created_at
     FROM user_notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, notification_id DESC
     LIMIT 50'
  );
  $stmt->execute([$userId]);
  $unreadStmt = $pdo->prepare(
    'SELECT COUNT(*) FROM user_notifications WHERE user_id = ? AND is_read = 0'
  );
  $unreadStmt->execute([$userId]);
  $unread = (int) $unreadStmt->fetchColumn();
  $out = [];
  foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $created = (string) ($row['created_at'] ?? '');
    $ts = $created !== '' ? strtotime($created) : false;
    $isRead = (int) ($row['is_read'] ?? 0) === 1;
    $out[] = [
      'id' => (int) $row['notification_id'],
      'kind' => $row['kind'] ?? '',
      'title' => $row['title'] ?? '',
      'body' => $row['body'] ?? '',
      'href' => notification_href_for_role($role, (string) ($row['page'] ?? 'requests')),
      'badge' => $row['badge'] ?? 'Requests',
      'isRead' => $isRead,
      'at' => $ts ? date('c', $ts) : $created,
      'atLabel' => $ts ? date('M j, Y g:i A', $ts) : $created,
    ];
  }
  return ['notifications' => $out, 'unreadCount' => $unread];
}

function mark_user_notification_read(PDO $pdo, int $id): array
{
  $userId = current_session_user_id();
  if (!$userId || !schema_table_exists($pdo, 'user_notifications')) {
    return list_user_notifications($pdo);
  }
  if ($id > 0) {
    $pdo->prepare(
      'UPDATE user_notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?'
    )->execute([$id, $userId]);
  } else {
    $pdo->prepare('UPDATE user_notifications SET is_read = 1 WHERE user_id = ?')->execute([$userId]);
  }
  return list_user_notifications($pdo);
}

/**
 * A department sits under a college and owns one or more programs.
 * Existing program rows become a department of the same name plus that program,
 * so curricula and sections keep their program_id.
 */
function ensure_department_program_split(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'colleges') || !schema_table_exists($pdo, 'programs')) {
    return;
  }
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS departments (
      department_id INT PRIMARY KEY AUTO_INCREMENT,
      college_id INT NOT NULL,
      department_code VARCHAR(30) NOT NULL,
      department_name VARCHAR(255) NOT NULL,
      archived_label VARCHAR(40) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_departments_code (department_code),
      KEY idx_departments_college (college_id),
      CONSTRAINT fk_departments_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  if (!schema_column_exists($pdo, 'programs', 'department_id')) {
    $pdo->exec('ALTER TABLE programs ADD COLUMN department_id INT NULL AFTER college_id');
  }
  $fk = $pdo->query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'programs' AND CONSTRAINT_NAME = 'fk_programs_department'"
  )->fetch();
  if (!$fk) {
    $pdo->exec(
      'ALTER TABLE programs ADD CONSTRAINT fk_programs_department
       FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL'
    );
  }
  $pending = $pdo->query(
    'SELECT program_id, college_id, program_code, program_name, is_active, archived_label
     FROM programs WHERE department_id IS NULL'
  )->fetchAll();
  $insDept = $pdo->prepare(
    'INSERT INTO departments (college_id, department_code, department_name, archived_label, is_active)
     VALUES (?, ?, ?, ?, ?)'
  );
  $linkProg = $pdo->prepare('UPDATE programs SET department_id = ? WHERE program_id = ?');
  foreach ($pending as $p) {
    $code = unique_code(
      $pdo,
      'departments',
      'department_code',
      'D' . (string) $p['program_code'],
      null,
      'department_id'
    );
    $insDept->execute([
      (int) $p['college_id'],
      $code,
      (string) $p['program_name'],
      $p['archived_label'] !== null && $p['archived_label'] !== '' ? (string) $p['archived_label'] : null,
      (int) $p['is_active'] === 1 ? 1 : 0,
    ]);
    $linkProg->execute([(int) $pdo->lastInsertId(), (int) $p['program_id']]);
  }
  if (!schema_table_exists($pdo, 'users')) {
    return;
  }
  if (!schema_column_exists($pdo, 'users', 'department_id')) {
    $pdo->exec('ALTER TABLE users ADD COLUMN department_id INT NULL AFTER college_id');
  }
  $userFk = $pdo->query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND CONSTRAINT_NAME = 'fk_users_department'"
  )->fetch();
  if (!$userFk) {
    $pdo->exec(
      'ALTER TABLE users ADD CONSTRAINT fk_users_department
       FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL'
    );
  }
  if (!schema_table_exists($pdo, 'user_programs')) {
    return;
  }
  $chairs = $pdo->query(
    "SELECT user_id FROM users WHERE role = 'program_chair' AND department_id IS NULL"
  )->fetchAll();
  $firstDept = $pdo->prepare(
    'SELECT p.department_id
     FROM user_programs up
     JOIN programs p ON p.program_id = up.program_id
     WHERE up.user_id = ? AND p.department_id IS NOT NULL
     ORDER BY p.program_id
     LIMIT 1'
  );
  $taken = $pdo->prepare(
    "SELECT user_id FROM users
     WHERE role = 'program_chair' AND department_id = ? AND user_id <> ?
     LIMIT 1"
  );
  $setDept = $pdo->prepare('UPDATE users SET department_id = ? WHERE user_id = ?');
  foreach ($chairs as $chair) {
    $uid = (int) $chair['user_id'];
    $firstDept->execute([$uid]);
    $deptId = $firstDept->fetchColumn();
    if (!$deptId) {
      continue;
    }
    $taken->execute([(int) $deptId, $uid]);
    if ($taken->fetch()) {
      continue;
    }
    $setDept->execute([(int) $deptId, $uid]);
  }
}

function ensure_users_schema(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'colleges') || !schema_table_exists($pdo, 'programs')) {
    return;
  }
  ensure_department_program_split($pdo);
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS users (
      user_id INT PRIMARY KEY AUTO_INCREMENT,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('super_admin','admin','vpaa','dean','program_chair') NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      college_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email),
      KEY idx_users_role (role),
      KEY idx_users_college (college_id),
      CONSTRAINT fk_users_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS user_programs (
      user_id INT NOT NULL,
      program_id INT NOT NULL,
      PRIMARY KEY (user_id, program_id),
      CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      CONSTRAINT fk_up_program FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
  seed_demo_users($pdo);
  ensure_department_program_split($pdo);
  ensure_notifications_schema($pdo);
}

function seed_demo_users(PDO $pdo): void
{
  $casId = null;
  $stmt = $pdo->query(
    "SELECT college_id FROM colleges
     WHERE is_active = 1 AND college_name LIKE '%Arts%'
     ORDER BY college_id LIMIT 1"
  );
  $row = $stmt ? $stmt->fetch() : false;
  if ($row) {
    $casId = (int) $row['college_id'];
  }

  $chairPrograms = [];
  if ($casId) {
    $prog = $pdo->prepare(
      "SELECT program_id FROM programs
       WHERE college_id = ? AND represents_college = 0 AND is_active = 1
         AND program_name IN ('Computer Science', 'Information Technology', 'EMC')"
    );
    $prog->execute([$casId]);
    foreach ($prog->fetchAll() as $p) {
      $chairPrograms[] = (int) $p['program_id'];
    }
  }

  $demos = [
    ['Ryan Registrar', 'admin@gmail.com', '12345', 'super_admin', null, []],
    ['Records Officer', 'admin2@gmail.com', '123452', 'admin', null, []],
    ['VPAA Viewer', 'viewing2@gmail.com', 'qwerty2', 'vpaa', null, []],
    ['CAS Dean', 'viewing@gmail.com', 'qwerty', 'dean', $casId, []],
    ['CS / IT / EMC Chair', 'viewingph@gmail.com', 'asdfg', 'program_chair', $casId, $chairPrograms],
  ];

  $find = $pdo->prepare('SELECT user_id FROM users WHERE email = ? LIMIT 1');
  $ins = $pdo->prepare(
    'INSERT INTO users (full_name, email, password_hash, role, is_active, college_id)
     VALUES (?, ?, ?, ?, 1, ?)'
  );
  $link = $pdo->prepare('INSERT IGNORE INTO user_programs (user_id, program_id) VALUES (?, ?)');

  foreach ($demos as $demo) {
    [$name, $email, $password, $role, $collegeId, $programIds] = $demo;
    if ($role === 'dean' && !$collegeId) {
      continue;
    }
    if ($role === 'program_chair' && (!$collegeId || !$programIds)) {
      continue;
    }
    $find->execute([$email]);
    $existing = $find->fetch();
    if ($existing) {
      continue;
    }
    $ins->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT), $role, $collegeId]);
    $uid = (int) $pdo->lastInsertId();
    foreach ($programIds as $pid) {
      $link->execute([$uid, $pid]);
    }
  }
}
