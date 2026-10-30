<?php
/*
	Pulls the schedule and every book the list doesn't turn off, the way update.php does, into a folder of its
	own, with every raw response saved beside the parsed file. For the health-odds skill: it reads the feeds and
	writes only into <out>.

		php pull.php <fetch_lib.php> <out> [--direct]

	--direct pulls each book that has a fetcher for its own site through it, whatever its mode in the list, to
	see whether a book in comparison mode could go back to direct.

	Prints one JSON line per step: the schedule, the books as pulled, then one per book. Notices are caught per
	step instead of logged, so a check never adds to the server's PHP error log. Keep the calls below in step
	with update.php's.
*/
ini_set('log_errors', '0');
ini_set('display_errors', 'stderr');

$lib = $argv[1] ?? '';
$out = $argv[2] ?? '';
$direct = in_array('--direct', array_slice($argv, 3), true);
if (!is_file($lib) || !is_dir($out)) {
	fwrite(STDERR, "usage: php pull.php <fetch_lib.php> <out folder> [--direct]\n");
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

$line = fn(array $fields) => print(json_encode($fields, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR) . "\n");

// A step that throws is reported as such, not as a fetch error
$run = function (callable $step) use (&$notices) {
	$notices = [];
	$started = microtime(true);
	try {
		$result = $step();
	} catch (Throwable $error) {
		$result = ['thrown' => get_class($error) . ': ' . $error->getMessage() . ' (line ' . $error->getLine() . ')'];
	}
	return [$result, round(microtime(true) - $started, 1), $notices];
};

[$result, $seconds, $caught] = $run(fn() => updateGames($now, $out));
$line(['step' => 'games', 'seconds' => $seconds] + (array)$result + ['notices' => $caught]);

// A library from before the book list reads its books another way, which this pull doesn't follow
if (!function_exists('sportsbooks') || !function_exists('updateBooks')) {
	$line(['step' => 'books', 'error' => 'this fetch_lib.php predates the book list']);
	exit;
}
$list = sportsbooks();
if ($list['error'] !== null) {
	$line(['step' => 'books', 'error' => $list['error']]);
	exit;
}
$books = $list['books'];
if ($direct) {
	foreach ($books as &$book) {
		if ($book['mode'] !== 'off' && isset(DIRECT_FETCHERS[$book['key']])) $book['mode'] = 'direct';
	}
	unset($book);
}

[$outputs, $seconds, $caught] = $run(fn() => updateBooks($now, $endOfDay, $ch, $out, true, $books));
$line(['step' => 'books', 'seconds' => $seconds, 'books' => $books, 'direct' => $direct, 'notices' => $caught] + (isset($outputs['thrown']) ? $outputs : []));
if (isset($outputs['thrown'])) exit;

// One line per book, in the order updateBooks returns them: every book that isn't off
$active = array_values(array_filter($books, fn($book) => $book['mode'] !== 'off'));
foreach ($outputs as $index => $output) {
	$book = $active[$index] ?? null;
	$line(['step' => $book['key'] ?? "book $index", 'mode' => $book['mode'] ?? null] + $output);
}
