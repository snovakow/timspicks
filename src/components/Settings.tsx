import { StrategyLabels, type StrategyMode } from '../dataTypes';
import * as Feature from '../features';
import './Settings.css';

interface SettingsPanelProps {
	showPercentage: boolean;
	onShowPercentageChange: (value: boolean) => void;
	deVigEnabled: boolean;
	onDeVigEnabledChange: (value: boolean) => void;
	minSportsbooks: number;
	onMinSportsbooksChange: (value: number) => void;
	enabledStrategies: Record<StrategyMode, boolean>;
	onStrategyEnabledChange: (strategy: StrategyMode, value: boolean) => void;
	xgEnabled: boolean;
	onXgEnabledChange: (value: boolean) => void;
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
		xgEnabled,
		onXgEnabledChange,
	} = props;

	const labelClassNames = "settings-checkbox-item settings-checkbox settings-strategy-checkbox settings-label-single settings-checkbox-hoverable";
	return (
		<div className="settings-container">
			<div className="settings-group">
				<label htmlFor="min-sportsbooks" className="settings-label">
					Minimum Sportsbooks
				</label>
				<select
					id="min-sportsbooks"
					className="settings-select settings-min-sportsbooks-select"
					value={minSportsbooks}
					onChange={(e) => onMinSportsbooksChange(Number(e.target.value))}
				>
					<option value="1">1 sportsbook</option>
					<option value="2">2 sportsbooks</option>
					<option value="3">3 sportsbooks</option>
					<option value="4">All 4 sportsbooks</option>
				</select>
				<div className="settings-description">
					Minimum number of available sportsbook odds for a top pick.
				</div>
			</div>

			<div className="settings-group">
				<label className={labelClassNames}>
					<input
						type="checkbox"
						checked={showPercentage}
						onChange={(e) => onShowPercentageChange(e.target.checked)}
					/>
					<span>Show Probabilities</span>
				</label>
				<div className="settings-description">
					Show sportsbook odds as implied probability percentages, otherwise as American odds.
				</div>
			</div>
			{Feature.normalizeSportsbooks && (
				<div className="settings-group">
					<label className={labelClassNames}>
						<input
							type="checkbox"
							checked={deVigEnabled}
							onChange={(e) => onDeVigEnabledChange(e.target.checked)}
						/>
						<span>Normalize Sportsbooks</span>
					</label>
					<div className="settings-description">
						Remove sportsbook bias by adjusting odds to a consensus value.
					</div>
				</div>
			)}
			<div className="settings-group">
				<label className={labelClassNames}>
					<input
						type="checkbox"
						checked={xgEnabled}
						onChange={(e) => onXgEnabledChange(e.target.checked)}
					/>
					<span>Expected Team Goals</span>
				</label>
				<div className="settings-description">
					Include expected team goals in the Games table.
				</div>
			</div>

			{Feature.correlation && (
				<div className="settings-group">
					<div className="settings-label">Pick Strategies</div>
					<div className="settings-checkbox-group" role="group" aria-label="Pick strategies">
						{Object.entries(StrategyLabels).map(([key, label]) => (
							<label
								key={key}
								className={`settings-checkbox-item settings-checkbox settings-strategy-${key} settings-checkbox-hoverable`}
							>
								<input
									type="checkbox"
									checked={enabledStrategies[key as StrategyMode]}
									onChange={(e) => onStrategyEnabledChange(key as StrategyMode, e.target.checked)}
									tabIndex={0}
								/>
								{label}
							</label>
						))}
					</div>
					<div className="settings-description">
						Select which strategies to display.
					</div>
				</div>
			)}
		</div>
	);
}
