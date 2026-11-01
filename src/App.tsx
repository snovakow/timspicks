import Correlate from './components/Correlate';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as Picks from './components/Table';
import Popup from './components/Popup';
import InfoPopupContent, { LegendPopupContent } from './components/InfoPopupContent';
import StatsPopupContent, { StatsSportsbookList, type SlotStats } from './components/StatsPopupContent';
import type { SportsbookLog, LogStatsKey, SportsbookKey, StrategyMode } from './dataTypes';
import { SportsbookKeys, Sportsbooks } from './dataTypes';
import SettingsPanel from './components/Settings';
import { roundToPercent, probabilityToAmerican, getEntries, timeFormat } from './utility';
import * as DataProcessor from './dataProcessor';
import { precalculateLogStats, cloneLogStats, calculateBooksStats, calculateSelectedStats, streakLine } from './statsCalculations';
import { bestPicks, logCorrelations, runSimulation } from './picksOptimizer';
import CollapsibleSection from './components/CollapsibleSection';
import type { Team } from './components/logo';
import { getTeamTotals } from './teamGoals';
import * as Feature from './features';

import iconSettings from './images/settings_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconStats from './images/leaderboard_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconInfo from './images/info_i_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconLegend from './images/legend_toggle_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyDark from './images/sports_hockey_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyLight from './images/sports_hockey_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg';

import './App.css';

const precision = Picks.precision;

// Ceiling on a single wait for the next start: well inside setTimeout's 32-bit limit,
// and short enough that a sleeping device re-checks the clock soon after it wakes
const CLOCK_CHECK_MAX_MS = 4 * 60 * 60 * 1000;

let SIMULATE = Feature.analyze === 'GENERATE';
let ANALYZE = Feature.analyze === 'OUTPUT';

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

const clearDerivedPickState = (rows: Picks.PickOdds[]) => {
	for (const row of rows) {
		row.highlight.clear();
		row.strategy.clear();
	}
};

// The display text and the derived pick state get containers of their own, so filling them
// can't reach the source rows
const clonePickLists = (lists: DataProcessor.PickLists): DataProcessor.PickLists => {
	const clonePlayer = (player: Picks.Player): Picks.Player => {
		return Object.assign(Object.create(Picks.Player.prototype), player, { display: {} }) as Picks.Player;
	};

	const clonePickRow = (row: Picks.PickOdds, player: Picks.Player): Picks.PickOdds => {
		return Object.assign(Object.create(Picks.PickOdds.prototype), row, { player, highlight: new Set(), strategy: new Map() }) as Picks.PickOdds;
	};

	// Preserve shared player identity across cloned rows so updates stay consistent per player.
	const playerById = new Map<number, Picks.Player>();
	const playerList = lists.playerList.map((player) => {
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
	return {
		playerList,
		table1Rows: cloneRows(lists.table1Rows),
		table2Rows: cloneRows(lists.table2Rows),
		table3Rows: cloneRows(lists.table3Rows),
	};
};

// Each player's book values, display text, book count and average, from the prices the books gave
const fillDisplay = (playerList: Picks.Player[], showPercentage: boolean, deVigEnabled: boolean) => {
	if (Feature.normalizeSportsbooks) {
		// Reset to raw values before reapplying de-vig to avoid compounding transformations.
		for (const player of playerList) {
			for (const key of SportsbookKeys) player[key] = player.raw[key] ?? null;
		}
		if (deVigEnabled) DataProcessor.deVig(playerList);
	}

	for (const player of playerList) {
		let count = 0;
		let avg = 0;
		for (const key of SportsbookKeys) {
			const value = deVigEnabled ? player[key] : player.raw[key] ?? null;
			if (value === null) continue;
			player.display[key] = showPercentage
				? roundToPercent(value, precision)
				: probabilityToAmerican(player.raw[key] ?? null);
			avg += value;
			count++;
		}

		player.betCount = count;
		if (count > 0) {
			player.betAvg = avg / count;
			player.display.betAvg = betDisplayRounded(player.betAvg);
		} else {
			player.betAvg = null;
			player.display.betAvg = '-';
		}
	}
};

// The latest of the day's starts at or before now, or null before the first
const latestStart = (startTimes: readonly number[], now: number): number | null => {
	let latest: number | null = null;
	for (const time of startTimes) {
		if (time <= now && (latest === null || time > latest)) latest = time;
	}
	return latest;
};

interface InitializedData extends DataProcessor.PickLists {
	gamesList: Picks.GameData[];
	scheduleDate: string | null;
}

let xgMapCachePromise: Promise<Map<Team, number>> | null = null;
const getXgMap = async (): Promise<Map<Team, number>> => {
	if (!xgMapCachePromise) xgMapCachePromise = getTeamTotals();
	return xgMapCachePromise;
}

function App() {
	// xG (expected goals) state
	const [xgEnabled, setXgEnabled] = useState(false);
	const [xgMap, setXgMap] = useState<Map<Team, number> | null>(null);
	const xgLoadedRef = useRef(false);

	// Lazy-load xG data only if enabled and not already loaded
	useEffect(() => {
		if (xgEnabled && !xgLoadedRef.current) {
			getXgMap().then((map) => {
				setXgMap(map);
				xgLoadedRef.current = true;
			});
		}
	}, [xgEnabled]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<InitializedData | null>(null);
	const [dataStatus, setDataStatus] = useState<DataProcessor.DataStatus | null>(null);
	const [processed, setProcessed] = useState<Date | null>(null);
	const [lastGameStart, setLastGameStart] = useState<Date | null>(null);
	// The latest start the clock has passed, in ms, which greys that game's rows and every earlier one's
	const [passedStart, setPassedStart] = useState<number | null>(null);

	const [showPercentage, setShowPercentage] = useState(true);
	const [deVigEnabled, setDeVigEnabled] = useState(false);
	const [historyEnabled, setHistoryEnabled] = useState(false);
	const [minSportsbooks, setMinSportsbooks] = useState(4);
	const [correlationFactor, setCorrelationFactor] = useState(Feature.correlation ? 1 : 0);
	const [showCorrelate, setShowCorrelate] = useState(false);
	const [enabledStrategies, setEnabledStrategies] = useState<Record<StrategyMode, boolean>>({
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

				const { table1Rows, table2Rows, table3Rows } = DataProcessor.mapPlayers(
					playerList,
					initialData.playerData,
					normalizedNameMap
				);

				DataProcessor.compilePlayerList(playerList, initialData.playerOdds);

				setData({
					gamesList,
					scheduleDate: initialData.scheduleDate,
					playerList,
					table1Rows,
					table2Rows,
					table3Rows,
				});
				setDataStatus(initialData.dataStatus);
				setProcessed(initialData.processed);
				setLastGameStart(initialData.lastGameStart);
				// Set alongside the data so a started game's rows never paint before the clock effect greys them
				setPassedStart(latestStart(gamesList.map((game) => game.time.getTime()), Date.now()));
				setError(null);
			} catch (error: unknown) {
				if (error instanceof Error && error.message === DataProcessor.NO_GAMES_ERROR) {
					console.warn('No games found for today. Displaying empty tables.');
				} else {
					console.error('Failed to load initial data:', error);
					setError('Failed to load game data. Please refresh the page.');
				}
				setData({
					gamesList: [],
					scheduleDate: null,
					playerList: [],
					table1Rows: [],
					table2Rows: [],
					table3Rows: [],
				});
			} finally {
				setIsLoading(false);
			}
		};

		initializeData();
	}, []);

	// The day's distinct start times, which are also its slots, in order
	const startTimes = useMemo(() => {
		const times = (data?.gamesList ?? []).map((game) => game.time.getTime()).filter((time) => !isNaN(time));
		return [...new Set(times)].sort((a, b) => a - b);
	}, [data]);

	/*
		A start greys its game's rows before any run follows it, and the cron makes no runs between
		the day's last start and midnight, so the view has to move on the clock rather than on a
		fetch. No re-fetch either: the next day's lists arrive on the next load, by which time the
		post-midnight run has written them. A long wait is re-armed from the clock instead of trusted
		once, since a background tab throttles its timers and a device asleep past a start wakes
		with one already due.
	*/
	useEffect(() => {
		if (startTimes.length === 0) return;

		let timer: number | undefined;
		const check = () => {
			const now = Date.now();
			setPassedStart(latestStart(startTimes, now));
			const next = startTimes.find((time) => time > now);
			if (next === undefined) return;
			timer = window.setTimeout(check, Math.min(next - now, CLOCK_CHECK_MAX_MS));
		};
		check();

		const handleVisibility = () => {
			if (document.visibilityState !== 'visible') return;
			window.clearTimeout(timer);
			check();
		};
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			window.clearTimeout(timer);
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	}, [startTimes]);

	// Data stale enough to trip "stopped" is likely holding an earlier day's schedule, all of it long started,
	// so as with calling the day locked, that notice takes precedence over greying its games
	const passed = dataStatus?.stopped ? null : passedStart;

	// The passed slots' starts, oldest first
	const passedSlots = useMemo(() => passed === null ? [] : startTimes.filter((time) => time <= passed), [startTimes, passed]);

	// The passed slots whose players the tables keep, which only the history does
	const shownSlots = useMemo(() => historyEnabled ? passedSlots : [], [historyEnabled, passedSlots]);

	// Each shown slot's snapshot: absent while it loads, null when the slot has none. A passed slot's
	// folder is never written again, so a load holds for the page's life
	const [slotSnapshots, setSlotSnapshots] = useState<ReadonlyMap<number, DataProcessor.PickLists | null>>(new Map());
	const slotLoads = useRef(new Set<number>());
	useEffect(() => {
		if (!data?.scheduleDate) return;
		const date = data.scheduleDate;
		const games = data.gamesList;
		for (const start of shownSlots) {
			if (slotLoads.current.has(start)) continue;
			slotLoads.current.add(start);
			DataProcessor.loadSlot(date, new Date(start), games)
				.catch(() => null)
				.then((slot) => setSlotSnapshots((prev) => new Map(prev).set(start, slot)));
		}
	}, [shownSlots, data]);

	// Initialize sort configs - use ref to avoid recreating
	const sortConfig1Ref = useRef<Picks.SortConfig>({ keyOrder: [] });
	const sortConfig2Ref = useRef<Picks.SortConfig>({ keyOrder: [] });
	const sortConfig3Ref = useRef<Picks.SortConfig>({ keyOrder: [] });
	const sortConfigPlayerRef = useRef<Picks.SortConfig>({ keyOrder: [] });

	const requestSort1: Picks.RequestSort = useCallback((key) => setNeedsSort1(key), []);
	const requestSort2: Picks.RequestSort = useCallback((key) => setNeedsSort2(key), []);
	const requestSort3: Picks.RequestSort = useCallback((key) => setNeedsSort3(key), []);
	const requestSortPlayer: Picks.RequestSort = useCallback((key) => setNeedsSortPlayer(key), []);
	const handleStrategyEnabledChange = useCallback((strategy: StrategyMode, value: boolean) => {
		setEnabledStrategies((prev) => ({ ...prev, [strategy]: value }));
	}, []);

	const memoizedDisplayData = useMemo(() => {
		if (!data) return null;

		const { gamesList } = data;
		const current = clonePickLists(data);
		const playerList = current.playerList;
		fillDisplay(playerList, showPercentage, deVigEnabled);

		// Each slot gets copies of its own, with any de-vig fitted to the odds it had
		const slots = new Map<number, DataProcessor.PickLists>();
		for (const start of shownSlots) {
			const snapshot = slotSnapshots.get(start);
			if (!snapshot) continue;
			const slot = clonePickLists(snapshot);
			fillDisplay(slot.playerList, showPercentage, deVigEnabled);
			slots.set(start, slot);
		}

		/*
			A shown slot's started games take their rows from its snapshot, the last lists before they
			started, so the redraw at a start doesn't drop the game's players from the tables. Before
			the redraw the snapshot is the same run the current lists come from, and
			after a run the feed hadn't redrawn for, only the snapshot holds the game's prices from
			before its start: a later run finds them changed, or gone.
		*/
		const withHistory = (rows: Picks.PickOdds[], slotRows: (slot: DataProcessor.PickLists) => Picks.PickOdds[]): Picks.PickOdds[] => {
			if (slots.size === 0) return rows;
			const merged = rows.filter((row) => !slots.has(row.player.gameTime.getTime()));
			for (const [start, slot] of slots) {
				merged.push(...slotRows(slot).filter((row) => row.player.gameTime.getTime() === start));
			}
			return merged;
		};
		const table1Rows = withHistory(current.table1Rows, (slot) => slot.table1Rows);
		const table2Rows = withHistory(current.table2Rows, (slot) => slot.table2Rows);
		const table3Rows = withHistory(current.table3Rows, (slot) => slot.table3Rows);

		// Derived highlight/strategy state is recomputed every memo run.
		clearDerivedPickState(table1Rows);
		clearDerivedPickState(table2Rows);
		clearDerivedPickState(table3Rows);

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

		return {
			gamesList,
			playerList,
			table1Rows,
			table2Rows,
			table3Rows,
			slots,
		};
	}, [data, showPercentage, deVigEnabled, needsSort1, needsSort2, needsSort3, needsSortPlayer, shownSlots, slotSnapshots]);

	// Only stats popup uses 'key', others do not
	const [showPopup, setShowPopup] = useState<{ visible: boolean; title: string; key?: LogStatsKey }>({ visible: false, title: 'Stats', key: 'betAvg' });
	const [popupStats, setPopupStats] = useState<SportsbookLog | null>(null);
	const [popupView, setPopupView] = useState<'info' | 'legend' | 'stats' | 'settings'>('stats');
	// The books whose average the stats show; none selected averages them all
	const [selectedStatsBooks, setSelectedStatsBooks] = useState<ReadonlySet<SportsbookKey>>(new Set());
	// A book toggles either way: picked alone it also deselects every other book, while adding to the
	// selection leaves the others as they are
	const toggleStatsBook = useCallback((key: SportsbookKey, add: boolean) => {
		setSelectedStatsBooks((prev) => {
			if (!add) return prev.has(key) ? new Set() : new Set([key]);
			const next = new Set(prev);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	}, []);
	const statsBooks = useMemo(() => SportsbookKeys.filter((key) => selectedStatsBooks.has(key)), [selectedStatsBooks]);

	const closePopup = () => {
		setShowPopup({ ...showPopup, visible: false });
	};

	// The rows whose game hasn't started, the only ones left to pick, so the only ones the stats count and mark
	const liveRows = useMemo(() => {
		if (!memoizedDisplayData) return null;
		const live = (rows: Picks.PickOdds[]) => passed === null ? rows : rows.filter((row) => row.player.gameTime.getTime() > passed);
		return {
			table1Rows: live(memoizedDisplayData.table1Rows),
			table2Rows: live(memoizedDisplayData.table2Rows),
			table3Rows: live(memoizedDisplayData.table3Rows),
		};
	}, [memoizedDisplayData, passed]);

	// Memoize stats calculations - expensive O(n³) combo calculations
	const statsCache = useMemo(() => {
		if (!memoizedDisplayData || !liveRows) return null;

		// Stats calculation mutates row highlight/strategy fields, so reset first to avoid stale accumulation
		// when dependencies like correlationFactor change without rebuilding memoizedDisplayData. Every row is
		// reset, so one whose game has since started loses its marks.
		clearDerivedPickState(memoizedDisplayData.table1Rows);
		clearDerivedPickState(memoizedDisplayData.table2Rows);
		clearDerivedPickState(memoizedDisplayData.table3Rows);

		// Precompute once per dependency change and clone on read to keep cache immutable.
		return precalculateLogStats(
			minSportsbooks,
			liveRows.table1Rows,
			liveRows.table2Rows,
			liveRows.table3Rows,
			correlationFactor
		);
	}, [memoizedDisplayData, liveRows, minSportsbooks, correlationFactor]);

	// One book or all of them read the precomputed stats; any other set of books is averaged here
	const booksStats = useMemo(() => {
		if (!liveRows) return null;
		if (statsBooks.length < 2 || statsBooks.length === SportsbookKeys.length) return null;
		return calculateBooksStats(
			statsBooks,
			minSportsbooks,
			liveRows.table1Rows,
			liveRows.table2Rows,
			liveRows.table3Rows,
			correlationFactor
		);
	}, [liveRows, minSportsbooks, correlationFactor, statsBooks]);

	// Each passed slot's stats from its snapshot and the books the stats view has selected, oldest first
	const slotStats = useMemo((): SlotStats[] => {
		if (!historyEnabled || !memoizedDisplayData) return [];
		return passedSlots.map((start) => {
			const time = new Date(start).toLocaleTimeString([], timeFormat);
			const slot = memoizedDisplayData.slots.get(start);
			if (!slot) return { start, time, summary: slotSnapshots.has(start) ? 'No snapshot' : 'Loading…', stats: null };
			const { stats, streak } = calculateSelectedStats(
				statsBooks,
				minSportsbooks,
				slot.table1Rows,
				slot.table2Rows,
				slot.table3Rows,
				correlationFactor
			);
			if (streak === null) return { start, time, summary: 'No stats', stats: null };
			return { start, time, summary: streakLine(streak), stats };
		});
	}, [historyEnabled, memoizedDisplayData, passedSlots, slotSnapshots, statsBooks, minSportsbooks, correlationFactor]);

	if (memoizedDisplayData) {
		// Run SIMULATE or ANALYZE only once after data has initialized
		if (SIMULATE) {
			SIMULATE = false;
			runSimulation(minSportsbooks).then((results) => {
				console.log(results);
			});
		}
		if (ANALYZE) {
			ANALYZE = false;
			logCorrelations();
			const options = {
				correlationFactor: Feature.correlation ? 1 : 0,
				formatFilter: 'all' as const,
				minSportsbooks
			};
			bestPicks(
				memoizedDisplayData.table1Rows,
				memoizedDisplayData.table2Rows,
				memoizedDisplayData.table3Rows,
				options,
				getXgMap
			);
		}
	}

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

	const { gamesList: allGames, playerList: allPlayers } = memoizedDisplayData;

	// Without the history, a started game and its players leave the tables, so they hold only what can still be picked
	const isLive = (time: Date) => passed === null || time.getTime() > passed;
	const gamesList = historyEnabled ? allGames : allGames.filter((game) => isLive(game.time));
	const displayPlayerList = historyEnabled ? allPlayers : allPlayers.filter((player) => isLive(player.gameTime));
	const { table1Rows, table2Rows, table3Rows } = historyEnabled || !liveRows ? memoizedDisplayData : liveRows;

	const oddsColumns: Picks.ColumnData[] = getEntries(Sportsbooks).map(([key, book]) => ({
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

	/*
		Data stale enough to trip "stopped" is likely holding an earlier day's schedule, whose last
		start is long past, so that notice takes precedence over calling the day locked.
	*/
	const dayDone = lastGameStart !== null && passedStart !== null && passedStart >= lastGameStart.getTime();
	const dayLocked = dayDone && !dataStatus?.stopped;
	// A locked day leaves nothing in the tables without the history, so they say why instead
	const lockedOut = dayLocked && !historyEnabled;
	// Nothing is left to report once the locked day has swallowed the game-started notice
	const bannerProblem = !!dataStatus && (dataStatus.unfinished || dataStatus.stopped || ((dataStatus.staleList || dataStatus.earlierDraw) && !dayLocked) || dataStatus.warnings.length > 0);
	// A locked day with nothing wrong is the expected nightly state, and the update time is only
	// worth showing as context for a problem
	const lockedOnly = dayLocked && !bannerProblem;

	const includeCorrelationSlider = false;
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
					<button className={`button${Feature.correlation ? '' : ' button-disabled'}`} title="Legend" aria-label="Legend"
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
				<Popup title={showPopup.title} showPopUp={showPopup.visible} closePopUp={closePopup} top={popupView === 'stats'}
					pinned={popupView === 'stats' && popupStats && (!dayLocked || historyEnabled) && (
						<StatsSportsbookList selected={selectedStatsBooks} onToggle={toggleStatsBook} />
					)}>
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
							historyEnabled={historyEnabled}
							onHistoryEnabledChange={setHistoryEnabled}
						/>
					) : (
						<StatsPopupContent stats={booksStats ?? popupStats?.[statsBooks.length === 1 ? statsBooks[0] : 'betAvg'] ?? null} locked={dayLocked} slots={slotStats} />
					)}
				</Popup>

				{Feature.offseasonBanner && (
					<section className="offseason-banner" role="status" aria-live="polite">
						<p className="offseason-banner-primary">Check back for the 2026/2027 hockey season!</p>
						<p className="offseason-banner-secondary">Offseason view: showing the last day of the 2026 Stanley Cup finals.</p>
					</section>
				)}

				{!Feature.offseasonBanner && (dataStatus || dayLocked) && (
					<section className={`status-banner${lockedOnly ? ' status-banner-info' : ''}`} role="status" aria-live="polite">
						{processed && !lockedOnly && (
							<p className="status-banner-primary">
								Data last updated {processed.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
							</p>
						)}
						{dayLocked && (
							<p className={processed && !lockedOnly ? 'status-banner-secondary' : 'status-banner-primary'}>
								All of today's games have started, so picks are locked until tomorrow's lists post.
							</p>
						)}
						{dataStatus && (dataStatus.unfinished || dataStatus.stopped || ((dataStatus.staleList || dataStatus.earlierDraw) && !dayLocked)) && (
							<p className="status-banner-secondary">
								{dataStatus.unfinished
									? "The latest update didn't finish"
									: dataStatus.stopped
										? "There hasn't been an update in over a day"
										: dataStatus.earlierDraw
											? "Today's pick lists haven't posted yet"
											: "A game has started since the last update"}, so picks and odds may be out of date.
							</p>
						)}
						{dataStatus && dataStatus.warnings.length > 0 && (
							<>
								<p className="status-banner-secondary">
									{dataStatus.warnings.length === 1 ? '1 warning' : `${dataStatus.warnings.length} warnings`} from the last {dataStatus.unfinished ? 'complete ' : ''}update:
								</p>
								<ul className="status-banner-warnings">
									{dataStatus.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
								</ul>
							</>
						)}
					</section>
				)}

				<CollapsibleSection title="Games">
					<div className="scrollable-table-wrapper section-container">
						{lockedOut ? (
							<div className="no-games-message">Today's games have all started</div>
						) : gamesList.length === 0 ? (
							<div className="no-games-message">No games today</div>
						) : (
							<Picks.Basic games={gamesList} passed={passed} darkTheme={darkTheme} xgMap={xgEnabled && xgMap ? xgMap : undefined} />
						)}
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Pick #1">
					<div className="scrollable-table-wrapper section-container">
						{lockedOut ? (
							<div className="no-games-message">Picks are locked</div>
						) : (
							<Picks.Table columns={columns} sortedRows={table1Rows} requestSort={requestSort1} sortConfig={sortConfig1Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} passed={passed} />
						)}
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Pick #2">
					<div className="scrollable-table-wrapper section-container">
						{lockedOut ? (
							<div className="no-games-message">Picks are locked</div>
						) : (
							<Picks.Table columns={columns} sortedRows={table2Rows} requestSort={requestSort2} sortConfig={sortConfig2Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} passed={passed} />
						)}
					</div>
				</CollapsibleSection>
				<CollapsibleSection title="Pick #3">
					<div className="scrollable-table-wrapper section-container">
						{lockedOut ? (
							<div className="no-games-message">Picks are locked</div>
						) : (
							<Picks.Table columns={columns} sortedRows={table3Rows} requestSort={requestSort3} sortConfig={sortConfig3Ref.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} passed={passed} />
						)}
					</div>
				</CollapsibleSection>
				{Feature.allPlayersTable && (
					<CollapsibleSection title="Players">
						<div className="scrollable-table-wrapper section-container">
							<Picks.Table columns={columnsPlayer} sortedRows={displayPlayerList} requestSort={requestSortPlayer} sortConfig={sortConfigPlayerRef.current} darkTheme={darkTheme} enabledStrategies={enabledStrategies} passed={passed} />
						</div>
					</CollapsibleSection>
				)}

				{Feature.correlation && includeCorrelationSlider && (
					showCorrelate ? (
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
					))}
			</main>
		</>
	)
}

export default App
