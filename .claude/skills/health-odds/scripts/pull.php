<?php
/*
	Pulls the schedule and bet1–bet4 the way update.php does, into a folder of its own, with every raw
	response saved beside the parsed file. For the health-odds skill: it reads the feeds and writes
	only into <out>.

		php pull.php <fetch_lib.php> <out>

	Prints one JSON line per step. Notices are caught per step instead of logged, so a check never
	adds to the server's PHP error log. Keep the calls below in step with update.php's.
*/
ini_set('log_errors', '0');
ini_set('display_errors', 'stderr');

$lib = $argv[1] ?? '';
$out = $argv[2] ?? '';
if (!is_file($lib) || !is_dir($out)) {
	fwrite(STDERR, "usage: php pull.php <fetch_lib.php> <out folder>\n");
	exit(2);
}
require $lib;

$notices = [];
set_error_handler(function (int $level, string $message, string $file, int $line) use (&$notices) {
	$notices[] = basename($file) . ":$line $message";
	return true;
});

$timezone = new DateTimeZone('America/New_York');
$now = new DateTime('now', $timezone);
$endOfDay = new DateTime('tomorrow midnight', $timezone);
$ch = curl_init();

$steps = [
	'games' => fn() => updateGames($now, $out),
	'bet1' => fn() => updateBet1($ch, $out, true),
	'bet2' => fn() => updateBet2($endOfDay, $ch, $out, true),
	'bet3' => fn() => updateBet3($endOfDay, $ch, $out, true),
	'bet4' => fn() => updateBet4($endOfDay, $out, true),
];
foreach ($steps as $step => $run) {
	$notices = [];
	$started = microtime(true);
	try {
		$result = $run();
	} catch (Throwable $error) {
		// A parser that throws stops the cron's whole run, so it's reported as such, not as a fetch error
		$result = ['thrown' => get_class($error) . ': ' . $error->getMessage() . ' (line ' . $error->getLine() . ')'];
	}
	$line = ['step' => $step, 'seconds' => round(microtime(true) - $started, 1)] + (array)$result + ['notices' => $notices];
	echo json_encode($line, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR), "\n";
}
