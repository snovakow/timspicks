<?php

function updateGames($now, $basePath)
{
	echo '<h3>Games</h3>';

	// Endpoint for today's schedule
	$url = 'https://api-web.nhle.com/v1/schedule/' . $now->format('Y-m-d');

	// Fetch the JSON data
	$response = file_get_contents($url);
	if ($response === false) {
		die('Error fetching NHL data: ' . $url);
	}

	$local_file = $basePath . '/games.json';
	if (file_put_contents($local_file, $response) === false) {
		die('Error saving local JSON file.');
	}
	echo "Data has been written to $local_file";
}

function updatePicks($now, $basePath) {}
