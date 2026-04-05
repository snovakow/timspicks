import './Settings.css';

interface SettingsPanelProps {
	showPercentage: boolean;
	onShowPercentageChange: (value: boolean) => void;
	deVigEnabled: boolean;
	onDeVigEnabledChange: (value: boolean) => void;
	minSportsbooks: number;
	onMinSportsbooksChange: (value: number) => void;
}

export default function SettingsPanel(props: SettingsPanelProps) {
	const {
		showPercentage,
		onShowPercentageChange,
		deVigEnabled,
		onDeVigEnabledChange,
		minSportsbooks,
		onMinSportsbooksChange,
	} = props;

	return (
		<div className="settings-container">
			<div className="settings-group">
				<label className="settings-label">
					<div className="settings-toggle">
						<input
							type="checkbox"
							checked={showPercentage}
							onChange={(e) => onShowPercentageChange(e.target.checked)}
						/>
						Show Probabilities
					</div>
					<div className="settings-description">
						Show values as probability percentages.
						Sportsbook odds are displayed as implied probabilities,
						otherwise are displayed as American odds.
					</div>
				</label>
			</div>

			<div className="settings-group">
				<label className="settings-label">
					<div className="settings-toggle">
						<input
							type="checkbox"
							checked={deVigEnabled}
							onChange={(e) => onDeVigEnabledChange(e.target.checked)}
						/>
						Normalize Sportsbooks
					</div>
					<div className="settings-description">
						Remove sportsbook bias by adjusting odds to a consensus value.
					</div>
				</label>
			</div>

			<div className="settings-group">
				<label htmlFor="min-sportsbooks" className="settings-label">
					Minimum Sportsbooks for Avg
				</label>
				<select
					id="min-sportsbooks"
					className="settings-select"
					value={minSportsbooks}
					onChange={(e) => onMinSportsbooksChange(Number(e.target.value))}
				>
					<option value="1">1 sportsbook</option>
					<option value="2">2 sportsbooks</option>
					<option value="3">3 sportsbooks</option>
					<option value="4">All 4 sportsbooks</option>
				</select>
				<div className="settings-description">
					Highlight Avg when at least this many sportsbooks have values.
				</div>
			</div>

		</div>
	);
}
