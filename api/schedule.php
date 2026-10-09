<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/schedule-workspaces.php';

$pdo = db();
ensure_schedule_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  try {
    if (trim((string) ($_GET['home'] ?? '')) === 'vpaa') {
      json_ok(vpaa_home_status($pdo));
    }
    $year = trim((string) ($_GET['year'] ?? ''));
    $sem = normalize_term_code((string) ($_GET['sem'] ?? '1'));
    $version = trim((string) ($_GET['version'] ?? ''));
    $actor = (string) ($_GET['actor'] ?? '');
    $liveOnly = isset($_GET['live']) && ((string) $_GET['live'] === '1' || strtolower((string) $_GET['live']) === 'true');
    $page = trim((string) ($_GET['page'] ?? 'create'));
    $workspace = trim((string) ($_GET['workspace'] ?? $_GET['ws'] ?? ''));
    json_ok(load_schedule_payload($pdo, $year, $sem, $version, $actor, $liveOnly, $workspace, $page));
  } catch (Throwable $e) {
    json_error($e->getMessage(), 400);
  }
}

if ($method === 'POST') {
  $body = json_input();
    $action = (string) ($body['action'] ?? 'generate');
    $workspace = normalize_workspace(
      (string) ($body['workspace'] ?? 'mine'),
      (string) ($body['actor'] ?? ''),
      (string) ($body['page'] ?? 'create')
    );
    try {
    $pdo->beginTransaction();
    $dispatch = static function () use ($pdo, &$body, $action): array {
      if ($action === 'decide') {
        return decide_merge($pdo, $body);
      }
      if ($action === 'ready_for_super_admin') {
        return submit_to_super_admin_copy($pdo, $body + ['from' => 'mine']);
      }
      if ($action === 'submit_to_super_admin') {
        return submit_to_super_admin_copy($pdo, $body);
      }
      if ($action === 'retract_admin_submission') {
        return retract_admin_submission($pdo, $body);
      }
      if ($action === 'approve_admin_submission') {
        return approve_admin_submission_to_vpaa($pdo, $body);
      }
      if ($action === 'reject_admin_submission') {
        return reject_admin_submission($pdo, $body);
      }
      if ($action === 'submit_to_vpaa') {
        return submit_to_vpaa_from_workspace($pdo, $body);
      }
      if ($action === 'retract_vpaa_pending') {
        return retract_vpaa_pending($pdo, $body);
      }
      if ($action === 'save_as') {
        return save_named_schedule($pdo, $body);
      }
      if ($action === 'clear_schedule') {
        return clear_active_workspace_schedule($pdo, $body);
      }
      if ($action === 'open_save') {
        return open_save_into_workspace($pdo, $body);
      }
      if ($action === 'request_open_shared') {
        return request_open_save_shared($pdo, $body);
      }
      if ($action === 'decide_open_shared') {
        return decide_open_save_shared($pdo, $body);
      }
      if ($action === 'delete_save') {
        return delete_named_save($pdo, $body);
      }
      if ($action === 'archive_save') {
        return archive_named_save($pdo, $body);
      }
      if ($action === 'archive_published_offering') {
        return archive_published_offering($pdo, $body);
      }
      if ($action === 'share_save') {
        return share_named_save($pdo, $body);
      }
      if ($action === 'open_returned') {
        return open_returned_into_workspace($pdo, $body);
      }
      if ($action === 'super_admin_decide') {
        return !empty($body['accept'])
          ? approve_admin_submission_to_vpaa($pdo, $body)
          : reject_admin_submission($pdo, $body);
      }
      if ($action === 'super_admin_send_live') {
        return submit_to_vpaa_from_workspace($pdo, $body + ['from' => 'mine']);
      }
      if ($action === 'vpaa_decide') {
        return vpaa_decide_package($pdo, $body);
      }
      if ($action === 'move_meeting') {
        return move_meeting($pdo, $body);
      }
      if ($action === 'reassign_section') {
        return reassign_section($pdo, $body);
      }
      if ($action === 'add_meeting') {
        return add_class_meeting($pdo, $body);
      }
      if ($action === 'remove_meeting') {
        return remove_class_meeting($pdo, $body);
      }
      if ($action === 'split_meeting') {
        return split_class_meeting($pdo, $body);
      }
      if ($action === 'combine_meetings') {
        return combine_class_meetings($pdo, $body);
      }
      if ($action === 'save_generator_settings') {
        return save_generator_settings($pdo, $body);
      }
      if ($action === 'partition_section' || $action === 'recombine_section') {
        throw new RuntimeException('Partitioning a section is only available on My schedule.');
      }
      if ($action === 'unschedule_class') {
        throw new RuntimeException('Removing a class schedule is only available on My schedule.');
      }
      return generate_schedule($pdo, $body);
    };
    $privateMutations = [
      'generate',
      'decide',
      'move_meeting',
      'reassign_section',
      'unschedule_class',
      'add_meeting',
      'remove_meeting',
      'split_meeting',
      'combine_meetings',
      'partition_section',
      'recombine_section',
    ];
    if ($workspace === 'mine' && in_array($action, $privateMutations, true)) {
      if ($action === 'generate' || $action === 'decide') {
        $body['privateWorkspace'] = true;
      }
      $out = run_private_workspace_mutation($pdo, $body, $dispatch);
    } else {
      $out = $dispatch();
    }
    $out = merge_workspace_into_result($pdo, $body, $workspace, (string) ($body['page'] ?? 'create'), $out);
    $pdo->commit();
    json_ok($out);
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    $msg = $e->getMessage();
    if (stripos($msg, 'Duplicate') !== false || stripos($msg, '23000') !== false) {
      $detail = '';
      try {
        $detail = describe_slot_unique_conflict($pdo, $body);
      } catch (Throwable $ignored) {
        $detail = '';
      }
      $msg = 'That time overlaps another class or room booking (database unique key).';
      if ($detail !== '') {
        $msg .= ' ' . $detail;
      }
    }
    json_error($msg, 400);
  }
}

json_error('Unsupported method', 405);

function load_schedule_payload(
  PDO $pdo,
  string $year,
  string $sem,
  string $version = '',
  string $actor = '',
  bool $liveOnly = false,
  string $workspace = '',
  string $page = 'create'
): array
{
  $actor = normalize_schedule_actor($actor);
  $current = ensure_current_school_year($pdo);
  $currentOffering = current_offering_term($pdo);
  if ($liveOnly) {
    if ($currentOffering) {
      $label = $currentOffering['schoolYear'];
      $sem = $currentOffering['termCode'];
      $termId = (int) $currentOffering['termId'];
    } else {
      $label = $current['label'];
      $termId = null;
    }
  } else {
    $label = $year !== '' ? parse_school_year_label($year) : $current['label'];
    $syId = school_year_id_by_label($pdo, $label);
    $termId = $syId ? find_term_id($pdo, $syId, $sem) : null;
  }
  $liveTerm = $termId && offering_term_is_live($pdo, $termId);
  $liveClasses = $termId ? list_scheduled_classes($pdo, $termId) : [];
  $rooms = list_campus_rooms($pdo);
  $row = $termId ? approval_row($pdo, $termId) : approval_empty_row();
  $publication = publication_public($row, $liveClasses, $actor);
  $allowed = $publication['versions'];
  if ($version === '' || !in_array($version, $allowed, true)) {
    $version = default_schedule_version($actor, $allowed);
  }
  if ($termId && $liveTerm && $version === 'working' && in_array('working', $allowed, true)) {
    sync_missing_class_offerings($pdo, $termId, $sem);
    $liveClasses = list_scheduled_classes($pdo, $termId);
    $publication = publication_public($row, $liveClasses, $actor);
  }
  if (!$liveTerm) {
    $publication['canReady'] = false;
    $publication['canSendLive'] = false;
  }
  $classes = $liveClasses;
  $summary = schedule_summary($classes);
  if ($version !== 'working') {
    $col = snapshot_column($version);
    $snap = $col && !empty($row[$col]) ? json_decode((string) $row[$col], true) : [];
    if (!is_array($snap)) {
      $snap = [];
    }
    $classes = isset($snap['classes']) && is_array($snap['classes']) ? $snap['classes'] : [];
    $summary = isset($snap['summary']) && is_array($snap['summary']) ? $snap['summary'] : schedule_summary($classes);
    if (!empty($snap['rooms']) && is_array($snap['rooms'])) {
      $rooms = $snap['rooms'];
    }
  } elseif (!in_array('working', $allowed, true)) {
    $classes = [];
    $summary = schedule_summary($classes);
  }
  $payload = [
    'schoolYear' => ['label' => $label, 'isCurrent' => $label === $current['label']],
    'schoolYears' => list_school_years($pdo),
    'termCode' => $sem,
    'summary' => $summary,
    'classes' => $classes,
    'rooms' => $rooms,
    'version' => $version,
    'publication' => $publication,
    'offering' => [
      'current' => public_current_offering($currentOffering),
      'archived' => archived_offerings_for_actor($pdo, $actor),
      'viewingLive' => (bool) $liveTerm,
      'canArchive' => in_array($actor, ['admin', 'super_admin'], true) && !!$currentOffering,
      'canUnarchive' => in_array($actor, ['admin', 'super_admin'], true),
    ],
  ];
  if (in_array($actor, ['admin', 'super_admin'], true) || ($actor === 'vpaa' && $page === 'report')) {
    $page = $page === 'report' ? 'report' : 'create';
    if ($actor === 'vpaa') {
      $page = 'report';
    }
    $workspace = normalize_workspace($workspace, $actor, $page);
    if ($termId) {
      $payload = apply_workspace_to_payload($payload, $pdo, (int) $termId, $actor, $workspace, $page);
    } else {
      $payload['workspace'] = workspace_state_payload($pdo, 0, $actor, $workspace, $page);
      if ($page === 'create' && $workspace === 'mine') {
        $payload['generatorSettings'] = default_generator_settings();
      }
    }
  }
  return $payload;
}

function normalize_schedule_actor(string $actor): string
{
  $a = strtolower(str_replace('-', '_', trim($actor)));
  if ($a === 'program_head') {
    $a = 'program_chair';
  }
  $ok = ['admin', 'super_admin', 'vpaa', 'dean', 'program_chair'];
  return in_array($a, $ok, true) ? $a : 'admin';
}

function snapshot_column(string $version): ?string
{
  return [
    'pendingSuperAdmin' => 'pending_sa_json',
    'pendingVpaa' => 'pending_vpaa_json',
    'published' => 'published_json',
  ][$version] ?? null;
}

function default_schedule_version(string $actor, array $allowed): string
{
  if ($actor === 'super_admin' && in_array('pendingSuperAdmin', $allowed, true)) {
    return 'pendingSuperAdmin';
  }
  if ($actor === 'vpaa' && in_array('pendingVpaa', $allowed, true)) {
    return 'pendingVpaa';
  }
  if ($actor === 'vpaa' || $actor === 'dean' || $actor === 'program_chair') {
    return in_array('published', $allowed, true) ? 'published' : ($allowed[0] ?? 'published');
  }
  return in_array('working', $allowed, true) ? 'working' : ($allowed[0] ?? 'working');
}

function approval_empty_row(): array
{
  return [
    'term_id' => 0,
    'status' => 'draft',
    'pending_sa_json' => null,
    'pending_sa_at' => null,
    'pending_vpaa_json' => null,
    'pending_vpaa_at' => null,
    'published_json' => null,
    'published_at' => null,
    'last_reject_from' => null,
    'last_reject_note' => null,
    'last_reject_at' => null,
  ];
}

function approval_row(PDO $pdo, int $termId): array
{
  $stmt = $pdo->prepare('SELECT * FROM term_schedule_approvals WHERE term_id = ?');
  $stmt->execute([$termId]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if ($row) {
    return $row;
  }
  $pdo->prepare('INSERT INTO term_schedule_approvals (term_id, status) VALUES (?, \'draft\')')->execute([$termId]);
  $stmt->execute([$termId]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: (['term_id' => $termId] + approval_empty_row());
}

function schedule_fingerprint(array $classes): string
{
  $norm = [];
  foreach ($classes as $c) {
    $meets = [];
    foreach ($c['meetings'] ?? [] as $m) {
      $meets[] = [
        $m['id'] ?? '',
        $m['day'] ?? '',
        $m['start'] ?? '',
        $m['end'] ?? '',
        $m['roomId'] ?? '',
      ];
    }
    $norm[] = [$c['id'] ?? '', $c['status'] ?? '', $meets];
  }
  return hash('sha256', (string) json_encode($norm));
}

function schedule_live_snapshot(PDO $pdo, string $label, string $sem, array $classes): array
{
  return [
    'schoolYear' => ['label' => $label],
    'termCode' => $sem,
    'summary' => schedule_summary($classes),
    'classes' => $classes,
    'rooms' => list_campus_rooms($pdo),
    'fingerprint' => schedule_fingerprint($classes),
    'capturedAt' => date('c'),
  ];
}

function publication_public(array $row, array $liveClasses, string $actor): array
{
  $hasSa = trim((string) ($row['pending_sa_json'] ?? '')) !== '';
  $hasVpaa = trim((string) ($row['pending_vpaa_json'] ?? '')) !== '';
  $hasPub = trim((string) ($row['published_json'] ?? '')) !== '';
  $status = (string) ($row['status'] ?? 'draft');
  $versions = [];
  if ($actor === 'vpaa') {
    if ($hasVpaa) {
      $versions[] = 'pendingVpaa';
    }
    if ($hasPub) {
      $versions[] = 'published';
    }
  } elseif ($actor === 'dean' || $actor === 'program_chair') {
    if ($hasPub) {
      $versions[] = 'published';
    }
  } else {
    $versions[] = 'working';
    if ($hasSa) {
      $versions[] = 'pendingSuperAdmin';
    }
    if ($hasVpaa) {
      $versions[] = 'pendingVpaa';
    }
    if ($hasPub) {
      $versions[] = 'published';
    }
  }
  $saFp = null;
  if ($hasSa) {
    $sa = json_decode((string) $row['pending_sa_json'], true);
    $saFp = is_array($sa) ? (string) ($sa['fingerprint'] ?? '') : '';
  }
  $rejectNote = trim((string) ($row['last_reject_note'] ?? ''));
  $returnedFromVpaa = $status === 'pending_super_admin'
    && $hasSa
    && (string) ($row['last_reject_from'] ?? '') === 'vpaa';
  $canReview = ($actor === 'super_admin' && $status === 'pending_super_admin' && $hasSa)
    || ($actor === 'vpaa' && $status === 'pending_vpaa' && $hasVpaa);
  return [
    'status' => $status,
    'versions' => $versions,
    'pendingSaAt' => $row['pending_sa_at'] ?? null,
    'pendingVpaaAt' => $row['pending_vpaa_at'] ?? null,
    'publishedAt' => $row['published_at'] ?? null,
    'workingDiffersFromSubmitted' => $hasSa && $saFp !== '' && $saFp !== schedule_fingerprint($liveClasses),
    'returnedFromVpaa' => $returnedFromVpaa,
    'lastReject' => $rejectNote !== '' ? [
      'from' => $row['last_reject_from'] ?? '',
      'note' => $rejectNote,
      'at' => $row['last_reject_at'] ?? null,
    ] : null,
    'canReady' => $actor === 'admin'
      && in_array($status, ['draft', 'published', 'pending_super_admin'], true)
      && count($liveClasses) > 0
      && !$returnedFromVpaa,
    'canSendLive' => $actor === 'super_admin'
      && in_array($status, ['draft', 'published', 'pending_super_admin'], true)
      && count($liveClasses) > 0,
    'canApprove' => $canReview,
    'canReject' => $canReview,
  ];
}

function archived_offerings_for_actor(PDO $pdo, string $actor): array
{
  $rows = list_archived_offerings($pdo);
  $out = [];
  foreach ($rows as $row) {
    if ($actor === 'dean' || $actor === 'program_chair') {
      if (empty($row['published'])) {
        continue;
      }
    } elseif ($actor === 'vpaa') {
      if (empty($row['published']) && empty($row['hasPendingVpaa'])) {
        continue;
      }
    }
    unset($row['hasPendingVpaa']);
    $out[] = $row;
  }
  return $out;
}

function public_current_offering(?array $current): ?array
{
  if (!$current) {
    return null;
  }
  return [
    'schoolYear' => (string) $current['schoolYear'],
    'termCode' => (string) $current['termCode'],
  ];
}

function resolve_term_for_year_sem(PDO $pdo, array $body, bool $mustBeLive = true): array
{
  $year = parse_school_year_label(trim((string) ($body['schoolYear'] ?? $body['year'] ?? '')));
  $sem = normalize_term_code((string) ($body['termCode'] ?? $body['sem'] ?? '1'));
  $syId = school_year_id_by_label($pdo, $year);
  $termId = $syId ? find_term_id($pdo, $syId, $sem) : null;
  if (!$termId) {
    throw new RuntimeException('No term exists for that academic year and semester.');
  }
  if ($mustBeLive) {
    require_live_offering_term($pdo, $termId);
  }
  return [$year, $sem, $termId];
}

function ready_for_super_admin(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? 'admin'));
  if ($actor !== 'admin') {
    throw new RuntimeException('Only Admin can mark a timetable ready for Super Admin.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body);
  $row = approval_row($pdo, $termId);
  if (($row['status'] ?? '') === 'pending_vpaa') {
    throw new RuntimeException('The VPAA is still reviewing the last Super Admin-approved package. Wait for that decision before sending a new one.');
  }
  $classes = list_scheduled_classes($pdo, $termId);
  if (!$classes) {
    throw new RuntimeException('Generate a schedule for this term before sending it to Super Admin.');
  }
  $snap = json_encode(schedule_live_snapshot($pdo, $year, $sem, $classes), JSON_UNESCAPED_UNICODE);
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = 'pending_super_admin',
         pending_sa_json = ?,
         pending_sa_at = NOW(),
         last_reject_from = NULL,
         last_reject_note = NULL,
         last_reject_at = NULL
     WHERE term_id = ?"
  )->execute([$snap, $termId]);
  record_schedule_handoff($pdo, $termId, 'send', 'admin', 'super_admin');
  $term = term_offering_label($year, $sem);
  notify_roles(
    $pdo,
    ['super_admin'],
    'timetable_send',
    'Admin sent a timetable for review',
    'Admin sent the ' . $term . ' timetable to Super Admin.',
    'final-report',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, 'pendingSuperAdmin', $actor) + ['status' => 'pending_super_admin'];
}

function super_admin_decide_package(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can approve or send back this package.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $row = approval_row($pdo, $termId);
  if (($row['status'] ?? '') !== 'pending_super_admin' || trim((string) ($row['pending_sa_json'] ?? '')) === '') {
    throw new RuntimeException('There is no timetable waiting for Super Admin approval.');
  }
  $accept = !empty($body['accept']);
  if ($accept) {
    $copy = (string) ($row['last_reject_from'] ?? '') === 'vpaa' ? 'returned' : 'snapshot';
    $pdo->prepare(
      "UPDATE term_schedule_approvals
       SET status = 'pending_vpaa',
           pending_vpaa_json = pending_sa_json,
           pending_vpaa_at = NOW(),
           pending_sa_json = NULL,
           pending_sa_at = NULL,
           last_reject_from = NULL,
           last_reject_note = NULL,
           last_reject_at = NULL
       WHERE term_id = ?"
    )->execute([$termId]);
    record_schedule_handoff($pdo, $termId, 'send', 'super_admin', 'vpaa', '', $copy);
    $term = term_offering_label($year, $sem);
    notify_roles(
      $pdo,
      ['vpaa'],
      'timetable_send',
      'Super Admin sent a timetable for approval',
      'Super Admin sent the ' . $term . ' timetable to the VPAA.',
      'final-report.html?ws=awaiting',
      'Timetable'
    );
    return load_schedule_payload($pdo, $year, $sem, 'pendingVpaa', $actor) + ['status' => 'pending_vpaa'];
  }
  $note = trim((string) ($body['note'] ?? ''));
  if ($note === '') {
    throw new RuntimeException('Say what the Admin should revise before sending this back.');
  }
  $next = trim((string) ($row['published_json'] ?? '')) !== '' ? 'published' : 'draft';
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = ?,
         pending_sa_json = NULL,
         pending_sa_at = NULL,
         last_reject_from = 'super_admin',
         last_reject_note = ?,
         last_reject_at = NOW()
     WHERE term_id = ?"
  )->execute([$next, $note, $termId]);
  record_schedule_handoff($pdo, $termId, 'send_back', 'super_admin', 'admin', $note);
  $term = term_offering_label($year, $sem);
  $msg = 'Super Admin sent the ' . $term . ' timetable back to Admin.';
  $snip = notify_note_snippet($note);
  if ($snip !== '') {
    $msg .= ' ' . $snip;
  }
  notify_roles(
    $pdo,
    ['admin'],
    'timetable_return',
    'Super Admin sent a timetable back',
    $msg,
    'final-report',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor) + ['status' => 'returned'];
}

function super_admin_send_live(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'super_admin') {
    throw new RuntimeException('Only Super Admin can send the live timetable to the VPAA.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, true);
  $row = approval_row($pdo, $termId);
  if (($row['status'] ?? '') === 'pending_vpaa') {
    throw new RuntimeException('The VPAA is still reviewing the last Super Admin-approved package. Wait for that decision before sending a new one.');
  }
  $classes = list_scheduled_classes($pdo, $termId);
  if (!$classes) {
    throw new RuntimeException('Generate a schedule for this term before sending it to the VPAA.');
  }
  $snap = json_encode(schedule_live_snapshot($pdo, $year, $sem, $classes), JSON_UNESCAPED_UNICODE);
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = 'pending_vpaa',
         pending_vpaa_json = ?,
         pending_vpaa_at = NOW(),
         pending_sa_json = NULL,
         pending_sa_at = NULL,
         last_reject_from = NULL,
         last_reject_note = NULL,
         last_reject_at = NULL
     WHERE term_id = ?"
  )->execute([$snap, $termId]);
  record_schedule_handoff($pdo, $termId, 'send', 'super_admin', 'vpaa', '', 'live');
  $term = term_offering_label($year, $sem);
  notify_roles(
    $pdo,
    ['vpaa'],
    'timetable_send',
    'Super Admin sent a timetable for approval',
    'Super Admin sent the ' . $term . ' live timetable to the VPAA.',
    'final-report.html?ws=awaiting',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, 'pendingVpaa', $actor) + ['status' => 'pending_vpaa'];
}

function vpaa_decide_package(PDO $pdo, array $body): array
{
  $actor = normalize_schedule_actor((string) ($body['actor'] ?? ''));
  if ($actor !== 'vpaa') {
    throw new RuntimeException('Only the VPAA can give the final approval or send this back.');
  }
  [$year, $sem, $termId] = resolve_term_for_year_sem($pdo, $body, false);
  $row = approval_row($pdo, $termId);
  if (($row['status'] ?? '') !== 'pending_vpaa' || trim((string) ($row['pending_vpaa_json'] ?? '')) === '') {
    throw new RuntimeException('There is no timetable waiting for VPAA approval.');
  }
  $accept = !empty($body['accept']);
  if ($accept) {
    $pdo->prepare(
      "UPDATE term_schedule_approvals
       SET status = 'published',
           published_json = pending_vpaa_json,
           published_at = NOW(),
           pending_vpaa_json = NULL,
           pending_vpaa_at = NULL
       WHERE term_id = ?"
    )->execute([$termId]);
    $pending = load_workspace_copy($pdo, $termId, 'vpaa_pending');
    if ($pending) {
      if (!isset($pending['origin']) || !is_array($pending['origin'])) {
        $pending['origin'] = [];
      }
      $pending['origin']['publishedBy'] = 'vpaa';
      $pending['origin']['publishedAt'] = date('Y-m-d H:i:s');
      upsert_workspace_copy($pdo, $termId, 'vpaa_final', $pending);
    }
    clear_workspace_copy($pdo, $termId, 'vpaa_pending');
    if (function_exists('clear_pipeline_after_vpaa_decision')) {
      clear_pipeline_after_vpaa_decision($pdo, $termId);
    }
    $term = term_offering_label($year, $sem);
    notify_roles(
      $pdo,
      ['super_admin', 'admin'],
      'timetable_published',
      'VPAA published a timetable',
      'The VPAA published the ' . $term . ' timetable.',
      'final-report',
      'Timetable'
    );
    return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'final', 'report') + ['status' => 'published'];
  }
  $note = trim((string) ($body['note'] ?? ''));
  if ($note === '') {
    throw new RuntimeException('Say what Super Admin should revise before sending this back.');
  }
  $pdo->prepare(
    "UPDATE term_schedule_approvals
     SET status = 'draft',
         pending_sa_json = NULL,
         pending_sa_at = NULL,
         pending_vpaa_json = NULL,
         pending_vpaa_at = NULL,
         last_reject_from = 'vpaa',
         last_reject_note = ?,
         last_reject_at = NOW()
     WHERE term_id = ?"
  )->execute([$note, $termId]);
  if (function_exists('park_vpaa_returned_copy')) {
    park_vpaa_returned_copy($pdo, $termId, $note);
  } else {
    clear_workspace_copy($pdo, $termId, 'vpaa_pending');
  }
  record_schedule_handoff($pdo, $termId, 'send_back', 'vpaa', 'super_admin', $note);
  $term = term_offering_label($year, $sem);
  $msg = 'The VPAA sent the ' . $term . ' timetable back to Super Admin.';
  $snip = notify_note_snippet($note);
  if ($snip !== '') {
    $msg .= ' ' . $snip;
  }
  notify_roles(
    $pdo,
    ['super_admin'],
    'timetable_return',
    'VPAA sent a timetable back',
    $msg,
    'create-schedule.html?ws=submitted',
    'Timetable'
  );
  notify_roles(
    $pdo,
    ['admin'],
    'timetable_return',
    'VPAA sent a timetable back to Super Admin',
    $msg . ' Super Admin still has the frozen copy.',
    'create-schedule.html?ws=submitted',
    'Timetable'
  );
  return load_schedule_payload($pdo, $year, $sem, '', $actor, false, 'awaiting', 'report') + ['status' => 'returned'];
}

function school_year_id_by_label(PDO $pdo, string $label): ?int
{
  $stmt = $pdo->prepare('SELECT school_year_id FROM school_years WHERE label = ?');
  $stmt->execute([$label]);
  $id = $stmt->fetchColumn();
  return $id ? (int) $id : null;
}

function find_term_id(PDO $pdo, int $schoolYearId, string $termCode): ?int
{
  $termCode = normalize_term_code($termCode);
  $stmt = $pdo->prepare('SELECT term_id FROM terms WHERE school_year_id = ? AND term_code = ?');
  $stmt->execute([$schoolYearId, $termCode]);
  $id = $stmt->fetchColumn();
  return $id ? (int) $id : null;
}

function generate_schedule(PDO $pdo, array $body): array
{
  $year = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $sem = normalize_term_code((string) ($body['termCode'] ?? '1'));
  $sy = resolve_offering_school_year($pdo, ['schoolYear' => $year]);
  $termId = ensure_term($pdo, $sy['id'], $sem);
  require_live_offering_term($pdo, $termId);
  $settings = persist_request_generator_settings($pdo, $body, $termId);
  $mode = (string) ($settings['mergeMode'] ?? 'auto');
  $onlyUnscheduled = !empty($body['onlyUnscheduled']) && !empty($body['privateWorkspace']);
  $seedClasses = is_array($body['seedPrivateClasses'] ?? null) ? $body['seedPrivateClasses'] : [];

  $jobs = build_schedule_jobs($pdo, $termId, $sem, $body);
  if (!$jobs) {
    throw new RuntimeException('No sections found for that term. Create sections first.');
  }
  $jobSubjectKeys = [];
  if ($onlyUnscheduled) {
    $scheduledSubjects = [];
    foreach ($seedClasses as $c) {
      if (!is_array($c) || empty($c['meetings'])) {
        continue;
      }
      $scheduledSubjects[private_subject_key_from_class($c)] = true;
    }
    $filtered = [];
    foreach ($jobs as $job) {
      $key = public_id('s', (int) $job['sectionId'])
        . '|'
        . (string) ($job['courseCode'] ?? '')
        . '|'
        . (string) ($job['component'] ?? '');
      if (!empty($scheduledSubjects[$key])) {
        continue;
      }
      $filtered[] = $job;
      $jobSubjectKeys[$key] = true;
    }
    $jobs = $filtered;
    if (!$jobs) {
      return [
        'status' => 'done',
        'summary' => schedule_summary($seedClasses),
        'privateClasses' => $seedClasses,
        'remainingOnly' => true,
      ];
    }
  }
  $sectionIds = [];
  foreach ($jobs as $job) {
    $sectionIds[(int) $job['sectionId']] = true;
  }
  $groups = pack_schedule_groups(
    $pdo,
    $jobs,
    $mode !== 'off',
    $mode === 'off' ? 'off' : (string) ($settings['partitionScope'] ?? 'small')
  );
  if ($mode === 'manual') {
    $queue = merge_queue_indexes($groups);
    if ($queue) {
      $payload = [
        'schoolYear' => $year,
        'termCode' => $sem,
        'filters' => [
          'collegeId' => $body['collegeId'] ?? '',
          'departmentId' => $body['departmentId'] ?? '',
          'yearLevel' => $body['yearLevel'] ?? '',
        ],
        'sectionIds' => array_keys($sectionIds),
        'groups' => $groups,
        'queue' => $queue,
        'generatorSettings' => $settings,
        'onlyUnscheduled' => $onlyUnscheduled,
        'seedPrivateClasses' => $onlyUnscheduled ? $seedClasses : [],
        'jobSubjectKeys' => array_keys($jobSubjectKeys),
      ];
      $ins = $pdo->prepare(
        'INSERT INTO schedule_runs (term_id, merge_mode, status, payload_json) VALUES (?, ?, ?, ?)'
      );
      $ins->execute([$termId, 'manual', 'merging', json_encode($payload)]);
      return [
        'status' => 'needs_merge',
        'runId' => public_id('run', (int) $pdo->lastInsertId()),
        'proposal' => proposal_from_group($groups[$queue[0]]),
        'remaining' => count($queue),
      ];
    }
  }
  if (!empty($body['privateWorkspace'])) {
    sync_missing_class_offerings($pdo, $termId, $sem);
    $placed = place_groups_in_memory(
      $pdo,
      assign_rooms_to_groups($pdo, $groups),
      $settings,
      $onlyUnscheduled ? $seedClasses : []
    );
    $classes = classes_from_placed_groups($pdo, $termId, $placed);
    if ($onlyUnscheduled) {
      $classes = merge_remaining_private_classes($seedClasses, $classes, array_keys($jobSubjectKeys));
    }
    return [
      'status' => 'done',
      'summary' => schedule_summary($classes),
      'privateClasses' => $classes,
      'remainingOnly' => $onlyUnscheduled,
    ];
  }
  persist_and_place($pdo, $termId, $groups, array_keys($sectionIds), !empty($body['keepOfferings']), $settings);
  return load_schedule_payload($pdo, $year, $sem) + ['status' => 'done'];
}

function decide_merge(PDO $pdo, array $body): array
{
  $runId = parse_id((string) ($body['runId'] ?? ''), 'run');
  if (!$runId) {
    throw new RuntimeException('Schedule run is missing.');
  }
  $stmt = $pdo->prepare('SELECT run_id, term_id, payload_json, status FROM schedule_runs WHERE run_id = ?');
  $stmt->execute([$runId]);
  $row = $stmt->fetch();
  if (!$row || $row['status'] !== 'merging') {
    throw new RuntimeException('That merge prompt is no longer active.');
  }
  require_live_offering_term($pdo, (int) $row['term_id']);
  $payload = json_decode((string) $row['payload_json'], true);
  if (!is_array($payload) || empty($payload['queue'])) {
    throw new RuntimeException('Nothing left to confirm.');
  }
  $idx = (int) array_shift($payload['queue']);
  if (empty($body['accept'])) {
    $added = count($payload['groups'][$idx]['members']) - 1;
    $payload['groups'] = split_group_to_singletons($payload['groups'], $idx);
    foreach ($payload['queue'] as $q => $qIdx) {
      if ((int) $qIdx > $idx) {
        $payload['queue'][$q] = (int) $qIdx + $added;
      }
    }
  }
  if (!empty($payload['queue'])) {
    $upd = $pdo->prepare('UPDATE schedule_runs SET payload_json = ? WHERE run_id = ?');
    $upd->execute([json_encode($payload), $runId]);
    return [
      'status' => 'needs_merge',
      'runId' => public_id('run', $runId),
      'proposal' => proposal_from_group($payload['groups'][$payload['queue'][0]]),
      'remaining' => count($payload['queue']),
    ];
  }
  $settings = normalize_generator_settings($payload['generatorSettings'] ?? []);
  if (!empty($body['privateWorkspace'])) {
    sync_missing_class_offerings($pdo, (int) $row['term_id'], (string) ($payload['termCode'] ?? '1'));
    $seedClasses = !empty($payload['onlyUnscheduled']) && is_array($payload['seedPrivateClasses'] ?? null)
      ? $payload['seedPrivateClasses']
      : [];
    $placed = place_groups_in_memory(
      $pdo,
      assign_rooms_to_groups($pdo, $payload['groups']),
      $settings,
      $seedClasses
    );
    $classes = classes_from_placed_groups($pdo, (int) $row['term_id'], $placed);
    if ($seedClasses) {
      $jobKeys = is_array($payload['jobSubjectKeys'] ?? null) ? $payload['jobSubjectKeys'] : [];
      $classes = merge_remaining_private_classes($seedClasses, $classes, $jobKeys);
    }
    $pdo->prepare("UPDATE schedule_runs SET status = 'done', payload_json = ? WHERE run_id = ?")
      ->execute([json_encode($payload), $runId]);
    return [
      'status' => 'done',
      'summary' => schedule_summary($classes),
      'privateClasses' => $classes,
      'remainingOnly' => !empty($payload['onlyUnscheduled']),
    ];
  }
  persist_and_place(
    $pdo,
    (int) $row['term_id'],
    $payload['groups'],
    section_ids_from_payload($payload),
    !empty($body['keepOfferings']),
    $settings
  );
  $pdo->prepare("UPDATE schedule_runs SET status = 'done', payload_json = ? WHERE run_id = ?")
    ->execute([json_encode($payload), $runId]);
  return load_schedule_payload($pdo, (string) $payload['schoolYear'], (string) $payload['termCode']) + [
    'status' => 'done',
  ];
}

function build_schedule_jobs(PDO $pdo, int $termId, string $sem, array $body): array
{
  $collegeId = parse_id((string) ($body['collegeId'] ?? ''), 'c');
  $departmentId = parse_id((string) ($body['departmentId'] ?? ''), 'd');
  $yearLevel = (int) ($body['yearLevel'] ?? 0);
  $sql = 'SELECT s.section_id, s.curriculum_id, s.year_level, s.section_code, s.student_count, s.is_retake,
                 p.program_id, p.program_name, p.college_id, p.represents_college, c.college_name
          FROM sections s
          JOIN programs p ON p.program_id = s.program_id
          JOIN colleges c ON c.college_id = p.college_id
          WHERE s.term_id = ?';
  $params = [$termId];
  if ($collegeId) {
    $sql .= ' AND p.college_id = ?';
    $params[] = $collegeId;
  }
  if ($departmentId) {
    $sql .= ' AND p.program_id = ?';
    $params[] = $departmentId;
  }
  if ($yearLevel >= 1 && $yearLevel <= 6) {
    $sql .= ' AND s.year_level = ?';
    $params[] = $yearLevel;
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $sections = $stmt->fetchAll();
  $overrides = retake_course_ids_by_section($pdo);
  $jobs = [];
  foreach ($sections as $sec) {
    $courses = courses_for_section($pdo, $sec, $sem, $overrides);
    foreach ($courses as $co) {
      foreach (['lecture', 'laboratory'] as $comp) {
        $units = $comp === 'lecture' ? (float) $co['lecture_units'] : (float) $co['lab_units'];
        if ($units <= 0) {
          continue;
        }
        $typeName = $comp === 'lecture' ? trim((string) $co['lecture_room_type']) : trim((string) $co['lab_room_type']);
        $hours = component_hours_from_course($co, $comp, $sem);
        $type = $typeName !== '' ? room_type_row_by_name($pdo, $typeName) : null;
        $usesCampus = $type ? ((int) ($type['requires_campus_room'] ?? 1) === 1) : true;
        $unresolved = '';
        if ($typeName === '') {
          $unresolved = 'No room type on the curriculum for this ' . $comp . '.';
          $usesCampus = true;
        } elseif (!$type) {
          $unresolved = 'Room type "' . $typeName . '" is not in the list.';
        } elseif ($usesCampus) {
          $rooms = rooms_of_type($pdo, (int) $type['room_type_id']);
          if (!$rooms) {
            $unresolved = 'No campus room of type ' . $typeName . '.';
          }
        }
        $jobs[] = [
          'sectionId' => (int) $sec['section_id'],
          'sectionName' => section_display_name($sec),
          'collegeId' => (int) $sec['college_id'],
          'collegeName' => (string) $sec['college_name'],
          'studentCount' => (int) $sec['student_count'],
          'curriculumCourseId' => (int) $co['curriculum_course_id'],
          'courseCode' => strtoupper(trim((string) $co['course_id'])),
          'courseTitle' => (string) $co['course_title'],
          'component' => $comp,
          'hours' => $hours,
          'loadUnits' => $units,
          'roomTypeId' => $type ? (int) $type['room_type_id'] : null,
          'roomTypeName' => $typeName,
          'usesCampusRoom' => $usesCampus && $unresolved === '',
          'unresolved' => $unresolved,
        ];
      }
    }
  }
  return $jobs;
}

function section_display_name(array $sec): string
{
  $program = (int) $sec['represents_college'] === 1 ? $sec['college_name'] : $sec['program_name'];
  return $program . ' ' . (int) $sec['year_level'] . '-' . $sec['section_code'];
}

function sync_missing_class_offerings(PDO $pdo, int $termId, string $sem): void
{
  if (!schema_table_exists($pdo, 'class_offerings') || !schema_table_exists($pdo, 'sections')) {
    return;
  }
  $jobs = build_schedule_jobs($pdo, $termId, $sem, []);
  if (!$jobs) {
    return;
  }
  $have = [];
  $stmt = $pdo->prepare(
    'SELECT section_id, curriculum_course_id, component FROM class_offerings WHERE term_id = ?'
  );
  $stmt->execute([$termId]);
  foreach ($stmt->fetchAll() as $row) {
    $have[(int) $row['section_id'] . '|' . (int) $row['curriculum_course_id'] . '|' . $row['component']] = true;
  }
  $hasNotes = schema_column_exists($pdo, 'class_offerings', 'notes');
  foreach ($jobs as $job) {
    $key = (int) $job['sectionId'] . '|' . (int) $job['curriculumCourseId'] . '|' . $job['component'];
    if (isset($have[$key])) {
      continue;
    }
    $note = $job['unresolved'] !== '' ? (string) $job['unresolved'] : null;
    if ($hasNotes) {
      $ins = $pdo->prepare(
        'INSERT INTO class_offerings
          (term_id, section_id, curriculum_course_id, component, hours_per_week, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      $ins->execute([
        $termId,
        (int) $job['sectionId'],
        (int) $job['curriculumCourseId'],
        $job['component'],
        $job['hours'],
        'unscheduled',
        $note,
      ]);
    } else {
      $ins = $pdo->prepare(
        'INSERT INTO class_offerings
          (term_id, section_id, curriculum_course_id, component, hours_per_week, status)
         VALUES (?, ?, ?, ?, ?, ?)'
      );
      $ins->execute([
        $termId,
        (int) $job['sectionId'],
        (int) $job['curriculumCourseId'],
        $job['component'],
        $job['hours'],
        'unscheduled',
      ]);
    }
    $have[$key] = true;
  }
}

function retake_course_ids_by_section(PDO $pdo): array
{
  if (!schema_table_exists($pdo, 'section_subject_overrides')) {
    return [];
  }
  $rows = $pdo->query(
    'SELECT section_id, curriculum_course_id FROM section_subject_overrides'
  )->fetchAll();
  $out = [];
  foreach ($rows as $row) {
    $out[(int) $row['section_id']][] = (int) $row['curriculum_course_id'];
  }
  return $out;
}

function component_hours_per_week(float $units, string $component, string $termCode): float
{
  $weeks = $termCode === 'summer' ? 6.0 : 18.0;
  $factor = $component === 'laboratory' ? 3.0 : 1.0;
  return round(($units * $factor * 18.0) / $weeks, 2);
}

function component_hours_from_course(array $co, string $comp, string $sem): float
{
  $lec = (float) ($co['lecture_units'] ?? 0);
  $lab = (float) ($co['lab_units'] ?? 0);
  $computedLec = component_hours_per_week($lec, 'lecture', $sem);
  $computedLab = component_hours_per_week($lab, 'laboratory', $sem);
  $computedThis = $comp === 'lecture' ? $computedLec : $computedLab;
  if ($computedThis <= 0) {
    return 0.0;
  }
  $computedTotal = $computedLec + $computedLab;
  $fileTotal = (float) ($co['total_hours_week'] ?? 0);
  if ($fileTotal <= 0 || $computedTotal <= 0 || abs($fileTotal - $computedTotal) < 0.005) {
    return $computedThis;
  }
  return round($fileTotal * ($computedThis / $computedTotal), 2);
}

function courses_for_section(PDO $pdo, array $sec, string $sem, array $overrides): array
{
  if ((int) $sec['is_retake'] === 1) {
    $ids = $overrides[(int) $sec['section_id']] ?? [];
    if (!$ids) {
      return [];
    }
    $in = implode(',', array_map('intval', $ids));
    return $pdo->query(
      "SELECT curriculum_course_id, course_id, course_title, lecture_units, lab_units,
              lecture_room_type, lab_room_type, total_hours_week
       FROM curriculum_courses WHERE curriculum_course_id IN ({$in})"
    )->fetchAll();
  }
  $stmt = $pdo->prepare(
    'SELECT curriculum_course_id, course_id, course_title, lecture_units, lab_units,
            lecture_room_type, lab_room_type, total_hours_week
     FROM curriculum_courses
     WHERE curriculum_id = ? AND year_level = ? AND term_code = ?
     ORDER BY display_order, course_id'
  );
  $stmt->execute([(int) $sec['curriculum_id'], (int) $sec['year_level'], $sem]);
  return $stmt->fetchAll();
}

function room_type_row_by_name(PDO $pdo, string $name): ?array
{
  $id = find_room_type_id($pdo, $name);
  if (!$id) {
    return null;
  }
  $stmt = $pdo->prepare(
    'SELECT room_type_id, room_type_name, requires_campus_room FROM room_types WHERE room_type_id = ?'
  );
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function rooms_of_type(PDO $pdo, int $typeId): array
{
  $stmt = $pdo->prepare(
    "SELECT r.room_id, r.room_code, r.capacity, b.building_name, b.building_code
     FROM rooms r
     LEFT JOIN floors f ON f.floor_id = r.floor_id
     LEFT JOIN buildings b ON b.building_id = f.building_id
     WHERE r.room_type_id = ? AND r.status = 'active' AND r.capacity > 0
       AND (b.building_id IS NULL OR b.is_active = 1)
     ORDER BY r.capacity ASC, b.building_name, r.room_code"
  );
  $stmt->execute([$typeId]);
  return $stmt->fetchAll();
}

function format_room_label(?string $buildingName, ?string $buildingCode, ?string $roomCode): ?string
{
  $room = trim((string) $roomCode);
  if ($room === '') {
    return null;
  }
  $name = trim((string) $buildingName);
  $code = trim((string) $buildingCode);
  $prefix = $name !== '' ? $name : $code;
  if ($prefix === '') {
    return $room;
  }
  $lower = strtolower($room);
  foreach ([$prefix, $code] as $lead) {
    if ($lead === '') {
      continue;
    }
    if (str_starts_with($lower, strtolower($lead) . ' ') || strcasecmp($room, $lead) === 0) {
      return $room;
    }
  }
  return $prefix . ' ' . $room;
}

function room_row_label(array $room): ?string
{
  return format_room_label(
    isset($room['building_name']) ? (string) $room['building_name'] : null,
    isset($room['building_code']) ? (string) $room['building_code'] : null,
    isset($room['room_code']) ? (string) $room['room_code'] : null
  );
}

function pack_schedule_groups(PDO $pdo, array $jobs, bool $allowMerge = true, string $partitionScope = 'small'): array
{
  $groups = [];
  $buckets = [];
  foreach ($jobs as $job) {
    $mergeable = $allowMerge && $job['unresolved'] === '' && !empty($job['usesCampusRoom']) && !empty($job['roomTypeId']);
    if (!$mergeable) {
      $groups[] = group_from_members([$job], $pdo);
      continue;
    }
    $key = $job['courseCode'] . '|' . $job['component'] . '|' . number_format((float) $job['hours'], 2, '.', '') . '|' . (int) $job['roomTypeId'];
    $buckets[$key][] = $job;
  }
  foreach ($buckets as $members) {
    if (count($members) === 1) {
      $groups[] = group_from_members($members, $pdo);
      continue;
    }
    $rooms = rooms_of_type($pdo, (int) $members[0]['roomTypeId']);
    $chunks = bin_pack_members($members, $rooms);
    if ($partitionScope !== 'off') {
      $chunks = partition_leftover_chunks($chunks, $rooms, $partitionScope);
    }
    foreach ($chunks as $chunk) {
      $groups[] = group_from_members($chunk, $pdo);
    }
  }
  return $groups;
}

// How large a section may be and still be split. A section that already fills
// the room it would be given is a normal class, not a leftover, so the scope
// decides where that line sits.
function partition_scope_ceiling(string $scope, int $maxCapacity): int
{
  if ($scope === 'any') {
    return PHP_INT_MAX;
  }
  if ($scope === 'medium') {
    return intdiv($maxCapacity * 2, 3);
  }
  return intdiv($maxCapacity - 1, 2);
}

// A section left in a class of its own is the expensive case: it burns a room
// and a time slot for a handful of students. If its headcount can be spread
// into the spare seats of the other classes of the same subject, that class
// disappears. A partition never forms a class on its own, so every partition
// that succeeds removes exactly one class.
function partition_leftover_chunks(array $chunks, array $rooms, string $scope = 'small'): array
{
  $maxCapacity = 0;
  foreach ($rooms as $room) {
    $maxCapacity = max($maxCapacity, (int) ($room['capacity'] ?? 0));
  }
  if ($maxCapacity < 1 || count($chunks) < 2) {
    return $chunks;
  }
  $candidates = [];
  foreach ($chunks as $i => $chunk) {
    if (count($chunk) !== 1 || partition_member_is_partitioned($chunk[0])) {
      continue;
    }
    $count = (int) $chunk[0]['studentCount'];
    if ($count > partition_scope_ceiling($scope, $maxCapacity)) {
      continue;
    }
    $candidates[$i] = $count;
  }
  if (!$candidates) {
    return $chunks;
  }
  asort($candidates);
  $dissolved = [];
  foreach (array_keys($candidates) as $idx) {
    // The chunk may have taken in a partition since the candidates were
    // listed. Dissolving it now would throw that partition away.
    if (count($chunks[$idx]) !== 1) {
      continue;
    }
    $member = $chunks[$idx][0];
    $total = (int) $member['studentCount'];
    if ($total < PARTITION_MIN_STUDENTS * 2) {
      continue;
    }
    $hosts = [];
    foreach ($chunks as $j => $chunk) {
      if ($j === $idx || isset($dissolved[$j])) {
        continue;
      }
      if (partition_chunk_has_section($chunk, (int) $member['sectionId'])) {
        continue;
      }
      $spare = $maxCapacity - partition_chunk_count($chunk);
      if ($spare > 0) {
        $hosts[$j] = $spare;
      }
    }
    if (count($hosts) < 2) {
      continue;
    }
    arsort($hosts);
    $plan = partition_plan_for($total, $hosts);
    if (!$plan) {
      continue;
    }
    $index = 0;
    foreach ($plan as $hostIdx => $take) {
      $index++;
      $chunks[$hostIdx][] = partition_member($member, $index, count($plan), $take, $total);
    }
    $dissolved[$idx] = true;
  }
  if (!$dissolved) {
    return $chunks;
  }
  $out = [];
  foreach ($chunks as $i => $chunk) {
    if (!isset($dissolved[$i])) {
      $out[] = $chunk;
    }
  }
  return $out;
}

// Even split first, then top up: if a host cannot hold its even share the
// surplus moves to the hosts that still have seats.
function partition_plan_for(int $total, array $hosts): ?array
{
  $maxParts = min(PARTITION_MAX_PARTS, intdiv($total, PARTITION_MIN_STUDENTS), count($hosts));
  for ($k = 2; $k <= $maxParts; $k++) {
    $chosen = array_slice($hosts, 0, $k, true);
    if (array_sum($chosen) < $total) {
      continue;
    }
    $base = intdiv($total, $k);
    $extra = $total % $k;
    $take = [];
    foreach (array_keys($chosen) as $n => $hostIdx) {
      $take[$hostIdx] = $base + ($n < $extra ? 1 : 0);
    }
    $surplus = 0;
    foreach ($take as $hostIdx => $want) {
      $room = (int) $chosen[$hostIdx];
      if ($want > $room) {
        $surplus += $want - $room;
        $take[$hostIdx] = $room;
      }
    }
    foreach ($take as $hostIdx => $have) {
      if ($surplus <= 0) {
        break;
      }
      $room = (int) $chosen[$hostIdx] - $have;
      if ($room <= 0) {
        continue;
      }
      $move = min($room, $surplus);
      $take[$hostIdx] = $have + $move;
      $surplus -= $move;
    }
    if ($surplus > 0) {
      continue;
    }
    foreach ($take as $have) {
      if ($have < PARTITION_MIN_STUDENTS) {
        continue 2;
      }
    }
    return $take;
  }
  return null;
}

function partition_member(array $member, int $index, int $count, int $students, int $wholeCount): array
{
  $member['studentCount'] = $students;
  $member['partitionIndex'] = $index;
  $member['partitionCount'] = $count;
  $member['partitionStudents'] = $students;
  $member['sectionStudentCount'] = $wholeCount;
  return $member;
}

function partition_member_is_partitioned(array $member): bool
{
  return (int) ($member['partitionCount'] ?? 1) > 1;
}

function partition_chunk_count(array $chunk): int
{
  $sum = 0;
  foreach ($chunk as $member) {
    $sum += (int) $member['studentCount'];
  }
  return $sum;
}

function partition_chunk_has_section(array $chunk, int $sectionId): bool
{
  foreach ($chunk as $member) {
    if ((int) $member['sectionId'] === $sectionId) {
      return true;
    }
  }
  return false;
}

// Sibling partitions of one section may share a time slot because they hold
// different students. Everything else about the section still collides, so each
// partition carries a token and only an identical token is allowed to overlap.
function partition_lane_token(array $member): string
{
  if (!partition_member_is_partitioned($member)) {
    return '';
  }
  return 'p:' . (int) $member['sectionId']
    . ':' . (string) ($member['courseCode'] ?? '')
    . ':' . (string) ($member['component'] ?? '');
}

function partition_lanes_for_group(array $group): array
{
  $lanes = [];
  foreach ($group['members'] ?? [] as $member) {
    if (!is_array($member)) {
      continue;
    }
    $token = partition_lane_token($member);
    if ($token !== '') {
      $lanes[(int) $member['sectionId']] = $token;
    }
  }
  return $lanes;
}

function section_ids_from_payload(array $payload): array
{
  if (!empty($payload['sectionIds']) && is_array($payload['sectionIds'])) {
    return array_values(array_unique(array_map('intval', $payload['sectionIds'])));
  }
  $ids = [];
  foreach ($payload['groups'] ?? [] as $g) {
    foreach ($g['members'] ?? [] as $m) {
      $ids[(int) $m['sectionId']] = true;
    }
  }
  return array_keys($ids);
}

function bin_pack_members(array $members, array $rooms): array
{
  $left = $members;
  usort($left, static function ($a, $b) {
    if ($a['collegeId'] !== $b['collegeId']) {
      return $a['collegeId'] <=> $b['collegeId'];
    }
    return $b['studentCount'] <=> $a['studentCount'];
  });
  $chunks = [];
  while ($left) {
    $seed = array_shift($left);
    $chunk = [$seed];
    $sum = (int) $seed['studentCount'];
    $left = take_fitting($left, $chunk, $sum, $rooms, true);
    $sum = array_sum(array_column($chunk, 'studentCount'));
    $left = take_fitting($left, $chunk, $sum, $rooms, false);
    $chunks[] = $chunk;
  }
  return $chunks;
}

function take_fitting(array $left, array &$chunk, int $sum, array $rooms, bool $sameCollege): array
{
  $college = $chunk[0]['collegeId'];
  $remain = [];
  foreach ($left as $m) {
    if ($sameCollege && (int) $m['collegeId'] !== (int) $college) {
      $remain[] = $m;
      continue;
    }
    if (!$sameCollege && (int) $m['collegeId'] === (int) $college) {
      $remain[] = $m;
      continue;
    }
    $next = $sum + (int) $m['studentCount'];
    if (smallest_room_for($rooms, $next)) {
      $chunk[] = $m;
      $sum = $next;
    } else {
      $remain[] = $m;
    }
  }
  return $remain;
}

function smallest_room_for(array $rooms, int $count): ?array
{
  foreach ($rooms as $r) {
    if ((int) $r['capacity'] >= $count) {
      return $r;
    }
  }
  return null;
}

function group_from_members(array $members, PDO $pdo): array
{
  $first = $members[0];
  $sum = 0;
  foreach ($members as $m) {
    $sum += (int) $m['studentCount'];
  }
  $room = null;
  if (!empty($first['usesCampusRoom']) && $first['roomTypeId'] && $first['unresolved'] === '') {
    $room = smallest_room_for(rooms_of_type($pdo, (int) $first['roomTypeId']), $sum);
    if (!$room && count($members) > 1) {
      // Combined group does not fit any room; caller should have packed to fit.
      // Fall back to placing without a room so the run can finish with a warning.
    }
  }
  return [
    'courseCode' => $first['courseCode'],
    'courseTitle' => $first['courseTitle'],
    'component' => $first['component'],
    'hours' => $first['hours'],
    'loadUnits' => (float) ($first['loadUnits'] ?? $first['hours'] ?? 0),
    'usesCampusRoom' => !empty($first['usesCampusRoom']),
    'roomTypeId' => $first['roomTypeId'],
    'roomTypeName' => $first['roomTypeName'],
    'unresolved' => $first['unresolved'],
    'members' => $members,
    'combinedCount' => $sum,
    'roomId' => $room ? (int) $room['room_id'] : null,
    'roomCode' => $room ? room_row_label($room) : null,
    'roomCapacity' => $room ? (int) $room['capacity'] : null,
  ];
}

function merge_queue_indexes(array $groups): array
{
  $out = [];
  foreach ($groups as $i => $g) {
    if (count($g['members']) > 1 && empty($g['unresolved'])) {
      $out[] = $i;
    }
  }
  return $out;
}

function proposal_from_group(array $g): array
{
  $members = [];
  foreach ($g['members'] as $m) {
    $members[] = [
      'name' => $m['sectionName'],
      'collegeName' => $m['collegeName'],
      'studentCount' => $m['studentCount'],
    ];
  }
  $colleges = [];
  foreach ($g['members'] as $m) {
    $colleges[$m['collegeId']] = true;
  }
  return [
    'courseCode' => $g['courseCode'],
    'courseTitle' => $g['courseTitle'],
    'component' => $g['component'],
    'combinedCount' => $g['combinedCount'],
    'roomCode' => $g['roomCode'],
    'roomCapacity' => $g['roomCapacity'],
    'sameCollege' => count($colleges) === 1,
    'members' => $members,
  ];
}

function split_group_to_singletons(array $groups, int $idx): array
{
  $g = $groups[$idx];
  $replacements = [];
  foreach ($g['members'] as $m) {
    $one = $g;
    $one['members'] = [$m];
    $one['combinedCount'] = (int) $m['studentCount'];
    $one['roomId'] = null;
    $one['roomCode'] = null;
    $one['roomCapacity'] = null;
    $replacements[] = $one;
  }
  array_splice($groups, $idx, 1, $replacements);
  return $groups;
}

function assign_rooms_to_groups(PDO $pdo, array $groups): array
{
  foreach ($groups as &$g) {
    if ($g['unresolved'] !== '' || empty($g['usesCampusRoom']) || !$g['roomTypeId']) {
      continue;
    }
    $room = smallest_room_for(rooms_of_type($pdo, (int) $g['roomTypeId']), (int) $g['combinedCount']);
    if ($room) {
      $g['roomId'] = (int) $room['room_id'];
      $g['roomCode'] = room_row_label($room);
      $g['roomCapacity'] = (int) $room['capacity'];
    } else {
      $g['roomId'] = null;
      $g['roomCode'] = null;
      $g['roomCapacity'] = null;
    }
  }
  unset($g);
  return $groups;
}

function persist_and_place(PDO $pdo, int $termId, array $groups, array $sectionIds, bool $keepOfferings = false, array $settings = []): void
{
  $ids = [];
  foreach ($sectionIds as $sid) {
    $ids[(int) $sid] = true;
  }
  foreach ($groups as $g) {
    foreach ($g['members'] as $m) {
      $ids[(int) $m['sectionId']] = true;
    }
  }
  if ($ids) {
    $in = implode(',', array_map('intval', array_keys($ids)));
    if ($keepOfferings) {
      $pdo->exec(
        "DELETE m FROM class_meetings m
         INNER JOIN class_offerings o ON o.offering_id = m.offering_id
         WHERE m.term_id = {$termId} AND o.section_id IN ({$in})"
      );
      if (schema_table_exists($pdo, 'merged_class_members')) {
        $pdo->exec(
          "DELETE mem FROM merged_class_members mem
           INNER JOIN class_offerings o ON o.offering_id = mem.offering_id
           WHERE o.term_id = {$termId} AND o.section_id IN ({$in})"
        );
      }
    } else {
      $pdo->exec("DELETE FROM class_offerings WHERE term_id = {$termId} AND section_id IN ({$in})");
    }
    $pdo->exec(
      "DELETE mc FROM merged_classes mc
       LEFT JOIN merged_class_members mcm ON mcm.merged_class_id = mc.merged_class_id
       WHERE mc.term_id = {$termId} AND mcm.merged_class_id IS NULL"
    );
  }
  $groups = assign_rooms_to_groups($pdo, $groups);
  $placed = place_groups_in_memory($pdo, $groups, $settings);
  $hasNotes = schema_column_exists($pdo, 'class_offerings', 'notes');
  $findOff = $keepOfferings
    ? $pdo->prepare(
      'SELECT offering_id FROM class_offerings
       WHERE term_id = ? AND section_id = ? AND curriculum_course_id = ? AND component = ?'
    )
    : null;
  foreach ($placed as $g) {
    $offeringIds = [];
    $hasMeetings = !empty($g['meetings']);
    $status = offering_public_status('scheduled', $hasMeetings);
    $note = !empty($g['unresolved']) ? (string) $g['unresolved'] : null;
    foreach ($g['members'] as $m) {
      $oid = 0;
      if ($findOff) {
        $findOff->execute([$termId, $m['sectionId'], $m['curriculumCourseId'], $g['component']]);
        $oid = (int) $findOff->fetchColumn();
      }
      if ($oid) {
        persist_update_offering($pdo, $oid, $termId, $g['hours'], $status, $note, $hasNotes);
      } else {
        $oid = persist_insert_offering(
          $pdo,
          $termId,
          (int) $m['sectionId'],
          (int) $m['curriculumCourseId'],
          (string) $g['component'],
          (float) $g['hours'],
          $status,
          $note,
          $hasNotes
        );
      }
      $offeringIds[] = $oid;
    }
    $mergedId = null;
    if (count($offeringIds) > 1) {
      $insM = $pdo->prepare(
        'INSERT INTO merged_classes (term_id, course_code, component, room_id) VALUES (?, ?, ?, ?)'
      );
      $insM->execute([$termId, $g['courseCode'], $g['component'], $g['roomId']]);
      $mergedId = (int) $pdo->lastInsertId();
      $insMem = $pdo->prepare(
        'INSERT INTO merged_class_members (merged_class_id, offering_id) VALUES (?, ?)'
      );
      foreach ($offeringIds as $oid) {
        $insMem->execute([$mergedId, $oid]);
      }
    }
    $meetIns = $pdo->prepare(
      'INSERT INTO class_meetings (offering_id, term_id, day_of_week, start_time, end_time, room_id)
       VALUES (?, ?, ?, ?, ?, ?)'
    );
    foreach ($g['meetings'] as $meet) {
      foreach ($offeringIds as $i => $oid) {
        $room = ($i === 0) ? $meet['roomId'] : null;
        $meetIns->execute([
          $oid,
          $termId,
          $meet['day'],
          $meet['start'],
          $meet['end'],
          $room,
        ]);
      }
    }
  }
}

function classes_from_placed_groups(PDO $pdo, int $termId, array $placed): array
{
  $secMeta = [];
  if (schema_table_exists($pdo, 'sections')) {
    $stmt = $pdo->prepare(
      'SELECT s.section_id, s.year_level, s.student_count, s.is_retake,
              p.program_id, p.program_name, p.represents_college, p.college_id, c.college_name
       FROM sections s
       JOIN programs p ON p.program_id = s.program_id
       JOIN colleges c ON c.college_id = p.college_id
       WHERE s.term_id = ?'
    );
    $stmt->execute([$termId]);
    foreach ($stmt->fetchAll() as $row) {
      $secMeta[(int) $row['section_id']] = $row;
    }
  }
  $findOff = schema_table_exists($pdo, 'class_offerings')
    ? $pdo->prepare(
      'SELECT offering_id FROM class_offerings
       WHERE term_id = ? AND section_id = ? AND curriculum_course_id = ? AND component = ?'
    )
    : null;
  $roomsById = [];
  foreach (list_campus_rooms($pdo) as $room) {
    $rid = parse_id((string) ($room['id'] ?? ''), 'r');
    if ($rid) {
      $roomsById[$rid] = $room;
    }
  }
  $classes = [];
  $tmp = 0;
  foreach ($placed as $gi => $g) {
    $status = offering_public_status('scheduled', !empty($g['meetings']));
    foreach ($g['members'] as $i => $m) {
      $sid = (int) $m['sectionId'];
      $meta = $secMeta[$sid] ?? [];
      $oid = 0;
      if ($findOff) {
        $findOff->execute([
          $termId,
          $sid,
          (int) $m['curriculumCourseId'],
          $g['component'] ?? $m['component'],
        ]);
        $oid = (int) $findOff->fetchColumn();
      }
      $tmp++;
      $offId = $oid ? public_id('off', $oid) : 'off-tmp-' . $tmp;
      // Partitions of one section share the offering row, so the class rows
      // need distinct ids or edits would all land on the first partition.
      if ((int) ($m['partitionCount'] ?? 1) > 1) {
        $offId .= '-p' . (int) ($m['partitionIndex'] ?? 1);
      }
      $meetings = [];
      foreach ($g['meetings'] ?? [] as $j => $meet) {
        $rid = ($i === 0) ? (int) ($meet['roomId'] ?? $g['roomId'] ?? 0) : 0;
        $room = $rid && isset($roomsById[$rid]) ? $roomsById[$rid] : null;
        $meetings[] = [
          'id' => 'mt-tmp-' . $gi . '-' . $i . '-' . $j,
          'day' => $meet['day'],
          'start' => substr((string) ($meet['start'] ?? ''), 0, 5),
          'end' => substr((string) ($meet['end'] ?? ''), 0, 5),
          'roomId' => $rid ? public_id('r', $rid) : null,
          'roomCode' => $room['label'] ?? ($rid ? (string) ($g['roomCode'] ?? '') : ''),
          'buildingId' => $room['buildingId'] ?? null,
          'buildingName' => $room['buildingName'] ?? '',
          'roomCapacity' => $room['capacity'] ?? ($g['roomCapacity'] ?? null),
        ];
      }
      $represents = (int) ($meta['represents_college'] ?? 0) === 1;
      $classes[] = [
        'id' => $offId,
        'sectionId' => public_id('s', $sid),
        'sectionName' => $m['sectionName'] ?? '',
        'collegeId' => public_id('c', (int) ($m['collegeId'] ?? $meta['college_id'] ?? 0)),
        'collegeName' => $m['collegeName'] ?? (string) ($meta['college_name'] ?? ''),
        'departmentId' => (!$represents && !empty($meta['program_id']))
          ? public_id('d', (int) $meta['program_id'])
          : null,
        'yearLevel' => (int) ($meta['year_level'] ?? 0),
        'isRetake' => (int) ($meta['is_retake'] ?? 0) === 1,
        'studentCount' => (int) ($m['studentCount'] ?? $meta['student_count'] ?? 0),
        'courseCode' => $m['courseCode'] ?? $g['courseCode'],
        'courseTitle' => $m['courseTitle'] ?? $g['courseTitle'],
        'component' => $m['component'] ?? $g['component'],
        'hoursPerWeek' => (float) ($g['hours'] ?? $m['hours'] ?? 0),
        'loadUnits' => (float) ($g['loadUnits'] ?? $m['loadUnits'] ?? $g['hours'] ?? 0),
        'roomTypeName' => $g['roomTypeName'] ?? ($m['roomTypeName'] ?? ''),
        'requiresCampusRoom' => !empty($g['usesCampusRoom']),
        'status' => $status,
        'notes' => !empty($g['unresolved']) ? (string) $g['unresolved'] : null,
        'mergedClassId' => count($g['members']) > 1
          ? 'mc-tmp-' . ($g['courseCode'] ?? '') . '-' . ($g['component'] ?? '') . '-' . $gi
          : null,
        'partitionIndex' => (int) ($m['partitionIndex'] ?? 1),
        'partitionCount' => (int) ($m['partitionCount'] ?? 1),
        'partitionStudents' => isset($m['partitionStudents']) ? (int) $m['partitionStudents'] : null,
        'sectionStudentCount' => (int) ($m['sectionStudentCount'] ?? $m['studentCount'] ?? $meta['student_count'] ?? 0),
        'meetings' => $meetings,
      ];
    }
  }
  return $classes;
}

function placement_day_windows(bool $keepLunch): array
{
  return $keepLunch ? [range(0, 9), range(12, 23)] : [range(0, 23)];
}

function order_days_by_existing(array $days, array $sectionIds, array $sBusy): array
{
  $decorated = [];
  foreach (array_values($days) as $i => $day) {
    $decorated[] = [day_has_classes($sectionIds, $day, $sBusy) ? 0 : 1, $i, $day];
  }
  sort($decorated);
  return array_map(static function ($row) {
    return $row[2];
  }, $decorated);
}

function order_pairs_by_existing(array $pairs, array $sectionIds, array $sBusy): array
{
  $decorated = [];
  foreach (array_values($pairs) as $i => $pair) {
    $busy = day_has_classes($sectionIds, $pair[0], $sBusy) || day_has_classes($sectionIds, $pair[1], $sBusy);
    $decorated[] = [$busy ? 0 : 1, $i, $pair];
  }
  sort($decorated);
  return array_map(static function ($row) {
    return $row[2];
  }, $decorated);
}

function day_has_classes(array $sectionIds, string $day, array $sBusy): bool
{
  foreach ($sectionIds as $sid) {
    if (!empty($sBusy[$sid][$day])) {
      return true;
    }
  }
  return false;
}

function sections_day_vacant_ok(array $sectionIds, string $day, array $newIntervals, array $sBusy): bool
{
  foreach ($sectionIds as $sid) {
    if (!vacant_gaps_ok(occupied_slots_for_day((int) $sid, $day, $sBusy, $newIntervals))) {
      return false;
    }
  }
  return true;
}

function occupied_slots_for_day(int $sid, string $day, array $sBusy, array $newIntervals): array
{
  $slots = [];
  foreach ($sBusy[$sid][$day] ?? [] as $s => $on) {
    if ($on) {
      $slots[(int) $s] = true;
    }
  }
  foreach ($newIntervals as $iv) {
    for ($s = (int) $iv[0]; $s < (int) $iv[1]; $s++) {
      $slots[$s] = true;
    }
  }
  return $slots;
}

function vacant_gaps_ok(array $slotSet): bool
{
  if (count($slotSet) < 2) {
    return true;
  }
  $keys = array_map('intval', array_keys($slotSet));
  sort($keys);
  $a = $keys[0];
  $prev = $keys[0];
  $intervals = [];
  for ($i = 1; $i < count($keys); $i++) {
    if ($keys[$i] === $prev + 1) {
      $prev = $keys[$i];
      continue;
    }
    $intervals[] = [$a, $prev + 1];
    $a = $keys[$i];
    $prev = $keys[$i];
  }
  $intervals[] = [$a, $prev + 1];
  for ($i = 1; $i < count($intervals); $i++) {
    $vacant = 0;
    for ($s = $intervals[$i - 1][1]; $s < $intervals[$i][0]; $s++) {
      if ($s === 10 || $s === 11) {
        continue;
      }
      $vacant++;
    }
    if ($vacant > 4) {
      return false;
    }
  }
  return true;
}

function compactness_score(array $sectionIds, string $day, array $newIntervals, array $sBusy): int
{
  $total = 0;
  foreach ($sectionIds as $sid) {
    $total += vacant_total(occupied_slots_for_day((int) $sid, $day, $sBusy, $newIntervals));
  }
  return $total;
}

function vacant_total(array $slotSet): int
{
  if (count($slotSet) < 2) {
    return 0;
  }
  $keys = array_map('intval', array_keys($slotSet));
  sort($keys);
  $vacant = 0;
  for ($s = $keys[0]; $s <= $keys[count($keys) - 1]; $s++) {
    if ($s === 10 || $s === 11) {
      continue;
    }
    if (empty($slotSet[$s])) {
      $vacant++;
    }
  }
  return $vacant;
}

function block_from(string $day, int $startSlot, int $len, ?int $roomId): array
{
  return [
    'day' => $day,
    'start' => slot_to_time($startSlot),
    'end' => slot_to_time($startSlot + $len),
    'roomId' => $roomId,
  ];
}

function slot_to_time(int $slot): string
{
  $minutes = 7 * 60 + $slot * 30;
  return sprintf('%02d:%02d:00', intdiv($minutes, 60), $minutes % 60);
}

function time_to_slot(string $time): int
{
  [$h, $m] = array_map('intval', explode(':', $time));
  return (int) ((($h * 60 + $m) - 7 * 60) / 30);
}

function seed_busy_from_private_classes(array $classes, array &$sectionBusy, array &$roomBusy): void
{
  foreach ($classes as $c) {
    if (!is_array($c) || empty($c['meetings'])) {
      continue;
    }
    $sid = parse_id((string) ($c['sectionId'] ?? ''), 's');
    if (!$sid) {
      continue;
    }
    $lane = true;
    if ((int) ($c['partitionCount'] ?? 1) > 1) {
      $lane = 'p:' . $sid . ':' . (string) ($c['courseCode'] ?? '') . ':' . (string) ($c['component'] ?? '');
    }
    foreach ($c['meetings'] as $m) {
      if (!is_array($m)) {
        continue;
      }
      $day = (string) ($m['day'] ?? '');
      if ($day === '') {
        continue;
      }
      $start = time_to_slot(substr((string) ($m['start'] ?? '00:00'), 0, 5));
      $end = time_to_slot(substr((string) ($m['end'] ?? '00:00'), 0, 5));
      if ($end <= $start) {
        continue;
      }
      $rid = parse_id((string) ($m['roomId'] ?? ''), 'r');
      for ($s = $start; $s < $end; $s++) {
        $sectionBusy[$sid][$day][$s] = $lane;
        if ($rid) {
          $roomBusy[$rid][$day][$s] = true;
        }
      }
    }
  }
}

function place_groups_in_memory(PDO $pdo, array $groups, array $settings = [], array $seedClasses = []): array
{
  $settings = normalize_generator_settings($settings);
  $roomsByType = placement_rooms_by_type($pdo);
  usort($groups, static function ($a, $b) {
    $members = count($b['members']) <=> count($a['members']);
    if ($members !== 0) {
      return $members;
    }
    $hours = $b['hours'] <=> $a['hours'];
    if ($hours !== 0) {
      return $hours;
    }
    $aLab = (($a['component'] ?? '') === 'laboratory') ? 1 : 0;
    $bLab = (($b['component'] ?? '') === 'laboratory') ? 1 : 0;
    return $aLab <=> $bLab;
  });
  $sectionBusy = [];
  $roomBusy = [];
  if ($seedClasses) {
    seed_busy_from_private_classes($seedClasses, $sectionBusy, $roomBusy);
  }
  foreach ($groups as &$g) {
    $g['meetings'] = [];
    if ($g['unresolved'] !== '' || $g['hours'] <= 0) {
      continue;
    }
    $needRoom = !empty($g['usesCampusRoom']);
    if ($needRoom && !$g['roomId']) {
      $g['unresolved'] = 'No room large enough for ' . $g['combinedCount'] . ' students.';
      continue;
    }
    $memberIds = array_map(static function ($m) {
      return (int) $m['sectionId'];
    }, $g['members']);
    $roomChoices = placement_room_choices($g, $roomsByType);
    $lanes = partition_lanes_for_group($g);
    $meetings = null;
    $chosenRoom = $g['roomId'] ? (int) $g['roomId'] : null;
    foreach ($roomChoices as $roomId) {
      $meetings = find_placement(
        $g['hours'],
        $memberIds,
        $roomId,
        $sectionBusy,
        $roomBusy,
        $settings,
        $lanes
      );
      if ($meetings) {
        $chosenRoom = $roomId;
        break;
      }
    }
    if (!$meetings) {
      $g['unresolved'] = 'No free MW / TTh / FS slot in the available rooms.';
      continue;
    }
    $g['meetings'] = $meetings;
    if ($chosenRoom && (int) ($g['roomId'] ?? 0) !== (int) $chosenRoom) {
      $g['roomId'] = (int) $chosenRoom;
      $meta = placement_room_meta($roomsByType, (int) $chosenRoom);
      if ($meta) {
        $g['roomCode'] = $meta['label'];
        $g['roomCapacity'] = $meta['capacity'];
      }
    }
  }
  unset($g);
  return $groups;
}

function find_placement(
  float $hours,
  array $sectionIds,
  ?int $roomId,
  array &$sectionBusy,
  array &$roomBusy,
  array $settings = [],
  array $lanes = []
): ?array {
  $settings = normalize_generator_settings($settings);
  $splitHours = (float) $settings['splitHours'];
  $keepLunch = !empty($settings['keepLunch']);
  $slotsWeek = (int) round($hours * 2);
  if ($slotsWeek < 1) {
    return null;
  }
  $pairs = [
    ['Mon', 'Wed'],
    ['Tue', 'Thu'],
    ['Fri', 'Sat'],
  ];
  $single = order_days_by_existing(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], $sectionIds, $sectionBusy);
  if ($hours <= $splitHours + 0.0001) {
    foreach ($single as $day) {
      $blocks = try_day_blocks(
        $slotsWeek,
        $day,
        $sectionIds,
        $roomId,
        $sectionBusy,
        $roomBusy,
        $keepLunch,
        $lanes
      );
      if ($blocks) {
        occupy($blocks, $sectionIds, $roomId, $sectionBusy, $roomBusy, $lanes);
        return $blocks;
      }
    }
    return null;
  }
  $perDay = (int) ceil($slotsWeek / 2);
  $other = $slotsWeek - $perDay;
  foreach (order_pairs_by_existing($pairs, $sectionIds, $sectionBusy) as $pair) {
    $blocks = try_pair_same_clock(
      $perDay,
      $other > 0 ? $other : $perDay,
      $pair[0],
      $pair[1],
      $sectionIds,
      $roomId,
      $sectionBusy,
      $roomBusy,
      $keepLunch,
      $lanes
    );
    if ($blocks) {
      occupy($blocks, $sectionIds, $roomId, $sectionBusy, $roomBusy, $lanes);
      return $blocks;
    }
  }
  return null;
}

function try_pair_same_clock(
  int $lenA,
  int $lenB,
  string $dayA,
  string $dayB,
  array $sectionIds,
  ?int $roomId,
  array $sectionBusy,
  array $roomBusy,
  bool $keepLunch = true,
  array $lanes = []
): ?array {
  $windows = placement_day_windows($keepLunch);
  $maxLen = max($lenA, $lenB);
  foreach ($windows as $win) {
    if ($maxLen > count($win)) {
      continue;
    }
    $maxStart = count($win) - $maxLen;
    for ($i = 0; $i <= $maxStart; $i++) {
      $start = $win[$i];
      if (
        slot_open_and_compact($start, $lenA, $dayA, $sectionIds, $roomId, $sectionBusy, $roomBusy, [], $lanes)
        && slot_open_and_compact($start, $lenB, $dayB, $sectionIds, $roomId, $sectionBusy, $roomBusy, [], $lanes)
      ) {
        return [
          block_from($dayA, $start, $lenA, $roomId),
          block_from($dayB, $start, $lenB, $roomId),
        ];
      }
    }
  }
  if (!$keepLunch || $maxLen <= 10) {
    return null;
  }
  foreach (range(0, 9) as $mStart) {
    $morningLen = 10 - $mStart;
    $restA = $lenA - $morningLen;
    $restB = $lenB - $morningLen;
    if ($restA < 1 || $restB < 1 || $restA > 12 || $restB > 12) {
      continue;
    }
    if (
      slot_open_and_compact($mStart, $morningLen, $dayA, $sectionIds, $roomId, $sectionBusy, $roomBusy, [], $lanes)
      && slot_open_and_compact(12, $restA, $dayA, $sectionIds, $roomId, $sectionBusy, $roomBusy, [[$mStart, $mStart + $morningLen]], $lanes)
      && slot_open_and_compact($mStart, $morningLen, $dayB, $sectionIds, $roomId, $sectionBusy, $roomBusy, [], $lanes)
      && slot_open_and_compact(12, $restB, $dayB, $sectionIds, $roomId, $sectionBusy, $roomBusy, [[$mStart, $mStart + $morningLen]], $lanes)
    ) {
      return [
        block_from($dayA, $mStart, $morningLen, $roomId),
        block_from($dayA, 12, $restA, $roomId),
        block_from($dayB, $mStart, $morningLen, $roomId),
        block_from($dayB, 12, $restB, $roomId),
      ];
    }
  }
  return null;
}

function try_day_blocks(
  int $slots,
  string $day,
  array $sectionIds,
  ?int $roomId,
  array $sectionBusy,
  array $roomBusy,
  bool $keepLunch = true,
  array $lanes = []
): ?array {
  $windows = placement_day_windows($keepLunch);
  foreach ($windows as $win) {
    $start = fit_contiguous($win, $slots, $day, $sectionIds, $roomId, $sectionBusy, $roomBusy, $lanes);
    if ($start !== null) {
      return [block_from($day, $start, $slots, $roomId)];
    }
  }
  if (!$keepLunch || $slots <= 10) {
    return null;
  }
  foreach (range(0, 9) as $mStart) {
    $morningLen = 10 - $mStart;
    $rest = $slots - $morningLen;
    if ($rest < 1 || $rest > 12) {
      continue;
    }
    if (
      slot_open_and_compact($mStart, $morningLen, $day, $sectionIds, $roomId, $sectionBusy, $roomBusy, [], $lanes)
      && slot_open_and_compact(12, $rest, $day, $sectionIds, $roomId, $sectionBusy, $roomBusy, [[$mStart, $mStart + $morningLen]], $lanes)
    ) {
      return [
        block_from($day, $mStart, $morningLen, $roomId),
        block_from($day, 12, $rest, $roomId),
      ];
    }
  }
  return null;
}

function fit_contiguous(
  array $win,
  int $slots,
  string $day,
  array $sectionIds,
  ?int $roomId,
  array $sBusy,
  array $rBusy,
  array $lanes = []
): ?int {
  if ($slots > count($win)) {
    return null;
  }
  $maxStart = count($win) - $slots;
  $best = null;
  $bestScore = PHP_INT_MAX;
  for ($i = 0; $i <= $maxStart; $i++) {
    $start = $win[$i];
    if (!slot_open_and_compact($start, $slots, $day, $sectionIds, $roomId, $sBusy, $rBusy, [], $lanes)) {
      continue;
    }
    $score = compactness_score($sectionIds, $day, [[$start, $start + $slots]], $sBusy);
    if ($score < $bestScore || ($score === $bestScore && ($best === null || $start < $best))) {
      $best = $start;
      $bestScore = $score;
    }
  }
  return $best;
}

function range_free(
  int $start,
  int $len,
  string $day,
  array $sectionIds,
  ?int $roomId,
  array $sBusy,
  array $rBusy,
  array $lanes = []
): bool {
  for ($s = $start; $s < $start + $len; $s++) {
    if ($s === 10 || $s === 11) {
      return false;
    }
    foreach ($sectionIds as $sid) {
      $held = $sBusy[$sid][$day][$s] ?? null;
      if (!empty($held) && $held !== ($lanes[$sid] ?? '')) {
        return false;
      }
    }
    if ($roomId && !empty($rBusy[$roomId][$day][$s])) {
      return false;
    }
  }
  return true;
}

function slot_open_and_compact(
  int $start,
  int $len,
  string $day,
  array $sectionIds,
  ?int $roomId,
  array $sBusy,
  array $rBusy,
  array $extraIntervals = [],
  array $lanes = []
): bool {
  if (!range_free($start, $len, $day, $sectionIds, $roomId, $sBusy, $rBusy, $lanes)) {
    return false;
  }
  $intervals = $extraIntervals;
  $intervals[] = [$start, $start + $len];
  return sections_day_vacant_ok($sectionIds, $day, $intervals, $sBusy);
}

function occupy(
  array $blocks,
  array $sectionIds,
  ?int $roomId,
  array &$sBusy,
  array &$rBusy,
  array $lanes = []
): void {
  foreach ($blocks as $b) {
    $start = time_to_slot($b['start']);
    $end = time_to_slot($b['end']);
    for ($s = $start; $s < $end; $s++) {
      foreach ($sectionIds as $sid) {
        $sBusy[$sid][$b['day']][$s] = $lanes[$sid] ?? true;
      }
      if ($roomId) {
        $rBusy[$roomId][$b['day']][$s] = true;
      }
    }
  }
}

function placement_rooms_by_type(PDO $pdo): array
{
  $out = [];
  if (!schema_table_exists($pdo, 'rooms')) {
    return $out;
  }
  $sql = "SELECT r.room_id, r.room_type_id, r.room_code, r.capacity, b.building_name, b.building_code
          FROM rooms r
          LEFT JOIN floors f ON f.floor_id = r.floor_id
          LEFT JOIN buildings b ON b.building_id = f.building_id
          WHERE r.status = 'active' AND r.capacity > 0
            AND (b.building_id IS NULL OR b.is_active = 1)
          ORDER BY r.capacity ASC, b.building_name, r.room_code";
  foreach ($pdo->query($sql) as $row) {
    $tid = (int) ($row['room_type_id'] ?? 0);
    $out[$tid][] = $row;
  }
  return $out;
}

function placement_room_choices(array $g, array $roomsByType): array
{
  if (empty($g['usesCampusRoom'])) {
    return [null];
  }
  $typeId = (int) ($g['roomTypeId'] ?? 0);
  $need = (int) ($g['combinedCount'] ?? 0);
  $ids = [];
  $assigned = (int) ($g['roomId'] ?? 0);
  if ($assigned) {
    $ids[] = $assigned;
  }
  foreach ($roomsByType[$typeId] ?? [] as $row) {
    if ((int) $row['capacity'] < $need) {
      continue;
    }
    $rid = (int) $row['room_id'];
    if (!in_array($rid, $ids, true)) {
      $ids[] = $rid;
    }
  }
  return $ids;
}

function placement_room_meta(array $roomsByType, int $roomId): ?array
{
  foreach ($roomsByType as $rows) {
    foreach ($rows as $row) {
      if ((int) $row['room_id'] === $roomId) {
        return [
          'label' => room_row_label($row),
          'capacity' => (int) $row['capacity'],
        ];
      }
    }
  }
  return null;
}

function offering_public_status(string $stored, bool $hasMeetings): string
{
  return $hasMeetings ? 'scheduled' : 'unscheduled';
}

function persist_update_offering(
  PDO $pdo,
  int $oid,
  int $termId,
  $hours,
  string $status,
  ?string $note,
  bool $hasNotes
): void {
  if ($hasNotes) {
    $pdo->prepare(
      'UPDATE class_offerings SET hours_per_week = ?, status = ?, notes = ? WHERE offering_id = ? AND term_id = ?'
    )->execute([$hours, $status, $note, $oid, $termId]);
    return;
  }
  $pdo->prepare(
    'UPDATE class_offerings SET hours_per_week = ?, status = ? WHERE offering_id = ? AND term_id = ?'
  )->execute([$hours, $status, $oid, $termId]);
}

function persist_insert_offering(
  PDO $pdo,
  int $termId,
  int $sectionId,
  int $curriculumCourseId,
  string $component,
  float $hours,
  string $status,
  ?string $note,
  bool $hasNotes
): int {
  if ($hasNotes) {
    $pdo->prepare(
      'INSERT INTO class_offerings
        (term_id, section_id, curriculum_course_id, component, hours_per_week, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([$termId, $sectionId, $curriculumCourseId, $component, $hours, $status, $note]);
  } else {
    $pdo->prepare(
      'INSERT INTO class_offerings
        (term_id, section_id, curriculum_course_id, component, hours_per_week, status)
       VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$termId, $sectionId, $curriculumCourseId, $component, $hours, $status]);
  }
  return (int) $pdo->lastInsertId();
}

function refresh_group_status(PDO $pdo, array $members): void
{
  $hasNotes = schema_column_exists($pdo, 'class_offerings', 'notes');
  foreach ($members as $m) {
    $oid = (int) ($m['offering_id'] ?? 0);
    if (!$oid) {
      continue;
    }
    $meets = offering_meetings($pdo, $oid);
    $status = offering_public_status('scheduled', $meets !== []);
    if ($hasNotes) {
      $pdo->prepare('UPDATE class_offerings SET status = ?, notes = ? WHERE offering_id = ?')->execute([$status, null, $oid]);
    } else {
      $pdo->prepare('UPDATE class_offerings SET status = ? WHERE offering_id = ?')->execute([$status, $oid]);
    }
  }
}

function list_scheduled_classes(PDO $pdo, int $termId): array
{
  $notesCol = schema_column_exists($pdo, 'class_offerings', 'notes') ? 'o.notes' : 'NULL AS notes';
  $sql = "SELECT o.offering_id, o.section_id, o.component, o.hours_per_week, o.status, {$notesCol},
                 o.curriculum_course_id, cc.course_id, cc.course_title,
                 cc.lecture_room_type, cc.lab_room_type, cc.lecture_units, cc.lab_units,
                 s.section_code, s.year_level, s.student_count, s.is_retake,
                 p.program_name, p.represents_college, p.college_id, p.program_id, col.college_name,
                 m.meeting_id, m.day_of_week, m.start_time, m.end_time,
                 COALESCE(m.room_id, mc.room_id) AS room_id,
                 r.room_code, r.capacity, b.building_id, b.building_name, b.building_code,
                 mem.merged_class_id
          FROM class_offerings o
          JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
          JOIN sections s ON s.section_id = o.section_id
          JOIN programs p ON p.program_id = s.program_id
          JOIN colleges col ON col.college_id = p.college_id
          LEFT JOIN class_meetings m ON m.offering_id = o.offering_id
          LEFT JOIN merged_class_members mem ON mem.offering_id = o.offering_id
          LEFT JOIN merged_classes mc ON mc.merged_class_id = mem.merged_class_id
          LEFT JOIN rooms r ON r.room_id = COALESCE(m.room_id, mc.room_id)
          LEFT JOIN floors fl ON fl.floor_id = r.floor_id
          LEFT JOIN buildings b ON b.building_id = fl.building_id
          WHERE o.term_id = ?
          ORDER BY col.college_name, p.program_name, s.year_level, s.section_code, cc.course_id, o.component, m.day_of_week, m.start_time";
  $stmt = $pdo->prepare($sql);
  $stmt->execute([$termId]);
  $byOff = [];
  foreach ($stmt->fetchAll() as $row) {
    $oid = (int) $row['offering_id'];
    if (!isset($byOff[$oid])) {
      $prog = (int) $row['represents_college'] === 1 ? $row['college_name'] : $row['program_name'];
      $byOff[$oid] = [
        'id' => public_id('off', $oid),
        'sectionId' => public_id('s', (int) $row['section_id']),
        'sectionName' => $prog . ' ' . (int) $row['year_level'] . '-' . $row['section_code'],
        'collegeId' => public_id('c', (int) $row['college_id']),
        'collegeName' => $row['college_name'],
        'departmentId' => ((int) $row['represents_college'] === 1) ? null : public_id('d', (int) $row['program_id']),
        'yearLevel' => (int) $row['year_level'],
        'isRetake' => (int) $row['is_retake'] === 1,
        'studentCount' => (int) $row['student_count'],
        'courseCode' => $row['course_id'],
        'courseTitle' => $row['course_title'],
        'component' => $row['component'],
        'hoursPerWeek' => (float) $row['hours_per_week'],
        'loadUnits' => (float) (($row['component'] === 'laboratory')
          ? ($row['lab_units'] ?? 0)
          : ($row['lecture_units'] ?? 0)),
        'roomTypeName' => $row['component'] === 'laboratory'
          ? trim((string) ($row['lab_room_type'] ?? ''))
          : trim((string) ($row['lecture_room_type'] ?? '')),
        'requiresCampusRoom' => true,
        'status' => $row['status'],
        'notes' => $row['notes'] ?? null,
        'mergedClassId' => $row['merged_class_id'] ? public_id('mc', (int) $row['merged_class_id']) : null,
        'meetings' => [],
      ];
      $typeName = $byOff[$oid]['roomTypeName'];
      if ($typeName !== '') {
        $typeRow = room_type_row_by_name($pdo, $typeName);
        if ($typeRow) {
          $byOff[$oid]['requiresCampusRoom'] = (int) ($typeRow['requires_campus_room'] ?? 1) === 1;
        }
      }
    }
    if (!empty($row['meeting_id'])) {
      $byOff[$oid]['meetings'][] = [
        'id' => public_id('mt', (int) $row['meeting_id']),
        'day' => $row['day_of_week'],
        'start' => substr((string) $row['start_time'], 0, 5),
        'end' => substr((string) $row['end_time'], 0, 5),
        'roomId' => $row['room_id'] ? public_id('r', (int) $row['room_id']) : null,
        'roomCode' => format_room_label(
          isset($row['building_name']) ? (string) $row['building_name'] : null,
          isset($row['building_code']) ? (string) $row['building_code'] : null,
          $row['room_code'] !== null ? (string) $row['room_code'] : null
        ),
        'buildingId' => !empty($row['building_id']) ? public_id('b', (int) $row['building_id']) : null,
        'buildingName' => isset($row['building_name']) ? (string) $row['building_name'] : '',
        'roomCapacity' => $row['capacity'] !== null ? (int) $row['capacity'] : null,
      ];
    }
  }
  foreach ($byOff as &$cls) {
    $cls['status'] = offering_public_status(
      (string) ($cls['status'] ?? 'unscheduled'),
      !empty($cls['meetings'])
    );
  }
  unset($cls);
  return array_values($byOff);
}

function schedule_summary(array $classes): array
{
  $n = count($classes);
  $scheduled = 0;
  $unscheduled = 0;
  foreach ($classes as $c) {
    if (
      ($c['status'] ?? '') === 'scheduled'
      && !empty($c['meetings'])
    ) {
      $scheduled++;
    } else {
      $unscheduled++;
    }
  }
  return ['offerings' => $n, 'scheduled' => $scheduled, 'unscheduled' => $unscheduled];
}

function list_campus_rooms(PDO $pdo): array
{
  if (!schema_table_exists($pdo, 'rooms')) {
    return [];
  }
  $sql = "SELECT r.room_id, r.room_code, r.capacity, r.status,
                 rt.room_type_name,
                 fl.floor_number,
                 b.building_id, b.building_name, b.building_code, b.is_active
          FROM rooms r
          LEFT JOIN room_types rt ON rt.room_type_id = r.room_type_id
          LEFT JOIN floors fl ON fl.floor_id = r.floor_id
          LEFT JOIN buildings b ON b.building_id = fl.building_id
          ORDER BY COALESCE(b.building_name, b.building_code, ''), r.room_code";
  $out = [];
  foreach ($pdo->query($sql) as $row) {
    $buildingActive = $row['building_id'] ? ((int) ($row['is_active'] ?? 1) === 1) : true;
    $out[] = [
      'id' => public_id('r', (int) $row['room_id']),
      'code' => $row['room_code'],
      'label' => format_room_label(
        isset($row['building_name']) ? (string) $row['building_name'] : null,
        isset($row['building_code']) ? (string) $row['building_code'] : null,
        $row['room_code'] !== null ? (string) $row['room_code'] : null
      ),
      'capacity' => (int) $row['capacity'],
      'status' => (string) ($row['status'] ?? 'active'),
      'buildingActive' => $buildingActive,
      'typeName' => (string) ($row['room_type_name'] ?? ''),
      'floorNumber' => $row['floor_number'] !== null && $row['floor_number'] !== '' ? (int) $row['floor_number'] : null,
      'buildingId' => $row['building_id'] ? public_id('b', (int) $row['building_id']) : 'b-none',
      'buildingName' => trim((string) ($row['building_name'] ?: $row['building_code'] ?: 'Unassigned')),
    ];
  }
  return $out;
}

function normalize_clock(string $time): string
{
  $time = trim($time);
  if (!preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $time, $m)) {
    throw new RuntimeException('Enter a valid time.');
  }
  $h = (int) $m[1];
  $min = (int) $m[2];
  if ($h < 7 || $h > 19 || ($h === 19 && $min > 0)) {
    throw new RuntimeException('Meetings must stay between 7:00am and 7:00pm.');
  }
  if ($min !== 0 && $min !== 30) {
    throw new RuntimeException('Times must start and end on the hour or half hour.');
  }
  return sprintf('%02d:%02d:00', $h, $min);
}

function normalize_day(string $day): string
{
  foreach (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as $d) {
    if (strcasecmp($d, $day) === 0) {
      return $d;
    }
  }
  throw new RuntimeException('Choose a day from Monday to Saturday.');
}

function format_clock_12(string $time): string
{
  $time = trim($time);
  if ($time === '') {
    return '';
  }
  $mins = clock_minutes($time);
  $h = intdiv($mins, 60) % 24;
  if ($h < 0) {
    $h += 24;
  }
  $m = $mins % 60;
  $suffix = $h >= 12 ? 'pm' : 'am';
  $h12 = $h % 12;
  if ($h12 === 0) {
    $h12 = 12;
  }
  return $h12 . ':' . str_pad((string) $m, 2, '0', STR_PAD_LEFT) . $suffix;
}

function clock_minutes(string $time): int
{
  [$h, $m] = array_map('intval', explode(':', $time));
  return $h * 60 + $m;
}

function ranges_overlap_min(int $a0, int $a1, int $b0, int $b1): bool
{
  return $a0 < $b1 && $b0 < $a1;
}

function assert_meeting_window(string $start, string $end): void
{
  $s = clock_minutes($start);
  $e = clock_minutes($end);
  if ($e <= $s) {
    throw new RuntimeException('End time must be after start time.');
  }
}

function room_for_edit(PDO $pdo, int $roomId): ?array
{
  $stmt = $pdo->prepare('SELECT room_id, room_code, capacity, status FROM rooms WHERE room_id = ?');
  $stmt->execute([$roomId]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function combined_student_count(PDO $pdo, array $sectionIds): int
{
  $ids = array_values(array_unique(array_map('intval', $sectionIds)));
  if (!$ids) {
    return 0;
  }
  $in = implode(',', $ids);
  return (int) $pdo->query("SELECT COALESCE(SUM(student_count), 0) FROM sections WHERE section_id IN ({$in})")->fetchColumn();
}

function sibling_meetings(PDO $pdo, array $src): array
{
  if (!empty($src['merged_class_id'])) {
    $stmt = $pdo->prepare(
      'SELECT m.meeting_id, m.offering_id, m.room_id, o.section_id
       FROM class_meetings m
       JOIN class_offerings o ON o.offering_id = m.offering_id
       JOIN merged_class_members mem ON mem.offering_id = o.offering_id
       WHERE mem.merged_class_id = ? AND m.day_of_week = ? AND m.start_time = ?'
    );
    $stmt->execute([(int) $src['merged_class_id'], $src['day_of_week'], $src['start_time']]);
    $rows = $stmt->fetchAll();
    if ($rows) {
      return $rows;
    }
  }
  $stmt = $pdo->prepare(
    'SELECT m.meeting_id, m.offering_id, m.room_id, o.section_id
     FROM class_meetings m
     JOIN class_offerings o ON o.offering_id = m.offering_id
     WHERE m.meeting_id = ?'
  );
  $stmt->execute([(int) $src['meeting_id']]);
  return $stmt->fetchAll();
}

function conflict_meeting_select_sql(): string
{
  return 'SELECT m.meeting_id, m.offering_id, m.day_of_week, m.start_time, m.end_time, m.room_id,
                 o.component, o.section_id, cc.course_id, cc.course_title,
                 s.section_code, s.year_level, s.is_retake,
                 p.program_name, p.represents_college, col.college_name,
                 r.room_code, b.building_name, b.building_code
          FROM class_meetings m
          JOIN class_offerings o ON o.offering_id = m.offering_id
          JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
          JOIN sections s ON s.section_id = o.section_id
          JOIN programs p ON p.program_id = s.program_id
          JOIN colleges col ON col.college_id = p.college_id
          LEFT JOIN rooms r ON r.room_id = m.room_id
          LEFT JOIN floors fl ON fl.floor_id = r.floor_id
          LEFT JOIN buildings b ON b.building_id = fl.building_id';
}

function format_conflict_meeting(array $row, int $movingMeetingId = 0): string
{
  $who = ((int) ($row['represents_college'] ?? 0) === 1)
    ? (string) ($row['college_name'] ?? '')
    : (string) ($row['program_name'] ?? '');
  $section = trim($who . ' ' . (int) ($row['year_level'] ?? 0) . '-' . (string) ($row['section_code'] ?? ''));
  $room = format_room_label(
    isset($row['building_name']) ? (string) $row['building_name'] : null,
    isset($row['building_code']) ? (string) $row['building_code'] : null,
    isset($row['room_code']) ? (string) $row['room_code'] : null
  );
  if (!$room) {
    $room = 'no room';
  }
  $same = $movingMeetingId && (int) $row['meeting_id'] === $movingMeetingId
    ? ' — this is the meeting you are moving'
    : '';
  return sprintf(
    '%s %s · %s%s · %s %s–%s · %s%s',
    (string) ($row['course_id'] ?? 'Class'),
    (string) ($row['component'] ?? ''),
    $section,
    !empty($row['is_retake']) ? ' retake' : '',
    (string) ($row['day_of_week'] ?? ''),
    format_clock_12((string) ($row['start_time'] ?? '')),
    format_clock_12((string) ($row['end_time'] ?? '')),
    $room,
    $same
  );
}

function format_conflict_list(array $rows, int $movingMeetingId = 0): string
{
  $bits = [];
  foreach ($rows as $row) {
    $bits[] = format_conflict_meeting($row, $movingMeetingId);
  }
  return implode(' | ', $bits);
}

function describe_slot_unique_conflict(PDO $pdo, array $body): string
{
  $meetingId = parse_id((string) ($body['meetingId'] ?? ''), 'mt');
  $offeringId = parse_id((string) ($body['offeringId'] ?? ''), 'off');
  $day = normalize_day((string) ($body['day'] ?? ''));
  $start = normalize_clock((string) ($body['start'] ?? ''));
  $end = normalize_clock((string) ($body['end'] ?? ''));
  $roomKey = trim((string) ($body['roomId'] ?? ''));
  $roomId = $roomKey === '' ? null : parse_id($roomKey, 'r');
  $termId = 0;
  if ($meetingId) {
    $src = $pdo->prepare('SELECT term_id FROM class_meetings WHERE meeting_id = ?');
    $src->execute([$meetingId]);
    $termId = (int) $src->fetchColumn();
  } elseif ($offeringId) {
    $src = $pdo->prepare('SELECT term_id FROM class_offerings WHERE offering_id = ?');
    $src->execute([$offeringId]);
    $termId = (int) $src->fetchColumn();
  }
  if (!$termId || $day === '' || $start === '' || $end === '') {
    return '';
  }
  $sql = conflict_meeting_select_sql() .
    ' WHERE m.term_id = ? AND m.day_of_week = ? AND m.start_time < ? AND m.end_time > ?';
  $params = [$termId, $day, $end, $start];
  if ($roomId) {
    $sql .= ' AND (m.room_id = ? OR m.meeting_id = ?)';
    $params[] = $roomId;
    $params[] = $meetingId ?: 0;
  }
  $sql .= ' ORDER BY m.start_time, m.meeting_id LIMIT 8';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();
  if (!$rows) {
    return 'No overlapping class_meetings row was found; leftover meeting_slots may still be blocking the room or section.';
  }
  return 'Conflict with: ' . format_conflict_list($rows, $meetingId);
}

function assert_no_conflicts(
  PDO $pdo,
  int $termId,
  string $day,
  string $start,
  string $end,
  array $sectionIds,
  ?int $roomId,
  array $ignoreMeetingIds
): void {
  $ignore = $ignoreMeetingIds ? implode(',', array_map('intval', $ignoreMeetingIds)) : '0';
  $secIn = $sectionIds ? implode(',', array_map('intval', $sectionIds)) : '0';
  $movingId = $ignoreMeetingIds ? (int) $ignoreMeetingIds[0] : 0;
  $select = conflict_meeting_select_sql();
  $stmt = $pdo->prepare(
    "{$select}
     WHERE m.term_id = ? AND m.day_of_week = ?
       AND m.start_time < ? AND m.end_time > ?
       AND o.section_id IN ({$secIn})
       AND m.meeting_id NOT IN ({$ignore})
     ORDER BY m.start_time, m.meeting_id
     LIMIT 8"
  );
  $stmt->execute([$termId, $day, $end, $start]);
  $rows = $stmt->fetchAll();
  if ($rows) {
    throw new RuntimeException(
      'That time overlaps another class for this section. Conflict with: ' .
      format_conflict_list($rows, $movingId)
    );
  }
  if ($roomId) {
    $stmt = $pdo->prepare(
      "{$select}
       WHERE m.term_id = ? AND m.day_of_week = ? AND m.room_id = ?
         AND m.start_time < ? AND m.end_time > ?
         AND m.meeting_id NOT IN ({$ignore})
       ORDER BY m.start_time, m.meeting_id
       LIMIT 8"
    );
    $stmt->execute([$termId, $day, $roomId, $end, $start]);
    $rows = $stmt->fetchAll();
    if ($rows) {
      throw new RuntimeException(
        'That room is already booked at this time. Conflict with: ' .
        format_conflict_list($rows, $movingId)
      );
    }
  }
}

function offering_edit_row(PDO $pdo, int $offeringId): ?array
{
  $stmt = $pdo->prepare(
    'SELECT o.offering_id, o.term_id, o.section_id, o.component, o.status,
            cc.course_id, mem.merged_class_id, mc.room_id AS merge_room_id
     FROM class_offerings o
     JOIN curriculum_courses cc ON cc.curriculum_course_id = o.curriculum_course_id
     LEFT JOIN merged_class_members mem ON mem.offering_id = o.offering_id
     LEFT JOIN merged_classes mc ON mc.merged_class_id = mem.merged_class_id
     WHERE o.offering_id = ?'
  );
  $stmt->execute([$offeringId]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function offering_meetings(PDO $pdo, int $offeringId): array
{
  $stmt = $pdo->prepare(
    'SELECT day_of_week, start_time, end_time, room_id
     FROM class_meetings WHERE offering_id = ? ORDER BY day_of_week, start_time'
  );
  $stmt->execute([$offeringId]);
  return $stmt->fetchAll();
}

function offering_meeting_ids(PDO $pdo, int $offeringId): array
{
  $stmt = $pdo->prepare('SELECT meeting_id FROM class_meetings WHERE offering_id = ?');
  $stmt->execute([$offeringId]);
  return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

function merge_member_rows(PDO $pdo, array $tgt): array
{
  if (!empty($tgt['merged_class_id'])) {
    $stmt = $pdo->prepare(
      'SELECT o.offering_id, o.section_id
       FROM merged_class_members mem
       JOIN class_offerings o ON o.offering_id = mem.offering_id
       WHERE mem.merged_class_id = ?'
    );
    $stmt->execute([(int) $tgt['merged_class_id']]);
    return $stmt->fetchAll();
  }
  return [['offering_id' => (int) $tgt['offering_id'], 'section_id' => (int) $tgt['section_id']]];
}

function target_room_id(PDO $pdo, array $tgt): ?int
{
  if (!empty($tgt['merge_room_id'])) {
    return (int) $tgt['merge_room_id'];
  }
  $stmt = $pdo->prepare(
    'SELECT room_id FROM class_meetings WHERE offering_id = ? AND room_id IS NOT NULL LIMIT 1'
  );
  $stmt->execute([(int) $tgt['offering_id']]);
  $id = $stmt->fetchColumn();
  return $id ? (int) $id : null;
}

function detach_offering_from_merge(PDO $pdo, array $src): void
{
  if (empty($src['merged_class_id'])) {
    return;
  }
  $mergedId = (int) $src['merged_class_id'];
  $offeringId = (int) $src['offering_id'];
  $anchorMeet = $pdo->prepare(
    'SELECT m.meeting_id FROM class_meetings m WHERE m.offering_id = ? AND m.room_id IS NOT NULL LIMIT 1'
  );
  $anchorMeet->execute([$offeringId]);
  $wasAnchor = (bool) $anchorMeet->fetch();

  $pdo->prepare('DELETE FROM merged_class_members WHERE merged_class_id = ? AND offering_id = ?')
    ->execute([$mergedId, $offeringId]);

  $left = $pdo->prepare('SELECT offering_id FROM merged_class_members WHERE merged_class_id = ?');
  $left->execute([$mergedId]);
  $remain = $left->fetchAll();
  $roomId = !empty($src['merge_room_id']) ? (int) $src['merge_room_id'] : null;
  if (count($remain) <= 1) {
    if ($remain && $wasAnchor && $roomId) {
      $pdo->prepare('UPDATE class_meetings SET room_id = ? WHERE offering_id = ? AND room_id IS NULL')
        ->execute([$roomId, (int) $remain[0]['offering_id']]);
    }
    $pdo->prepare('DELETE FROM merged_classes WHERE merged_class_id = ?')->execute([$mergedId]);
  } elseif ($wasAnchor && $roomId) {
    $pdo->prepare('UPDATE merged_classes SET room_id = ? WHERE merged_class_id = ?')
      ->execute([$roomId, $mergedId]);
    $pdo->prepare('UPDATE class_meetings SET room_id = ? WHERE offering_id = ? AND room_id IS NULL')
      ->execute([$roomId, (int) $remain[0]['offering_id']]);
  }
}

function move_meeting(PDO $pdo, array $body): array
{
  $year = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $sem = normalize_term_code((string) ($body['termCode'] ?? '1'));
  $meetingId = parse_id((string) ($body['meetingId'] ?? ''), 'mt');
  if (!$meetingId) {
    throw new RuntimeException('That meeting is missing.');
  }
  $day = normalize_day((string) ($body['day'] ?? ''));
  $start = normalize_clock((string) ($body['start'] ?? ''));
  $end = normalize_clock((string) ($body['end'] ?? ''));
  assert_meeting_window($start, $end);
  $roomKey = trim((string) ($body['roomId'] ?? ''));
  $roomId = $roomKey === '' ? null : parse_id($roomKey, 'r');
  if ($roomKey !== '' && !$roomId) {
    throw new RuntimeException('That room is not valid.');
  }

  $stmt = $pdo->prepare(
    'SELECT m.meeting_id, m.offering_id, m.term_id, m.day_of_week, m.start_time, m.end_time, m.room_id,
            o.section_id, mem.merged_class_id
     FROM class_meetings m
     JOIN class_offerings o ON o.offering_id = m.offering_id
     LEFT JOIN merged_class_members mem ON mem.offering_id = o.offering_id
     WHERE m.meeting_id = ?'
  );
  $stmt->execute([$meetingId]);
  $src = $stmt->fetch();
  if (!$src) {
    throw new RuntimeException('That meeting is no longer on the timetable.');
  }
  require_live_offering_term($pdo, (int) $src['term_id']);

  $siblings = sibling_meetings($pdo, $src);
  $ignoreIds = array_map(static function ($r) {
    return (int) $r['meeting_id'];
  }, $siblings);
  $sectionIds = array_values(array_unique(array_map(static function ($r) {
    return (int) $r['section_id'];
  }, $siblings)));
  $studentCount = combined_student_count($pdo, $sectionIds);

  if ($roomId) {
    $room = room_for_edit($pdo, $roomId);
    if (!$room) {
      throw new RuntimeException('That room was not found.');
    }
    if (($room['status'] ?? '') !== 'active') {
      throw new RuntimeException('Only active rooms can be used.');
    }
    if ((int) $room['capacity'] < $studentCount) {
      throw new RuntimeException(
        'That room holds ' . (int) $room['capacity'] . ' students; this class has ' . $studentCount . '.'
      );
    }
  }

  assert_no_conflicts($pdo, (int) $src['term_id'], $day, $start, $end, $sectionIds, $roomId, $ignoreIds);

  $anchor = (int) $siblings[0]['meeting_id'];
  foreach ($siblings as $row) {
    if (!empty($row['room_id'])) {
      $anchor = (int) $row['meeting_id'];
      break;
    }
  }
  $in = implode(',', $ignoreIds);
  $pdo->exec("UPDATE class_meetings SET room_id = NULL WHERE meeting_id IN ({$in})");
  $upd = $pdo->prepare(
    'UPDATE class_meetings SET day_of_week = ?, start_time = ?, end_time = ? WHERE meeting_id = ?'
  );
  foreach ($ignoreIds as $id) {
    $upd->execute([$day, $start, $end, $id]);
  }
  if ($roomId) {
    $pdo->prepare('UPDATE class_meetings SET room_id = ? WHERE meeting_id = ?')->execute([$roomId, $anchor]);
  }
  if (!empty($src['merged_class_id'])) {
    $pdo->prepare('UPDATE merged_classes SET room_id = ? WHERE merged_class_id = ?')
      ->execute([$roomId, (int) $src['merged_class_id']]);
  }
  [, $members] = group_from_offering($pdo, (int) $src['offering_id']);
  refresh_group_status($pdo, $members);

  return load_schedule_payload($pdo, $year, $sem) + ['status' => 'updated'];
}

function term_from_body(PDO $pdo, array $body): array
{
  $year = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $sem = normalize_term_code((string) ($body['termCode'] ?? '1'));
  $syId = school_year_id_by_label($pdo, $year);
  $termId = $syId ? find_term_id($pdo, $syId, $sem) : null;
  if ($termId) {
    require_live_offering_term($pdo, $termId);
  }
  return [$year, $sem];
}

function parse_meeting_room(array $body): ?int
{
  $roomKey = trim((string) ($body['roomId'] ?? ''));
  if ($roomKey === '') {
    return null;
  }
  $roomId = parse_id($roomKey, 'r');
  if (!$roomId) {
    throw new RuntimeException('That room is not valid.');
  }
  return $roomId;
}

function assert_room_holds(PDO $pdo, ?int $roomId, int $studentCount): void
{
  if (!$roomId) {
    return;
  }
  $room = room_for_edit($pdo, $roomId);
  if (!$room) {
    throw new RuntimeException('That room was not found.');
  }
  if (($room['status'] ?? '') !== 'active') {
    throw new RuntimeException('Only active rooms can be used.');
  }
  if ((int) $room['capacity'] < $studentCount) {
    throw new RuntimeException(
      'That room holds ' . (int) $room['capacity'] . ' students; this class has ' . $studentCount . '.'
    );
  }
}

function group_from_offering(PDO $pdo, int $offeringId): array
{
  $src = offering_edit_row($pdo, $offeringId);
  if (!$src) {
    throw new RuntimeException('That class is no longer on the timetable.');
  }
  $members = merge_member_rows($pdo, $src);
  $sectionIds = array_values(array_unique(array_map(static function ($r) {
    return (int) $r['section_id'];
  }, $members)));
  return [$src, $members, $sectionIds, combined_student_count($pdo, $sectionIds)];
}

function group_meeting_ids(PDO $pdo, array $members): array
{
  $ids = [];
  foreach ($members as $m) {
    foreach (offering_meeting_ids($pdo, (int) $m['offering_id']) as $id) {
      $ids[] = $id;
    }
  }
  return $ids;
}

function insert_meetings_for_group(
  PDO $pdo,
  array $members,
  int $termId,
  string $day,
  string $start,
  string $end,
  ?int $roomId
): int {
  $ins = $pdo->prepare(
    'INSERT INTO class_meetings (offering_id, term_id, day_of_week, start_time, end_time, room_id)
     VALUES (?, ?, ?, ?, ?, ?)'
  );
  $firstId = 0;
  foreach ($members as $i => $m) {
    $ins->execute([
      (int) $m['offering_id'],
      $termId,
      $day,
      $start,
      $end,
      $i === 0 ? $roomId : null,
    ]);
    $newId = (int) $pdo->lastInsertId();
    if ($i === 0) {
      $firstId = $newId;
    }
  }
  return $firstId;
}

function windows_overlap(string $dayA, string $startA, string $endA, string $dayB, string $startB, string $endB): bool
{
  if (strcasecmp($dayA, $dayB) !== 0) {
    return false;
  }
  return ranges_overlap_min(
    clock_minutes($startA),
    clock_minutes($endA),
    clock_minutes($startB),
    clock_minutes($endB)
  );
}

function add_class_meeting(PDO $pdo, array $body): array
{
  [$year, $sem] = term_from_body($pdo, $body);
  $offeringId = parse_id((string) ($body['offeringId'] ?? ''), 'off');
  if (!$offeringId) {
    throw new RuntimeException('That class is missing.');
  }
  $day = normalize_day((string) ($body['day'] ?? ''));
  $start = normalize_clock((string) ($body['start'] ?? ''));
  $end = normalize_clock((string) ($body['end'] ?? ''));
  assert_meeting_window($start, $end);
  $roomId = parse_meeting_room($body);
  [$src, $members, $sectionIds, $studentCount] = group_from_offering($pdo, $offeringId);
  assert_room_holds($pdo, $roomId, $studentCount);
  assert_no_conflicts($pdo, (int) $src['term_id'], $day, $start, $end, $sectionIds, $roomId, []);
  $id = insert_meetings_for_group($pdo, $members, (int) $src['term_id'], $day, $start, $end, $roomId);
  refresh_group_status($pdo, $members);
  return load_schedule_payload($pdo, $year, $sem) + [
    'status' => 'updated',
    'meetingId' => public_id('mt', $id),
  ];
}

function remove_class_meeting(PDO $pdo, array $body): array
{
  [$year, $sem] = term_from_body($pdo, $body);
  $meetingId = parse_id((string) ($body['meetingId'] ?? ''), 'mt');
  if (!$meetingId) {
    throw new RuntimeException('That meeting is missing.');
  }
  $stmt = $pdo->prepare(
    'SELECT m.meeting_id, m.offering_id, m.day_of_week, m.start_time, m.room_id, o.section_id, mem.merged_class_id
     FROM class_meetings m
     JOIN class_offerings o ON o.offering_id = m.offering_id
     LEFT JOIN merged_class_members mem ON mem.offering_id = o.offering_id
     WHERE m.meeting_id = ?'
  );
  $stmt->execute([$meetingId]);
  $src = $stmt->fetch();
  if (!$src) {
    throw new RuntimeException('That meeting is no longer on the timetable.');
  }
  $slots = offering_meetings($pdo, (int) $src['offering_id']);
  if (count($slots) <= 1) {
    throw new RuntimeException('Keep at least one meeting. Combine or change times instead.');
  }
  $siblings = sibling_meetings($pdo, $src);
  $ids = array_map(static function ($r) {
    return (int) $r['meeting_id'];
  }, $siblings);
  if (!$ids) {
    $ids = [$meetingId];
  }
  $in = implode(',', $ids);
  $pdo->exec("DELETE FROM class_meetings WHERE meeting_id IN ({$in})");
  [, $members] = group_from_offering($pdo, (int) $src['offering_id']);
  refresh_group_status($pdo, $members);
  return load_schedule_payload($pdo, $year, $sem) + ['status' => 'updated'];
}

function split_class_meeting(PDO $pdo, array $body): array
{
  [$year, $sem] = term_from_body($pdo, $body);
  $meetingId = parse_id((string) ($body['meetingId'] ?? ''), 'mt');
  if (!$meetingId) {
    throw new RuntimeException('That meeting is missing.');
  }
  $firstEnd = normalize_clock((string) ($body['firstEnd'] ?? ''));
  $day = normalize_day((string) ($body['day'] ?? ''));
  $start = normalize_clock((string) ($body['start'] ?? ''));
  $end = normalize_clock((string) ($body['end'] ?? ''));
  $roomId = parse_meeting_room($body);

  $stmt = $pdo->prepare(
    'SELECT m.meeting_id, m.offering_id, m.term_id, m.day_of_week, m.start_time, m.end_time, m.room_id,
            o.section_id, mem.merged_class_id
     FROM class_meetings m
     JOIN class_offerings o ON o.offering_id = m.offering_id
     LEFT JOIN merged_class_members mem ON mem.offering_id = o.offering_id
     WHERE m.meeting_id = ?'
  );
  $stmt->execute([$meetingId]);
  $src = $stmt->fetch();
  if (!$src) {
    throw new RuntimeException('That meeting is no longer on the timetable.');
  }
  assert_meeting_window((string) $src['start_time'], $firstEnd);
  if (clock_minutes($firstEnd) >= clock_minutes((string) $src['end_time'])) {
    throw new RuntimeException('The first half must end before the original meeting ends.');
  }
  assert_meeting_window($start, $end);
  if (windows_overlap((string) $src['day_of_week'], (string) $src['start_time'], $firstEnd, $day, $start, $end)) {
    throw new RuntimeException('The new meeting overlaps the first half.');
  }

  $siblings = sibling_meetings($pdo, $src);
  $ignoreIds = array_map(static function ($r) {
    return (int) $r['meeting_id'];
  }, $siblings);
  [, $members, $sectionIds, $studentCount] = group_from_offering($pdo, (int) $src['offering_id']);
  assert_room_holds($pdo, $roomId, $studentCount);
  assert_no_conflicts($pdo, (int) $src['term_id'], $day, $start, $end, $sectionIds, $roomId, $ignoreIds);

  $upd = $pdo->prepare('UPDATE class_meetings SET end_time = ? WHERE meeting_id = ?');
  foreach ($ignoreIds as $id) {
    $upd->execute([$firstEnd, $id]);
  }
  $newId = insert_meetings_for_group($pdo, $members, (int) $src['term_id'], $day, $start, $end, $roomId);
  refresh_group_status($pdo, $members);
  return load_schedule_payload($pdo, $year, $sem) + [
    'status' => 'updated',
    'meetingId' => public_id('mt', $newId),
  ];
}

function combine_class_meetings(PDO $pdo, array $body): array
{
  [$year, $sem] = term_from_body($pdo, $body);
  $offeringId = parse_id((string) ($body['offeringId'] ?? ''), 'off');
  if (!$offeringId) {
    throw new RuntimeException('That class is missing.');
  }
  $day = normalize_day((string) ($body['day'] ?? ''));
  $start = normalize_clock((string) ($body['start'] ?? ''));
  $end = normalize_clock((string) ($body['end'] ?? ''));
  assert_meeting_window($start, $end);
  $roomId = parse_meeting_room($body);
  [$src, $members, $sectionIds, $studentCount] = group_from_offering($pdo, $offeringId);
  $ignore = group_meeting_ids($pdo, $members);
  if (count($ignore) < 2) {
    throw new RuntimeException('There is only one meeting to keep.');
  }
  assert_room_holds($pdo, $roomId, $studentCount);
  assert_no_conflicts($pdo, (int) $src['term_id'], $day, $start, $end, $sectionIds, $roomId, $ignore);
  $in = implode(',', $ignore);
  $pdo->exec("DELETE FROM class_meetings WHERE meeting_id IN ({$in})");
  $id = insert_meetings_for_group($pdo, $members, (int) $src['term_id'], $day, $start, $end, $roomId);
  refresh_group_status($pdo, $members);
  return load_schedule_payload($pdo, $year, $sem) + [
    'status' => 'updated',
    'meetingId' => public_id('mt', $id),
  ];
}

function reassign_section(PDO $pdo, array $body): array
{
  $year = parse_school_year_label(trim((string) ($body['schoolYear'] ?? '')));
  $sem = normalize_term_code((string) ($body['termCode'] ?? '1'));
  $offeringId = parse_id((string) ($body['offeringId'] ?? ''), 'off');
  $targetOfferingId = parse_id((string) ($body['targetOfferingId'] ?? ''), 'off');
  if (!$offeringId) {
    throw new RuntimeException('That class is missing.');
  }

  $src = offering_edit_row($pdo, $offeringId);
  if (!$src) {
    throw new RuntimeException('That class is no longer on the timetable.');
  }
  require_live_offering_term($pdo, (int) $src['term_id']);

  if ($targetOfferingId) {
    if ($targetOfferingId === $offeringId) {
      throw new RuntimeException('Choose a different class.');
    }
    $tgt = offering_edit_row($pdo, $targetOfferingId);
    if (!$tgt || (int) $tgt['term_id'] !== (int) $src['term_id']) {
      throw new RuntimeException('That target class is not in this term.');
    }
    if ((int) $tgt['section_id'] === (int) $src['section_id']) {
      throw new RuntimeException('That section is already in this class.');
    }
    if (!empty($src['merged_class_id']) && $src['merged_class_id'] === $tgt['merged_class_id']) {
      throw new RuntimeException('That section is already in this class.');
    }
    if (
      (string) ($src['course_id'] ?? '') !== (string) ($tgt['course_id'] ?? '')
      || (string) ($src['component'] ?? '') !== (string) ($tgt['component'] ?? '')
    ) {
      throw new RuntimeException('Only classes with the same course code and component can be merged.');
    }

    $tgtMeetings = offering_meetings($pdo, (int) $tgt['offering_id']);
    if (!$tgtMeetings) {
      throw new RuntimeException('Choose a class that is already scheduled.');
    }

    $members = merge_member_rows($pdo, $tgt);
    $sectionIds = array_map(static function ($r) {
      return (int) $r['section_id'];
    }, $members);
    $sectionIds[] = (int) $src['section_id'];
    $studentCount = combined_student_count($pdo, $sectionIds);
    $roomId = target_room_id($pdo, $tgt);
    if ($roomId) {
      $room = room_for_edit($pdo, $roomId);
      if ($room && (int) $room['capacity'] < $studentCount) {
        throw new RuntimeException(
          'The target room holds ' . (int) $room['capacity'] . ' students; the combined class would have ' . $studentCount . '.'
        );
      }
    }

    $ignore = offering_meeting_ids($pdo, $offeringId);
    foreach ($members as $row) {
      foreach (offering_meeting_ids($pdo, (int) $row['offering_id']) as $mid) {
        $ignore[] = $mid;
      }
    }
    $ignore = array_values(array_unique(array_map('intval', $ignore)));
    foreach ($tgtMeetings as $meet) {
      assert_no_conflicts(
        $pdo,
        (int) $src['term_id'],
        (string) $meet['day_of_week'],
        (string) $meet['start_time'],
        (string) $meet['end_time'],
        [],
        $roomId,
        $ignore
      );
    }

    detach_offering_from_merge($pdo, $src);
    $pdo->prepare('DELETE FROM class_meetings WHERE offering_id = ?')->execute([$offeringId]);
    $ins = $pdo->prepare(
      'INSERT INTO class_meetings (offering_id, term_id, day_of_week, start_time, end_time, room_id)
       VALUES (?, ?, ?, ?, ?, NULL)'
    );
    foreach ($tgtMeetings as $meet) {
      $ins->execute([
        $offeringId,
        (int) $src['term_id'],
        $meet['day_of_week'],
        $meet['start_time'],
        $meet['end_time'],
      ]);
    }

    $mergedId = !empty($tgt['merged_class_id']) ? (int) $tgt['merged_class_id'] : null;
    if (!$mergedId) {
      $insM = $pdo->prepare(
        'INSERT INTO merged_classes (term_id, course_code, component, room_id) VALUES (?, ?, ?, ?)'
      );
      $insM->execute([(int) $src['term_id'], $tgt['course_id'], $tgt['component'], $roomId]);
      $mergedId = (int) $pdo->lastInsertId();
      $pdo->prepare('INSERT INTO merged_class_members (merged_class_id, offering_id) VALUES (?, ?)')
        ->execute([$mergedId, (int) $tgt['offering_id']]);
    }
    $pdo->prepare('INSERT INTO merged_class_members (merged_class_id, offering_id) VALUES (?, ?)')
      ->execute([$mergedId, $offeringId]);
    $all = merge_member_rows($pdo, ['merged_class_id' => $mergedId, 'offering_id' => $offeringId, 'section_id' => (int) $src['section_id']]);
    refresh_group_status($pdo, $all);
  } else {
    if (empty($src['merged_class_id'])) {
      throw new RuntimeException('This section is already in its own class.');
    }
    $leftMembers = merge_member_rows($pdo, $src);
    detach_offering_from_merge($pdo, $src);
    $pdo->prepare('DELETE FROM class_meetings WHERE offering_id = ?')->execute([$offeringId]);
    $remaining = [];
    foreach ($leftMembers as $row) {
      if ((int) $row['offering_id'] !== $offeringId) {
        $remaining[] = $row;
      }
    }
    if ($remaining) {
      refresh_group_status($pdo, $remaining);
    }
    refresh_group_status($pdo, [['offering_id' => $offeringId]]);
  }

  return load_schedule_payload($pdo, $year, $sem) + ['status' => 'updated'];
}
