import './Settings.css';

export type AvgDisplayMode = 'avg' | 'max';

interface SettingsPanelProps {
	showPercentage: boolean;
	onShowPercentageChange: (value: boolean) => void;
	deVigEnabled: boolean;
	onDeVigEnabledChange: (value: boolean) => void;
	minSportsbooks: number;
	onMinSportsbooksChange: (value: number) => void;
	avgDisplayMode: AvgDisplayMode;
	onAvgDisplayModeChange: (value: AvgDisplayMode) => void;
}

export default function SettingsPanel(props: SettingsPanelProps) {
	const {
		showPercentage,
		onShowPercentageChange,
		deVigEnabled,
		onDeVigEnabledChange,
		minSportsbooks,
		onMinSportsbooksChange,
		avgDisplayMode,
		onAvgDisplayModeChange,
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
					<div className="settings-description">Display values as probability percentages</div>
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
					<div className="settings-description">Remove sportsbook bias by adjusting odds to a consensus value</div>
				</label>
			</div>

			<div className="settings-group">
				<label htmlFor="min-sportsbooks" className="settings-label">Minimum Sportsbooks for Highlight</label>
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
				<div className="settings-description">Highlight avg column when value appears in at least this many sportsbooks</div>
			</div>

			<div className="settings-group">
				<label htmlFor="avg-display" className="settings-label">Avg Column Display</label>
				<select
					id="avg-display"
					className="settings-select"
					value={avgDisplayMode}
					onChange={(e) => onAvgDisplayModeChange(e.target.value as AvgDisplayMode)}
				>
					<option value="avg">Average of sportsbooks</option>
					<option value="max">Maximum sportsbook value</option>
				</select>
				<div className="settings-description">Choose what to display in the Avg column</div>
			</div>
		</div>
	);
}
