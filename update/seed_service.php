<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') die("Invalid request method");

$json_data = file_get_contents('php://input');

$data = json_decode($json_data, true);

if (!isset($data['code']) || !isset($data['name'])) die("Missing required parameters");

$auth = [];
$auth["code"] = password_hash($data['code'], PASSWORD_DEFAULT);
$auth["name"] = $data['name'];

$auth_string = json_encode($auth, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$auth_file = '../public/auth.json';
if (file_put_contents($auth_file, $auth_string) === false) {
	die("Error saving $auth_file");
}

echo 'Data saved successfully';
