<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$cfg = [
  'host' => '127.0.0.1',
  'port' => 3306,
  'name' => 'mcu_nex',
  'user' => 'root',
  'pass' => '',
  'charset' => 'utf8mb4',
];

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

$pdo = pdo_from_config($cfg, false);
$pdo->exec('CREATE DATABASE IF NOT EXISTS `mcu_nex` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
$pdo->exec('USE `mcu_nex`');

$has = $pdo->query("SHOW TABLES LIKE 'colleges'")->fetch();
if (!$has) {
  $schema = dirname(__DIR__) . '/database_schema.sql';
  run_sql_script($pdo, (string) file_get_contents($schema));
  echo "Schema installed.\n";
} else {
  echo "Schema already present.\n";
}

$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
echo 'Tables: ' . implode(', ', $tables) . "\n";

$export = var_export($cfg, true);
file_put_contents(__DIR__ . '/config.php', "<?php\nreturn {$export};\n");
echo "Wrote api/config.php\n";
