<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_users_schema($pdo);
ensure_faculty_loading_schema($pdo);

$me = session_user_payload($pdo);
if (!$me) {
  json_error('Log in to open faculty loading.', 401);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok([
    'actor' => actor_view($pdo, $me),
    'documents' => visible_documents($pdo, $me),
  ]);
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? '');
  try {
    $pdo->beginTransaction();
    if ($action === 'save') {
      $doc = save_document($pdo, $me, $body);
    } elseif ($action === 'clear') {
      $pdo->exec('DELETE FROM faculty_loadings');
      $doc = null;
    } elseif (in_array($action, ['submit', 'approve', 'verify', 'accept', 'return'], true)) {
      $doc = move_document($pdo, $me, $action, $body);
    } else {
      throw new RuntimeException('Unknown faculty loading action.');
    }
    $pdo->commit();
    json_ok([
      'actor' => actor_view($pdo, $me),
      'document' => $doc,
      'documents' => visible_documents($pdo, $me),
    ]);
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);

function ensure_faculty_loading_schema(PDO $pdo): void
{
  if (!schema_table_exists($pdo, 'colleges') || !schema_table_exists($pdo, 'departments')) {
    return;
  }
  $pdo->exec(
    "CREATE TABLE IF NOT EXISTS faculty_loadings (
      loading_id INT PRIMARY KEY AUTO_INCREMENT,
      college_id INT NOT NULL,
      department_id INT NULL,
      school_year VARCHAR(9) NOT NULL,
      term_code ENUM('1','2','summer') NOT NULL,
      status ENUM('draft','pending_dean','pending_registrar','pending_vpaa','accepted') NOT NULL DEFAULT 'draft',
      faculty_json LONGTEXT NOT NULL,
      rows_json LONGTEXT NOT NULL,
      history_json LONGTEXT NOT NULL,
      dept_key INT GENERATED ALWAYS AS (IFNULL(department_id, 0)) STORED,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_fl_college FOREIGN KEY (college_id) REFERENCES colleges(college_id) ON DELETE CASCADE,
      CONSTRAINT fk_fl_department FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE,
      UNIQUE KEY uq_faculty_loading (college_id, dept_key, school_year, term_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
  );
}

function actor_view(PDO $pdo, array $me): array
{
  $collegeId = parse_id((string) ($me['collegeId'] ?? ''), 'c');
  $hasDepartments = false;
  if ($collegeId) {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM departments WHERE college_id = ? AND is_active = 1');
    $stmt->execute([$collegeId]);
    $hasDepartments = (int) $stmt->fetchColumn() > 0;
  }
  $role = (string) $me['role'];
  $creates = null;
  if ($role === 'program_chair' && !empty($me['departmentId'])) {
    $creates = 'department';
  } elseif ($role === 'dean' && $collegeId && !$hasDepartments) {
    $creates = 'college';
  }
  return [
    'role' => $role,
    'roleLabel' => (string) ($me['roleLabel'] ?? $role),
    'name' => (string) $me['name'],
    'collegeId' => $me['collegeId'] ?? null,
    'collegeName' => $me['collegeName'] ?? null,
    'departmentId' => $me['departmentId'] ?? null,
    'departmentName' => $me['departmentName'] ?? null,
    'hasDepartments' => $hasDepartments,
    'creates' => $creates,
  ];
}

function visible_documents(PDO $pdo, array $me): array
{
  $sql = 'SELECT f.loading_id, f.college_id, f.department_id, f.school_year, f.term_code, f.status,
            f.faculty_json, f.rows_json, f.history_json, c.college_name, d.department_name
     FROM faculty_loadings f
     JOIN colleges c ON c.college_id = f.college_id
     LEFT JOIN departments d ON d.department_id = f.department_id';
  $params = [];
  $role = (string) $me['role'];
  if ($role === 'program_chair') {
    $deptId = parse_id((string) ($me['departmentId'] ?? ''), 'dept');
    if (!$deptId) {
      return [];
    }
    $sql .= ' WHERE f.department_id = ?';
    $params[] = $deptId;
  } elseif ($role === 'dean') {
    $collegeId = parse_id((string) ($me['collegeId'] ?? ''), 'c');
    if (!$collegeId) {
      return [];
    }
    $sql .= ' WHERE f.college_id = ?';
    $params[] = $collegeId;
  }
  $sql .= ' ORDER BY c.college_name, d.department_name, f.school_year, f.term_code';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $out = [];
  foreach ($stmt->fetchAll() as $row) {
    $out[] = present_document($row);
  }
  return $out;
}

function present_document(array $row): array
{
  $faculty = json_decode((string) $row['faculty_json'], true);
  $rows = json_decode((string) $row['rows_json'], true);
  $history = json_decode((string) $row['history_json'], true);
  $deptId = $row['department_id'] !== null ? (int) $row['department_id'] : 0;
  return [
    'id' => public_id('fld', (int) $row['loading_id']),
    'collegeId' => public_id('c', (int) $row['college_id']),
    'collegeName' => (string) $row['college_name'],
    'departmentId' => $deptId > 0 ? public_id('dept', $deptId) : null,
    'departmentName' => $deptId > 0 ? (string) ($row['department_name'] ?? '') : null,
    'schoolYear' => (string) $row['school_year'],
    'termCode' => (string) $row['term_code'],
    'status' => (string) $row['status'],
    'faculty' => is_array($faculty) ? $faculty : [],
    'rows' => is_array($rows) ? $rows : [],
    'history' => is_array($history) ? $history : [],
  ];
}

function save_document(PDO $pdo, array $me, array $body): array
{
  $term = term_from_body($body);
  $scope = creator_scope($pdo, $me);
  $people = clean_faculty(is_array($body['faculty'] ?? null) ? $body['faculty'] : []);
  $rows = clean_rows(is_array($body['rows'] ?? null) ? $body['rows'] : [], $people);
  $existing = find_document($pdo, $scope['collegeId'], $scope['departmentId'], $term['schoolYear'], $term['termCode']);
  if ($existing && (string) $existing['status'] !== 'draft') {
    throw new RuntimeException('This faculty loading can no longer be edited.');
  }
  $facultyJson = json_encode($people, JSON_UNESCAPED_UNICODE);
  $rowsJson = json_encode($rows, JSON_UNESCAPED_UNICODE);
  if ($existing) {
    $pdo->prepare('UPDATE faculty_loadings SET faculty_json = ?, rows_json = ? WHERE loading_id = ?')
      ->execute([$facultyJson, $rowsJson, (int) $existing['loading_id']]);
    $id = (int) $existing['loading_id'];
  } else {
    $history = json_encode([history_entry($me, 'Started the faculty loading', '')], JSON_UNESCAPED_UNICODE);
    $pdo->prepare(
      'INSERT INTO faculty_loadings (college_id, department_id, school_year, term_code, status, faculty_json, rows_json, history_json)
       VALUES (?, ?, ?, ?, \'draft\', ?, ?, ?)'
    )->execute([
      $scope['collegeId'],
      $scope['departmentId'],
      $term['schoolYear'],
      $term['termCode'],
      $facultyJson,
      $rowsJson,
      $history,
    ]);
    $id = (int) $pdo->lastInsertId();
  }
  return load_document($pdo, $id);
}

function move_document(PDO $pdo, array $me, string $action, array $body): array
{
  $id = parse_id((string) ($body['id'] ?? ''), 'fld');
  if (!$id) {
    throw new RuntimeException('That faculty loading was not found.');
  }
  $row = load_raw($pdo, $id);
  if (!$row) {
    throw new RuntimeException('That faculty loading was not found.');
  }
  assert_can_see($me, $row);
  $status = (string) $row['status'];
  $role = (string) $me['role'];
  $collegeLevel = $row['department_id'] === null;
  $note = trim(preg_replace('/\s+/', ' ', (string) ($body['note'] ?? '')) ?? '');
  if (strlen($note) > 240) {
    $note = substr($note, 0, 240);
  }
  $next = '';
  $label = '';
  if ($action === 'submit' && $status === 'draft') {
    $people = json_decode((string) $row['faculty_json'], true);
    if (!is_array($people) || count($people) < 1) {
      throw new RuntimeException('Add at least one faculty member before sending this on.');
    }
    if ($role === 'program_chair' && !$collegeLevel && same_department($me, $row)) {
      $next = 'pending_dean';
      $label = 'Submitted to the Dean';
    } elseif ($role === 'dean' && $collegeLevel && same_college($me, $row)) {
      $next = 'pending_registrar';
      $label = 'Submitted to the Registrar';
    }
  } elseif ($action === 'approve' && $status === 'pending_dean' && $role === 'dean' && same_college($me, $row)) {
    $next = 'pending_registrar';
    $label = 'Approved by the Dean';
  } elseif ($action === 'verify' && $status === 'pending_registrar' && is_registrar($role)) {
    $next = 'pending_vpaa';
    $label = 'Verified by the Registrar';
  } elseif ($action === 'accept' && $status === 'pending_vpaa' && $role === 'vpaa') {
    $next = 'accepted';
    $label = 'Accepted by the VPAA';
  } elseif ($action === 'return') {
    if ($status === 'pending_dean' && $role === 'dean' && same_college($me, $row)) {
      $next = 'draft';
      $label = 'Returned to the Program Chair';
    } elseif ($status === 'pending_registrar' && is_registrar($role)) {
      $next = $collegeLevel ? 'draft' : 'pending_dean';
      $label = $collegeLevel ? 'Returned to the Dean' : 'Returned to the Dean';
    } elseif ($status === 'pending_vpaa' && $role === 'vpaa') {
      $next = 'pending_registrar';
      $label = 'Returned to the Registrar';
    }
  }
  if ($next === '') {
    throw new RuntimeException('That step is not yours to take.');
  }
  $history = json_decode((string) $row['history_json'], true);
  if (!is_array($history)) {
    $history = [];
  }
  $history[] = history_entry($me, $label, $note);
  $pdo->prepare('UPDATE faculty_loadings SET status = ?, history_json = ? WHERE loading_id = ?')
    ->execute([$next, json_encode($history, JSON_UNESCAPED_UNICODE), $id]);
  return load_document($pdo, $id);
}

function creator_scope(PDO $pdo, array $me): array
{
  $role = (string) $me['role'];
  if ($role === 'program_chair') {
    $deptId = parse_id((string) ($me['departmentId'] ?? ''), 'dept');
    if (!$deptId) {
      throw new RuntimeException('Your account is not assigned to a department.');
    }
    $stmt = $pdo->prepare('SELECT college_id FROM departments WHERE department_id = ? AND is_active = 1');
    $stmt->execute([$deptId]);
    $collegeId = (int) $stmt->fetchColumn();
    if ($collegeId < 1) {
      throw new RuntimeException('Your department is not active.');
    }
    return ['collegeId' => $collegeId, 'departmentId' => $deptId];
  }
  if ($role === 'dean') {
    $collegeId = parse_id((string) ($me['collegeId'] ?? ''), 'c');
    if (!$collegeId) {
      throw new RuntimeException('Your account is not assigned to a college.');
    }
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM departments WHERE college_id = ? AND is_active = 1');
    $stmt->execute([$collegeId]);
    if ((int) $stmt->fetchColumn() > 0) {
      throw new RuntimeException('Program Chairs prepare faculty loading for the departments in this college.');
    }
    return ['collegeId' => $collegeId, 'departmentId' => null];
  }
  throw new RuntimeException('Only a Program Chair or a Dean prepares faculty loading.');
}

function term_from_body(array $body): array
{
  $year = trim((string) ($body['schoolYear'] ?? ''));
  $code = (string) ($body['termCode'] ?? '');
  if (!preg_match('/^\d{4}-\d{4}$/', $year)) {
    throw new RuntimeException('Choose an academic year.');
  }
  if (!in_array($code, ['1', '2', 'summer'], true)) {
    throw new RuntimeException('Choose a semester.');
  }
  return ['schoolYear' => $year, 'termCode' => $code];
}

function clean_faculty(array $faculty): array
{
  $out = [];
  $seen = [];
  foreach ($faculty as $person) {
    if (!is_array($person)) {
      continue;
    }
    $name = trim(preg_replace('/\s+/', ' ', (string) ($person['name'] ?? '')) ?? '');
    if ($name === '') {
      continue;
    }
    $key = strtolower($name);
    if (isset($seen[$key])) {
      continue;
    }
    $seen[$key] = true;
    $id = (string) ($person['id'] ?? '');
    if (!preg_match('/^fl-[a-z0-9-]{4,40}$/', $id)) {
      $id = 'fl-' . bin2hex(random_bytes(4));
    }
    $out[] = ['id' => $id, 'name' => $name];
  }
  return $out;
}

function clean_rows(array $rows, array $faculty): array
{
  $ids = [];
  foreach ($faculty as $person) {
    $ids[$person['id']] = true;
  }
  $out = [];
  foreach ($rows as $row) {
    if (!is_array($row)) {
      continue;
    }
    $facultyId = (string) ($row['facultyId'] ?? '');
    if (!isset($ids[$facultyId])) {
      continue;
    }
    $subject = trim(preg_replace('/\s+/', ' ', (string) ($row['subject'] ?? '')) ?? '');
    if ($subject === '') {
      continue;
    }
    $students = (int) ($row['students'] ?? 0);
    if ($students < 0) {
      $students = 0;
    }
    $id = (string) ($row['id'] ?? '');
    if (!preg_match('/^flr-[a-z0-9-]{4,40}$/', $id)) {
      $id = 'flr-' . bin2hex(random_bytes(4));
    }
    $out[] = [
      'id' => $id,
      'facultyId' => $facultyId,
      'room' => trim(preg_replace('/\s+/', ' ', (string) ($row['room'] ?? '')) ?? ''),
      'section' => trim(preg_replace('/\s+/', ' ', (string) ($row['section'] ?? '')) ?? ''),
      'subject' => $subject,
      'students' => $students,
    ];
  }
  return $out;
}

function find_document(PDO $pdo, int $collegeId, ?int $departmentId, string $year, string $code): ?array
{
  $stmt = $pdo->prepare(
    'SELECT loading_id, status FROM faculty_loadings
     WHERE college_id = ? AND IFNULL(department_id, 0) = ? AND school_year = ? AND term_code = ?'
  );
  $stmt->execute([$collegeId, $departmentId ?? 0, $year, $code]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function load_raw(PDO $pdo, int $id): ?array
{
  $stmt = $pdo->prepare('SELECT * FROM faculty_loadings WHERE loading_id = ?');
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function load_document(PDO $pdo, int $id): array
{
  $stmt = $pdo->prepare(
    'SELECT f.loading_id, f.college_id, f.department_id, f.school_year, f.term_code, f.status,
            f.faculty_json, f.rows_json, f.history_json, c.college_name, d.department_name
     FROM faculty_loadings f
     JOIN colleges c ON c.college_id = f.college_id
     LEFT JOIN departments d ON d.department_id = f.department_id
     WHERE f.loading_id = ?'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  if (!$row) {
    throw new RuntimeException('That faculty loading was not found.');
  }
  return present_document($row);
}

function assert_can_see(array $me, array $row): void
{
  $role = (string) $me['role'];
  if ($role === 'program_chair' && !same_department($me, $row)) {
    throw new RuntimeException('That faculty loading is outside your department.');
  }
  if ($role === 'dean' && !same_college($me, $row)) {
    throw new RuntimeException('That faculty loading is outside your college.');
  }
}

function same_college(array $me, array $row): bool
{
  $collegeId = parse_id((string) ($me['collegeId'] ?? ''), 'c');
  return $collegeId && $collegeId === (int) $row['college_id'];
}

function same_department(array $me, array $row): bool
{
  $deptId = parse_id((string) ($me['departmentId'] ?? ''), 'dept');
  return $deptId && $row['department_id'] !== null && $deptId === (int) $row['department_id'];
}

function is_registrar(string $role): bool
{
  return $role === 'admin' || $role === 'super_admin';
}

function history_entry(array $me, string $action, string $note): array
{
  return [
    'at' => date('c'),
    'name' => (string) $me['name'],
    'role' => (string) $me['role'],
    'action' => $action,
    'note' => $note,
  ];
}
