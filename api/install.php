<?php
declare(strict_types=1);

$configFile = __DIR__ . '/config.php';
$schemaFile = dirname(__DIR__) . '/database_schema.sql';
$message = '';
$error = '';
$done = false;

$defaults = [
  'host' => '127.0.0.1',
  'port' => '3306',
  'name' => 'mcu_nex',
  'user' => 'root',
  'pass' => '',
];
if (is_file($configFile)) {
  $existing = require $configFile;
  if (is_array($existing)) {
    $defaults = array_merge($defaults, array_map('strval', $existing));
  }
}

function run_sql_script(PDO $pdo, string $sql): void
{
  $delimiter = ';';
  $buffer = '';
  $lines = preg_split("/\r\n|\n|\r/", $sql) ?: [];
  foreach ($lines as $line) {
    $trim = trim($line);
    if ($trim === '' || str_starts_with($trim, '--')) {
      continue;
    }
    if (preg_match('/^DELIMITER\s+(\S+)/i', $trim, $m)) {
      if (trim($buffer) !== '') {
        $pdo->exec($buffer);
        $buffer = '';
      }
      $delimiter = $m[1];
      continue;
    }
    $buffer .= $line . "\n";
    $dlen = strlen($delimiter);
    $stripped = rtrim($buffer);
    if ($dlen > 0 && substr($stripped, -$dlen) === $delimiter) {
      $stmt = substr($stripped, 0, -$dlen);
      if (trim($stmt) !== '') {
        $pdo->exec($stmt);
      }
      $buffer = '';
    }
  }
  if (trim($buffer) !== '') {
    $pdo->exec($buffer);
  }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $host = trim((string) ($_POST['host'] ?? '127.0.0.1'));
  $port = (int) ($_POST['port'] ?? 3306);
  $name = trim((string) ($_POST['name'] ?? 'mcu_nex'));
  $user = trim((string) ($_POST['user'] ?? 'root'));
  $pass = (string) ($_POST['pass'] ?? '');
  $defaults = compact('host', 'port', 'name', 'user', 'pass');
  $defaults['port'] = (string) $port;

  try {
    if (!preg_match('/^[A-Za-z0-9_]+$/', $name)) {
      throw new RuntimeException('Database name may only contain letters, numbers and underscores.');
    }
    if (!is_file($schemaFile)) {
      throw new RuntimeException('database_schema.sql was not found next to the api folder.');
    }
    $dsn = "mysql:host={$host};port={$port};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("USE `{$name}`");

    $tables = $pdo->query("SHOW TABLES LIKE 'colleges'")->fetch();
    if (!$tables) {
      run_sql_script($pdo, (string) file_get_contents($schemaFile));
    }

    $export = var_export([
      'host' => $host,
      'port' => $port,
      'name' => $name,
      'user' => $user,
      'pass' => $pass,
      'charset' => 'utf8mb4',
    ], true);
    if (file_put_contents($configFile, "<?php\nreturn {$export};\n") === false) {
      throw new RuntimeException('Could not write api/config.php. Check folder permissions.');
    }
    $done = true;
    $message = $tables
      ? "Connected. The database `{$name}` already had tables, so the schema was left as-is. Config saved."
      : "Database `{$name}` created and the schema was installed. Config saved.";
  } catch (Throwable $e) {
    $error = $e->getMessage();
  }
}

function h($v): string
{
  return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MCU-NEX · Install MySQL</title>
  <style>
    body { font-family: DM Sans, system-ui, sans-serif; background: #f5f5f9; color: #1f1230; margin: 0; padding: 2rem 1rem; }
    .box { max-width: 32rem; margin: 0 auto; background: #fff; border: 1px solid #e3d9f0; border-radius: 14px; padding: 1.5rem 1.6rem 1.7rem; box-shadow: 0 10px 26px rgba(0,0,0,.06); }
    h1 { margin: 0 0 .35rem; font-size: 1.2rem; }
    p { color: #7a6992; font-size: .9rem; line-height: 1.5; }
    label { display: block; font-size: .78rem; font-weight: 600; margin: .85rem 0 .3rem; }
    input { width: 100%; box-sizing: border-box; padding: .5rem .65rem; border: 1px solid #e3d9f0; border-radius: 8px; font: inherit; }
    button { margin-top: 1.1rem; padding: .55rem 1rem; border: 0; border-radius: 8px; background: #5c267e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: .7rem .8rem; border-radius: 8px; font-size: .88rem; }
    .bad { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: .7rem .8rem; border-radius: 8px; font-size: .88rem; }
    a { color: #5c267e; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Install MySQL for MCU-NEX</h1>
    <p>This creates the database, runs <code>database_schema.sql</code>, and writes <code>api/config.php</code>. Start MySQL first (XAMPP: Start MySQL). Default XAMPP login is user <strong>root</strong> with an empty password.</p>
    <?php if ($message): ?><p class="ok"><?= h($message) ?></p><?php endif; ?>
    <?php if ($error): ?><p class="bad"><?= h($error) ?></p><?php endif; ?>
    <?php if ($done): ?>
      <p>Open the <a href="../admin/home-dashboard.html">admin dashboard</a> and upload a curriculum. Colleges you add will be stored in MySQL.</p>
    <?php endif; ?>
    <form method="post">
      <label>Host</label>
      <input name="host" value="<?= h($defaults['host']) ?>" required />
      <label>Port</label>
      <input name="port" value="<?= h($defaults['port']) ?>" required />
      <label>Database name</label>
      <input name="name" value="<?= h($defaults['name']) ?>" required />
      <label>User</label>
      <input name="user" value="<?= h($defaults['user']) ?>" required />
      <label>Password</label>
      <input name="pass" type="password" value="<?= h($defaults['pass']) ?>" />
      <button type="submit"><?= $done ? 'Save again' : 'Create database' ?></button>
    </form>
  </div>
</body>
</html>
