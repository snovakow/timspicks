import Correlate from './components/Correlate';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as Picks from './components/Table';
import Popup from './components/Popup';
import InfoPopupContent, { LegendPopupContent } from './components/InfoPopupContent';
import StatsPopupContent from './components/StatsPopupContent';
import type { SportsbookLog, LogStatsKey } from './sportsbookTypes';
import SettingsPanel from './components/Settings';
import { roundToPercent, probabilityToAmerican, getEntries } from './utility';
import * as DataProcessor from './dataProcessor';
import { precalculateLogStats, cloneLogStats } from './statsCalculations';
import { sportsbooks } from './sportsbookTypes';
import iconSettings from './images/settings_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconStats from './images/leaderboard_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconInfo from './images/info_i_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconLegend from './images/legend_toggle_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyDark from './images/sports_hockey_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyLight from './images/sports_hockey_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg';
import { runSimulation } from './picksOptimizer';
import CollapsibleSection from './components/CollapsibleSection';
import { getTeamTotals } from './teamGoals';
import * as Feature from './features';

import './App.css';

const precision = Picks.precision;
let SIMULATE = Feature.simulate;

const betDisplayRounded = (chance: number | null): string => {
	if (chance === null) return "-";
	return roundToPercent(chance, precision);
}

const sortFunction = (sortConfig: Picks.SortConfig) => {
	return (a: Picks.PickOdds | Picks.Player, b: Picks.PickOdds | Picks.Player): number => {
		// Rows can be either PickOdds or Player depending on the table; normalize for shared sorting.
		const aPlayer = a instanceof Picks.PickOdds ? a.player : a;
		const bPlayer = b instanceof Picks.PickOdds ? b.player : b;
		for (const key of sortConfig.keyOrder) {
			const aVal = aPlayer[key];
			const bVal = bPlayer[key];

			// Keep nulls at the end regardless of sort key.
			if (aVal === null) {
				if (bVal === null) continue;
				return 1;
			}
			if (bVal === null) return -1;

			if (typeof aVal === 'number' && typeof bVal === 'number') {
				// Treat 0 as low-signal/missing for ranking and push it down.
				if (aVal === 0) {
					if (bVal === 0) continue;
					return 1;
				}
				if (bVal === 0) return -1;

				if (aVal !== bVal) {
					return bVal - aVal;
				}
			}

			if (aVal instanceof Date && bVal instanceof Date) {
				const diff = aVal.getTime() - bVal.getTime();
				if (diff !== 0) return diff;
			}

			if (typeof aVal === 'string' && typeof bVal === 'string') {
				const comparison = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
				if (comparison !== 0) return comparison;
			}
		}
		return 0;
	}
}

const makeSort = (sortConfig: Picks.SortConfig) => {
	return (keyPrimary: Picks.ColumnKeys) => {
		if (sortConfig.keyOrder[0] === keyPrimary) return;
		// Keep the chosen key first while preserving the existing fallback key order.
		const keyOrder = [keyPrimary];
		for (const key of sortConfig.keyOrder) {
			if (key === keyPrimary) continue;
			keyOrder.push(key);
		}
		sortConfig.keyOrder = keyOrder;
	};
}

interface InitializedData {
	gamesList: Picks.GameData[];
	playerList: Picks.Player[];
	table1Rows: Picks.PickOdds[];
	table2Rows: Picks.PickOdds[];
	table3Rows: Picks.PickOdds[];
}

function App() {
	// xG (expected goals) state
	const [xgEnabled, setXgEnabled] = useState(false);
	const [xgMap, setXgMap] = useState<Map<string, number> | null>(null);
	const xgLoadedRef = useRef(false);

	// Lazy-load xG data only if enabled and not already loaded
	useEffect(() => {
		if (xgEnabled && !xgLoadedRef.current) {
			getTeamTotals().then((map) => {
				setXgMap(map);
				xgLoadedRef.current = true;
			});
		}
	}, [xgEnabled]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<InitializedData | null>(null);

	const [showPercentage, setShowPercentage] = useState(true);
	const [deVigEnabled, setDeVigEnabled] = useState(true);
	const [minSportsbooks, setMinSportsbooks] = useState(3);
	const [correlationFactor, setCorrelationFactor] = useState(1);
	const [showCorrelate, setShowCorrelate] = useState(false);
	const [enabledStrategies, setEnabledStrategies] = useState<Record<Picks.StrategyMode, boolean>>({
		least1: true,
		points: true,
		hits: true,
		top: true,
	});

	const [needsSort1, setNeedsSort1] = useState<Picks.ColumnKeys>('betAvg');
	const [needsSort2, setNeedsSort2] = useState<Picks.ColumnKeys>('betAvg');
	const [needsSort3, setNeedsSort3] = useState<Picks.ColumnKeys>('betAvg');
	const [needsSortPlayer, setNeedsSortPlayer] = useState<Picks.ColumnKeys>('betAvg');

	// Load data on mount
	useEffect(() => {
		const initializeData = async () => {
			try {
				const initialData = await DataProcessor.loadInitialData();
				const playerList = initialData.playersListing;
				const gamesList = initialData.gamesListing;
				const normalizedNameMap = DataProcessor.buildNormalizedNameMap(playerList);

				if (SIMULATE) {
					runSimulation(1000000).then((results) => {
						console.log(JSON.stringify(results));
					});
					SIMULATE = false;
				}

				const { table1Rows, table2Rows, table3Rows } = DataProcessor.mapPlayers(
					playerList,
					initialData.playerData,
					normalizedNameMap
				);

				DataProcessor.compilePlayerList(
					playerList,
					initialData.playerOddsDraftKings,
					initialData.playerOddsFanDuel,
					initialData.playerOddsBetMGM,
					initialData.playerOddsBetRivers
				);

				setData({ gamesList, playerList, table1Rows, table2Rows, table3Rows });
				setError(null);
			} catch (error: unknown) {
				if (error instanceof Error && error.message === DataProcessor.NO_GAMES_ERROR) {
					console.warn('No games found for today. Displaying empty tables.');
				} else {
					console.error('Failed to load initial data:', error);
					setError('Failed to load game data. Please refresh the page.');
				}
				setData({ gamesList: [], playerList: [], table1Rows: [], table2Rows: [], table3Rows: [] });
			} finally {
				setIsLoading(false);
			}
		};

		initializeData();
	}, []);

	// Initialize sort configs - use ref to avoid recreating
	const sortConfig1Ref = useRef<Picks.SortConfig>({ keyOrder: [] });
	const sortConfig2Ref = useRef<Picks.SortConfig>({ keyOrder: [] });
	const sortConfig3Ref = useRef<Picks.SortConfig>({ keyOrder: [] });
	const sortConfigPlayerRef = useRef<Picks.SortConfig>({ keyOrder: [] });

	const requestSort1: Picks.RequestSort = useCallback((key) => setNeedsSort1(key), []);
	const requestSort2: Picks.RequestSort = useCallback((key) => setNeedsSort2(key), []);
	const requestSort3: Picks.RequestSort = useCallback((key) => setNeedsSort3(key), []);
	const requestSortPlayer: Picks.RequestSort = useCallback((key) => setNeedsSortPlayer(key), []);
	const handleStrategyEnabledChange = useCallback((strategy: Picks.StrategyMode, value: boolean) => {
		setEnabledStrategies((prev) => ({ ...prev, [strategy]: value }));
	}, []);

	const memoizedDisplayData = useMemo(() => {
		if (!data) return null;

		const { gamesList, playerList: origPlayerList, table1Rows: origTable1, table2Rows: origTable2, table3Rows: origTable3 } = data;

		const clonePlayer = (player: Picks.Player): Picks.Player => {
			return Object.assign(Object.create(Picks.Player.prototype), player) as Picks.Player;
		};

		const clonePickRow = (row: Picks.PickOdds, player: Picks.Player): Picks.PickOdds => {
			return Object.assign(Object.create(Picks.PickOdds.prototype), row, { player }) as Picks.PickOdds;
		};

		// Preserve shared player identity across cloned rows so updates stay consistent per player.
		const playerById = new Map<number, Picks.Player>();
		const playerList = origPlayerList.map((player) => {
			const clone = clonePlayer(player);
			playerById.set(clone.playerId, clone);
			return clone;
		});

		const cloneRows = (rows: Picks.PickOdds[]): Picks.PickOdds[] => {
			return rows.map((row) => {
				const player = playerById.get(row.player.playerId) ?? clonePlayer(row.player);
				return clonePickRow(row, player);
			});
		};

		// Create fresh object graphs so display mutations do not leak back into source data.
		const table1Rows = cloneRows(origTable1);
		const table2Rows = cloneRows(origTable2);
		const table3Rows = cloneRows(origTable3);

		// Update player betting display values
		const key1 = deVigEnabled ? 'bet1' : 'betRaw1';
		const key2 = deVigEnabled ? 'bet2' : 'betRaw2';
		const key3 = deVigEnabled ? 'bet3' : 'betRaw3';
		const key4 = deVigEnabled ? 'bet4' : 'betRaw4';

		if (Feature.normalize) {
			// Reset to raw values before reapplying de-vig to avoid compounding transformations.
			for (const player of playerList) {
				player.bet1 = player.betRaw1;
				player.bet2 = player.betRaw2;
				player.bet3 = player.betRaw3;
				player.bet4 = player.betRaw4;
			}
			if (deVigEnabled) DataProcessor.deVig(playerList);
		}

		for (const player of playerList) {
			const values = [player[key1], player[key2], player[key3], player[key4]];
			const rawValues = [player.betRaw1, player.betRaw2, player.betRaw3, player.betRaw4];
			const displays = ['betDisplay1', 'betDisplay2', 'betDisplay3', 'betDisplay4'] as const;

			for (let i = 0; i < values.length; i++) {
				const value = values[i] as number | null;
				if (value === null) continue;
				player[displays[i]] = showPercentage
					? roundToPercent(value, precision)
					: probabilityToAmerican(rawValues[i]);
			}

			let count = 0;
			let avg = 0;
			for (const value of values as (number | null)[]) {
				if (value === null) continue;
				avg += value;
				count++;
			}

			player.betCount = count;
			if (count > 0) {
				player.betAvg = avg / count;
				player.betDisplayAvg = betDisplayRounded(player.betAvg);
			} else {
				player.betAvg = null;
				player.betDisplayAvg = '-';
			}
		}

		const clearArray = (array: Picks.PickOdds[]) => {
			// Derived highlight/strategy state is recomputed every memo run.
			for (const row of array) {
				row.highlight1 = false;
				row.highlight2 = false;
				row.highlight3 = false;
				row.highlight4 = false;
				row.highlightAvg = false;
				row.strategy1.clear();
				row.strategy2.clear();
				row.strategy3.clear();
				row.strategy4.clear();
				row.strategyAvg.clear();
			}
		};
		clearArray(table1Rows);
		clearArray(table2Rows);
		clearArray(table3Rows);

		// Build sort functions and apply sorting
		const sortFunction1 = sortFunction(sortConfig1Ref.current);
		const makeSort1 = makeSort(sortConfig1Ref.current);
		makeSort1(needsSort1);
		table1Rows.sort(sortFunction1);

		const sortFunction2 = sortFunction(sortConfig2Ref.current);
		const makeSort2 = makeSort(sortConfig2Ref.current);
		makeSort2(needsSort2);
		table2Rows.sort(sortFunction2);

		const sortFunction3 = sortFunction(sortConfig3Ref.current);
		const makeSort3 = makeSort(sortConfig3Ref.current);
		makeSort3(needsSort3);
		table3Rows.sort(sortFunction3);

		const sortFunctionPlayer = sortFunction(sortConfigPlayerRef.current);
		const makeSortPlayer = makeSort(sortConfigPlayerRef.current);
		makeSortPlayer(needsSortPlayer);
		playerList.sort(sortFunctionPlayer);

		return { gamesList, playerList, table1Rows, table2Rows, table3Rows };
	}, [data, showPercentage, deVigEnabled, needsSort1, needsSort2, needsSort3, needsSortPlayer]);

	// Only stats popup uses 'key', others do not
	const [showPopup, setShowPopup] = useState<{ visible: boolean; title: string; key?: LogStatsKey }>({ visible: false, title: 'Stats', key: 'betAvg' });
	const [popupStats, setPopupStats] = useState<SportsbookLog | null>(null);
	const [popupView, setPopupView] = useState<'info' | 'legend' | 'stats' | 'settings'>('stats');

	const closePopup = () => {
		setShowPopup({ ...showPopup, visible: false });
	};

	// Memoize stats calculations - expensive O(n³) combo calculations
	const statsCache = useMemo(() => {
		if (!memoizedDisplayData) return null;
		// Precompute once per dependency change and clone on read to keep cache immutable.
		return precalculateLogStats(
			minSportsbooks,
			memoizedDisplayData.table1Rows,
			memoizedDisplayData.table2Rows,
			memoizedDisplayData.table3Rows,
			correlationFactor
		);
	}, [memoizedDisplayData, minSportsbooks, correlationFactor]);

	// Keep popup stats in sync with the latest cache only while the stats view is visible.
	useEffect(() => {
		if (popupView === 'stats' && showPopup.visible && statsCache) {
			setPopupStats(cloneLogStats(statsCache));
		}
	}, [popupView, showPopup.visible, statsCache]);

	const openStatsPopup = (key: LogStatsKey, title: string) => {
		if (gamesList.length > 0 && statsCache) {
			setPopupStats(cloneLogStats(statsCache));
		}
		setPopupView('stats');
		setShowPopup({ visible: true, title, key });
	};

	const openInfoPopup = () => {
		setPopupView('info');
		setShowPopup({ visible: true, title: 'Info' });
	};

	const openLegendPopup = () => {
		setPopupView('legend');
		setShowPopup({ visible: true, title: 'Legend' });
	};

	const openSettingsPopup = () => {
		setPopupView('settings');
		setShowPopup({ visible: true, title: 'Settings' });
	};

	const [darkTheme, setDarkTheme] = useState(() => {
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	});

	useEffect(() => {
		const handleChange = (event: MediaQueryListEvent) => {
			setDarkTheme(event.matches);
		};
		const darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
		darkModeMql.addEventListener('change', handleChange);
		return () => darkModeMql.removeEventListener('change', handleChange);
	}, []);

	if (error) {
		return (
			<div className="error-screen">
				<p className="error-message">{error}</p>
				<button onClick={() => window.location.reload()}>Refresh Page</button>
			</div>
		);
	}

	if (isLoading || !memoizedDisplayData) {
		return (
			<div className="loading-screen">
				<p>Loading...</p>
			</div>
		);
	}

	const { gamesList, table1Rows, table2Rows, table3Rows, playerList: displayPlayerList } = memoizedDisplayData;

	const oddsColumns: Picks.ColumnData[] = getEntries(sportsbooks).map(([key, book]) => ({
		key: key,
		title: book.title,
		sort: true,
		logo: book.logo,
	}));

	const columns: Picks.ColumnData[] = [
		{ key: "fullName", title: "Player", sort: true },
		...oddsColumns,
		{ key: "betAvg", title: "Avg", sort: true },
	];

	const columnsPlayer: Picks.ColumnData[] = [
		{ key: "fullName", title: "Player", sort: true },
		...oddsColumns,
		{ key: "betAvg", title: "Avg", sort: true },
		{ key: "pick", title: "Pick", sort: false },
		{ key: "gameTime", title: "Start", sort: true },
	];

	return (
		<>
			<header>
				<div className='toolBar toolbar-start'>
					<button className="button" title="Settings" aria-label="Settings"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'settings') closePopup();
								else openSettingsPopup();
							}
						}>
						<img src={iconSettings} alt="⚙" />
					</button>
					<button className="button" title="Stats" aria-label="Stats"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'stats') closePopup();
								else openStatsPopup('betAvg', 'Stats');
							}
						}>
						<img src={iconStats} alt="📊" aria-hidden="true" />
					</button>
				</div>
				<span className="header-title">
					<img className="header-title-icon" src={darkTheme ? iconHockeyLight : iconHockeyDark} alt="" aria-hidden="true" />
					<span className="header-title-text">
						Tims Hockey Picks
					</span>
				</span>
				<div className='toolBar toolbar-end'>
					<button className="button" title="Legend" aria-label="Legend"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'legend') closePopup();
								else openLegendPopup();
							}
						}>
						<img src={iconLegend} alt="ℹ️" aria-hidden="true" />
					</button>
					<button className="button" title="Info" aria-label="Info"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'info') closePopup();
								else openInfoPopup();
							}
						}>
						<img src={iconInfo} alt="?" aria-hidden="true" />
					</button>
				</div>
			</header>
			<main className='content'>
				<Popup title={showPopup.title} showPopUp={showPopup.visible} closePopUp={closePopup} top={popupView === 'stats'}>
					{popupView === 'info' ? (
						<InfoPopupContent />
					) : popupView === 'legend' ? (
						<LegendPopupContent />
					) : popupView === 'settings' ? (
						<SettingsPanel
							showPercentage={showPercentage}
							onShowPercentageChange={setShowPercentage}
							deVigEnabled={deVigEnabled}
							onDeVigEnabledChange={setDeVigEnabled}
							minSportsbooks={minSportsbooks}
							onMinSportsbooksChange={setMinSportsbooks}
							enabledStrategies={enabledStrategies}
							onStrategyEnabledChange={handleStrategyEnabledChange}
							xgEnabled={xgEnabled}
							onXgEnabledChange={setXgEnabled}
						/>
					) : (
						<StatsPopupContent bookStats={popupStats} />
					)}
				</Popup>

				<CollapsibleSection title="Games">
					<div className="scrollable-table-wrapper section-container">
						{gamesList.length === 0 ? (
							<div className="no-games-message">No games today</div>
						) : (
							<Picks.Basic games={gamesList} darkTheme={darkTheme} xgMap={xgEnabled && xgMap ? xgMap : undefined} />
						)}
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Pick #1">
					<div className="scrollable-table-wrapper section-container">
						<Picks.Table columns={columns} sortedRows={table1Rows} requestSort={requestSort1} sortConfig={sortConfig1Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Pick #2">
					<div className="scrollable-table-wrapper section-container">
						<Picks.Table columns={columns} sortedRows={table2Rows} requestSort={requestSort2} sortConfig={sortConfig2Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Pick #3">
					<div className="scrollable-table-wrapper section-container">
						<Picks.Table columns={columns} sortedRows={table3Rows} requestSort={requestSort3} sortConfig={sortConfig3Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Players">
					<div className="scrollable-table-wrapper section-container">
						<Picks.Table columns={columnsPlayer} sortedRows={displayPlayerList} requestSort={requestSortPlayer} sortConfig={sortConfigPlayerRef.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
					</div>
				</CollapsibleSection>

				{showCorrelate ? (
					<Correlate
						value={correlationFactor}
						setValue={setCorrelationFactor}
						onClose={() => setShowCorrelate(false)}
					/>
				) : (
					<button className="correlate-button"
						title="Show Correlation Slider"
						aria-label="Show Correlation Slider"
						onClick={() => setShowCorrelate(true)}
					>
						<i>𝑳%</i>
					</button>
				)}
			</main>
		</>
	)
}

export default App
