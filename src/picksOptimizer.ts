import type { Team } from "./components/logo";
import * as Picks from "./components/Table";
import { pairLifts } from "./correlationData";
import type { PairLifts } from "./correlationData";
import { deVig, oddsNameCandidates, removeAccentsNormalize } from "./dataProcessor";
import type { LogStatsKey, Strategy, PoolSlots } from "./dataTypes";
import {
	SportsbookKeys, LogStatsKeys, StrategyLabels,
	AllStrategies, Sportsbooks, AllPoolSlots
} from "./dataTypes";
import type { MergedSelection, PlayerType, SelectionCandidate } from "./strategySelection";
import { ComboGroup, getStrategy } from "./strategySelection";
import * as Feature from './features';
import { roundToPercent } from "./utility";

export const calcAny = (prob1: number, prob2: number, prob3: number): number => {
	return 1 - (1 - prob1) * (1 - prob2) * (1 - prob3);
};

// Challenge points for a game day, indexed by the number of correct picks.
const PointsByHits = [0, 10, 25, 100] as const;

export const calcPnt = (prob1: number, prob2: number, prob3: number): number => {
	const not1 = 1 - prob1;
	const not2 = 1 - prob2;
	const not3 = 1 - prob3;
	const p1 = prob1 * not2 * not3 + not1 * prob2 * not3 + not1 * not2 * prob3;
	const p2 = prob1 * prob2 * not3 + prob1 * not2 * prob3 + not1 * prob2 * prob3;
	const p3 = prob1 * prob2 * prob3;
	return p1 * PointsByHits[1] + p2 * PointsByHits[2] + p3 * PointsByHits[3];
};

export const calcHit = (prob1: number, prob2: number, prob3: number): number => {
	return prob1 + prob2 + prob3;
};

// How many times as often two picks both score as their odds say: the archive's lift for
// teammates or for opponents, and 1 for picks from different games. factor scales the effect:
// 0 => no effect, 1 => full effect, >1 => amplified effect.
export const pairLift = <T>(
	pick1: PlayerType<T>,
	pick2: PlayerType<T>,
	factor: number = 1,
	lifts: Pick<PairLifts, 'teammates' | 'opponents'> = pairLifts
): number => {
	const lift = pick1.sameTeam(pick2) ? lifts.teammates : pick1.opponentTeam(pick2) ? lifts.opponents : 1;
	if (!Number.isFinite(lift)) return 1;
	return (lift - 1) * factor + 1;
};

// A ticket's value for a strategy when each pair of its picks scores together lift times as
// often as their odds say, and all three as often as their pairs compounded. Correlation can't
// change the expected number of correct picks, so hits is the same either way.
export const correlatedValue = (
	strategy: Strategy,
	prob1: number,
	prob2: number,
	prob3: number,
	lift12: number,
	lift13: number,
	lift23: number
): number => {
	if (strategy === 'hits') return calcHit(prob1, prob2, prob3);
	if (lift12 === 1 && lift13 === 1 && lift23 === 1) {
		return strategy === 'least1' ? calcAny(prob1, prob2, prob3) : calcPnt(prob1, prob2, prob3);
	}

	// Each joint chance stays where none of the eight outcomes' chances goes negative
	const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
	const both = (lift: number, a: number, b: number) => clamp(lift * a * b, Math.max(0, a + b - 1), Math.min(a, b));
	const p12 = both(lift12, prob1, prob2);
	const p13 = both(lift13, prob1, prob3);
	const p23 = both(lift23, prob2, prob3);
	const p123 = clamp(
		lift12 * lift13 * lift23 * prob1 * prob2 * prob3,
		Math.max(0, p12 + p13 - prob1, p12 + p23 - prob2, p13 + p23 - prob3),
		Math.min(p12, p13, p23, 1 - prob1 - prob2 - prob3 + p12 + p13 + p23)
	);

	const singles = prob1 + prob2 + prob3;
	const pairs = p12 + p13 + p23;
	if (strategy === 'least1') return singles - pairs + p123;

	const exactly1 = singles - 2 * pairs + 3 * p123;
	const exactly2 = pairs - 3 * p123;
	return exactly1 * PointsByHits[1] + exactly2 * PointsByHits[2] + p123 * PointsByHits[3];
};

interface HistoryPlayer {
	"nhlPlayerId": number;
	"fullName": string;
	"team": string;
	"opponent": string;
	"scored": boolean;
	"note": string;
	"availableTimes": string[];
}

interface HistoryManifestItem {
	season: string;
	format: string;
	start: string;
	end: string;
	files: string[];
}

type PickGroup = '1' | '2' | '3';
const AllPickGroup: PickGroup[] = ['1', '2', '3'];
interface SnapshotOddsRowType {
	sid: PickGroup;
	id: number;
	team: string;
	opponent: string;
	scored: boolean;
	bet1: number | null;
	bet2: number | null;
	bet3: number | null;
	bet4: number | null;
	betAvg: number | null;
	betCount: number;
}

class SnapshotOddsRow {
	sid: PickGroup;
	id: number;
	team: string;
	opponent: string;
	scored: boolean;
	bet1: number | null;
	bet2: number | null;
	bet3: number | null;
	bet4: number | null;
	betAvg: number | null;
	betCount: number;
	constructor(row: SnapshotOddsRowType) {
		this.sid = row.sid;
		this.id = row.id;
		this.team = row.team;
		this.opponent = row.opponent;
		this.scored = row.scored;
		this.bet1 = row.bet1;
		this.bet2 = row.bet2;
		this.bet3 = row.bet3;
		this.bet4 = row.bet4;
		this.betAvg = row.betAvg;
		this.betCount = row.betCount;
	}
	sameTeam(other: SnapshotOddsRow): boolean {
		return this.team === other.team;
	}
	opponentTeam(other: SnapshotOddsRow): boolean {
		return this.team === other.opponent;
	}
	sameGame(other: SnapshotOddsRow): boolean {
		return this.sameTeam(other) || this.opponentTeam(other);
	}
}

type ItemFormat = 'regular' | 'playoff';
type Format = ItemFormat | 'all';

export interface AnalyzeOptions {
	minSportsbooks: number;
	formatFilter?: Format;
}
const GameType: Record<Format, string> = {
	regular: 'Regular Season',
	playoff: 'Playoffs',
	all: 'Full Season',
}
interface HistoricalAuditOptions extends AnalyzeOptions {
	logResults?: boolean;
	slots: PoolSlots;
}

interface OutcomeStat {
	value: number;
	predicted: number;
	count: number;
};
class Outcome {
	least1: OutcomeStat;
	points: OutcomeStat;
	hits: OutcomeStat;
	constructor(prob1: number, prob2: number, prob3: number, hitCount: number) {
		this.least1 = {
			value: hitCount > 0 ? 1 : 0,
			predicted: calcAny(prob1, prob2, prob3),
			count: 1,
		};
		this.points = {
			value: PointsByHits[hitCount],
			predicted: calcPnt(prob1, prob2, prob3),
			count: 1,
		};
		this.hits = {
			value: hitCount,
			predicted: calcHit(prob1, prob2, prob3),
			count: 3,
		};
	}
}

class AccumulateOutcome {
	least1: OutcomeStat;
	points: OutcomeStat;
	hits: OutcomeStat;
	slotCount: number;
	constructor() {
		this.least1 = { value: 0, predicted: 0, count: 0 };
		this.points = { value: 0, predicted: 0, count: 0 };
		this.hits = { value: 0, predicted: 0, count: 0 };
		this.slotCount = 0;
	}
	accumulate(outcome: Pick<AccumulateOutcome, 'least1' | 'points' | 'hits'>, normalize: number = 1) {
		this.least1.value += outcome.least1.value / normalize;
		this.least1.predicted += outcome.least1.predicted / normalize;
		this.least1.count += outcome.least1.count / normalize;

		this.points.value += outcome.points.value / normalize;
		this.points.predicted += outcome.points.predicted / normalize;
		this.points.count += outcome.points.count / normalize;

		this.hits.value += outcome.hits.value / normalize;
		this.hits.predicted += outcome.hits.predicted / normalize;
		this.hits.count += outcome.hits.count / normalize;
	}
}

type HistoricalAuditResults = Record<LogStatsKey, AccumulateOutcome>;

const fetchJson = async <T>(src: string): Promise<T> => {
	const response = await fetch(src);
	if (!response.ok) throw new Error(`Failed to load ${src}: ${response.status} ${response.statusText}`);
	return await response.json() as T;
};

const fetchOptionalJson = async <T>(src: string): Promise<T | null> => {
	try {
		const response = await fetch(src);
		if (!response.ok) return null;
		return await response.json() as T;
	} catch {
		return null;
	}
};

const getGameStartTimeGroups = async (date: string): Promise<string[]> => {
	const data = await fetchOptionalJson<{
		gameWeek: Array<{
			date: string;
			games: Array<{ startTimeUTC: string; easternUTCOffset: string }>;
		}>;
	}>(`./data/${date}/games.json`);

	if (!data) return [];
	const timeGroups = new Set<string>();

	for (const week of data.gameWeek) {
		if (week.date !== date) continue;
		for (const game of week.games) {
			const utc = new Date(game.startTimeUTC);

			const formatter = new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/New_York',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false
			});
			const parts = formatter.formatToParts(utc);
			const dateMap = Object.fromEntries(parts.map(p => [p.type, p.value]));

			const hhmm = `${dateMap.hour}${dateMap.minute}`;
			timeGroups.add(hhmm);
		}
	}

	return Array.from(timeGroups).sort();
};

const bookTitle = (key: LogStatsKey): string => (key === 'betAvg') ? 'Average' : Sportsbooks[key].title;

const createAuditBuckets = (): Record<LogStatsKey, AccumulateOutcome> => ({
	bet1: new AccumulateOutcome(),
	bet2: new AccumulateOutcome(),
	bet3: new AccumulateOutcome(),
	bet4: new AccumulateOutcome(),
	betAvg: new AccumulateOutcome(),
});

const countGamesFromHelper = (
	helper: Record<PickGroup, Picks.OddsItem[]>,
	playerSets: Map<string, Map<number, HistoryPlayer>>
): number => {
	const teams = new Set<string>();
	let gameCount = 0;

	for (const sid of AllPickGroup) {
		const outcomes = playerSets.get(sid);
		if (!outcomes) continue;

		for (const item of helper[sid] ?? []) {
			const player = outcomes.get(item.playerId);
			if (!player) {
				console.error("Player not found:", item);
				continue;
			}
			if (teams.has(player.team)) continue;

			teams.add(player.team);
			teams.add(player.opponent);
			gameCount++;
		}
	}

	return gameCount;
};

type BookComboEvaluation = {
	topOutcome: AccumulateOutcome;
};

type BookPredictionSummary = {
	book: LogStatsKey;
	predicted: string;
};

type StartegySummary = {
	books: LogStatsKey[];
	actualValue: number;
	predictedByBook: BookPredictionSummary[];
	slotCount: number;
}

export type PoolAccuracySummary = {
	topLeast1: StartegySummary;
	topPoints: StartegySummary;
	topHits: StartegySummary;
};

export type ComparePoolAccuracySummary = Record<PoolSlots, PoolAccuracySummary>;
export type ComparePoolAccuracyResult = {
	summary: ComparePoolAccuracySummary;
	results: Record<PoolSlots, HistoricalAuditResults>;
};

const aggregateSelectionOutcome = (selection: MergedSelection<SnapshotOddsRow>): AccumulateOutcome | null => {
	const result = new AccumulateOutcome();
	const { combos } = selection;
	if (!combos || combos.length === 0) return null;
	const comboCount = combos.length;
	for (const combo of combos) {
		const hitCount = (combo.pick1.scored ? 1 : 0)
			+ (combo.pick2.scored ? 1 : 0)
			+ (combo.pick3.scored ? 1 : 0);
		const actual = new Outcome(combo.prob1, combo.prob2, combo.prob3, hitCount);
		result.accumulate(actual, comboCount);
	}
	// A merged selection always represents one pick set (ticket/slot),
	// while combo stats above are equally weighted across ties.
	result.slotCount = 1;
	return result;
};

const evaluateBookCombos = (
	set1: SnapshotOddsRow[],
	set2: SnapshotOddsRow[],
	set3: SnapshotOddsRow[],
	bookKey: LogStatsKey,
): BookComboEvaluation | null => {
	const candidates: SelectionCandidate<SnapshotOddsRow>[] = [];
	for (const pick1 of set1) {
		for (const pick2 of set2) {
			for (const pick3 of set3) {
				const prob1 = pick1[bookKey];
				const prob2 = pick2[bookKey];
				const prob3 = pick3[bookKey];
				if (prob1 === null || prob2 === null || prob3 === null) continue;

				candidates.push({
					pick1,
					pick2,
					pick3,
					prob1,
					prob2,
					prob3,
					strategy: getStrategy(pick1, pick2, pick3),
				});
			}
		}
	}

	const top: ComboGroup<SnapshotOddsRow> = new ComboGroup();
	for (const candidate of candidates) top.add(candidate);

	const topSelection = top.merge();
	if (!topSelection) return null;
	const topOutcome = aggregateSelectionOutcome(topSelection);
	if (!topOutcome) return null;

	return {
		topOutcome,
	};
};

const round = (value: number, precision: number = 1): number => {
	const factor = 10 ** precision;
	return Math.round(value * factor) / factor;
};

const formatAuditPercent = (value: number): string => `${value.toFixed(2)}%`;
const formatAuditPoints = (value: number): string => value.toFixed(2);

// Statistical diagnostic functions for pool variance analysis
const calculateHitRateCI = (hitPct: number, totalPicks: number): { lower: number; upper: number; se: number } => {
	if (totalPicks === 0) return { lower: 0, upper: 0, se: 0 };
	const p = hitPct / 100; // Convert percentage to decimal
	const se = Math.sqrt((p * (1 - p)) / totalPicks);
	const margin = 1.96 * se; // 95% CI
	return {
		lower: Math.max(0, (p - margin) * 100),
		upper: Math.min(100, (p + margin) * 100),
		se: se * 100,
	};
};

const calculateZScore = (actual: number, predicted: number, se: number): number => {
	if (se === 0) return 0;
	return (actual - predicted) / se;
};

const titleForPoolKey = (poolKey: PoolSlots): string => {
	switch (poolKey) {
		case '1': return "Pool Slots: 1 Game";
		case '2': return "Pool Slots: 2 Games";
		case '3': return "Pool Slots: 3 Games";
		case '4+': return "Pool Slots: 4+ Games";
		case 'all': return "Pool Slots: All";
	}
};

export const runHistoricalStrategyAudit = async (
	options: HistoricalAuditOptions
): Promise<HistoricalAuditResults> => {
	const {
		minSportsbooks,
		logResults = true,
		slots,
		formatFilter = 'all',
	} = options;

	const historyManifest = await fetchJson<HistoryManifestItem[]>('./history/history.json');
	const oldestDate = new Date("2026-04-09"); // Oldest recorded backup date
	const historyByDate = new Map<string, string>();
	for (const item of historyManifest) {
		if (formatFilter !== 'all' && item.format !== formatFilter) continue;

		for (const file of item.files) {
			const components = file.split('_');
			if (components.length !== 3) continue;
			const name = components[1];
			const date = new Date(name);
			if (isNaN(date.valueOf())) continue;
			if (date < oldestDate) continue;
			historyByDate.set(name, file);
		}
	}

	const stats = createAuditBuckets();
	const daysWithSlots = new Set<string>();

	for (const [date, historyFile] of historyByDate) {
		try {
			const history = await fetchJson<{
				playerLists: Array<{ id: number; players: HistoryPlayer[] }>;
			}>(`./history/${historyFile}`);

			const playerSets = new Map<string, Map<number, HistoryPlayer>>();
			for (const list of history.playerLists) {
				playerSets.set(String(list.id), new Map(list.players.map((player) => [Math.abs(player.nhlPlayerId), player])));
			}

			const gameStartTimes = await getGameStartTimeGroups(date);

			const findOne = slots !== 'all';
			for (let slotIndex = 0; slotIndex < gameStartTimes.length; slotIndex++) {
				try {
					const folderTime = gameStartTimes[slotIndex];

					const folder = `./data/${date}/${folderTime}`;
					const helper = await fetchOptionalJson<Record<PickGroup, Picks.OddsItem[]>>(`${folder}/helper.json`);
					if (!helper) continue;

					const bookOdds = await Promise.all(SportsbookKeys.map(async (key) => {
						const items = await fetchOptionalJson<Array<{ name: string; odds: number }>>(`${folder}/${key}.json`);
						return items;
					}));
					if (bookOdds.some((items) => items === null)) continue;

					const oddsMaps = bookOdds.map((items) => {
						const oddsMap = new Map<string, number>();
						for (const item of items ?? []) oddsMap.set(removeAccentsNormalize(item.name), item.odds);
						return oddsMap;
					});

					const rows: SnapshotOddsRow[] = [];
					for (const sid of AllPickGroup) {
						const outcomes = playerSets.get(sid);
						if (!outcomes) continue;

						for (const item of helper[sid] ?? []) {
							const player = outcomes.get(item.playerId);
							if (!player) {
								console.error("Player not found:", item);
								continue;
							}

							const fullName = `${item.firstName} ${item.lastName}`;
							const candidates = oddsNameCandidates(fullName);
							const probs: Array<number | null> = [null, null, null, null];

							for (let index = 0; index < oddsMaps.length; index++) {
								for (const candidate of candidates) {
									const odds = oddsMaps[index].get(removeAccentsNormalize(candidate));
									if (odds !== undefined) {
										probs[index] = 1 / odds;
										break;
									}
								}
							}

							rows.push(new SnapshotOddsRow({
								sid,
								id: item.playerId,
								team: player.team,
								opponent: player.opponent,
								scored: player.scored,
								bet1: probs[0],
								bet2: probs[1],
								bet3: probs[2],
								bet4: probs[3],
								betAvg: null,
								betCount: 0,
							}));
						}
					}

					if (rows.length === 0) continue;

					// Only apply deVig if normalizeSportsbooks is enabled
					if (Feature.normalizeSportsbooks) deVig(rows as unknown as Picks.Player[]);

					// Always recalculate betCount and betAvg using minSportsbooks filter, matching statsCalculations
					for (const row of rows) {
						const values = SportsbookKeys
							.map((key) => row[key])
							.filter((value): value is number => value !== null);
						row.betCount = values.length;
						row.betAvg = values.length >= minSportsbooks
							? values.reduce((sum, value) => sum + value, 0) / values.length
							: null;
					}

					// Mirror gamesCount by deduping games from helper teams only.
					const helperGameCount = countGamesFromHelper(helper, playerSets);
					const gameCount = helperGameCount;
					if (gameCount === 0) continue;

					if (slots !== 'all') {
						switch (slots) {
							case '1': if (gameCount !== 1) continue; break;
							case '2': if (gameCount !== 2) continue; break;
							case '3': if (gameCount !== 3) continue; break;
							default: if (gameCount < 4) continue;
						}
					}

					daysWithSlots.add(date);

					for (const bookKey of LogStatsKeys) {
						const set1 = rows.filter((row) => row.sid === '1' && row[bookKey] !== null && row.betCount >= minSportsbooks);
						const set2 = rows.filter((row) => row.sid === '2' && row[bookKey] !== null && row.betCount >= minSportsbooks);
						const set3 = rows.filter((row) => row.sid === '3' && row[bookKey] !== null && row.betCount >= minSportsbooks);
						if (set1.length === 0 || set2.length === 0 || set3.length === 0) continue;

						const evaluation = evaluateBookCombos(set1, set2, set3, bookKey);
						if (!evaluation) continue;

						const outcome = stats[bookKey];
						// topOutcome is already tie-normalized within this pick set.
						outcome.accumulate(evaluation.topOutcome);
						// Count one processed pick set (ticket/slot).
						outcome.slotCount += evaluation.topOutcome.slotCount;
					}

					if (findOne) break;
				} catch (error) {
					console.warn(`Skipping snapshot ${date} ${gameStartTimes[slotIndex]}:`, error);
				}
			}
		} catch (error) {
			console.warn(`Skipping date ${date}:`, error);
		}
	}

	if (logResults) {
		const makeDisplay = (
			title: string,
			percent: boolean,
			hitsKey: 'least1' | 'points' | 'hits',
		) => {
			const display = Object.fromEntries((LogStatsKeys).map((bookKey) => {
				const result = stats[bookKey];

				const stat = result[hitsKey];
				const hitsTotal = stat.count;
				const actualValue = stat.value;
				const predictedValue = stat.predicted;
				let actualPct = hitsTotal === 0 ? 0 : 100 * actualValue / hitsTotal;
				let predictedPct = hitsTotal === 0 ? 0 : 100 * predictedValue / hitsTotal;
				if (hitsKey === 'points') {
					actualPct = hitsTotal === 0 ? 0 : actualValue / hitsTotal;
					predictedPct = hitsTotal === 0 ? 0 : predictedValue / hitsTotal;
				}

				const ci = calculateHitRateCI(actualPct, hitsTotal);
				const zScore = calculateZScore(actualPct, predictedPct, ci.se);

				const table = {} as Record<string, string | number>;

				table["key"] = bookKey;
				if (percent) {
					table["%"] = formatAuditPercent(actualPct);
					table["Odds %"] = formatAuditPercent(predictedPct);
					table["hits"] = `${round(actualValue)}/${hitsTotal}`;
				} else {
					table["#"] = formatAuditPoints(actualValue / hitsTotal);
					table["Odds #"] = formatAuditPoints(predictedValue / hitsTotal);
					table["hits"] = hitsTotal;
				}

				table["CI Lower"] = round(ci.lower, 2);
				table["CI Upper"] = round(ci.upper, 2);
				table["Z"] = round(zScore, 2);
				return [
					bookTitle(bookKey), table
				];
			}));
			console.log(`\n*** ${title} ${titleForPoolKey(slots)} ***`);
			console.table(display);
		}
		makeDisplay(StrategyLabels.least1, true, 'least1');
		// makeDisplay(StrategyLabels.points, false, 'points');
		// makeDisplay(StrategyLabels.hits, true, 'hits');
	}

	return stats;
};

export const comparePoolAccuracy = async (options: AnalyzeOptions): Promise<ComparePoolAccuracyResult> => {
	const { formatFilter = 'all', minSportsbooks } = options;

	console.log(
		`\nComparing top pick accuracy across game count pools:\n` +
		`${GameType[formatFilter]}\n`
	);

	console.log(`\n*** Statistical Diagnostics: ${GameType[formatFilter]} ***`);
	console.log(" • 95% CI (Confidence Interval): The range where the true hit rate likely falls with 95% confidence");
	console.log("   ◦ Wider CI = smaller pool (more variance)");
	console.log("   ◦ Narrower CI = larger pool (more stable results)");
	console.log(" • Z-score: How many standard errors away from the predicted value");
	console.log("   ◦ Z > 1.96 or Z < -1.96: Statistically significant at 95% level");
	console.log("   ◦ Z between -1.96 and 1.96: Within expected random variance");

	type PoolResults = Record<PoolSlots, HistoricalAuditResults>;
	const results: PoolResults = {} as PoolResults;
	for (const pool of AllPoolSlots) {
		results[pool] = {} as HistoricalAuditResults;
	}

	interface StrategyMetric {
		entries: Array<{ book: LogStatsKey; stat: AccumulateOutcome }>;
		stat: AccumulateOutcome
	};
	const getTopBooksForMetric = (
		poolResult: HistoricalAuditResults,
		metric: (stat: AccumulateOutcome) => number
	): StrategyMetric => {
		let bestBooks: LogStatsKey[] = [LogStatsKeys[0]];
		let bestValue = metric(poolResult[LogStatsKeys[0]]);

		for (let index = 1; index < LogStatsKeys.length; index++) {
			const book = LogStatsKeys[index];
			const stat = poolResult[book];
			const value = metric(stat);
			if (value > bestValue) {
				bestValue = value;
				bestBooks = [book];
			} else if (value === bestValue) {
				bestBooks.push(book);
			}
		}

		const entries = bestBooks.map((book) => ({ book, stat: poolResult[book] }));
		return { entries, stat: entries[0].stat };
	};

	const summarizeEntries = (
		entries: Array<{ book: LogStatsKey; stat: AccumulateOutcome }>,
		metric: (stat: AccumulateOutcome) => string
	) => entries.map((entry) => ({
		book: entry.book,
		predicted: metric(entry.stat),
	}));

	const summaryByPool = {} as ComparePoolAccuracySummary;

	for (const pool of AllPoolSlots) {
		const auditResult = await runHistoricalStrategyAudit({
			minSportsbooks,
			formatFilter,
			slots: pool,
			logResults: true,
		});
		results[pool] = auditResult;
	}

	const avg = (count: number, total: number): number => total > 0 ? count / total : 0;
	const avgValue = (stat: OutcomeStat): number => avg(stat.value, stat.count);
	const avgPredicted = (stat: OutcomeStat): number => avg(stat.predicted, stat.count);

	for (const pool of AllPoolSlots) {
		const bestTopLeast1 = getTopBooksForMetric(results[pool], (stat) => 100 * avgValue(stat.least1));
		const bestTopPoints = getTopBooksForMetric(results[pool], (stat) => avgValue(stat.points));
		const bestTopHits = getTopBooksForMetric(results[pool], (stat) => 100 * avgValue(stat.hits));

		summaryByPool[pool] = {
			topLeast1: {
				books: bestTopLeast1.entries.map((entry) => entry.book),
				actualValue: 100 * avgValue(bestTopLeast1.stat.least1),
				predictedByBook: summarizeEntries(bestTopLeast1.entries, (stat) => `${(100 * avgPredicted(stat.least1)).toFixed(2)}%`),
				slotCount: bestTopLeast1.stat.slotCount,
			},
			topPoints: {
				books: bestTopPoints.entries.map((entry) => entry.book),
				actualValue: avgValue(bestTopPoints.stat.points),
				predictedByBook: summarizeEntries(bestTopPoints.entries, (stat) => avgPredicted(stat.points).toFixed(2)),
				slotCount: bestTopPoints.stat.slotCount,
			},
			topHits: {
				books: bestTopHits.entries.map((entry) => entry.book),
				actualValue: 100 * avgValue(bestTopHits.stat.hits),
				predictedByBook: summarizeEntries(bestTopHits.entries, (stat) => `${(100 * avgPredicted(stat.hits)).toFixed(2)}%`),
				slotCount: bestTopHits.stat.slotCount,
			},
		};
	}

	return { summary: summaryByPool, results };
};

class StrategyType {
	key: Strategy;
	books: LogStatsKey[];
	constructor(strategy: Strategy, books: LogStatsKey[] = []) {
		this.key = strategy;
		this.books = books;
	}
}
interface BestPicksResult extends Record<PickGroup, Picks.PickOdds> {
	strategies: Set<StrategyType>,
	rankedBy?: 'top' | 'strategies' | 'least1' | 'hits' | 'points' | 'books' | 'consensus' | 'xg' | 'tied';
	isTied?: boolean;
}

export const resolvePoolKey = (gameCount: number): PoolSlots => {
	if (gameCount <= 1) return '1';
	if (gameCount === 2) return '2';
	if (gameCount === 3) return '3';
	return '4+';
}

type PickGroupType = Pick<BestPicksResult, PickGroup>;
const comboCode = (combo: PickGroupType): string => `${combo["1"].player.playerId}:${combo["2"].player.playerId}:${combo["3"].player.playerId}`;

const isCorrelationApplied = (
	player1: Picks.Player,
	player2: Picks.Player,
	player3: Picks.Player
): boolean => {
	if (!Feature.correlation) return false;
	return pairLift(player1, player2) !== 1 || pairLift(player1, player3) !== 1 || pairLift(player2, player3) !== 1;
}

// calculate available games from players, rather than use the gamesList.
// Some games may have started, or players may not be available from a game.
export const gamesCount = (picks1: Picks.PickOdds[], picks2: Picks.PickOdds[], picks3: Picks.PickOdds[]): number => {
	const gamesSet = new Set<Team>();
	let gameCount = 0;
	for (const pick of [...picks1, ...picks2, ...picks3]) {
		if (gamesSet.has(pick.player.team.code)) continue;
		gamesSet.add(pick.player.team.code);
		gamesSet.add(pick.player.opponent.code);
		gameCount++;
	}
	return gameCount;
}

export const bestPicks = async (
	picks1: Picks.PickOdds[],
	picks2: Picks.PickOdds[],
	picks3: Picks.PickOdds[],
	options: AnalyzeOptions,
	getXgMap: () => Promise<Map<Team, number>>
): Promise<BestPicksResult[]> => {
	const gameCount = gamesCount(picks1, picks2, picks3);
	if (gameCount === 0) return [];

	const poolKey: PoolSlots = resolvePoolKey(gameCount);
	const { minSportsbooks } = options;
	const epsilon = 1e-12;
	const xgMap = await getXgMap();

	// Run once using the requested analysis options.
	const { summary: summaryByPool, results: auditResults } = await comparePoolAccuracy(options);
	const summary = summaryByPool;

	const strategyConfig: Record<Strategy, LogStatsKey[]> = {
		least1: [],
		points: [],
		hits: [],
	};

	const adjustedStrategyScore = (
		strategy: Strategy,
		prob1: number,
		prob2: number,
		prob3: number,
		pick1: Picks.Player,
		pick2: Picks.Player,
		pick3: Picks.Player
	): number => {
		const factor = Feature.correlation ? 1 : 0;
		return correlatedValue(
			strategy, prob1, prob2, prob3,
			pairLift(pick1, pick2, factor), pairLift(pick1, pick3, factor), pairLift(pick2, pick3, factor)
		);
	};

	const strategyBookWeights: Record<Strategy, Map<LogStatsKey, number>> = {
		least1: new Map<LogStatsKey, number>(),
		points: new Map<LogStatsKey, number>(),
		hits: new Map<LogStatsKey, number>(),
	};

	for (const strategy of AllStrategies) {
		let totalValue = 0;
		let totalCount = 0;
		for (const book of LogStatsKeys) {
			const stat = auditResults[poolKey][book][strategy];
			if (stat.count <= 0) continue;
			totalValue += stat.value;
			totalCount += stat.count;
		}

		const globalRate = totalCount > 0 ? totalValue / totalCount : 0;

		for (const book of LogStatsKeys) {
			const stat = auditResults[poolKey][book][strategy];
			if (stat.count <= 0) {
				strategyBookWeights[strategy].set(book, 0);
				continue;
			}

			const observedRate = stat.value / stat.count;
			const baseRate = Number.isFinite(observedRate) ? observedRate : globalRate;
			const weight = Math.max(1e-6, baseRate);
			strategyBookWeights[strategy].set(book, weight);
		}
	}

	const booksByWeight = (strategy: Strategy): LogStatsKey[] => {
		const weightedBooks = LogStatsKeys.map((book, order) => ({
			book,
			weight: strategyBookWeights[strategy].get(book) ?? 0,
			order,
		}));
		weightedBooks.sort((left, right) => {
			const weightCompare = right.weight - left.weight;
			if (Math.abs(weightCompare) > epsilon) return weightCompare;
			return left.order - right.order;
		});

		const positive = weightedBooks.filter((item) => item.weight > 0).map((item) => item.book);
		return positive.length > 0 ? positive : [...LogStatsKeys];
	};

	const evaluateWeightedStrategyScore = (
		pick1: Picks.PickOdds,
		pick2: Picks.PickOdds,
		pick3: Picks.PickOdds,
		strategy: Strategy,
		books: readonly LogStatsKey[],
	): { score: number; adjusted: boolean } | null => {
		let weightedTotal = 0;
		let totalWeight = 0;
		let adjusted = false;

		for (const book of books) {
			const prob1 = pick1.player[book];
			const prob2 = pick2.player[book];
			const prob3 = pick3.player[book];
			if (prob1 === null || prob2 === null || prob3 === null) continue;

			const weight = strategyBookWeights[strategy].get(book) ?? 0;
			if (weight <= 0) continue;

			const score = adjustedStrategyScore(
				strategy,
				prob1,
				prob2,
				prob3,
				pick1.player,
				pick2.player,
				pick3.player
			);

			weightedTotal += weight * score;
			totalWeight += weight;
			if (
				strategy === 'least1'
				&& isCorrelationApplied(pick1.player, pick2.player, pick3.player)
			) {
				adjusted = true;
			}
		}

		if (totalWeight <= 0) return null;
		return { score: weightedTotal / totalWeight, adjusted };
	};

	// Compare and decide for each strategy
	for (const strategy of AllStrategies) {
		strategyConfig[strategy] = booksByWeight(strategy);
	}

	const bestByStrategyAndBooks: Record<Strategy, Map<string, PickGroupType>> = {
		least1: new Map(),
		points: new Map(),
		hits: new Map(),
	};

	// Find best combos for each strategy using its decided configuration
	for (const strategy of AllStrategies) {
		const candidateBooks = strategyConfig[strategy];

		let bestScore = Number.NEGATIVE_INFINITY;
		const bestCombos = new Map<string, PickGroupType>();

		for (const pick1 of picks1) {
			if (pick1.player.betCount < minSportsbooks) continue;
			for (const pick2 of picks2) {
				if (pick2.player.betCount < minSportsbooks) continue;
				for (const pick3 of picks3) {
					if (pick3.player.betCount < minSportsbooks) continue;

					const weightedScore = evaluateWeightedStrategyScore(pick1, pick2, pick3, strategy, candidateBooks);
					if (!weightedScore) continue;

					const score = weightedScore.score;
					const resultCombo: PickGroupType = { "1": pick1, "2": pick2, "3": pick3 };
					if (score > bestScore + epsilon) {
						bestScore = score;
						bestCombos.clear();
						bestCombos.set(comboCode(resultCombo), resultCombo);
					} else if (Math.abs(score - bestScore) <= epsilon) {
						bestCombos.set(comboCode(resultCombo), resultCombo);
					}
				}
			}
		}

		for (const [code, combo] of bestCombos) {
			bestByStrategyAndBooks[strategy].set(`${candidateBooks.join(',')}:${code}`, combo);
		}
	}

	// Merge results: same combo might work for multiple strategies with different books
	const merged = new Map<string, { combo: PickGroupType; strategies: Map<Strategy, LogStatsKey[]> }>();
	for (const strategy of AllStrategies) {
		const books = strategyConfig[strategy];
		if (!books) continue;
		for (const combo of bestByStrategyAndBooks[strategy].values()) {
			const code = comboCode(combo);
			const existing = merged.get(code);
			if (existing) {
				existing.strategies.set(strategy, books);
			} else {
				const strategies = new Map<Strategy, LogStatsKey[]>();
				strategies.set(strategy, books);
				merged.set(code, { combo, strategies });
			}
		}
	}

	const results: BestPicksResult[] = [];
	for (const { combo, strategies } of merged.values()) {
		// Ranking is least1-only; ignore combos that are not selected by least1.
		if (!strategies.has('least1')) continue;
		results.push({
			...combo,
			strategies: new Set([...strategies.entries()].map(([strat, books]) => new StrategyType(strat, books))),
			rankedBy: undefined,
			isTied: false,
		});
	}

	/*
		Ranking priority (least1-only mode):
		1. Higher weighted least1 score (displayed as "adjusted score" when correlation is applied)
		2. Higher ranked-book values in ranked book order (compared by slot: pick1, pick2, pick3)
		3. Higher book consensus (compared by slot: pick1, pick2, pick3):
		   a) Earlier supporting book in ranked order wins
		   b) If tied on book rank, more supporting books in ranked order wins
		   c) If still tied, compare supporting values in ranked order
		   d) If still tied, compare remaining non-supporting values in ranked order
		4. Higher average team xG
	*/
	const strategyTieScore = (result: BestPicksResult, strategy: Strategy): { score: number; adjusted: boolean } => {
		let strategyType: StrategyType | undefined;
		for (const item of result.strategies) {
			if (item.key === strategy) {
				strategyType = item;
				break;
			}
		}
		if (!strategyType) return { score: Number.NEGATIVE_INFINITY, adjusted: false };

		const weightedScore = evaluateWeightedStrategyScore(
			result['1'],
			result['2'],
			result['3'],
			strategy,
			strategyType.books,
		);
		if (!weightedScore) return { score: Number.NEGATIVE_INFINITY, adjusted: false };

		return weightedScore;
	};

	const averageTeamXg = (result: BestPicksResult): number => {
		const xg1 = xgMap.get(result['1'].player.team.code as Team) ?? 0;
		const xg2 = xgMap.get(result['2'].player.team.code as Team) ?? 0;
		const xg3 = xgMap.get(result['3'].player.team.code as Team) ?? 0;
		return (xg1 + xg2 + xg3) / 3;
	};

	const compareDesc = (left: number, right: number): number => {
		if (left > right) return -1;
		if (left < right) return 1;
		return 0;
	};
	const compareAsc = (left: number, right: number): number => {
		if (left < right) return -1;
		if (left > right) return 1;
		return 0;
	};

	// Ranked consensus keys derived from pool effectiveness: sort books by least1 hit rate.
	const poolAuditResults = auditResults[poolKey];
	const booksByEffectiveness: Array<{ book: LogStatsKey; least1Rate: number; order: number }> = [];
	for (let order = 0; order < LogStatsKeys.length; order++) {
		const book = LogStatsKeys[order];
		if (poolAuditResults[book]) {
			const stat = poolAuditResults[book].least1;
			const least1Rate = stat.count > 0 ? stat.value / stat.count : Number.NEGATIVE_INFINITY;
			booksByEffectiveness.push({
				book,
				least1Rate,
				order,
			});
		}
	}
	booksByEffectiveness.sort((left, right) => {
		const effectivenessCompare = compareDesc(left.least1Rate, right.least1Rate);
		if (effectivenessCompare !== 0) return effectivenessCompare;
		return left.order - right.order;
	});
	const rankedConsensusBooks: readonly LogStatsKey[] = booksByEffectiveness.map(b => b.book);

	type BetSupport = Map<number, Map<LogStatsKey, number>>;
	const populateBetSupport = (picks: Picks.PickOdds[]): BetSupport => {
		const topBets = new Map<number, Map<LogStatsKey, number>>();
		for (const book of rankedConsensusBooks) {
			let max = Number.NEGATIVE_INFINITY;
			const eligiblePlayers: Array<{ playerId: number; value: number }> = [];
			for (const pick of picks) {
				const player = pick.player;
				const val = player[book];
				if (val === null || player.betCount < minSportsbooks) continue;
				eligiblePlayers.push({ playerId: player.playerId, value: val });
				if (val > max) max = val;
			}
			if (eligiblePlayers.length === 0) continue;

			for (const candidate of eligiblePlayers) {
				if (Math.abs(candidate.value - max) > epsilon) continue;
				let playerBets = topBets.get(candidate.playerId);
				if (!playerBets) {
					playerBets = new Map<LogStatsKey, number>();
					topBets.set(candidate.playerId, playerBets);
				}
				playerBets.set(book, candidate.value);
			}
		}
		return topBets;
	}
	const betSupport: Record<PickGroup, BetSupport> = {
		'1': populateBetSupport(picks1),
		'2': populateBetSupport(picks2),
		'3': populateBetSupport(picks3),
	}

	type SlotKey = PickGroup;
	type SlotConsensusProfile = {
		topBookRank: number;
		supportCount: number;
		supportByBook: Map<LogStatsKey, number>;
		allBookValues: Map<LogStatsKey, number | null>; // All books for this player in ranked order
	};
	type ConsensusProfile = Record<SlotKey, SlotConsensusProfile>;

	const buildSlotConsensusProfile = (slot: SlotKey, playerId: number, picks: Picks.PickOdds[]): SlotConsensusProfile => {
		const playerBooks = betSupport[slot].get(playerId);
		const allBookValues = new Map<LogStatsKey, number | null>();

		// Build map of all book values for this player
		let targetPlayer: Picks.Player | undefined;
		for (const pick of picks) {
			if (pick.player.playerId === playerId) {
				targetPlayer = pick.player;
				break;
			}
		}

		if (targetPlayer) {
			for (const book of rankedConsensusBooks) {
				allBookValues.set(book, targetPlayer[book]);
			}
		}

		if (!playerBooks) {
			return {
				topBookRank: Number.POSITIVE_INFINITY,
				supportCount: 0,
				supportByBook: new Map<LogStatsKey, number>(),
				allBookValues,
			};
		}

		let topBookRank = Number.POSITIVE_INFINITY;
		for (let index = 0; index < rankedConsensusBooks.length; index++) {
			if (playerBooks.has(rankedConsensusBooks[index])) {
				topBookRank = index;
				break;
			}
		}

		return {
			topBookRank,
			supportCount: playerBooks.size,
			supportByBook: playerBooks,
			allBookValues,
		};
	};

	const buildConsensusProfile = (result: BestPicksResult): ConsensusProfile => ({
		'1': buildSlotConsensusProfile('1', result['1'].player.playerId, picks1),
		'2': buildSlotConsensusProfile('2', result['2'].player.playerId, picks2),
		'3': buildSlotConsensusProfile('3', result['3'].player.playerId, picks3),
	});

	const compareSlotConsensus = (left: SlotConsensusProfile, right: SlotConsensusProfile): number => {
		// 3a) Earlier supporting book in ranked order wins.
		const topBookCompare = compareAsc(left.topBookRank, right.topBookRank);
		if (topBookCompare !== 0) return topBookCompare;

		// 3b) If book rank ties, more agreeing books in ranked order wins.
		const supportCountCompare = compareDesc(left.supportCount, right.supportCount);
		if (supportCountCompare !== 0) return supportCountCompare;

		// 3c) If still tied, compare supporting values in ranked order.
		for (const book of rankedConsensusBooks) {
			const leftValue = left.supportByBook.get(book);
			const rightValue = right.supportByBook.get(book);
			if (leftValue === undefined && rightValue === undefined) continue;
			if (leftValue === undefined) return 1;
			if (rightValue === undefined) return -1;
			const valueCompare = compareDesc(leftValue, rightValue);
			if (valueCompare !== 0) return valueCompare;
		}

		// 3d) If still tied, compare remaining non-supporting values in ranked order.
		for (let i = 0; i < rankedConsensusBooks.length; i++) {
			const book = rankedConsensusBooks[i];
			if (left.supportByBook.has(book) || right.supportByBook.has(book)) continue; // skip supporting books already compared in 3a/3c
			const leftValue = left.allBookValues.get(book) ?? null;
			const rightValue = right.allBookValues.get(book) ?? null;
			if (leftValue === null && rightValue === null) continue;
			if (leftValue === null) return 1;
			if (rightValue === null) return -1;
			const valueCompare = compareDesc(leftValue, rightValue);
			if (valueCompare !== 0) return valueCompare;
		}

		return 0;
	};

	const compareSlotRankedBooks = (left: SlotConsensusProfile, right: SlotConsensusProfile): number => {
		for (const book of rankedConsensusBooks) {
			const leftValue = left.allBookValues.get(book) ?? null;
			const rightValue = right.allBookValues.get(book) ?? null;
			if (leftValue === null && rightValue === null) continue;
			if (leftValue === null) return 1;
			if (rightValue === null) return -1;
			const valueCompare = compareDesc(leftValue, rightValue);
			if (valueCompare !== 0) return valueCompare;
		}

		return 0;
	};

	const compareRankedBookProfile = (left: ConsensusProfile, right: ConsensusProfile): number => {
		const slots: SlotKey[] = AllPickGroup;
		for (const slot of slots) {
			const slotCompare = compareSlotRankedBooks(left[slot], right[slot]);
			if (slotCompare !== 0) return slotCompare;
		}
		return 0;
	};

	const compareConsensusProfile = (left: ConsensusProfile, right: ConsensusProfile): number => {
		// Compare pick1, then pick2, then pick3.
		const slots: SlotKey[] = AllPickGroup;
		for (const slot of slots) {
			const slotCompare = compareSlotConsensus(left[slot], right[slot]);
			if (slotCompare !== 0) return slotCompare;
		}
		return 0;
	};

	type RankMetrics = {
		least1: number;
		least1Adjusted: boolean;
		consensus: ConsensusProfile;
		xg: number;
	};

	const toMetrics = (result: BestPicksResult): RankMetrics => {
		const least1Score = strategyTieScore(result, 'least1');
		return {
			least1: least1Score.score,
			least1Adjusted: least1Score.adjusted,
			consensus: buildConsensusProfile(result),
			xg: averageTeamXg(result),
		};
	};

	const metricsEqual = (left: RankMetrics, right: RankMetrics): boolean => {
		return Math.abs(left.least1 - right.least1) <= epsilon
			&& compareRankedBookProfile(left.consensus, right.consensus) === 0
			&& compareConsensusProfile(left.consensus, right.consensus) === 0
			&& Math.abs(left.xg - right.xg) <= epsilon;
	};

	const rankReasonVsPrevious = (current: RankMetrics, previous: RankMetrics): BestPicksResult['rankedBy'] => {
		if (Math.abs(current.least1 - previous.least1) > epsilon) return 'least1';
		if (compareRankedBookProfile(current.consensus, previous.consensus) !== 0) return 'books';
		if (compareConsensusProfile(current.consensus, previous.consensus) !== 0) return 'consensus';
		if (Math.abs(current.xg - previous.xg) > epsilon) return 'xg';
		return 'tied';
	};

	const ranked = results.map((result) => ({
		result,
		metrics: toMetrics(result),
	}));

	// Sort by least1-only ranking priority.
	ranked.sort((left, right) => {
		const least1Compare = compareDesc(left.metrics.least1, right.metrics.least1);
		if (least1Compare !== 0) return least1Compare;

		const rankedBooksCompare = compareRankedBookProfile(left.metrics.consensus, right.metrics.consensus);
		if (rankedBooksCompare !== 0) return rankedBooksCompare;

		const consensusCompare = compareConsensusProfile(left.metrics.consensus, right.metrics.consensus);
		if (consensusCompare !== 0) return consensusCompare;

		const xgCompare = compareDesc(left.metrics.xg, right.metrics.xg);
		if (xgCompare !== 0) return xgCompare;

		return 0;
	});

	for (let index = 0; index < ranked.length; index++) {
		const current = ranked[index];
		const previous = index > 0 ? ranked[index - 1] : null;
		const next = index + 1 < ranked.length ? ranked[index + 1] : null;

		if (!previous) {
			current.result.rankedBy = 'top';
		} else {
			current.result.rankedBy = rankReasonVsPrevious(current.metrics, previous.metrics);
		}

		const tiedWithPrevious = previous ? metricsEqual(current.metrics, previous.metrics) : false;
		const tiedWithNext = next ? metricsEqual(current.metrics, next.metrics) : false;
		current.result.isTied = tiedWithPrevious || tiedWithNext;
	}

	const tieGroupByIndex: Array<number | null> = new Array(ranked.length).fill(null);
	let tieGroupCount = 0;
	for (let index = 0; index < ranked.length; index++) {
		const current = ranked[index];
		if (!current.result.isTied) continue;

		const previous = index > 0 ? ranked[index - 1] : null;
		const sameAsPrevious = previous
			? previous.result.isTied && metricsEqual(current.metrics, previous.metrics)
			: false;

		if (sameAsPrevious) {
			tieGroupByIndex[index] = tieGroupByIndex[index - 1];
		} else {
			tieGroupCount++;
			tieGroupByIndex[index] = tieGroupCount;
		}
	}

	const displayRankByIndex: number[] = [];
	for (let index = 0; index < ranked.length; index++) {
		if (index === 0) {
			displayRankByIndex.push(1);
			continue;
		}
		const isSameAsPrevious = metricsEqual(ranked[index].metrics, ranked[index - 1].metrics);
		displayRankByIndex.push(isSameAsPrevious ? displayRankByIndex[index - 1] : index + 1);
	}

	results.splice(0, results.length, ...ranked.map((item) => item.result));

	const format = (pick: Picks.PickOdds, betKey: LogStatsKey) => {
		const player = pick.player;
		const bet = player[betKey];
		const precision = 1;
		const odds = bet === null ? '' : `${roundToPercent(bet, precision)} - `;
		return `${odds}${player.fullName} (${player.team.code})`;
	};
	const makeTitle = (text: string) => `\n${text}\n${"-".repeat(text.length)}`;

	const bookName = (book: LogStatsKey) => {
		const name = bookTitle(book);
		return makeTitle(`${name}`);
	}

	console.log(makeTitle(`*** Best Streak Picks ${titleForPoolKey(poolKey)} ***`));

	// --- Centralized rank metadata ---
	const rankMeta = [
		{
			key: 'top',
			label: 'Highest overall rank',
		},
		{
			key: 'least1',
			label: '',
		},
		{
			key: 'books',
			label: 'Higher ranked sportsbook values by book order',
		},
		{
			key: 'consensus',
			label: 'Higher consensus by pick order and ranked book support/value',
		},
		{
			key: 'xg',
			label: 'Higher average team xG',
		},
		{
			key: 'tied',
			label: 'Fully tied on all rank metrics',
		},
	];
	const getStrategyBooks = (result: BestPicksResult, strategy: Strategy): LogStatsKey[] => {
		for (const item of result.strategies) {
			if (item.key === strategy) return item.books;
		}
		return [];
	};
	const rankReasonLabel = Object.fromEntries(rankMeta.map(m => [m.key, m.label]));
	const formatHitPct = (value: number): string => `${(value * 100).toFixed(2)}%`;
	const least1DisplayLabel = (metrics: RankMetrics): 'least1' | 'adjusted score' => (
		metrics.least1Adjusted ? 'adjusted score' : 'least1'
	);
	const hasAdjustedLeast1 = ranked.some(item => item.metrics.least1Adjusted);
	const rankLeast1ReasonLabel = hasAdjustedLeast1
		? 'Higher adjusted score (streak)'
		: 'Higher least1 score (streak)';
	rankReasonLabel.least1 = rankLeast1ReasonLabel;
	for (const meta of rankMeta) {
		if (meta.key === 'least1') {
			meta.label = rankLeast1ReasonLabel;
			break;
		}
	}
	const metricSnapshot = (metrics: RankMetrics, least1Books: LogStatsKey[]): string => (
		`${least1DisplayLabel(metrics)}=${formatHitPct(metrics.least1)} | books=${least1Books.join(',') || 'n/a'} | xG=${metrics.xg.toFixed(3)}`
	);
	const explainSlotConsensusDelta = (left: SlotConsensusProfile, right: SlotConsensusProfile): string => {
		const leftTopBook = left.topBookRank === Number.POSITIVE_INFINITY ? null : rankedConsensusBooks[left.topBookRank];
		const rightTopBook = right.topBookRank === Number.POSITIVE_INFINITY ? null : rankedConsensusBooks[right.topBookRank];

		const topBookCompare = compareAsc(left.topBookRank, right.topBookRank);
		if (topBookCompare !== 0) {
			return `3a top support rank: ${leftTopBook ?? 'none'} vs ${rightTopBook ?? 'none'}`;
		}

		const supportCountCompare = compareDesc(left.supportCount, right.supportCount);
		if (supportCountCompare !== 0) {
			return `3b support count: ${left.supportCount} vs ${right.supportCount}`;
		}

		for (const book of rankedConsensusBooks) {
			const leftValue = left.supportByBook.get(book);
			const rightValue = right.supportByBook.get(book);
			if (leftValue === undefined && rightValue === undefined) continue;
			if (leftValue === undefined || rightValue === undefined || Math.abs(leftValue - rightValue) > epsilon) {
				const leftText = leftValue === undefined ? 'n/a' : leftValue.toFixed(3);
				const rightText = rightValue === undefined ? 'n/a' : rightValue.toFixed(3);
				return `3c support value ${book}: ${leftText} vs ${rightText}`;
			}
		}

		for (const book of rankedConsensusBooks) {
			if (left.supportByBook.has(book) || right.supportByBook.has(book)) continue;
			const leftValue = left.allBookValues.get(book) ?? null;
			const rightValue = right.allBookValues.get(book) ?? null;
			if (leftValue === null && rightValue === null) continue;
			if (leftValue === null || rightValue === null || Math.abs(leftValue - rightValue) > epsilon) {
				const leftText = leftValue === null ? 'n/a' : leftValue.toFixed(3);
				const rightText = rightValue === null ? 'n/a' : rightValue.toFixed(3);
				return `3d non-support value ${book}: ${leftText} vs ${rightText}`;
			}
		}

		return 'Consensus profile wins by ranked-book tie-break rules';
	};
	const explainRankDelta = (
		current: RankMetrics,
		previous: RankMetrics,
		rankedBy: BestPicksResult['rankedBy'],
	): string => {
		switch (rankedBy) {
			case 'least1': {
				const currentLabel = least1DisplayLabel(current);
				const previousLabel = least1DisplayLabel(previous);
				if (currentLabel === previousLabel) {
					return `${currentLabel}: ${formatHitPct(current.least1)} vs ${formatHitPct(previous.least1)}`;
				}
				return `${currentLabel}: ${formatHitPct(current.least1)} vs ${previousLabel}: ${formatHitPct(previous.least1)}`;
			}
			case 'xg':
				return `xG: ${current.xg.toFixed(3)} vs ${previous.xg.toFixed(3)}`;
			case 'books': {
				const slots: SlotKey[] = AllPickGroup;
				for (const slot of slots) {
					if (compareSlotRankedBooks(current.consensus[slot], previous.consensus[slot]) !== 0) {
						for (const book of rankedConsensusBooks) {
							const currentValue = current.consensus[slot].allBookValues.get(book) ?? null;
							const previousValue = previous.consensus[slot].allBookValues.get(book) ?? null;
							if (currentValue === null && previousValue === null) continue;
							if (currentValue === previousValue) continue;
							const currentText = currentValue === null ? 'n/a' : currentValue.toFixed(3);
							const previousText = previousValue === null ? 'n/a' : previousValue.toFixed(3);
							return `${`Pick${slot}`} ranked books: ${book} ${currentText} vs ${previousText}`;
						}
					}
				}
				return 'Ranked sportsbook values win by book order';
			}
			case 'consensus': {
				const slots: SlotKey[] = AllPickGroup;
				for (const slot of slots) {
					if (compareSlotConsensus(current.consensus[slot], previous.consensus[slot]) !== 0) {
						return `${`Pick${slot}`} consensus: ${explainSlotConsensusDelta(current.consensus[slot], previous.consensus[slot])}`;
					}
				}
				return 'Consensus profile wins by ranked-book tie-break rules';
			}
			case 'tied':
				return 'Fully tied on all ranking metrics';
			case 'top':
			default:
				return 'Top-ranked result';
		}
	};

	// --- Precompute display payloads for ranking/logging ---
	const displayPayloads = ranked.map((item, idx) => {
		const { result, metrics } = item;
		const previousMetrics = idx > 0 ? ranked[idx - 1].metrics : null;
		const least1Books = getStrategyBooks(result, 'least1');
		const rankExplain = previousMetrics && result.rankedBy
			? explainRankDelta(metrics, previousMetrics, result.rankedBy)
			: 'Top-ranked result';
		const bets: Set<LogStatsKey> = new Set(least1Books);
		const strategies: Set<Strategy> = new Set(['least1']);
		// Consensus details for each slot
		const consensusDetails = Object.entries(metrics.consensus).map(([slot, prof]) => {
			// Show topBookRank, supportCount, and top supporting book/value
			let topBook = null, topValue = null;
			if (prof.topBookRank !== Number.POSITIVE_INFINITY) {
				topBook = rankedConsensusBooks[prof.topBookRank];
				topValue = prof.supportByBook.get(topBook);
			}
			return {
				slot,
				topBookRank: prof.topBookRank,
				topBook,
				topValue,
				supportCount: prof.supportCount,
				supportByBook: Object.fromEntries(prof.supportByBook),
			};
		});
		return {
			index: idx,
			rank: displayRankByIndex[idx],
			rankedBy: result.rankedBy,
			isTied: result.isTied,
			tieGroup: tieGroupByIndex[idx],
			bets: Array.from(bets),
			strategies: Array.from(strategies),
			metricSnapshot: metricSnapshot(metrics, least1Books),
			rankExplain,
			consensusDetails,
			picks: [result['1'], result['2'], result['3']],
		};
	});

	// --- Enhanced Rank summary and reason output ---
	const rankSummaryOrder: Array<Exclude<BestPicksResult['rankedBy'], undefined>> = ['top', 'least1', 'books', 'consensus', 'xg', 'tied'];
	const rankMetaMap = Object.fromEntries(rankMeta.map(m => [m.key, m])) as Record<string, typeof rankMeta[number]>;

	const poolLeast1 = summary[poolKey].topLeast1.actualValue;

	console.log('Rank summary:');
	console.log(` • Total results: ${results.length}`);
	console.log(` • Tied entries: ${tieGroupByIndex.filter(g => g !== null).length} (results tied with at least one adjacent result)`);
	console.log(` • Tie groups: ${tieGroupCount} (contiguous clusters of fully-equal ranked results)`);
	console.log(` • ${hasAdjustedLeast1 ? 'adjusted score' : 'least1'} weighting books: ${strategyConfig.least1.join(' > ') || 'none'}`);
	console.log(` • Consensus rank order: ${rankedConsensusBooks.join(' > ')}`);
	console.log(' • Tie-break order: (1) ranked sportsbook values by book order, (2) earlier consensus support in ranked order, (3) more consensus support, (4) supporting values in ranked order, (5) remaining non-supporting values in ranked order');
	console.log(` • Pool least1 baseline: ${poolLeast1.toFixed(2)}%`);
	for (const key of rankSummaryOrder) {
		const meta = rankMetaMap[key];
		const count = results.filter(r => r.rankedBy === key).length;
		if (count > 0 && meta) console.log(`   - ${meta.label}: ${count}`);
	}

	for (const payload of displayPayloads) {
		const tieHeader = payload.tieGroup !== null
			? `* Shared Rank #${payload.rank} (tie group #${payload.tieGroup}) of ${displayPayloads.length}`
			: `* Rank #${payload.rank} of ${displayPayloads.length}`;
		console.log(makeTitle(tieHeader));
		console.log(`• Metric snapshot: ${payload.metricSnapshot}`);
		console.log(`• Why at this rank: ${payload.rankExplain}`);
		if (payload.tieGroup !== null) {
			console.log(`• Tie semantics: This result is fully tied; entries in tie group #${payload.tieGroup} share rank #${payload.rank} with no further ranking between them.`);
		}
		if (payload.rankedBy) {
			const tieSuffix = payload.tieGroup !== null ? ` | tie group #${payload.tieGroup}` : '';
			console.log(`• Rank reason: ${rankReasonLabel[payload.rankedBy]}${tieSuffix}`);
		}
		for (const slotDetail of payload.consensusDetails) {
			const slotLabel = `Pick${slotDetail.slot}`;
			const topBookStr = slotDetail.topBook !== undefined && slotDetail.topBook !== null ? `${slotDetail.topBook}` : 'none';
			const topValueStr = slotDetail.topValue !== undefined && slotDetail.topValue !== null ? slotDetail.topValue.toFixed(3) : 'n/a';
			console.log(`• ${slotLabel} consensus: TopBook=${topBookStr} (rank ${slotDetail.topBookRank}), Support=${slotDetail.supportCount}, TopValue=${topValueStr}`);
		}
		const compactBooks: LogStatsKey[] = payload.bets.length > 1 && payload.bets.includes('betAvg')
			? ['betAvg']
			: payload.bets;
		if (compactBooks.length !== payload.bets.length) {
			console.log(`• Compact display: Average only (weighted books: ${payload.bets.join(' > ')})`);
		}
		for (const bet of compactBooks) {
			console.log(`${bookName(bet)}`);
			// Show picks
			payload.picks.forEach((pick, i) => {
				console.log(`${i + 1}: ${format(pick, bet)}`);
			});
		}
	}

	return results;
}

export const logCorrelations = () => {
	const { teammates, opponents, from, through, days, playerDays } = pairLifts;
	console.log(`\n*** Pair lifts: teammates ×${round(teammates, 3)}, opponents ×${round(opponents, 3)} ***`);
	console.log(`Fitted on ${days} days, ${from} to ${through}, ${playerDays} player-days`);
}

// A listed player on one archived day, at the Avg price of the first window listing them
interface PlayerDay {
	team: string;
	opponent: string;
	scored: boolean;
	price: number;
}
type PairCounts = Record<'same' | 'opp' | 'diff', { both: number; expected: number }>;

// How many times as often teammates (or opponents) both scored as their odds say. Each day's pairs
// are compared with that day's pairs from different games, which can't be correlated, so the books'
// margin, which drifts from day to day, cancels. The days are pooled by Mantel-Haenszel.
const fitPairLifts = (days: string[], playersByDay: PlayerDay[][]): PairLifts => {
	const counts = playersByDay.map((players) => {
		const cells: PairCounts = {
			same: { both: 0, expected: 0 },
			opp: { both: 0, expected: 0 },
			diff: { both: 0, expected: 0 },
		};
		for (let a = 0; a < players.length; a++) {
			for (let b = a + 1; b < players.length; b++) {
				const x = players[a];
				const y = players[b];
				const cell = cells[x.team === y.team ? 'same' : x.team === y.opponent ? 'opp' : 'diff'];
				if (x.scored && y.scored) cell.both++;
				cell.expected += x.price * y.price;
			}
		}
		return cells;
	});

	const lift = (kind: 'same' | 'opp'): number => {
		let upper = 0;
		let lower = 0;
		for (const cells of counts) {
			const cell = cells[kind];
			const control = cells.diff;
			const weight = cell.expected + control.expected;
			if (!(weight > 0)) continue;
			upper += (cell.both * control.expected) / weight;
			lower += (control.both * cell.expected) / weight;
		}
		return upper / lower;
	};

	const sorted = [...days].sort();
	return {
		teammates: lift('same'),
		opponents: lift('opp'),
		from: sorted.length ? sorted[0] : '',
		through: sorted.length ? sorted[sorted.length - 1] : '',
		days: days.length,
		playerDays: playersByDay.reduce((sum, players) => sum + players.length, 0),
	};
}

export const runSimulation = async (minSportsbooks: number): Promise<PairLifts> => {
	const historyManifest = await fetchJson<HistoryManifestItem[]>('./history/history.json');
	const oldestDate = new Date("2026-04-09");
	const historyByDate = new Map<string, string>();

	for (const item of historyManifest) {
		for (const file of item.files) {
			const components = file.split('_');
			if (components.length !== 3) continue;
			const name = components[1];
			const date = new Date(name);
			if (isNaN(date.valueOf())) continue;
			if (date < oldestDate) continue;
			historyByDate.set(name, file);
		}
	}

	const days: string[] = [];
	const playersByDay: PlayerDay[][] = [];

	for (const [date, historyFile] of historyByDate) {
		try {
			const history = await fetchJson<{
				playerLists: Array<{ id: number; players: HistoryPlayer[] }>;
			}>(`./history/${historyFile}`);

			const playerSets = new Map<string, Map<number, HistoryPlayer>>();
			for (const list of history.playerLists) {
				playerSets.set(String(list.id), new Map(list.players.map((player) => [Math.abs(player.nhlPlayerId), player])));
			}

			const gameStartTimes = await getGameStartTimeGroups(date);

			const players = new Map<number, PlayerDay>();
			for (let slotIndex = 0; slotIndex < gameStartTimes.length; slotIndex++) {
				try {
					const folderTime = gameStartTimes[slotIndex];
					const folder = `./data/${date}/${folderTime}`;

					const helper = await fetchOptionalJson<Record<PickGroup, Picks.OddsItem[]>>(`${folder}/helper.json`);
					if (!helper) continue;

					const bookOdds = await Promise.all(SportsbookKeys.map(async (key) => {
						const items = await fetchOptionalJson<Array<{ name: string; odds: number }>>(`${folder}/${key}.json`);
						return items;
					}));
					if (bookOdds.some((items) => items === null)) continue;

					const oddsMaps = bookOdds.map((items) => {
						const oddsMap = new Map<string, number>();
						for (const item of items ?? []) oddsMap.set(removeAccentsNormalize(item.name), item.odds);
						return oddsMap;
					});

					const rows: SnapshotOddsRow[] = [];
					for (const sid of AllPickGroup) {
						const outcomes = playerSets.get(sid);
						if (!outcomes) continue;

						for (const item of helper[sid] ?? []) {
							const player = outcomes.get(item.playerId);
							if (!player) {
								console.error("Player not found:", item);
								continue;
							}

							const fullName = `${item.firstName} ${item.lastName}`;
							const candidates = oddsNameCandidates(fullName);
							const probs: Array<number | null> = [null, null, null, null];

							for (let index = 0; index < oddsMaps.length; index++) {
								for (const candidate of candidates) {
									const odds = oddsMaps[index].get(removeAccentsNormalize(candidate));
									if (odds !== undefined) {
										probs[index] = 1 / odds;
										break;
									}
								}
							}

							rows.push(new SnapshotOddsRow({
								sid,
								id: item.playerId,
								team: player.team,
								opponent: player.opponent,
								scored: player.scored,
								bet1: probs[0],
								bet2: probs[1],
								bet3: probs[2],
								bet4: probs[3],
								betAvg: null,
								betCount: 0,
							}));
						}
					}

					if (rows.length === 0) continue;

					if (Feature.normalizeSportsbooks) deVig(rows as unknown as Picks.Player[]);

					for (const row of rows) {
						const values = SportsbookKeys
							.map((key) => row[key])
							.filter((value): value is number => value !== null);
						row.betCount = values.length;
						row.betAvg = values.length >= minSportsbooks
							? values.reduce((sum, value) => sum + value, 0) / values.length
							: null;
					}

					const gameCount = countGamesFromHelper(helper, playerSets);
					if (gameCount === 0) continue;

					const set1 = rows.filter((row) => row.sid === '1' && row.betAvg !== null && row.betCount >= minSportsbooks);
					const set2 = rows.filter((row) => row.sid === '2' && row.betAvg !== null && row.betCount >= minSportsbooks);
					const set3 = rows.filter((row) => row.sid === '3' && row.betAvg !== null && row.betCount >= minSportsbooks);
					if (set1.length === 0 || set2.length === 0 || set3.length === 0) continue;

					// Each player once a day, from the first window listing them with enough books for an Avg
					for (const row of rows) {
						if (row.betAvg === null || row.betCount < minSportsbooks || players.has(row.id)) continue;
						players.set(row.id, { team: row.team, opponent: row.opponent, scored: row.scored, price: row.betAvg });
					}
				} catch (error) {
					console.warn(`Skipping simulation snapshot ${date} ${gameStartTimes[slotIndex]}:`, error);
				}
			}

			if (players.size === 0) continue;
			days.push(date);
			playersByDay.push([...players.values()]);
		} catch (error) {
			console.warn(`Skipping simulation date ${date}:`, error);
		}
	}

	return fitPairLifts(days, playersByDay);
}
