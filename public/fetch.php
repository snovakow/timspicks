<?php
session_start();

// Generate a new token if one doesn't exist in the session
if (empty($_SESSION['csrf_token'])) {
	// Use a cryptographically secure method to generate the token
	// random_bytes() is preferred over md5(uniqid())
	$_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$csrfToken = $_SESSION['csrf_token'];
?>
<!DOCTYPE html>
<html>

<head>
	<title>Data Fetcher</title>
	<link rel="stylesheet" href="./fetch.css">
</head>

<body>
	<div id="form">
		<select id="option">
			<option value="update">Update</option>
			<option value="history">History</option>
			<option value="players">Players</option>
		</select>
		<input type="text" id="name" />
		<input type="password" id="input" />
		<button id="button">Submit</button>
	</div>

	<div id="response"></div>

	<script>
		const teams = [
			"ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM",
			"FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT", "PHI", "PIT",
			"SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH"
		];

		const sendRequest = async (query) => {
			const data = {
				name: name.value,
				code: input.value,
				csrf_token: "<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>"
			};

			const response = await fetch("./fetch_service.php?" + query, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(data) // Converts JavaScript object to a JSON string
			});

			// Check for HTTP errors
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			// Handle the response from the server
			return await response.text();
		};

		const button = document.getElementById('button');
		const name = document.getElementById('name');
		const input = document.getElementById('input');
		let activeRunId = 0;

		const scrollResponseToBottom = (element) => {
			window.requestAnimationFrame(() => {
				element.scrollTop = element.scrollHeight;
			});
		};

		const keydown = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				button.focus();
				button.click();
			}
		};
		name.addEventListener("keydown", keydown);
		input.addEventListener("keydown", keydown);

		button.addEventListener('click', async () => {
			const runId = ++activeRunId;
			const option = document.getElementById('option');
			const options = option.value;
			if (!options) return;

			const responseElement = document.getElementById('response');
			responseElement.replaceChildren();
			responseElement.scrollTop = 0;

			if (options === "players") {
				let teamIndex = 0;
				const processTeam = async () => {
					if (runId !== activeRunId) return;
					try {
						const result = await sendRequest("players&team=" + teams[teamIndex]);
						if (runId !== activeRunId) return;
						if (result) {
							const tempDiv = document.createElement('div');
							tempDiv.innerHTML = result;
							responseElement.appendChild(tempDiv);
							scrollResponseToBottom(responseElement);
						}
					} catch (error) {
						if (runId !== activeRunId) return;
						const errorDiv = document.createElement('div');
						errorDiv.style.color = 'red';
						errorDiv.textContent = `Error fetching ${teams[teamIndex]}: ${error.message}`;
						responseElement.appendChild(errorDiv);
						scrollResponseToBottom(responseElement);
					}

					teamIndex++;

					if (teamIndex < teams.length) {
						window.setTimeout(() => {
							processTeam();
						}, 1000);
					} else {
						responseElement.insertAdjacentHTML('beforeend', "<h2>All teams processed</h2>");
						scrollResponseToBottom(responseElement);
					}
				}
				processTeam();
				return;
			}

			const result = await sendRequest(options.split(",").join("&"));
			if (runId !== activeRunId) return;
			if (result) {
				const tempDiv = document.createElement('div');
				tempDiv.innerHTML = result;
				responseElement.appendChild(tempDiv);
				scrollResponseToBottom(responseElement);
			}
		});
	</script>

</body>

</html>