<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$pdo = db();
ensure_department_program_split($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  json_ok(['org' => org_document($pdo)]);
}

if ($method === 'PUT') {
  $body = json_input();
  try {
    $pdo->beginTransaction();
    sync_org($pdo, $body);
    $pdo->commit();
    json_ok(['org' => org_document($pdo)]);
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

if ($method === 'POST') {
  $body = json_input();
  $action = (string) ($body['action'] ?? $_GET['action'] ?? '');
  try {
    $pdo->beginTransaction();
    if ($action === 'addCollege') {
      $college = add_college($pdo, (string) ($body['name'] ?? ''), (string) ($body['code'] ?? ''), !empty($body['useDepartments']));
      $pdo->commit();
      json_ok(['college' => $college, 'org' => org_document($pdo)]);
    }
    if ($action === 'addDepartment') {
      $dept = add_department($pdo, (string) ($body['collegeId'] ?? ''), (string) ($body['name'] ?? ''));
      $pdo->commit();
      json_ok(['department' => $dept, 'org' => org_document($pdo)]);
    }
    if ($action === 'addProgram') {
      $program = add_program(
        $pdo,
        (string) ($body['departmentId'] ?? ''),
        (string) ($body['name'] ?? '')
      );
      $pdo->commit();
      json_ok(['program' => $program, 'org' => org_document($pdo)]);
    }
    $pdo->rollBack();
    json_error('Unknown org action');
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    json_error($e->getMessage(), 400);
  }
}

json_error('Unsupported method', 405);

function org_document(PDO $pdo): array
{
  $colleges = $pdo->query(
    'SELECT college_id, college_code, college_name, use_departments, archived_label, is_active
     FROM colleges
     ORDER BY college_name'
  )->fetchAll();

  $departments = $pdo->query(
    'SELECT department_id, college_id, department_name, archived_label, is_active
     FROM departments
     ORDER BY department_name'
  )->fetchAll();
  $programs = $pdo->query(
    'SELECT program_id, college_id, department_id, program_code, program_name, represents_college, archived_label, is_active
     FROM programs
     ORDER BY program_name'
  )->fetchAll();

  $programsByDept = [];
  foreach ($programs as $p) {
    $deptId = (int) ($p['department_id'] ?? 0);
    if ($deptId < 1) {
      continue;
    }
    $programsByDept[$deptId][] = $p;
  }
  $deptsByCollege = [];
  foreach ($departments as $d) {
    $deptsByCollege[(int) $d['college_id']][] = $d;
  }

  $active = [];
  $archivedColleges = [];
  $archivedDeptOnly = [];
  $collegeIndex = [];

  foreach ($colleges as $c) {
    $cid = (int) $c['college_id'];
    $depts = [];
    foreach ($deptsByCollege[$cid] ?? [] as $d) {
      $did = (int) $d['department_id'];
      $plist = [];
      foreach ($programsByDept[$did] ?? [] as $p) {
        if ((int) $p['is_active'] !== 1) {
          continue;
        }
        $plist[] = [
          'id' => public_id('d', (int) $p['program_id']),
          'name' => $p['program_name'],
        ];
      }
      if ((int) $d['is_active'] === 1) {
        $depts[] = [
          'id' => public_id('dept', $did),
          'name' => $d['department_name'],
          'programs' => $plist,
        ];
      } elseif ((int) $c['is_active'] === 1) {
        $archivedDeptOnly[] = [
          'id' => public_id('dept', $did),
          'deptName' => $d['department_name'],
          'programs' => $plist,
          'parentCode' => $c['college_code'],
          'parentName' => $c['college_name'],
          'archivedLabel' => $d['archived_label'] ?: '',
        ];
      }
    }

    $row = [
      'id' => public_id('c', $cid),
      'name' => $c['college_name'],
      'code' => $c['college_code'],
      'useDepartments' => ((int) $c['use_departments'] === 1) || count($depts) > 0,
      'departments' => $depts,
    ];
    $collegeIndex[$cid] = $row;
    if ((int) $c['is_active'] === 1) {
      $active[] = $row;
    } else {
      $row['archivedLabel'] = $c['archived_label'] ?: '';
      $archivedColleges[] = $row;
    }
  }

  return [
    'active' => $active,
    'archivedColleges' => $archivedColleges,
    'archivedDeptOnly' => $archivedDeptOnly,
  ];
}

function add_college(PDO $pdo, string $name, string $code, bool $useDepartments): array
{
  $name = trim(preg_replace('/\s+/', ' ', $name) ?? '');
  if ($name === '') {
    throw new RuntimeException('Enter a name for the college.');
  }
  $stmt = $pdo->prepare('SELECT college_name FROM colleges WHERE college_name = ? LIMIT 1');
  $stmt->execute([$name]);
  if ($stmt->fetch()) {
    throw new RuntimeException('A college called "' . $name . '" already exists.');
  }
  $code = strtoupper(trim($code));
  if ($code === '') {
    $code = code_from_name($name);
  }
  $code = unique_code($pdo, 'colleges', 'college_code', $code, null, 'college_id');
  $ins = $pdo->prepare(
    'INSERT INTO colleges (college_code, college_name, use_departments, is_active) VALUES (?, ?, ?, 1)'
  );
  $ins->execute([$code, $name, $useDepartments ? 1 : 0]);
  $id = (int) $pdo->lastInsertId();
  if (!$useDepartments) {
    ensure_sole_program($pdo, $id, $name, $code);
  }
  return [
    'id' => public_id('c', $id),
    'name' => $name,
    'code' => $code,
    'useDepartments' => $useDepartments,
    'departments' => [],
  ];
}

function add_department(PDO $pdo, string $collegeId, string $name): array
{
  $name = trim(preg_replace('/\s+/', ' ', $name) ?? '');
  if ($name === '') {
    throw new RuntimeException('Enter a name for the department.');
  }
  $cid = parse_id($collegeId, 'c');
  if (!$cid) {
    throw new RuntimeException('Pick a college first.');
  }
  $col = $pdo->prepare('SELECT college_id, college_code, college_name FROM colleges WHERE college_id = ?');
  $col->execute([$cid]);
  $college = $col->fetch();
  if (!$college) {
    throw new RuntimeException('Pick a college first.');
  }
  $dup = $pdo->prepare(
    'SELECT department_name FROM departments WHERE college_id = ? AND department_name = ? AND is_active = 1 LIMIT 1'
  );
  $dup->execute([$cid, $name]);
  if ($dup->fetch()) {
    throw new RuntimeException('"' . $name . '" is already under this college.');
  }
  $pdo->prepare('UPDATE colleges SET use_departments = 1 WHERE college_id = ?')->execute([$cid]);
  $deptCode = unique_code(
    $pdo,
    'departments',
    'department_code',
    $college['college_code'] . '-' . code_from_name($name, 6),
    null,
    'department_id'
  );
  $insDept = $pdo->prepare(
    'INSERT INTO departments (college_id, department_code, department_name, is_active) VALUES (?, ?, ?, 1)'
  );
  $insDept->execute([$cid, $deptCode, $name]);
  $deptId = (int) $pdo->lastInsertId();
  $program = insert_program($pdo, $cid, $deptId, $name, (string) $college['college_code']);
  return [
    'id' => public_id('dept', $deptId),
    'name' => $name,
    'programs' => [$program],
  ];
}

function add_program(PDO $pdo, string $departmentId, string $name): array
{
  $name = trim(preg_replace('/\s+/', ' ', $name) ?? '');
  if ($name === '') {
    throw new RuntimeException('Enter a name for the program.');
  }
  $did = parse_id($departmentId, 'dept');
  if (!$did) {
    throw new RuntimeException('Pick a department first.');
  }
  $dept = $pdo->prepare(
    'SELECT d.department_id, d.college_id, c.college_code
     FROM departments d
     JOIN colleges c ON c.college_id = d.college_id
     WHERE d.department_id = ? AND d.is_active = 1'
  );
  $dept->execute([$did]);
  $row = $dept->fetch();
  if (!$row) {
    throw new RuntimeException('Pick a department first.');
  }
  $dup = $pdo->prepare(
    'SELECT program_id FROM programs WHERE department_id = ? AND program_name = ? AND is_active = 1 LIMIT 1'
  );
  $dup->execute([$did, $name]);
  if ($dup->fetch()) {
    throw new RuntimeException('"' . $name . '" is already under this department.');
  }
  return insert_program($pdo, (int) $row['college_id'], $did, $name, (string) $row['college_code']);
}

function insert_program(PDO $pdo, int $collegeId, int $departmentId, string $name, string $collegeCode): array
{
  $code = unique_code(
    $pdo,
    'programs',
    'program_code',
    $collegeCode . '-' . code_from_name($name, 6),
    null,
    'program_id'
  );
  $ins = $pdo->prepare(
    'INSERT INTO programs (college_id, department_id, program_code, program_name, represents_college, normal_years, is_active)
     VALUES (?, ?, ?, ?, 0, 4, 1)'
  );
  $ins->execute([$collegeId, $departmentId, $code, $name]);
  return [
    'id' => public_id('d', (int) $pdo->lastInsertId()),
    'name' => $name,
  ];
}

function ensure_sole_program(PDO $pdo, int $collegeId, string $collegeName, string $collegeCode): int
{
  $stmt = $pdo->prepare(
    'SELECT program_id, department_id FROM programs WHERE college_id = ? AND represents_college = 1 LIMIT 1'
  );
  $stmt->execute([$collegeId]);
  $existing = $stmt->fetch();
  if ($existing) {
    $pid = (int) $existing['program_id'];
    $deptId = (int) ($existing['department_id'] ?? 0);
    if ($deptId < 1) {
      $deptId = insert_department($pdo, $collegeId, $collegeName, $collegeCode);
    }
    $pdo->prepare('UPDATE programs SET is_active = 1, program_name = ?, department_id = ? WHERE program_id = ?')
      ->execute([$collegeName, $deptId, $pid]);
    return $pid;
  }
  $deptId = insert_department($pdo, $collegeId, $collegeName, $collegeCode);
  $program = insert_program($pdo, $collegeId, $deptId, $collegeName, $collegeCode);
  $pid = parse_id($program['id'], 'd');
  $pdo->prepare('UPDATE programs SET represents_college = 1 WHERE program_id = ?')->execute([$pid]);
  return (int) $pid;
}

function insert_department(PDO $pdo, int $collegeId, string $name, string $collegeCode): int
{
  $code = unique_code(
    $pdo,
    'departments',
    'department_code',
    $collegeCode . '-' . code_from_name($name, 6),
    null,
    'department_id'
  );
  $ins = $pdo->prepare(
    'INSERT INTO departments (college_id, department_code, department_name, is_active) VALUES (?, ?, ?, 1)'
  );
  $ins->execute([$collegeId, $code, $name]);
  return (int) $pdo->lastInsertId();
}

function sync_org(PDO $pdo, array $doc): void
{
  $active = is_array($doc['active'] ?? null) ? $doc['active'] : [];
  $archived = is_array($doc['archivedColleges'] ?? null) ? $doc['archivedColleges'] : [];
  $archivedDepts = is_array($doc['archivedDeptOnly'] ?? null) ? $doc['archivedDeptOnly'] : [];

  $seenColleges = [];
  $seenPrograms = [];
  $seenDepartments = [];

  foreach ($active as $c) {
    $cid = upsert_college($pdo, $c, true);
    $seenColleges[$cid] = true;
    $useDept = !empty($c['useDepartments']);
    $depts = is_array($c['departments'] ?? null) ? $c['departments'] : [];
    foreach ($depts as $d) {
      [$deptId, $programIds] = upsert_department_with_programs($pdo, $cid, $d, $c, true);
      $seenDepartments[$deptId] = true;
      foreach ($programIds as $pid) {
        $seenPrograms[$pid] = true;
      }
    }
    if (!$useDept && !$depts) {
      $soleId = ensure_sole_program($pdo, $cid, (string) $c['name'], (string) ($c['code'] ?? ''));
      $seenPrograms[$soleId] = true;
      $soleDept = $pdo->prepare('SELECT department_id FROM programs WHERE program_id = ?');
      $soleDept->execute([$soleId]);
      $soleDeptId = (int) $soleDept->fetchColumn();
      if ($soleDeptId > 0) {
        $seenDepartments[$soleDeptId] = true;
      }
    }
  }

  foreach ($archived as $c) {
    $cid = upsert_college($pdo, $c, false);
    $seenColleges[$cid] = true;
    $depts = is_array($c['departments'] ?? null) ? $c['departments'] : [];
    foreach ($depts as $d) {
      [$deptId, $programIds] = upsert_department_with_programs($pdo, $cid, $d, $c, false);
      $seenDepartments[$deptId] = true;
      foreach ($programIds as $pid) {
        $seenPrograms[$pid] = true;
      }
    }
  }

  foreach ($archivedDepts as $d) {
    $deptId = parse_id((string) ($d['id'] ?? ''), 'dept');
    if (!$deptId) {
      $deptId = parse_id((string) ($d['id'] ?? ''), 'd');
      if ($deptId) {
        $pdo->prepare('UPDATE programs SET is_active = 0, archived_label = ? WHERE program_id = ?')
          ->execute([(string) ($d['archivedLabel'] ?? ''), $deptId]);
        $seenPrograms[$deptId] = true;
      }
      continue;
    }
    $label = (string) ($d['archivedLabel'] ?? '');
    $pdo->prepare('UPDATE departments SET is_active = 0, archived_label = ? WHERE department_id = ?')
      ->execute([$label, $deptId]);
    $pdo->prepare('UPDATE programs SET is_active = 0, archived_label = ? WHERE department_id = ?')
      ->execute([$label, $deptId]);
    $seenDepartments[$deptId] = true;
    foreach ($pdo->query('SELECT program_id FROM programs WHERE department_id = ' . (int) $deptId)->fetchAll() as $row) {
      $seenPrograms[(int) $row['program_id']] = true;
    }
  }

  foreach ($pdo->query('SELECT college_id FROM colleges')->fetchAll() as $row) {
    $cid = (int) $row['college_id'];
    if (!isset($seenColleges[$cid])) {
      $pdo->prepare('UPDATE colleges SET is_active = 0 WHERE college_id = ?')->execute([$cid]);
    }
  }
  foreach ($pdo->query('SELECT program_id FROM programs')->fetchAll() as $row) {
    $pid = (int) $row['program_id'];
    if (!isset($seenPrograms[$pid])) {
      $pdo->prepare('UPDATE programs SET is_active = 0 WHERE program_id = ?')->execute([$pid]);
    }
  }
  foreach ($pdo->query('SELECT department_id FROM departments')->fetchAll() as $row) {
    $did = (int) $row['department_id'];
    if (!isset($seenDepartments[$did])) {
      $pdo->prepare('UPDATE departments SET is_active = 0 WHERE department_id = ?')->execute([$did]);
    }
  }
}

function upsert_department_with_programs(PDO $pdo, int $collegeId, array $d, array $college, bool $active): array
{
  $name = trim((string) ($d['name'] ?? ''));
  if ($name === '') {
    throw new RuntimeException('Enter a name for the department.');
  }
  $label = (string) ($d['archivedLabel'] ?? $college['archivedLabel'] ?? '');
  $deptId = parse_id((string) ($d['id'] ?? ''), 'dept');
  $collegeCode = (string) ($college['code'] ?? 'P');
  if ($deptId) {
    $exists = $pdo->prepare('SELECT department_id FROM departments WHERE department_id = ?');
    $exists->execute([$deptId]);
    if ($exists->fetch()) {
      $pdo->prepare(
        'UPDATE departments SET college_id = ?, department_name = ?, archived_label = ?, is_active = ? WHERE department_id = ?'
      )->execute([$collegeId, $name, $active ? null : $label, $active ? 1 : 0, $deptId]);
    } else {
      $deptId = insert_department($pdo, $collegeId, $name, $collegeCode);
    }
  } else {
    $deptId = insert_department($pdo, $collegeId, $name, $collegeCode);
  }

  $programs = is_array($d['programs'] ?? null) ? $d['programs'] : [];
  if (!$programs) {
    $existingPrograms = $pdo->prepare(
      'SELECT program_id, program_name FROM programs WHERE department_id = ? ORDER BY program_name'
    );
    $existingPrograms->execute([$deptId]);
    foreach ($existingPrograms->fetchAll() as $existingProgram) {
      $programs[] = [
        'id' => public_id('d', (int) $existingProgram['program_id']),
        'name' => (string) $existingProgram['program_name'],
      ];
    }
  }
  if (!$programs) {
    $programs = [['id' => '', 'name' => $name]];
  }
  $ids = [];
  foreach ($programs as $p) {
    if (!is_array($p)) {
      continue;
    }
    $pname = trim((string) ($p['name'] ?? ''));
    if ($pname === '') {
      continue;
    }
    $pid = parse_id((string) ($p['id'] ?? ''), 'd');
    if ($pid) {
      $exists = $pdo->prepare('SELECT program_id FROM programs WHERE program_id = ?');
      $exists->execute([$pid]);
      if ($exists->fetch()) {
        $pdo->prepare(
          'UPDATE programs SET college_id = ?, department_id = ?, program_name = ?, represents_college = 0, archived_label = ?, is_active = ?
           WHERE program_id = ?'
        )->execute([$collegeId, $deptId, $pname, $active ? null : $label, $active ? 1 : 0, $pid]);
        $ids[] = $pid;
        continue;
      }
    }
    $created = insert_program($pdo, $collegeId, $deptId, $pname, $collegeCode);
    $ids[] = (int) parse_id($created['id'], 'd');
  }
  if (!$ids) {
    $created = insert_program($pdo, $collegeId, $deptId, $name, $collegeCode);
    $ids[] = (int) parse_id($created['id'], 'd');
  }
  return [$deptId, $ids];
}

function upsert_college(PDO $pdo, array $c, bool $active): int
{
  $name = trim((string) ($c['name'] ?? ''));
  $code = strtoupper(trim((string) ($c['code'] ?? '')));
  $useDept = !empty($c['useDepartments']);
  $label = (string) ($c['archivedLabel'] ?? '');
  $id = parse_id((string) ($c['id'] ?? ''), 'c');

  if ($id) {
    $exists = $pdo->prepare('SELECT college_id FROM colleges WHERE college_id = ?');
    $exists->execute([$id]);
    if ($exists->fetch()) {
      if ($code === '') {
        $code = code_from_name($name);
      }
      $code = unique_code($pdo, 'colleges', 'college_code', $code, $id, 'college_id');
      $pdo->prepare(
        'UPDATE colleges SET college_code = ?, college_name = ?, use_departments = ?, archived_label = ?, is_active = ?
         WHERE college_id = ?'
      )->execute([$code, $name, $useDept ? 1 : 0, $active ? null : $label, $active ? 1 : 0, $id]);
      return $id;
    }
  }

  if ($code === '') {
    $code = code_from_name($name);
  }
  $code = unique_code($pdo, 'colleges', 'college_code', $code, null, 'college_id');
  $ins = $pdo->prepare(
    'INSERT INTO colleges (college_code, college_name, use_departments, archived_label, is_active)
     VALUES (?, ?, ?, ?, ?)'
  );
  $ins->execute([$code, $name, $useDept ? 1 : 0, $active ? null : $label, $active ? 1 : 0]);
  return (int) $pdo->lastInsertId();
}

function upsert_program(PDO $pdo, int $collegeId, array $d, array $college, bool $represents, bool $active): int
{
  $name = trim((string) ($d['name'] ?? ''));
  $id = parse_id((string) ($d['id'] ?? ''), 'd');
  $label = (string) ($d['archivedLabel'] ?? $college['archivedLabel'] ?? '');

  if ($id) {
    $exists = $pdo->prepare('SELECT program_id FROM programs WHERE program_id = ?');
    $exists->execute([$id]);
    if ($exists->fetch()) {
      $pdo->prepare(
        'UPDATE programs SET college_id = ?, program_name = ?, represents_college = ?, archived_label = ?, is_active = ?
         WHERE program_id = ?'
      )->execute([$collegeId, $name, $represents ? 1 : 0, $active ? null : $label, $active ? 1 : 0, $id]);
      return $id;
    }
  }

  $code = unique_code(
    $pdo,
    'programs',
    'program_code',
    ((string) ($college['code'] ?? 'P')) . '-' . code_from_name($name, 6),
    null,
    'program_id'
  );
  $ins = $pdo->prepare(
    'INSERT INTO programs (college_id, program_code, program_name, represents_college, normal_years, archived_label, is_active)
     VALUES (?, ?, ?, ?, 4, ?, ?)'
  );
  $ins->execute([$collegeId, $code, $name, $represents ? 1 : 0, $active ? null : $label, $active ? 1 : 0]);
  return (int) $pdo->lastInsertId();
}
