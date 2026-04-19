import './Settings.css';
import type { StrategyMode } from './Table';

interface SettingsPanelProps {
	showPercentage: boolean;
	onShowPercentageChange: (value: boolean) => void;
	deVigEnabled: boolean;
	onDeVigEnabledChange: (value: boolean) => void;
	minSportsbooks: number;
	onMinSportsbooksChange: (value: number) => void;
	enabledStrategies: Record<StrategyMode, boolean>;
	onStrategyEnabledChange: (strategy: StrategyMode, value: boolean) => void;
}

export default function SettingsPanel(props: SettingsPanelProps) {
	const {
		showPercentage,
		onShowPercentageChange,
		deVigEnabled,
		onDeVigEnabledChange,
		minSportsbooks,
		onMinSportsbooksChange,
		enabledStrategies,
		onStrategyEnabledChange,
	} = props;

	const strategyOptions: Array<{ key: StrategyMode; label: string }> = [
		{ key: 'least1', label: 'Streak' },
		{ key: 'points', label: 'Points' },
		{ key: 'hits', label: 'Leaderboard' },
		{ key: 'all3', label: 'All 3' },
		{ key: 'top', label: 'Top' },
	];

	return (
		<div className="settings-container">
			<div className="settings-group">
				<label className="settings-checkbox-item settings-checkbox-hoverable single-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none', margin: 0 }}>
					<input
						type="checkbox"
						checked={showPercentage}
						onChange={(e) => onShowPercentageChange(e.target.checked)}
						style={{ cursor: 'pointer', width: 18, height: 18 }}
					/>
					<span style={{ fontWeight: 500, fontSize: '1rem' }}>Show Probabilities</span>
				</label>
				<div className="settings-description">
					Show values as probability percentages. Sportsbook odds are displayed as implied probabilities, otherwise are displayed as American odds.
				</div>
			</div>

			<div className="settings-group">
				<label className="settings-checkbox-item settings-checkbox-hoverable single-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none', margin: 0 }}>
					<input
						type="checkbox"
						checked={deVigEnabled}
						onChange={(e) => onDeVigEnabledChange(e.target.checked)}
						style={{ cursor: 'pointer', width: 18, height: 18 }}
					/>
					<span style={{ fontWeight: 500, fontSize: '1rem' }}>Normalize Sportsbooks</span>
				</label>
				<div className="settings-description">
					Remove sportsbook bias by adjusting odds to a consensus value.
				</div>
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

			<div className="settings-group">
				<div className="settings-label">Pick Strategies</div>
				<div className="settings-checkbox-group" role="group" aria-label="Pick strategies">
					{strategyOptions.map((option) => (
						<label
							key={option.key}
							className={`settings-checkbox-item settings-strategy-checkbox settings-strategy-${option.key} settings-checkbox-hoverable`}
						>
							<input
								type="checkbox"
								checked={enabledStrategies[option.key]}
								onChange={(e) => onStrategyEnabledChange(option.key, e.target.checked)}
								tabIndex={0}
							/>
							{option.label}
						</label>
					))}
				</div>
				<div className="settings-description">
					Select which strategies to display.
				</div>
			</div>

		</div>
	);
}
