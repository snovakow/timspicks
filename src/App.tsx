import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './App.css';
import * as Picks from './components/Table';
import Popup from './components/Popup';
import InfoPopupContent, { LegendPopupContent } from './components/InfoPopupContent';
import StatsPopupContent from './components/StatsPopupContent';
import SettingsPanel from './components/Settings';
import { poissonChance, roundToPercent, probabilityToAmerican } from './utility';
import { loadInitialData, buildGamesList, buildPlayerList, buildNormalizedNameMap, mapPlayers, compilePlayerList } from './dataProcessor';
import { precalculateLogStats, cloneLogStats, type LogStatsKey, type LogStat } from './statsCalculations';
import logo1 from './images/sb-logo-16-draftkings.svg';
import logo2 from './images/sb-logo-16-fanduel.svg';
import logo3 from './images/sb-logo-16-mgm.svg';
import logo4 from './images/sb-logo-16-betrivers.svg';
import iconSettings from './images/settings_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconStats from './images/leaderboard_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconInfo from './images/info_i_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconLegend from './images/legend_toggle_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyDark from './images/sports_hockey_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyLight from './images/sports_hockey_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg';

const precision = Picks.precision;

type Sportsbook = {
	key: "bet1" | "bet2" | "bet3" | "bet4";
	title: string;
	logo: string;
};

const sportsbooks: Sportsbook[] = [
	{ key: "bet1", title: "DraftKings", logo: logo1 },
	{ key: "bet2", title: "FanDuel", logo: logo2 },
	{ key: "bet3", title: "BetMGM", logo: logo3 },
	{ key: "bet4", title: "BetRivers", logo: logo4 },
];

const betDisplayRounded = (chance: number | null): string => {
	if (chance === null) return "-";
	return roundToPercent(chance, precision);
}

const sortFunction = (sortConfig: Picks.SortConfig) => {
	return (a: Picks.PickOdds | Picks.Player, b: Picks.PickOdds | Picks.Player): number => {
		const aPlayer = a instanceof Picks.PickOdds ? a.player : a;
		const bPlayer = b instanceof Picks.PickOdds ? b.player : b;
		for (const key of sortConfig.keyOrder) {
			const aVal = key === 'ggRaw' ? (a as Picks.PickOdds)[key] : aPlayer[key];
			const bVal = key === 'ggRaw' ? (b as Picks.PickOdds)[key] : bPlayer[key];

			if (aVal === null) {
				if (bVal === null) continue;
				return 1;
			}
			if (bVal === null) return -1;

			if (typeof aVal === 'number' && typeof bVal === 'number') {
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
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<InitializedData | null>(null);

	const [showPercentage, setShowPercentage] = useState(true);
	const [deVigEnabled, setDeVigEnabled] = useState(true);
	const [minSportsbooks, setMinSportsbooks] = useState(3);
	const [enabledStrategies, setEnabledStrategies] = useState<Record<Picks.StrategyMode, boolean>>({
		streak: false,
		point: false,
		leaderboard: false,
		hybrid: true,
		top: true,
	});

	const [needsSort1, setNeedsSort1] = useState<Picks.ColumnKeys>('ggRaw');
	const [needsSort2, setNeedsSort2] = useState<Picks.ColumnKeys>('ggRaw');
	const [needsSort3, setNeedsSort3] = useState<Picks.ColumnKeys>('ggRaw');
	const [needsSortPlayer, setNeedsSortPlayer] = useState<Picks.ColumnKeys>('betAvg');

	// Load data on mount
	useEffect(() => {
		const initializeData = async () => {
			try {
				const initialData = await loadInitialData();
				const gamesList = buildGamesList(initialData.gamesListing);
				const playerList = buildPlayerList(initialData.gamesListing);
				const normalizedNameMap = buildNormalizedNameMap(playerList);

				const { table1Rows, table2Rows, table3Rows } = mapPlayers(
					playerList,
					initialData.playerData,
					normalizedNameMap
				);

				compilePlayerList(
					playerList,
					initialData.playerOddsDraftKings,
					initialData.playerOddsFanDuel,
					initialData.playerOddsBetMGM,
					initialData.playerOddsBetRivers
				);

				setData({ gamesList, playerList, table1Rows, table2Rows, table3Rows });
				setError(null);
			} catch (error) {
				console.error('Failed to load initial data:', error);
				setError('Failed to load game data. Please refresh the page.');
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

		// Create fresh object graphs so all display mutations stay local to this memoized result.
		const table1Rows = cloneRows(origTable1);
		const table2Rows = cloneRows(origTable2);
		const table3Rows = cloneRows(origTable3);

		// Update pick odds display values
		const updatePickOddsDisplay = (rows: Picks.PickOdds[]) => {
			for (const row of rows) {
				row.ggDisplay = showPercentage
					? poissonChance(row.ggRaw, precision)
					: row.ggRaw.toFixed(2);
			}
		};

		updatePickOddsDisplay(table1Rows);
		updatePickOddsDisplay(table2Rows);
		updatePickOddsDisplay(table3Rows);

		// Update player betting display values
		const key1 = deVigEnabled ? 'bet1' : 'betRaw1';
		const key2 = deVigEnabled ? 'bet2' : 'betRaw2';
		const key3 = deVigEnabled ? 'bet3' : 'betRaw3';
		const key4 = deVigEnabled ? 'bet4' : 'betRaw4';

		for (const player of playerList) {
			const values = [player[key1 as keyof typeof player], player[key2 as keyof typeof player], player[key3 as keyof typeof player], player[key4 as keyof typeof player]];
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

		// Expose minSportsbooks in the returned object for downstream consumers
		return { gamesList, playerList, table1Rows, table2Rows, table3Rows, minSportsbooks };
	}, [data, showPercentage, deVigEnabled, needsSort1, needsSort2, needsSort3, needsSortPlayer, minSportsbooks]);

	// Memoize stats calculations - expensive O(n³) combo calculations
	// Also applies stats-based highlights (opp/any) to rows after 'top' highlights are set
	const statsCache = useMemo(() => {
		if (!memoizedDisplayData) return null;
		const cache = precalculateLogStats(
			minSportsbooks,
			memoizedDisplayData.gamesList,
			memoizedDisplayData.table1Rows,
			memoizedDisplayData.table2Rows,
			memoizedDisplayData.table3Rows
		);
		return cache;
	}, [memoizedDisplayData, minSportsbooks]);

	const [showPopup, setShowPopup] = useState({ visible: false, title: 'Stats', key: 'betAvg' });
	const [popupStats, setPopupStats] = useState<LogStat[]>([]);
	const [popupView, setPopupView] = useState<'info' | 'legend' | 'stats' | 'settings'>('stats');

	const closePopup = () => {
		setShowPopup({ ...showPopup, visible: false });
	};

	const openStatsPopup = (key: LogStatsKey, title: string) => {
		if (statsCache) {
			const cached = statsCache[key];
			setPopupStats(cloneLogStats(cached.stats));
		}
		setPopupView('stats');
		setShowPopup({ visible: true, title, key });
	};

	const openInfoPopup = () => {
		setPopupView('info');
		setShowPopup({ visible: true, title: 'Info', key: showPopup.key });
	};

	const openLegendPopup = () => {
		setPopupView('legend');
		setShowPopup({ visible: true, title: 'Legend', key: showPopup.key });
	};

	const openSettingsPopup = () => {
		setPopupView('settings');
		setShowPopup({ visible: true, title: 'Settings', key: showPopup.key });
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
			<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
				<p style={{ color: '#d32f2f', fontSize: '1.1rem' }}>{error}</p>
				<button onClick={() => window.location.reload()}>Refresh Page</button>
			</div>
		);
	}

	if (isLoading || !memoizedDisplayData) {
		return (
			<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
				<p>Loading...</p>
			</div>
		);
	}

	const { gamesList, table1Rows, table2Rows, table3Rows, playerList: displayPlayerList } = memoizedDisplayData;

	const oddsColumns: Picks.ColumnData[] = sportsbooks.map((book) => ({
		key: book.key,
		title: book.title,
		sort: true,
		logo: book.logo,
	}));

	const columns: Picks.ColumnData[] = [
		{ key: "fullName", title: "Player", sort: true },
		{ key: "ggRaw", title: "G/GP", sort: true },
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
				<div className='toolBar' style={{ justifySelf: 'start' }}>
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
					Tims Hockey Picks
				</span>
				<div className='toolBar' style={{ justifySelf: 'end' }}>
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
				<Popup title={showPopup.title} showPopUp={showPopup.visible} closePopUp={closePopup}>
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
						/>
					) : (
						<StatsPopupContent stats={popupStats} />
					)}
				</Popup>

				<div className="table-container">
					<h2>Sportsbooks</h2>
					<div className="sportsbook-list">
						{sportsbooks.map((book) => (
							<button
								key={book.key}
								type="button"
								className="sportsbook-item"
								aria-label={book.title}
								onClick={() => openStatsPopup(book.key, book.title)}>
								<img className="sportsbook-logo logo-rounded" src={book.logo} alt={`${book.title} logo`} />
								<span>{book.title}</span>
							</button>
						))}
					</div>
				</div>
				<div className="table-container">
					<h2>Games</h2>
					<Picks.Basic games={gamesList} darkTheme={darkTheme} />
				</div>
				<div className="table-container">
					<h2>Pick #1</h2>
					<Picks.Table columns={columns} sortedRows={table1Rows} requestSort={requestSort1} sortConfig={sortConfig1Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
				</div>
				<div className="table-container">
					<h2>Pick #2</h2>
					<Picks.Table columns={columns} sortedRows={table2Rows} requestSort={requestSort2} sortConfig={sortConfig2Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
				</div>
				<div className="table-container">
					<h2>Pick #3</h2>
					<Picks.Table columns={columns} sortedRows={table3Rows} requestSort={requestSort3} sortConfig={sortConfig3Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
				</div>
				<div className="table-container">
					<h2>Players</h2>
					<Picks.Table columns={columnsPlayer} sortedRows={displayPlayerList} requestSort={requestSortPlayer} sortConfig={sortConfigPlayerRef.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} />
				</div>
			</main>
		</>
	)
}

export default App
