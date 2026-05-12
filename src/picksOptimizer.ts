import type { Team } from "./components/logo";
import * as Picks from "./components/Table";
import type { CorrelationData, CorrelationResult, CorrelationResults } from "./correlationData";
import { correlations } from "./correlationData";
import { deVig, oddsNameMap, removeAccentsNormalize } from "./dataProcessor";
import type { ComboPattern, LogStatsKey, StrategyMode, Strategy, PoolSlots } from "./dataTypes";
import { AllCombos, SportsbookKeys, LogStatsKeys, StrategyLabels, AllStrategies, Sportsbooks } from "./dataTypes";
import type { MergedSelection, SelectionCandidate } from "./strategySelection";
import { selectStrategyCombos } from "./strategySelection";
import * as Feature from './features';
import { roundToPercent } from "./utility";

export const calcAny = (prob1: number, prob2: number, prob3: number): number => {
	return 1 - (1 - prob1) * (1 - prob2) * (1 - prob3);
};

export const calcPnt = (prob1: number, prob2: number, prob3: number): number => {
	const not1 = 1 - prob1;
	const not2 = 1 - prob2;
	const not3 = 1 - prob3;
	const p1 = prob1 * not2 * not3 + not1 * prob2 * not3 + not1 * not2 * prob3;
	const p2 = prob1 * prob2 * not3 + prob1 * not2 * prob3 + not1 * prob2 * prob3;
	const p3 = prob1 * prob2 * prob3;
	return p1 * 25 + p2 * 50 + p3 * 100;
};

export const calcHit = (prob1: number, prob2: number, prob3: number): number => {
	return prob1 + prob2 + prob3;
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

type CorrelationCount = Record<typeof AllCombos[number], number>;
type BaselineKey = 'random' | 'iii';

export interface Total {
	least1: number;
	points: number;
	hits: number;
	count: number;
}

class Correlation {
	strategy = {
		least1: {} as CorrelationData,
		points: {} as CorrelationData,
		hits: {} as CorrelationData,
		count: {} as CorrelationCount
	}
	baseline: Total = {
		least1: 0,
		points: 0,
		hits: 0,
		count: 0
	};
	baselineKey: BaselineKey;

	constructor(baselineKey: BaselineKey) {
		this.baselineKey = baselineKey;
		for (const combo of AllCombos) {
			this.strategy.least1[combo] = null;
			this.strategy.points[combo] = null;
			this.strategy.hits[combo] = null;
			this.strategy.count[combo] = 0;
		}
	}
	add(result: SimTotal) {
		for (const combo of AllCombos) {
			if (result[combo].count === 0) continue;
			if (this.strategy.least1[combo] === null) this.strategy.least1[combo] = 0;
			if (this.strategy.points[combo] === null) this.strategy.points[combo] = 0;
			if (this.strategy.hits[combo] === null) this.strategy.hits[combo] = 0;
			this.strategy.least1[combo] += result[combo].least1;
			this.strategy.points[combo] += result[combo].points;
			this.strategy.hits[combo] += result[combo].hits;
			this.strategy.count[combo] += result[combo].count;
		}

		this.baseline.least1 += result[this.baselineKey].least1;
		this.baseline.points += result[this.baselineKey].points;
		this.baseline.hits += result[this.baselineKey].hits;
		this.baseline.count += result[this.baselineKey].count;
	}
	calculate() {
		if (this.baseline.count === 0) return;

		this.baseline.least1 /= this.baseline.count;
		this.baseline.points /= this.baseline.count;
		this.baseline.hits /= this.baseline.count;

		for (const combo of AllCombos) {
			const count = this.strategy.count[combo];
			if (count === 0) continue;
			if (this.strategy.least1[combo] === null) this.strategy.least1[combo] = 0;
			if (this.strategy.points[combo] === null) this.strategy.points[combo] = 0;
			if (this.strategy.hits[combo] === null) this.strategy.hits[combo] = 0;
			this.strategy.least1[combo] /= count * this.baseline.least1;
			this.strategy.points[combo] /= count * this.baseline.points;
			this.strategy.hits[combo] /= count * this.baseline.hits;

			this.strategy.least1[combo] = Math.log(this.strategy.least1[combo]) + 1;
			this.strategy.points[combo] = Math.log(this.strategy.points[combo]) + 1;
			this.strategy.hits[combo] = Math.log(this.strategy.hits[combo]) + 1;
		}
	}
	results(): CorrelationResult {
		return {
			least1: this.strategy.least1,
			points: this.strategy.points,
			hits: this.strategy.hits,
		};
	}
};

const compileSimItems = (simItems: SimItem[]): CorrelationResults => {
	const game1 = new Correlation('random');
	const game2 = new Correlation('random');
	const game3 = new Correlation('iii');
	const game4 = new Correlation('iii');
	for (const item of simItems) {
		if (item.gameCount === 1) game1.add(item.totals);
		else if (item.gameCount === 2) game2.add(item.totals);
		else if (item.gameCount === 3) game3.add(item.totals);
		else game4.add(item.totals);
	}
	game1.calculate();
	game2.calculate();
	game3.calculate();
	game4.calculate();

	return {
		"1": game1.results(),
		"2": game2.results(),
		"3": game3.results(),
		"4+": game4.results(),
	}
}

type PlayerSet = Array<HistoryPlayer>;
function getRandomEntry(entries: PlayerSet = []): HistoryPlayer | undefined {
	const randomEntry = entries[Math.floor(Math.random() * entries.length)];
	return randomEntry;
}

class Result {
	least1: boolean
	points: number
	hits: number
	constructor(hit1: boolean, hit2: boolean, hit3: boolean) {
		this.least1 = hit1 || hit2 || hit3;
		const hitCount = (hit1 ? 1 : 0) + (hit2 ? 1 : 0) + (hit3 ? 1 : 0);
		this.points = hitCount === 0 ? 0 : hitCount === 1 ? 25 : hitCount === 2 ? 50 : 100;
		this.hits = hitCount;
	}
}

class ResultTotal implements Total {
	least1: number
	points: number
	hits: number
	count: number
	constructor() {
		this.least1 = 0;
		this.points = 0;
		this.hits = 0;
		this.count = 0;
	}
	add(result: Result) {
		if (result.least1) this.least1++;
		this.points += result.points;
		this.hits += result.hits;
		this.count++;
	}
}

export type SimTotal = Record<ComboPattern | 'random', Total>;
interface SimItem {
	slotTotal: number;
	slotIndex: number;
	gameCount: number;
	totals: SimTotal;
}

const simulateRandom = (set1: PlayerSet, set2: PlayerSet, set3: PlayerSet): Result | null => {
	const pick1 = getRandomEntry(set1);
	if (!pick1) return null;
	const pick2 = getRandomEntry(set2);
	if (!pick2) return null;
	const pick3 = getRandomEntry(set3);
	if (!pick3) return null;
	return new Result(pick1.scored, pick2.scored, pick3.scored);
}
function iSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
	const independent = set.filter((p) => p.team !== player.team && p.opponent !== player.team);
	return independent;
}
function sSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
	const stacked = set.filter((p) => p.team === player.team);
	return stacked;
}
function oSet(player: HistoryPlayer, set: PlayerSet): PlayerSet {
	const opposing = set.filter((p) => p.team === player.opponent);
	return opposing;
}

/**
 * Simulate a pick combination according to the given strategy pattern.
 * @param set1 PlayerSet for pick 1
 * @param set2 PlayerSet for pick 2
 * @param set3 PlayerSet for pick 3
 * @param pattern strategyPattern string
 * @returns Result or null if a valid combo can't be formed
 */
function simulateCombo(set1: PlayerSet, set2: PlayerSet, set3: PlayerSet, pattern: ComboPattern): Result | null {
	const pick1 = getRandomEntry(set1);
	if (!pick1) return null;
	let pick2: HistoryPlayer | undefined;
	let pick3: HistoryPlayer | undefined;
	if (pattern === 'iii') {
		pick2 = getRandomEntry(iSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(iSet(pick2, iSet(pick1, set3)));
	} else if (pattern === 'sss') {
		pick2 = getRandomEntry(sSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(sSet(pick2, set3));
	} else if (pattern === 'iss') {
		pick2 = getRandomEntry(iSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(sSet(pick2, set3));
	} else if (pattern === 'sis') {
		pick2 = getRandomEntry(iSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(sSet(pick1, set3));
	} else if (pattern === 'ssi') {
		pick2 = getRandomEntry(sSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(iSet(pick1, set3));
	} else if (pattern === 'ioo') {
		pick2 = getRandomEntry(iSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(oSet(pick2, set3));
	} else if (pattern === 'oio') {
		pick2 = getRandomEntry(iSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(oSet(pick1, set3));
	} else if (pattern === 'ooi') {
		pick2 = getRandomEntry(oSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(iSet(pick1, set3));
	} else if (pattern === 'oso') {
		pick2 = getRandomEntry(sSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(oSet(pick1, set3));
	} else if (pattern === 'soo') {
		pick2 = getRandomEntry(sSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(oSet(pick2, set3));
	} else if (pattern === 'sos') {
		pick2 = getRandomEntry(oSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(sSet(pick1, set3));
	} else if (pattern === 'oss') {
		pick2 = getRandomEntry(oSet(pick1, set2));
		if (pick2) pick3 = getRandomEntry(sSet(pick2, set3));
	}
	if (!pick2) return null;
	if (!pick3) return null;
	return new Result(pick1.scored, pick2.scored, pick3.scored);
}

interface HistoryManifestItem {
	season: string;
	format: string;
	start: string;
	end: string;
	files: string[];
}

interface SnapshotOddsRow {
	sid: '1' | '2' | '3';
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

type ItemFormat = 'regular' | 'playoff';
type Format = ItemFormat | 'all';

export interface AnalyzeOptions {
	minSportsbooks: number;
	correlationFactor?: number;
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

export interface HistoricalAuditStat {
	tickets: number;
	hits: number;
	totalPicks: number;
	hitPct: number;
	predictedHitPct: number;
	ticketWins: number;
	ticketWinPct: number;
	predictedTicketWinPct: number;
	avgPoints: number;
	predictedAvgPoints: number;
	ratio: string;
}

export type HistoricalAuditResults = Record<LogStatsKey, Record<StrategyMode, HistoricalAuditStat>>;

type AuditBucket = {
	tickets: number;
	ticketWins: number;
	totalHits: number;
	totalPoints: number;
	expectedTicketWins: number;
	expectedHits: number;
	expectedPoints: number;
};

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

const auditLabels: Record<LogStatsKey, string> = {
	bet1: 'DraftKings (bet1)',
	bet2: 'FanDuel (bet2)',
	bet3: 'BetMGM (bet3)',
	bet4: 'BetRivers (bet4)',
	betAvg: 'Average',
};

const initAuditBucket = (): AuditBucket => ({
	tickets: 0,
	ticketWins: 0,
	totalHits: 0,
	totalPoints: 0,
	expectedTicketWins: 0,
	expectedHits: 0,
	expectedPoints: 0,
});

const createAuditBuckets = (): Record<LogStatsKey, Record<StrategyMode, AuditBucket>> => ({
	bet1: { top: initAuditBucket(), least1: initAuditBucket(), points: initAuditBucket(), hits: initAuditBucket() },
	bet2: { top: initAuditBucket(), least1: initAuditBucket(), points: initAuditBucket(), hits: initAuditBucket() },
	bet3: { top: initAuditBucket(), least1: initAuditBucket(), points: initAuditBucket(), hits: initAuditBucket() },
	bet4: { top: initAuditBucket(), least1: initAuditBucket(), points: initAuditBucket(), hits: initAuditBucket() },
	betAvg: { top: initAuditBucket(), least1: initAuditBucket(), points: initAuditBucket(), hits: initAuditBucket() },
});

type ComboOutcome = {
	actualTicketWins: number;
	actualHits: number;
	actualPoints: number;
	expectedLeast1: number;
	expectedHits: number;
	expectedPoints: number;
};

const applyAuditOutcome = (bucket: AuditBucket, outcome: ComboOutcome) => {
	const { actualTicketWins, actualHits, actualPoints, expectedLeast1, expectedHits, expectedPoints } = outcome;
	bucket.tickets++;
	bucket.ticketWins += actualTicketWins;
	bucket.totalHits += actualHits;
	bucket.totalPoints += actualPoints;
	bucket.expectedTicketWins += expectedLeast1;
	bucket.expectedHits += expectedHits;
	bucket.expectedPoints += expectedPoints;
};

const sameTeamSnapshot = (left: SnapshotOddsRow, right: SnapshotOddsRow): boolean => left.team === right.team;
const opponentTeamSnapshot = (left: SnapshotOddsRow, right: SnapshotOddsRow): boolean => left.team === right.opponent;
const sameGameSnapshot = (left: SnapshotOddsRow, right: SnapshotOddsRow): boolean => sameTeamSnapshot(left, right) || opponentTeamSnapshot(left, right);

const countGamesFromHelper = (
	helper: Record<'1' | '2' | '3', Picks.OddsItem[]>,
	playerSets: Map<string, Map<number, HistoryPlayer>>
): number => {
	const teams = new Set<string>();
	let gameCount = 0;

	for (const sid of ['1', '2', '3'] as const) {
		const outcomes = playerSets.get(sid);
		if (!outcomes) continue;

		for (const item of helper[sid] ?? []) {
			const player = outcomes.get(Math.abs(item.playerId));
			if (!player) continue;
			if (teams.has(player.team)) continue;

			teams.add(player.team);
			teams.add(player.opponent);
			gameCount++;
		}
	}

	return gameCount;
};


const getSnapshotStrategy = (pick1: SnapshotOddsRow, pick2: SnapshotOddsRow, pick3: SnapshotOddsRow): ComboPattern | null => {
	if (!sameGameSnapshot(pick1, pick2) && !sameGameSnapshot(pick2, pick3) && !sameGameSnapshot(pick1, pick3)) return 'iii';
	if (sameTeamSnapshot(pick1, pick2) && sameTeamSnapshot(pick2, pick3)) return 'sss';

	if (sameTeamSnapshot(pick2, pick3) && !sameGameSnapshot(pick1, pick2)) return 'iss';
	if (sameTeamSnapshot(pick1, pick3) && !sameGameSnapshot(pick2, pick1)) return 'sis';
	if (sameTeamSnapshot(pick1, pick2) && !sameGameSnapshot(pick3, pick1)) return 'ssi';

	if (opponentTeamSnapshot(pick2, pick3) && !sameGameSnapshot(pick1, pick2)) return 'ioo';
	if (opponentTeamSnapshot(pick1, pick3) && !sameGameSnapshot(pick2, pick1)) return 'oio';
	if (opponentTeamSnapshot(pick1, pick2) && !sameGameSnapshot(pick3, pick1)) return 'ooi';

	if (sameTeamSnapshot(pick1, pick2) && opponentTeamSnapshot(pick3, pick1)) return 'oso';
	if (sameTeamSnapshot(pick1, pick2) && opponentTeamSnapshot(pick3, pick2)) return 'soo';
	if (sameTeamSnapshot(pick1, pick3) && opponentTeamSnapshot(pick1, pick2)) return 'sos';
	if (sameTeamSnapshot(pick2, pick3) && opponentTeamSnapshot(pick1, pick2)) return 'oss';

	return null;
};

type StrategyScore = {
	score: number;
	outcome: ComboOutcome;
};

type BookComboEvaluation = {
	topOutcome: ComboOutcome;
	bestScores: Record<Strategy, StrategyScore | null>;
};

type BookPredictionSummary = {
	book: LogStatsKey;
	predicted: string;
};

type WinSummary = {
	books: LogStatsKey[];
	actualTicketWinPct: number;
	predictedByBook: BookPredictionSummary[];
	ticketRatio: string;
	tickets: number;
};

type PointsSummary = {
	books: LogStatsKey[];
	actualAvgPoints: number;
	predictedByBook: BookPredictionSummary[];
	tickets: number;
};

type HitPctSummary = {
	books: LogStatsKey[];
	actualHitPct: number;
	predictedByBook: BookPredictionSummary[];
	ratio: string;
};

export type PoolAccuracySummary = {
	recommendedForWins: {
		mode: StrategyMode;
		books: LogStatsKey[];
		actualTicketWinPct: number;
		predictedByBook: BookPredictionSummary[];
		ticketRatio: string;
		tickets: number;
	};
	topWin: WinSummary;
	correlatedWin: WinSummary;
	topPoints: PointsSummary;
	correlatedPoints: PointsSummary;
	topPickPct: HitPctSummary;
	correlatedPickPct: HitPctSummary;
};

export type ComparePoolAccuracySummary = Record<PoolSlots, PoolAccuracySummary>;

const createComboOutcome = (prob1: number, prob2: number, prob3: number, hitCount: number): ComboOutcome => ({
	actualTicketWins: hitCount > 0 ? 1 : 0,
	actualHits: hitCount,
	actualPoints: hitCount === 0 ? 0 : hitCount === 1 ? 25 : hitCount === 2 ? 50 : 100,
	expectedLeast1: calcAny(prob1, prob2, prob3),
	expectedHits: calcHit(prob1, prob2, prob3),
	expectedPoints: calcPnt(prob1, prob2, prob3),
});

const selectionHitCount = <T extends { scored: boolean }>(selection: MergedSelection<T>): number => {
	// Proportional/fractional hit counting for ties
	const { combos } = selection;
	if (!combos || combos.length === 0) return 0;
	let totalHits = 0;
	for (const combo of combos) {
		const hitCount = (combo.pick1.scored ? 1 : 0)
			+ (combo.pick2.scored ? 1 : 0)
			+ (combo.pick3.scored ? 1 : 0);
		totalHits += hitCount;
	}
	// Divide by number of tied combos to get fractional credit
	return totalHits / combos.length;
};

type ScoredSelection = {
	selection: MergedSelection<SnapshotOddsRow>;
	outcome: ComboOutcome;
};

const aggregateSelectionOutcome = (selections: ScoredSelection[]): ComboOutcome | null => {
	// Proportional/fractional hit counting for ties
	let selectionCount = 0;
	let actualTicketWins = 0;
	let actualHits = 0;
	let actualPoints = 0;
	let expectedLeast1 = 0;
	let expectedHits = 0;
	let expectedPoints = 0;

	for (const { selection, outcome } of selections) {
		// For each tied combo, calculate its outcome and sum fractionally
		const { combos } = selection;
		if (!combos || combos.length === 0) continue;
		let comboHits = 0;
		let comboPoints = 0;
		let comboTicketWins = 0;
		for (const combo of combos) {
			const hitCount = (combo.pick1.scored ? 1 : 0)
				+ (combo.pick2.scored ? 1 : 0)
				+ (combo.pick3.scored ? 1 : 0);
			const actual = createComboOutcome(combo.prob1, combo.prob2, combo.prob3, hitCount);
			comboHits += actual.actualHits;
			comboPoints += actual.actualPoints;
			comboTicketWins += actual.actualTicketWins;
		}
		// Average across all tied combos
		actualHits += comboHits / combos.length;
		actualPoints += comboPoints / combos.length;
		actualTicketWins += comboTicketWins / combos.length;
		expectedLeast1 += outcome.expectedLeast1;
		expectedHits += outcome.expectedHits;
		expectedPoints += outcome.expectedPoints;
		selectionCount++;
	}

	if (selectionCount === 0) return null;

	return {
		actualTicketWins: actualTicketWins / selectionCount,
		actualHits: actualHits / selectionCount,
		actualPoints: actualPoints / selectionCount,
		expectedLeast1: expectedLeast1 / selectionCount,
		expectedHits: expectedHits / selectionCount,
		expectedPoints: expectedPoints / selectionCount,
	};
};

const evaluateBookCombos = (
	set1: SnapshotOddsRow[],
	set2: SnapshotOddsRow[],
	set3: SnapshotOddsRow[],
	bookKey: LogStatsKey,
	ref: CorrelationResult,
	correlationFactor: number
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
					strategy: getSnapshotStrategy(pick1, pick2, pick3),
				});
			}
		}
	}

	const { top, strategies } = selectStrategyCombos(candidates);
	const topSelection = top.merge();
	if (!topSelection) return null;

	const rawTopOutcome = createComboOutcome(
		topSelection.prob1,
		topSelection.prob2,
		topSelection.prob3,
		selectionHitCount(topSelection)
	);
	const topOutcome = aggregateSelectionOutcome([{ selection: topSelection, outcome: rawTopOutcome }]);
	if (!topOutcome) return null;

	const epsilon = 1e-12;
	const bestSelections: Record<Strategy, { score: number; selections: ScoredSelection[] } | null> = {
		least1: null,
		points: null,
		hits: null,
	};

	const scaleCorrelation = (value: number | null): number => (((value ?? 1) - 1) * correlationFactor) + 1;
	for (const [strategy, combos] of strategies) {
		const selection = combos.merge();
		if (!selection) continue;

		const outcome = createComboOutcome(
			selection.prob1,
			selection.prob2,
			selection.prob3,
			selectionHitCount(selection)
		);
		const least1Scaled = scaleCorrelation(ref.least1[strategy]);
		const pointsScaled = scaleCorrelation(ref.points[strategy]);
		const hitsScaled = scaleCorrelation(ref.hits[strategy]);

		const correlatedOutcome: ComboOutcome = {
			actualTicketWins: outcome.actualTicketWins,
			actualHits: outcome.actualHits,
			actualPoints: outcome.actualPoints,
			expectedLeast1: outcome.expectedLeast1 * least1Scaled,
			expectedHits: outcome.expectedHits * hitsScaled,
			expectedPoints: outcome.expectedPoints * pointsScaled,
		};

		const scores: Record<Strategy, number> = {
			least1: correlatedOutcome.expectedLeast1,
			points: correlatedOutcome.expectedPoints,
			hits: correlatedOutcome.expectedHits,
		};

		for (const metric of AllStrategies) {
			const score = scores[metric];
			const current = bestSelections[metric];
			const scoredSelection = { selection, outcome: correlatedOutcome };
			if (!current || score > current.score + epsilon) {
				bestSelections[metric] = { score, selections: [scoredSelection] };
			} else if (Math.abs(score - current.score) <= epsilon) {
				current.selections.push(scoredSelection);
			}
		}
	}

	const bestScores: Record<Strategy, StrategyScore | null> = {
		least1: null,
		points: null,
		hits: null,
	};
	for (const metric of AllStrategies) {
		const best = bestSelections[metric];
		if (!best) continue;
		// For actual outcomes, aggregate over all tied best selections for full proportional credit.
		const aggregatedOutcome = aggregateSelectionOutcome(best.selections);
		if (!aggregatedOutcome) continue;
		bestScores[metric] = {
			score: best.score,
			outcome: aggregatedOutcome,
		};
	}

	return {
		topOutcome,
		bestScores,
	};
};

const round = (value: number, precision: number = 1): number => {
	const factor = 10 ** precision;
	return Math.round(value * factor) / factor;
};
const formatAuditStat = (bucket: AuditBucket): HistoricalAuditStat => {
	const totalPicks = bucket.tickets * 3;
	const hitPct = totalPicks === 0 ? 0 : (100 * bucket.totalHits) / totalPicks;
	const predictedHitPct = totalPicks === 0 ? 0 : (100 * bucket.expectedHits) / totalPicks;
	const ticketWinPct = bucket.tickets === 0 ? 0 : (100 * bucket.ticketWins) / bucket.tickets;
	const predictedTicketWinPct = bucket.tickets === 0 ? 0 : (100 * bucket.expectedTicketWins) / bucket.tickets;
	const avgPoints = bucket.tickets === 0 ? 0 : bucket.totalPoints / bucket.tickets;
	const predictedAvgPoints = bucket.tickets === 0 ? 0 : bucket.expectedPoints / bucket.tickets;
	return {
		tickets: bucket.tickets,
		hits: bucket.totalHits,
		totalPicks,
		hitPct,
		predictedHitPct,
		ticketWins: bucket.ticketWins,
		ticketWinPct,
		predictedTicketWinPct,
		avgPoints,
		predictedAvgPoints,
		ratio: `${round(bucket.totalHits)}/${totalPicks}`,
	};
};

const formatAuditPercent = (value: number): string => `${value.toFixed(2)}%`;
const formatAuditPoints = (value: number): string => value.toFixed(2);
const formatTicketRatio = (stat: HistoricalAuditStat): string => `${round(stat.ticketWins)}/${stat.tickets}`;

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

const formatMultiBookCIDiagnostics = (
	actual: number,
	total: number,
	entries: Array<{ book: LogStatsKey; stat: HistoricalAuditStat }>,
	getPredicted: (stat: HistoricalAuditStat) => number
): string[] => {
	const ci = calculateHitRateCI(actual, total);
	const bookDiagnostics = entries.map((entry) => {
		const predicted = getPredicted(entry.stat);
		const zScore = calculateZScore(actual, predicted, ci.se);
		const withinCI = predicted >= ci.lower && predicted <= ci.upper ? '✓' : '✗';
		return `${entry.book}(z=${zScore.toFixed(2)} pred=${predicted.toFixed(2)}% ${withinCI})`;
	});
	return [`[${ci.lower.toFixed(2)}%-${ci.upper.toFixed(2)}%]`, ...bookDiagnostics];
};

export const runHistoricalStrategyAudit = async (
	options: HistoricalAuditOptions
): Promise<HistoricalAuditResults> => {
	const {
		minSportsbooks,
		correlationFactor = 1,
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
				playerSets.set(String(list.id), new Map(list.players.map((player) => [player.nhlPlayerId, player])));
			}

			const gameStartTimes = await getGameStartTimeGroups(date);

			const findOne = true;
			for (let slotIndex = 0; slotIndex < gameStartTimes.length; slotIndex++) {
				try {
					const folderTime = gameStartTimes[slotIndex];

					const folder = `./data/${date}/${folderTime}`;
					const helper = await fetchOptionalJson<Record<'1' | '2' | '3', Picks.OddsItem[]>>(`${folder}/helper.json`);
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
					for (const sid of ['1', '2', '3'] as const) {
						const outcomes = playerSets.get(sid);
						if (!outcomes) continue;

						for (const item of helper[sid] ?? []) {
							const player = outcomes.get(Math.abs(item.playerId));
							if (!player) continue;

							const fullName = `${item.firstName} ${item.lastName}`;
							const candidates = [fullName, oddsNameMap.get(fullName)].filter((name): name is string => Boolean(name));
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

							rows.push({
								sid,
								team: player.team,
								opponent: player.opponent,
								scored: player.scored,
								bet1: probs[0],
								bet2: probs[1],
								bet3: probs[2],
								bet4: probs[3],
								betAvg: null,
								betCount: 0,
							});
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

					switch (slots) {
						case '1': if (gameCount !== 1) continue; break;
						case '2': if (gameCount !== 2) continue; break;
						case '3': if (gameCount !== 3) continue; break;
						default: if (gameCount < 4) continue;
					}

					const ref = correlations[slots];
					daysWithSlots.add(date);

					for (const bookKey of [...SportsbookKeys, 'betAvg'] as LogStatsKey[]) {
						const set1 = rows.filter((row) => row.sid === '1' && row[bookKey] !== null && row.betCount >= minSportsbooks);
						const set2 = rows.filter((row) => row.sid === '2' && row[bookKey] !== null && row.betCount >= minSportsbooks);
						const set3 = rows.filter((row) => row.sid === '3' && row[bookKey] !== null && row.betCount >= minSportsbooks);
						if (set1.length === 0 || set2.length === 0 || set3.length === 0) continue;

						const evaluation = evaluateBookCombos(set1, set2, set3, bookKey, ref, correlationFactor);
						if (!evaluation) continue;

						applyAuditOutcome(stats[bookKey].top, evaluation.topOutcome);

						for (const strategy of AllStrategies) {
							const result = evaluation.bestScores[strategy];
							if (result) applyAuditOutcome(stats[bookKey][strategy], result.outcome);
						}
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

	const results: HistoricalAuditResults = {
		bet1: {
			top: formatAuditStat(stats.bet1.top),
			least1: formatAuditStat(stats.bet1.least1),
			points: formatAuditStat(stats.bet1.points),
			hits: formatAuditStat(stats.bet1.hits),
		},
		bet2: {
			top: formatAuditStat(stats.bet2.top),
			least1: formatAuditStat(stats.bet2.least1),
			points: formatAuditStat(stats.bet2.points),
			hits: formatAuditStat(stats.bet2.hits),
		},
		bet3: {
			top: formatAuditStat(stats.bet3.top),
			least1: formatAuditStat(stats.bet3.least1),
			points: formatAuditStat(stats.bet3.points),
			hits: formatAuditStat(stats.bet3.hits),
		},
		bet4: {
			top: formatAuditStat(stats.bet4.top),
			least1: formatAuditStat(stats.bet4.least1),
			points: formatAuditStat(stats.bet4.points),
			hits: formatAuditStat(stats.bet4.hits),
		},
		betAvg: {
			top: formatAuditStat(stats.betAvg.top),
			least1: formatAuditStat(stats.betAvg.least1),
			points: formatAuditStat(stats.betAvg.points),
			hits: formatAuditStat(stats.betAvg.hits),
		},
	};

	if (correlationFactor <= 0) {
		for (const bookKey of Object.keys(auditLabels) as LogStatsKey[]) {
			const top = results[bookKey].top;
			results[bookKey].least1 = { ...top };
			results[bookKey].points = { ...top };
			results[bookKey].hits = { ...top };
		}
	}

	if (logResults) {
		const display = Object.fromEntries((Object.keys(auditLabels) as LogStatsKey[]).map((bookKey) => {
			const tickets = results[bookKey].top.tickets;
			const picks = results[bookKey].top.totalPicks;

			const table: Record<string, string> = {};
			table[`${StrategyLabels.least1} Top (${tickets}) Pred`] =
				`${formatAuditPercent(results[bookKey].top.ticketWinPct)} ` +
				`(${round(results[bookKey].top.ticketWins)}) ` +
				`${formatAuditPercent(results[bookKey].top.predictedTicketWinPct)}`;
			if (correlationFactor > 0) table[`${StrategyLabels.least1} L% (${tickets}) Pred`] =
				`${formatAuditPercent(results[bookKey].least1.ticketWinPct)} ` +
				`(${round(results[bookKey].least1.ticketWins)}) ` +
				`${formatAuditPercent(results[bookKey].least1.predictedTicketWinPct)}`;
			table[`${StrategyLabels.points} Top (${tickets}) Pred`] =
				`${formatAuditPoints(results[bookKey].top.avgPoints)} ` +
				`${formatAuditPoints(results[bookKey].top.predictedAvgPoints)}`;
			if (correlationFactor > 0) table[`${StrategyLabels.points} L% (${tickets}) Pred`] =
				`${formatAuditPoints(results[bookKey].points.avgPoints)} ` +
				`${formatAuditPoints(results[bookKey].points.predictedAvgPoints)}`;
			table[`${StrategyLabels.hits} Top (${picks}) Pred`] =
				`${formatAuditPercent(results[bookKey].top.hitPct)} ` +
				`(${round(results[bookKey].top.hits)}) ` +
				`${formatAuditPercent(results[bookKey].top.predictedHitPct)}`;
			if (correlationFactor > 0) table[`${StrategyLabels.hits} L% (${picks}) Pred`] =
				`${formatAuditPercent(results[bookKey].hits.hitPct)} ` +
				`(${round(results[bookKey].hits.hits)}) ` +
				`${formatAuditPercent(results[bookKey].hits.predictedHitPct)}`;
			return [
				auditLabels[bookKey], table
			];
		}));
		console.table(display);
		console.log(`Historical strategy audit: ${daysWithSlots.size} days`);
	}

	return results;
};

const titleForPoolKey = (poolKey: PoolSlots): string => {
	switch (poolKey) {
		case '1': return "1 Game Slots";
		case '2': return "2 Game Slots";
		case '3': return "3 Game Slots";
		case '4+': return "4+ Game Slots";
	}
};

export const comparePoolAccuracy = async (options: AnalyzeOptions): Promise<ComparePoolAccuracySummary> => {
	const { correlationFactor = 1, formatFilter = 'all', minSportsbooks } = options;

	console.log(
		`\nComparing top pick accuracy across game count pools:\n` +
		`Correlation factor = ${correlationFactor}\n` +
		`${GameType[formatFilter]}\n`
	);

	const pools: PoolSlots[] = ['1', '2', '3', '4+'];
	type PoolResults = Record<PoolSlots, HistoricalAuditResults>;
	const results: PoolResults = {} as PoolResults;
	for (const pool of pools) {
		results[pool] = {} as HistoricalAuditResults;
	}

	interface StrategyMetric {
		entries: Array<{ book: LogStatsKey; stat: HistoricalAuditStat }>;
		stat: HistoricalAuditStat
	};
	const getTopBooksForMetric = (
		poolResult: HistoricalAuditResults,
		column: StrategyMode,
		metric: (stat: HistoricalAuditStat) => number
	): StrategyMetric => {
		let bestBooks: LogStatsKey[] = [LogStatsKeys[0]];
		let bestValue = metric(poolResult[LogStatsKeys[0]][column]);

		for (let index = 1; index < LogStatsKeys.length; index++) {
			const book = LogStatsKeys[index];
			const stat = poolResult[book][column];
			const value = metric(stat);
			if (value > bestValue) {
				bestValue = value;
				bestBooks = [book];
			} else if (value === bestValue) {
				bestBooks.push(book);
			}
		}

		const entries = bestBooks.map((book) => ({ book, stat: poolResult[book][column] }));
		return { entries, stat: entries[0].stat };
	};

	const summarizeEntries = (
		entries: Array<{ book: LogStatsKey; stat: HistoricalAuditStat }>,
		metric: (stat: HistoricalAuditStat) => string
	) => entries.map((entry) => ({
		book: entry.book,
		predicted: metric(entry.stat),
	}));

	const summaryByPool = {} as ComparePoolAccuracySummary;

	for (const pool of pools) {
		console.log(`\n=== Pool ${titleForPoolKey(pool)} ===`);
		const auditResult = await runHistoricalStrategyAudit({
			minSportsbooks,
			correlationFactor: correlationFactor,
			formatFilter,
			slots: pool,
			logResults: true,
		});
		results[pool] = auditResult;
	}

	console.log(`\n\n=== Statistical Diagnostics: ${GameType[formatFilter]} ===`);
	console.log(" • 95% CI (Confidence Interval): The range where the true hit rate likely falls with 95% confidence");
	console.log("   ◦ Wider CI = smaller pool (more variance)");
	console.log("   ◦ Narrower CI = larger pool (more stable results)");
	console.log(" • Z-score: How many standard errors away from the predicted value");
	console.log("   ◦ Z > 1.96 or Z < -1.96: Statistically significant at 95% level");
	console.log("   ◦ Z between -1.96 and 1.96: Within expected random variance");
	console.log(" • ✓/✗: Whether the predicted value falls within the 95% CI");
	console.log("   ◦ ✓ = prediction is reasonable for the data");
	console.log("   ◦ ✗ = significant deviation from prediction");

	console.log(`\n\n=== Summary: ${GameType[formatFilter]}, L%=${correlationFactor} ===`);
	console.log('Top bet by pool and strategy:');
	for (const pool of pools) {
		const bestTopStreak = getTopBooksForMetric(results[pool], 'top', (stat) => stat.ticketWinPct);
		const bestTopPoints = getTopBooksForMetric(results[pool], 'top', (stat) => stat.avgPoints);
		const bestTopPickPct = getTopBooksForMetric(results[pool], 'top', (stat) => stat.hitPct);
		const bestCorrelatedStreak = getTopBooksForMetric(results[pool], 'least1', (stat) => stat.ticketWinPct);
		const bestCorrelatedPoints = getTopBooksForMetric(results[pool], 'points', (stat) => stat.avgPoints);
		const bestCorrelatedPickPct = getTopBooksForMetric(results[pool], 'hits', (stat) => stat.hitPct);

		const bestModeForWins: { mode: StrategyMode; result: { entries: Array<{ book: LogStatsKey; stat: HistoricalAuditStat }>; stat: HistoricalAuditStat } } = [
			{ mode: 'top' as const, result: getTopBooksForMetric(results[pool], 'top', (stat) => stat.ticketWinPct) },
			{ mode: 'least1' as const, result: getTopBooksForMetric(results[pool], 'least1', (stat) => stat.ticketWinPct) },
			{ mode: 'points' as const, result: getTopBooksForMetric(results[pool], 'points', (stat) => stat.ticketWinPct) },
			{ mode: 'hits' as const, result: getTopBooksForMetric(results[pool], 'hits', (stat) => stat.ticketWinPct) },
		].reduce((best, current) => {
			if (current.result.stat.ticketWinPct > best.result.stat.ticketWinPct) return current;
			return best;
		});

		const formatCI = (lines: string[], ci: string[]) => {
			const indent = "\n\t\t";
			return `\t${lines.join(" ")} CI ${ci.join(indent)}`;
		}
		const least1 = bestTopStreak.stat;
		const points = bestTopPoints.stat;
		const hits = bestTopPickPct.stat;
		const least1_c = bestCorrelatedStreak.stat;
		const points_c = bestCorrelatedPoints.stat;
		const hits_c = bestCorrelatedPickPct.stat;

		console.log(`Pool ${titleForPoolKey(pool)}:`);
		console.log(
			formatCI([
				`${StrategyLabels.least1} Top:`, `${least1.ticketWinPct.toFixed(2)}%`, `(${formatTicketRatio(least1)})`,
			], formatMultiBookCIDiagnostics(
				least1.ticketWinPct, least1.tickets, bestTopStreak.entries, (stat) => stat.predictedTicketWinPct
			))
		);
		if (correlationFactor > 0) console.log(
			formatCI([
				`${StrategyLabels.least1} L%:`, `${least1_c.ticketWinPct.toFixed(2)}%`, `(${formatTicketRatio(least1_c)})`,
			], formatMultiBookCIDiagnostics(
				least1_c.ticketWinPct, least1_c.tickets, bestCorrelatedStreak.entries, (stat) => stat.predictedTicketWinPct
			))
		);
		console.log(
			formatCI([
				`${StrategyLabels.points} Top:`, `${points.avgPoints.toFixed(2)}`, `(${points.tickets})`,
			], formatMultiBookCIDiagnostics(
				points.avgPoints, points.tickets, bestTopPoints.entries, (stat) => stat.predictedAvgPoints
			))
		);
		if (correlationFactor > 0) console.log(
			formatCI([
				`${StrategyLabels.points} L%:`, `${points_c.avgPoints.toFixed(2)}`, `(${points_c.tickets})`,
			], formatMultiBookCIDiagnostics(
				points_c.avgPoints, points_c.tickets, bestCorrelatedPoints.entries, (stat) => stat.predictedAvgPoints
			))
		);
		console.log(
			formatCI([
				`${StrategyLabels.hits} Top:`, `${hits.hitPct.toFixed(2)}%`, `(${hits.ratio})`,
			], formatMultiBookCIDiagnostics(
				hits.hitPct, hits.totalPicks, bestTopPickPct.entries, (stat) => stat.predictedHitPct
			))
		);
		if (correlationFactor > 0) console.log(
			formatCI([
				`${StrategyLabels.hits} L%:`, `${hits_c.hitPct.toFixed(2)}%`, `(${hits_c.ratio})`,
			], formatMultiBookCIDiagnostics(
				hits_c.hitPct, hits_c.totalPicks, bestCorrelatedPickPct.entries, (stat) => stat.predictedHitPct
			))
		);

		const recommendedForWins = {
			mode: bestModeForWins.mode,
			books: bestModeForWins.result.entries.map((entry) => entry.book),
			actualTicketWinPct: bestModeForWins.result.stat.ticketWinPct,
			predictedByBook: summarizeEntries(bestModeForWins.result.entries, (stat) => `${stat.predictedTicketWinPct.toFixed(2)}%`),
			ticketRatio: formatTicketRatio(bestModeForWins.result.stat),
			tickets: bestModeForWins.result.stat.tickets,
		};

		summaryByPool[pool] = {
			recommendedForWins,
			topWin: {
				books: bestTopStreak.entries.map((entry) => entry.book),
				actualTicketWinPct: bestTopStreak.stat.ticketWinPct,
				predictedByBook: summarizeEntries(bestTopStreak.entries, (stat) => `${stat.predictedTicketWinPct.toFixed(2)}%`),
				ticketRatio: formatTicketRatio(bestTopStreak.stat),
				tickets: bestTopStreak.stat.tickets,
			},
			correlatedWin: {
				books: bestCorrelatedStreak.entries.map((entry) => entry.book),
				actualTicketWinPct: bestCorrelatedStreak.stat.ticketWinPct,
				predictedByBook: summarizeEntries(bestCorrelatedStreak.entries, (stat) => `${stat.predictedTicketWinPct.toFixed(2)}%`),
				ticketRatio: formatTicketRatio(bestCorrelatedStreak.stat),
				tickets: bestCorrelatedStreak.stat.tickets,
			},
			topPoints: {
				books: bestTopPoints.entries.map((entry) => entry.book),
				actualAvgPoints: bestTopPoints.stat.avgPoints,
				predictedByBook: summarizeEntries(bestTopPoints.entries, (stat) => stat.predictedAvgPoints.toFixed(2)),
				tickets: bestTopPoints.stat.tickets,
			},
			correlatedPoints: {
				books: bestCorrelatedPoints.entries.map((entry) => entry.book),
				actualAvgPoints: bestCorrelatedPoints.stat.avgPoints,
				predictedByBook: summarizeEntries(bestCorrelatedPoints.entries, (stat) => stat.predictedAvgPoints.toFixed(2)),
				tickets: bestCorrelatedPoints.stat.tickets,
			},
			topPickPct: {
				books: bestTopPickPct.entries.map((entry) => entry.book),
				actualHitPct: bestTopPickPct.stat.hitPct,
				predictedByBook: summarizeEntries(bestTopPickPct.entries, (stat) => `${stat.predictedHitPct.toFixed(2)}%`),
				ratio: bestTopPickPct.stat.ratio,
			},
			correlatedPickPct: {
				books: bestCorrelatedPickPct.entries.map((entry) => entry.book),
				actualHitPct: bestCorrelatedPickPct.stat.hitPct,
				predictedByBook: summarizeEntries(bestCorrelatedPickPct.entries, (stat) => `${stat.predictedHitPct.toFixed(2)}%`),
				ratio: bestCorrelatedPickPct.stat.ratio,
			},
		};
	}

	return summaryByPool;
};

class StrategyType {
	key: Strategy;
	correlationRatio: number;
	books: LogStatsKey[];
	constructor(strategy: Strategy, correlationRatio: number = 1, books: LogStatsKey[] = []) {
		this.key = strategy;
		this.correlationRatio = correlationRatio;
		this.books = books;
	}
}
interface BestPicksResult {
	"1": Picks.PickOdds,
	"2": Picks.PickOdds,
	"3": Picks.PickOdds,
	strategies: Set<StrategyType>,
	rankedBy?: 'top' | 'strategies' | 'least1' | 'hits' | 'points' | 'ratio' | 'corrLean' | 'consensus' | 'xg' | 'tied';
	isTied?: boolean;
}

export const resolvePoolKey = (gameCount: number): PoolSlots => {
	if (gameCount <= 1) return '1';
	if (gameCount === 2) return '2';
	if (gameCount === 3) return '3';
	return '4+';
}

const getPlayerStrategy = (pick1: Picks.Player, pick2: Picks.Player, pick3: Picks.Player): ComboPattern | null => {
	if (!pick1.sameGame(pick2) && !pick2.sameGame(pick3) && !pick1.sameGame(pick3)) return 'iii';
	if (pick1.sameTeam(pick2) && pick2.sameTeam(pick3)) return 'sss';

	if (pick2.sameTeam(pick3) && !pick1.sameGame(pick2)) return 'iss';
	if (pick1.sameTeam(pick3) && !pick2.sameGame(pick1)) return 'sis';
	if (pick1.sameTeam(pick2) && !pick3.sameGame(pick1)) return 'ssi';

	if (pick2.opponentTeam(pick3) && !pick1.sameGame(pick2)) return 'ioo';
	if (pick1.opponentTeam(pick3) && !pick2.sameGame(pick1)) return 'oio';
	if (pick1.opponentTeam(pick2) && !pick3.sameGame(pick1)) return 'ooi';

	if (pick1.sameTeam(pick2) && pick3.opponentTeam(pick1)) return 'oso';
	if (pick1.sameTeam(pick2) && pick3.opponentTeam(pick2)) return 'soo';
	if (pick1.sameTeam(pick3) && pick1.opponentTeam(pick2)) return 'sos';
	if (pick2.sameTeam(pick3) && pick1.opponentTeam(pick2)) return 'oss';

	return null;
};

const comboCode = (combo: Pick<BestPicksResult, "1" | "2" | "3">): string => `${combo["1"].player.playerId}:${combo["2"].player.playerId}:${combo["3"].player.playerId}`;

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
	const ref = correlations[poolKey];
	const correlationFactor = options?.correlationFactor ?? 1;
	const { minSportsbooks } = options;
	const epsilon = 1e-12;
	const xgMap = await getXgMap();

	// Run once using the requested analysis options.
	const summary = await comparePoolAccuracy(options);

	// For each strategy, decide: use top or correlated? Calculate correlation ratio.
	interface StrategyConfig {
		books: LogStatsKey[];
		correlationFactor: number;
		correlationRatio: number;
	}
	const strategyConfig: Record<Strategy, StrategyConfig | null> = {
		least1: null,
		points: null,
		hits: null,
	};

	// Compare and decide for each strategy
	for (const strategy of AllStrategies) {
		let topBooks: LogStatsKey[];
		let topScore: number;
		let corrBooks: LogStatsKey[];
		let corrScore: number;

		if (strategy === 'least1') {
			topBooks = summary[poolKey].topWin.books;
			topScore = summary[poolKey].topWin.actualTicketWinPct;
			corrBooks = summary[poolKey].correlatedWin.books;
			corrScore = summary[poolKey].correlatedWin.actualTicketWinPct;
		} else if (strategy === 'points') {
			topBooks = summary[poolKey].topPoints.books;
			topScore = summary[poolKey].topPoints.actualAvgPoints;
			corrBooks = summary[poolKey].correlatedPoints.books;
			corrScore = summary[poolKey].correlatedPoints.actualAvgPoints;
		} else { // hits
			topBooks = summary[poolKey].topPickPct.books;
			topScore = summary[poolKey].topPickPct.actualHitPct;
			corrBooks = summary[poolKey].correlatedPickPct.books;
			corrScore = summary[poolKey].correlatedPickPct.actualHitPct;
		}

		// Use correlated only if correlation is enabled and it improves the result.
		if (correlationFactor > 0 && corrScore > topScore + epsilon) {
			strategyConfig[strategy] = {
				books: corrBooks,
				correlationFactor: correlationFactor,
				correlationRatio: topScore <= epsilon ? 1 : corrScore / topScore,
			};
		} else {
			strategyConfig[strategy] = {
				books: topBooks,
				correlationFactor: 0,
				correlationRatio: 1,
			};
		}
	}

	const bestByStrategyAndBooks: Record<Strategy, Map<string, { combo: Pick<BestPicksResult, "1" | "2" | "3">; ratio: number }>> = {
		least1: new Map(),
		points: new Map(),
		hits: new Map(),
	};

	// Find best combos for each strategy using its decided configuration
	for (const strategy of AllStrategies) {
		const config = strategyConfig[strategy];
		if (!config) continue;
		const candidateBooks = config.books;
		const scaleCorrelation = (value: number | null): number => (((value ?? 1) - 1) * config.correlationFactor) + 1;

		let bestScore = Number.NEGATIVE_INFINITY;
		const bestCombos = new Map<string, Pick<BestPicksResult, "1" | "2" | "3">>();

		for (const book of candidateBooks) {
			const candidates: SelectionCandidate<Picks.PickOdds>[] = [];
			for (const pick1 of picks1) {
				const prob1 = pick1.player[book];
				if (prob1 === null || pick1.player.betCount < minSportsbooks) continue;
				for (const pick2 of picks2) {
					const prob2 = pick2.player[book];
					if (prob2 === null || pick2.player.betCount < minSportsbooks) continue;
					for (const pick3 of picks3) {
						const prob3 = pick3.player[book];
						if (prob3 === null || pick3.player.betCount < minSportsbooks) continue;

						candidates.push({
							pick1,
							pick2,
							pick3,
							prob1,
							prob2,
							prob3,
							strategy: getPlayerStrategy(pick1.player, pick2.player, pick3.player),
						});
					}
				}
			}

			const { strategies } = selectStrategyCombos(candidates);
			for (const [strategyCode, combos] of strategies) {
				const selection = combos.merge();
				if (!selection) continue;

				const least1Scale = scaleCorrelation(ref.least1[strategyCode]);
				const pointsScale = scaleCorrelation(ref.points[strategyCode]);
				const hitsScale = scaleCorrelation(ref.hits[strategyCode]);

				const score = strategy === 'least1'
					? calcAny(selection.prob1, selection.prob2, selection.prob3) * least1Scale
					: strategy === 'points'
						? calcPnt(selection.prob1, selection.prob2, selection.prob3) * pointsScale
						: calcHit(selection.prob1, selection.prob2, selection.prob3) * hitsScale;

				if (score > bestScore + epsilon) {
					bestScore = score;
					bestCombos.clear();
					for (const combo of selection.combos) {
						const resultCombo: Pick<BestPicksResult, "1" | "2" | "3"> = { "1": combo.pick1, "2": combo.pick2, "3": combo.pick3 };
						bestCombos.set(comboCode(resultCombo), resultCombo);
					}
				} else if (Math.abs(score - bestScore) <= epsilon) {
					for (const combo of selection.combos) {
						const resultCombo: Pick<BestPicksResult, "1" | "2" | "3"> = { "1": combo.pick1, "2": combo.pick2, "3": combo.pick3 };
						bestCombos.set(comboCode(resultCombo), resultCombo);
					}
				}
			}
		}

		// Store with correlation ratio
		for (const [code, combo] of bestCombos) {
			bestByStrategyAndBooks[strategy].set(`${candidateBooks.join(',')}:${code}`, {
				combo,
				ratio: config.correlationRatio,
			});
		}
	}

	// Merge results: same combo might work for multiple strategies with different books/ratios
	const merged = new Map<string, { combo: Pick<BestPicksResult, "1" | "2" | "3">; strategies: Map<Strategy, { ratio: number; books: LogStatsKey[] }> }>();
	for (const strategy of AllStrategies) {
		const config = strategyConfig[strategy];
		if (!config) continue;
		for (const { combo, ratio } of bestByStrategyAndBooks[strategy].values()) {
			const code = comboCode(combo);
			const existing = merged.get(code);
			if (existing) {
				existing.strategies.set(strategy, { ratio, books: config.books });
			} else {
				const strategies = new Map<Strategy, { ratio: number; books: LogStatsKey[] }>();
				strategies.set(strategy, { ratio, books: config.books });
				merged.set(code, { combo, strategies });
			}
		}
	}

	const results: BestPicksResult[] = [];
	for (const { combo, strategies } of merged.values()) {
		results.push({
			...combo,
			strategies: new Set([...strategies.entries()].map(([strat, { ratio, books }]) => new StrategyType(strat, ratio, books))),
			rankedBy: undefined,
			isTied: false,
		});
	}

	/*
		1. More agreeing strategies (strategies.size)
		2. Higher least1 (streak) tie score
		3. Higher hits tie score
		4. Higher points tie score
		5. Higher average correlation ratio
		6. Higher correlation lean (pool strategy model)
		7. Higher book consensus (favored by more books)
		8. Higher average team xG
	*/
	type SlotKey = '1' | '2' | '3';
	const sportsbookKeys = [...SportsbookKeys] as LogStatsKey[];

	const favoredBooksByPlayer = (slotPicks: Picks.PickOdds[]): Map<number, number> => {
		const supportedByBook = new Map<number, number>();
		for (const book of sportsbookKeys) {
			let bestProb = Number.NEGATIVE_INFINITY;
			const bestPlayers = new Set<number>();

			for (const pick of slotPicks) {
				if (pick.player.betCount < minSportsbooks) continue;
				const prob = pick.player[book];
				if (prob === null) continue;

				if (prob > bestProb + epsilon) {
					bestProb = prob;
					bestPlayers.clear();
					bestPlayers.add(pick.player.playerId);
				} else if (Math.abs(prob - bestProb) <= epsilon) {
					bestPlayers.add(pick.player.playerId);
				}
			}

			for (const playerId of bestPlayers) {
				supportedByBook.set(playerId, (supportedByBook.get(playerId) ?? 0) + 1);
			}
		}
		return supportedByBook;
	};

	const supportBySlot: Record<SlotKey, Map<number, number>> = {
		'1': favoredBooksByPlayer(picks1),
		'2': favoredBooksByPlayer(picks2),
		'3': favoredBooksByPlayer(picks3),
	};
	const metricForBook = (combo: Pick<BestPicksResult, "1" | "2" | "3">, book: LogStatsKey, strategy: Strategy): number | null => {
		const odd1 = combo['1'].player[book];
		if (odd1 === null) return null;
		const odd2 = combo['2'].player[book];
		if (odd2 === null) return null;
		const odd3 = combo['3'].player[book];
		if (odd3 === null) return null;

		if (strategy === 'least1') return calcAny(odd1, odd2, odd3);
		if (strategy === 'points') return calcPnt(odd1, odd2, odd3);
		return calcHit(odd1, odd2, odd3) / 3;
	};

	const strategyTieScore = (result: BestPicksResult, strategy: Strategy): number => {
		let strategyType: StrategyType | undefined;
		for (const item of result.strategies) {
			if (item.key === strategy) {
				strategyType = item;
				break;
			}
		}
		if (!strategyType) return Number.NEGATIVE_INFINITY;

		let bestMetric = Number.NEGATIVE_INFINITY;
		for (const book of strategyType.books) {
			const metric = metricForBook(result, book, strategy);
			if (metric === null) continue;
			if (metric > bestMetric) bestMetric = metric;
		}
		if (bestMetric === Number.NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;

		return bestMetric * strategyType.correlationRatio;
	};

	const averageCorrelationRatio = (result: BestPicksResult): number => {
		let total = 0;
		let count = 0;
		for (const strategyType of result.strategies) {
			total += strategyType.correlationRatio;
			count++;
		}
		return count === 0 ? 0 : total / count;
	};

	const averageTeamXg = (result: BestPicksResult): number => {
		const xg1 = xgMap.get(result['1'].player.team.code as Team) ?? 0;
		const xg2 = xgMap.get(result['2'].player.team.code as Team) ?? 0;
		const xg3 = xgMap.get(result['3'].player.team.code as Team) ?? 0;
		return (xg1 + xg2 + xg3) / 3;
	};

	const averageBookConsensus = (result: BestPicksResult): number => {
		const support1 = supportBySlot['1'].get(result['1'].player.playerId) ?? 0;
		const support2 = supportBySlot['2'].get(result['2'].player.playerId) ?? 0;
		const support3 = supportBySlot['3'].get(result['3'].player.playerId) ?? 0;
		return (support1 + support2 + support3) / 3;
	};

	const averageCorrelationLean = (result: BestPicksResult): number => {
		const comboStrategy = getPlayerStrategy(result['1'].player, result['2'].player, result['3'].player);
		if (!comboStrategy) return 1;

		let total = 0;
		let weightTotal = 0;
		for (const strategyType of result.strategies) {
			const modelValue = ref[strategyType.key][comboStrategy];
			const scaled = (((modelValue ?? 1) - 1) * correlationFactor) + 1;
			const weight = Math.max(1, strategyType.books.length);
			total += scaled * weight;
			weightTotal += weight;
		}
		return weightTotal === 0 ? 1 : total / weightTotal;
	};

	const compareDesc = (left: number, right: number): number => {
		if (left > right) return -1;
		if (left < right) return 1;
		return 0;
	};

	type RankMetrics = {
		strategyCount: number;
		least1: number;
		hits: number;
		points: number;
		ratio: number;
		corrLean: number;
		consensus: number;
		xg: number;
	};

	const toMetrics = (result: BestPicksResult): RankMetrics => ({
		strategyCount: result.strategies.size,
		least1: strategyTieScore(result, 'least1'),
		hits: strategyTieScore(result, 'hits'),
		points: strategyTieScore(result, 'points'),
		ratio: averageCorrelationRatio(result),
		corrLean: averageCorrelationLean(result),
		consensus: averageBookConsensus(result),
		xg: averageTeamXg(result),
	});

	const metricsEqual = (left: RankMetrics, right: RankMetrics): boolean => {
		return left.strategyCount === right.strategyCount
			&& Math.abs(left.least1 - right.least1) <= epsilon
			&& Math.abs(left.hits - right.hits) <= epsilon
			&& Math.abs(left.points - right.points) <= epsilon
			&& Math.abs(left.ratio - right.ratio) <= epsilon
			&& Math.abs(left.corrLean - right.corrLean) <= epsilon
			&& Math.abs(left.consensus - right.consensus) <= epsilon
			&& Math.abs(left.xg - right.xg) <= epsilon;
	};

	const rankReasonVsPrevious = (current: RankMetrics, previous: RankMetrics): BestPicksResult['rankedBy'] => {
		if (current.strategyCount !== previous.strategyCount) return 'strategies';
		if (Math.abs(current.least1 - previous.least1) > epsilon) return 'least1';
		if (Math.abs(current.hits - previous.hits) > epsilon) return 'hits';
		if (Math.abs(current.points - previous.points) > epsilon) return 'points';
		if (Math.abs(current.ratio - previous.ratio) > epsilon) return 'ratio';
		if (Math.abs(current.corrLean - previous.corrLean) > epsilon) return 'corrLean';
		if (Math.abs(current.consensus - previous.consensus) > epsilon) return 'consensus';
		if (Math.abs(current.xg - previous.xg) > epsilon) return 'xg';
		return 'tied';
	};

	const ranked = results.map((result, originalIndex) => ({
		result,
		originalIndex,
		metrics: toMetrics(result),
	}));

	// Sort by ranking priority. If fully tied, preserve original insertion order.
	ranked.sort((left, right) => {
		if (right.metrics.strategyCount !== left.metrics.strategyCount) return right.metrics.strategyCount - left.metrics.strategyCount;

		const least1Compare = compareDesc(left.metrics.least1, right.metrics.least1);
		if (least1Compare !== 0) return least1Compare;

		const hitsCompare = compareDesc(left.metrics.hits, right.metrics.hits);
		if (hitsCompare !== 0) return hitsCompare;

		const pointsCompare = compareDesc(left.metrics.points, right.metrics.points);
		if (pointsCompare !== 0) return pointsCompare;

		const ratioCompare = compareDesc(left.metrics.ratio, right.metrics.ratio);
		if (ratioCompare !== 0) return ratioCompare;

		const corrLeanCompare = compareDesc(left.metrics.corrLean, right.metrics.corrLean);
		if (corrLeanCompare !== 0) return corrLeanCompare;

		const consensusCompare = compareDesc(left.metrics.consensus, right.metrics.consensus);
		if (consensusCompare !== 0) return consensusCompare;

		const xgCompare = compareDesc(left.metrics.xg, right.metrics.xg);
		if (xgCompare !== 0) return xgCompare;

		return left.originalIndex - right.originalIndex;
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
		const name = book === 'betAvg' ? 'Average' : Sportsbooks[book].title;
		return makeTitle(`${name}`);
	}

	console.log(makeTitle(`*** Best Picks ${titleForPoolKey(poolKey)} ***`));
	const rankOrder: Array<Exclude<BestPicksResult['rankedBy'], undefined>> = [
		'top',
		'strategies',
		'least1',
		'hits',
		'points',
		'ratio',
		'corrLean',
		'consensus',
		'xg',
		'tied',
	];
	const rankCounts: Record<Exclude<BestPicksResult['rankedBy'], undefined>, number> = {
		top: 0,
		strategies: 0,
		least1: 0,
		hits: 0,
		points: 0,
		ratio: 0,
		corrLean: 0,
		consensus: 0,
		xg: 0,
		tied: 0,
	};
	for (const result of results) {
		if (result.rankedBy) rankCounts[result.rankedBy]++;
	}

	let tieEntries = 0;
	for (const group of tieGroupByIndex) {
		if (group !== null) tieEntries++;
	}

	const rankReasonLabel: Record<Exclude<BestPicksResult['rankedBy'], undefined>, string> = {
		top: 'Highest overall rank',
		strategies: 'More strategy matches',
		least1: 'Higher least1 score (streak)',
		hits: 'Higher hits score',
		points: 'Higher points score',
		ratio: 'Higher correlation ratio',
		corrLean: 'Higher correlation lean (pool strategy model)',
		consensus: 'Higher book consensus (favored by more books)',
		xg: 'Higher average team xG',
		tied: 'Fully tied on all rank metrics (original order kept)',
	};

	console.log('Rank summary:');
	console.log(` • Total results: ${results.length}`);
	console.log(` • Tied entries: ${tieEntries} (results tied with at least one adjacent result)`);
	console.log(` • Tie groups: ${tieGroupCount} (contiguous clusters of fully-equal ranked results)`);
	console.log(' • Rank decision counts:');
	for (const rank of rankOrder) {
		const count = rankCounts[rank];
		if (count > 0) console.log(`   - ${rankReasonLabel[rank]}: ${count}`);
	}

	for (const [resultIndex, result] of results.entries()) {
		const bets: Map<LogStatsKey, number> = new Map();
		const strategies: Set<Strategy> = new Set();
		for (const strategy of result.strategies) {
			for (const book of strategy.books) bets.set(book, strategy.correlationRatio);
			strategies.add(strategy.key);
		}

		for (const [bet, correlation] of bets) {
			console.log(`${bookName(bet)}`);
			console.log(`${correlation.toFixed(3)}x correlation`);
			console.log(`Correlation lean: ${toMetrics(result).corrLean.toFixed(3)}x`);
			if (result.rankedBy) {
				const tieGroup = tieGroupByIndex[resultIndex];
				const tieSuffix = tieGroup !== null ? ` | tie group #${tieGroup}` : '';
				console.log(`→ Rank reason: ${rankReasonLabel[result.rankedBy]}${tieSuffix}`);
			}
			console.log(`1: ${format(result['1'], bet)}`);
			console.log(`2: ${format(result['2'], bet)}`);
			console.log(`3: ${format(result['3'], bet)}`);

			const odd1 = result['1'].player[bet];
			if (odd1 === null) continue;
			const odd2 = result['2'].player[bet];
			if (odd2 === null) continue;
			const odd3 = result['3'].player[bet];
			if (odd3 === null) continue;

			const anyValue = calcAny(odd1, odd2, odd3) * correlation;
			const pntValue = calcPnt(odd1, odd2, odd3) * correlation;
			const hitValue = calcHit(odd1, odd2, odd3) / 3 * correlation;

			const comboPrecision = 2;
			const any = roundToPercent(anyValue, comboPrecision);
			const pnt = pntValue.toFixed(comboPrecision);
			const hit = roundToPercent(hitValue, comboPrecision);

			const anyBold = strategies.has('least1') ? '*' : '';
			const pntBold = strategies.has('points') ? '*' : '';
			const hitBold = strategies.has('hits') ? '*' : '';

			console.log(`${anyBold}${StrategyLabels.least1}: ${any}`);
			console.log(`${pntBold}${StrategyLabels.points}: ${pnt}`);
			console.log(`${hitBold}${StrategyLabels.hits}: ${hit}`);
		}
	}

	return results;
}

export const runSimulation = async (iterations: number) => {
	const response = await fetch('./history/history.json');
	const data = await response.json();

	class PickIndex {
		readonly slotTotal: number;
		readonly slotIndex: number;
		readonly gameCount: number;
		constructor(slotTotal: number, slotIndex: number, gameCount: number) {
			this.slotTotal = slotTotal;
			this.slotIndex = slotIndex;
			this.gameCount = gameCount;
		}
	}
	const codeForIndex = (slotTotal: number, slotIndex: number, gameCount: number) => {
		return `${slotTotal} ${slotIndex} ${gameCount}`;
	}
	const indexes: Map<string, PickIndex> = new Map();

	class GameResult {
		randomResults = new ResultTotal();
		strategyResults: Map<ComboPattern, ResultTotal> = new Map();

		constructor() {
			for (const strategy of AllCombos) {
				this.strategyResults.set(strategy, new ResultTotal());
			}
		}
	}

	const gameResults: Map<PickIndex, GameResult> = new Map();

	for (const item of data) {
		// if (item.format !== 'regular') continue;
		for (const file of item.files) {
			const response = await fetch(`./history/${file}`);
			const fileData = await response.json();

			const slotTotal = fileData.availableTimes.length;
			for (let slotIndex = 0; slotIndex < slotTotal; slotIndex++) {
				const availableTime = fileData.availableTimes[slotIndex];

				const set1: Map<number, HistoryPlayer> = new Map();
				const set2: Map<number, HistoryPlayer> = new Map();
				const set3: Map<number, HistoryPlayer> = new Map();
				const teams = new Set<string>();
				let gameCount = 0;
				for (const playerList of fileData.playerLists) {
					const set = playerList.id === 1 ? set1 : playerList.id === 2 ? set2 : set3;
					for (const player of playerList.players) {
						const playsAtTime = player.availableTimes.includes(availableTime);
						if (!playsAtTime) continue;

						set.set(player.nhlPlayerId, player);
						if (!teams.has(player.team)) {
							gameCount++;
							teams.add(player.team);
							teams.add(player.opponent);
						}
					}
				}

				if (set1.size === 0 || set2.size === 0 || set3.size === 0) continue;

				const indexKey = codeForIndex(slotTotal, slotIndex, gameCount);
				let index = indexes.get(indexKey);
				if (!index) {
					index = new PickIndex(slotTotal, slotIndex, gameCount);
					indexes.set(indexKey, index);
				}
				let gameResult = gameResults.get(index);
				if (!gameResult) {
					gameResult = new GameResult();
					gameResults.set(index, gameResult);
				}

				const array1 = Array.from(set1.values());
				const array2 = Array.from(set2.values());
				const array3 = Array.from(set3.values());

				for (let i = 0; i < iterations; i++) {
					const resultRandom = simulateRandom(array1, array2, array3);
					if (resultRandom !== null) gameResult.randomResults.add(resultRandom);
					for (const [type, strategy] of gameResult.strategyResults) {
						const result = simulateCombo(array1, array2, array3, type);
						if (result !== null) strategy.add(result);
					}
				}
			}
		}
	}

	const compile = (): CorrelationResults => {
		const results: SimItem[] = [];
		for (const [index, result] of gameResults) {
			const totals = {} as SimTotal;
			totals.random = { ...result.randomResults };
			for (const [type, strategy] of result.strategyResults) {
				totals[type] = { ...strategy };
			}

			results.push({
				totals,
				...index
			});
		}
		return compileSimItems(results);
	}

	return compile();
}
