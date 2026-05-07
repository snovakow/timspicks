<?php

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	http_response_code(405);
	die('Invalid request method');
}

$json_data = file_get_contents('php://input');
$data = json_decode($json_data, true);

if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
	http_response_code(400);
	die('Invalid JSON payload');
}

if (!isset($data['code']) || !isset($data['name'])) {
	http_response_code(400);
	die('Missing required parameters');
}

$name = trim((string)$data['name']);
$code = (string)$data['code'];
if ($name === '' || $code === '') {
	http_response_code(400);
	die('Name and code cannot be empty');
}

$auth = [];
$auth['code'] = password_hash($code, PASSWORD_DEFAULT);
$auth['name'] = $name;

$auth_string = json_encode($auth, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($auth_string === false) {
	http_response_code(500);
	die('Error encoding auth data');
}

$auth_file = '../public/auth.json';
if (file_put_contents($auth_file, $auth_string) === false) {
	http_response_code(500);
	die("Error saving $auth_file");
}

echo 'Data saved successfully';
