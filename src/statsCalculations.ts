import * as Picks from './components/Table';
import { roundToPercent } from './utility';
import type { Team } from './components/logo';
import { correlations, type CorrelationResult } from './picksOptimizer';
import { LogStatsKeys, sportsbooks } from './sportsbookTypes';
import type { LogStatsKey, LogLines, LogLine, LogStatAlign, SportsbookLog } from './sportsbookTypes';


const precision = Picks.precision;


export const cloneLogStats = (stats: SportsbookLog): SportsbookLog => {
	const cache = {} as SportsbookLog;
	for (const key of LogStatsKeys) {
		cache[key] = stats[key].map((stat) => stat.map((line) => ({ ...line })));
	}
	return cache;
};

const allStrategies = [
	'iii', 'sss',
	'iss', 'sis', 'ssi',
	'ioo', 'oio', 'ooi',
	'oso', 'soo', 'sos', 'oss'
] as const;
type strategyPattern = typeof allStrategies[number];

class LogHandler {
	logSection: LogLine[];
	stats: LogLines;
	constructor(stats: LogLines) {
		this.stats = stats;
		this.logSection = [];
		this.stats.push(this.logSection);
	}
	addSection = () => {
		if (this.logSection.length === 0) return;
		this.logSection = [];
		this.stats.push(this.logSection);
	}
	addTitle = (title: string) => {
		this.addSection();
		this.logSection.push({ text: title, align: 'center', bold: true, title: true });
		this.addSection();
	}
	addLine = (line: string = "\n", align: LogStatAlign = "left", bold: boolean = false) => {
		this.logSection.push({ text: line, align, bold, title: false });
	}
	addLogLine = (line: LogLine) => {
		this.logSection.push(line);
	}
}
export const calculateStats = (
	betKey: LogStatsKey,
	minSportsbooks: number,
	table1Rows: Picks.PickOdds[],
	table2Rows: Picks.PickOdds[],
	table3Rows: Picks.PickOdds[],
	stats: LogLines,
	factor: number = 1
): void => {
	const logHandler = new LogHandler(stats);

	const addPlayersToHighlight = (players: Set<Picks.PickOdds>) => {
		for (const pick of players) {
			if (betKey === 'bet1') pick.highlight1 = true;
			else if (betKey === 'bet2') pick.highlight2 = true;
			else if (betKey === 'bet3') pick.highlight3 = true;
			else if (betKey === 'bet4') pick.highlight4 = true;
			else pick.highlightAvg = true;
		}
	};

	const printName = (player: Picks.Player) => `${player.fullName} (${player.team.code})`;
	const names = (players: Set<Picks.PickOdds>, shortTab: boolean = false) => {
		const names: string[] = [];
		for (const pick of players) names.push(printName(pick.player));
		return names.join(shortTab ? "\n   " : "\n           ");
	}

	class Choice {
		prob: number;
		pick: Picks.PickOdds;
		constructor(pick: Picks.PickOdds, prob: number) {
			this.prob = prob;
			this.pick = pick;
		}
	}

	const makeChoices = (list: Picks.PickOdds[]): Choice[] => {
		const choices: Choice[] = [];
		for (const row of list) {
			const avg = row.player[betKey];
			if (avg === null) continue;
			if (row.player.betCount < minSportsbooks) continue;
			choices.push(new Choice(row, avg));
		}
		return choices;
	};

	const choices1: Choice[] = makeChoices(table1Rows);
	const choices2: Choice[] = makeChoices(table2Rows);
	const choices3: Choice[] = makeChoices(table3Rows);

	interface BestCombo {
		pick1: Choice;
		pick2: Choice;
		pick3: Choice;
	}

	const calcAny = (prob1: number, prob2: number, prob3: number): number => {
		return 1 - (1 - prob1) * (1 - prob2) * (1 - prob3);
	}
	const calcPnt = (prob1: number, prob2: number, prob3: number): number => {
		const not1 = 1 - prob1;
		const not2 = 1 - prob2;
		const not3 = 1 - prob3;
		const p1 = prob1 * not2 * not3 + not1 * prob2 * not3 + not1 * not2 * prob3;
		const p2 = prob1 * prob2 * not3 + prob1 * not2 * prob3 + not1 * prob2 * prob3;
		const p3 = prob1 * prob2 * prob3;
		return p1 * 25 + p2 * 50 + p3 * 100;
	}
	const calcHit = (prob1: number, prob2: number, prob3: number): number => {
		return prob1 + prob2 + prob3;
	}
	class Result {
		players1: Set<Picks.PickOdds>;
		players2: Set<Picks.PickOdds>;
		players3: Set<Picks.PickOdds>;
		prob1: number;
		prob2: number;
		prob3: number;

		least1: number;
		points: number;
		hits: number;

		constructor(combo: BestCombo) {
			this.players1 = new Set([combo.pick1.pick]);
			this.players2 = new Set([combo.pick2.pick]);
			this.players3 = new Set([combo.pick3.pick]);
			this.prob1 = combo.pick1.prob;
			this.prob2 = combo.pick2.prob;
			this.prob3 = combo.pick3.prob;

			this.least1 = calcAny(this.prob1, this.prob2, this.prob3);
			this.points = calcPnt(this.prob1, this.prob2, this.prob3);
			this.hits = calcHit(this.prob1, this.prob2, this.prob3);
		}
		merge(combo: BestCombo): void {
			this.players1.add(combo.pick1.pick);
			this.players2.add(combo.pick2.pick);
			this.players3.add(combo.pick3.pick);
		}

		// Scale correlation effect with linear interpolation:
		// factor=0 => no effect, factor=1 => full effect, factor>1 => amplified effect.
		correlate(strategy: strategyPattern, ref: CorrelationResult): void {
			const least1 = ref.least1[strategy];
			if (least1 !== null) this.least1 *= (least1 - 1) * factor + 1;
			const points = ref.points[strategy];
			if (points !== null) this.points *= (points - 1) * factor + 1;
			const hits = ref.hits[strategy];
			if (hits !== null) this.hits *= (hits - 1) * factor + 1;
		}
	}

	class ComboGroup {
		combos: BestCombo[] = [];
		prob1: number = 0;
		prob2: number = 0;
		prob3: number = 0;
		add(pick1: Choice, pick2: Choice, pick3: Choice) {
			const max1 = pick1.prob >= this.prob1;
			if (!max1) return;
			const max2 = pick2.prob >= this.prob2;
			if (!max2) return;
			const max3 = pick3.prob >= this.prob3;
			if (!max3) return;
			if (pick1.prob > this.prob1 || pick2.prob > this.prob2 || pick3.prob > this.prob3) {
				this.combos.splice(0, this.combos.length, { pick1, pick2, pick3 });
				this.prob1 = pick1.prob;
				this.prob2 = pick2.prob;
				this.prob3 = pick3.prob;
				return;
			}
			this.combos.push({ pick1, pick2, pick3 });
		}
		merge(): Result | null {
			let prev: Result | null = null;
			for (const combo of this.combos) {
				if (prev) prev.merge(combo);
				else prev = new Result(combo);
			}
			return prev;
		}
	}

	/*	
		iii = independent
		sss = stacked
		iss = stacked + independent
		sis = stacked + independent
		ssi = stacked + independent
		ioo = opposing + independent
		oio = opposing + independent
		ooi = opposing + independent
		oso = ss + o to 1
		soo = ss + o to 2
		sos = oo + s as 1
		oss = oo + s as 2
	*/

	const strategyTitle = (strategy: strategyPattern): string => {
		if (strategy === 'iii') return "All Independent";
		if (strategy === 'sss') return "All Stacked";
		if (strategy === 'iss') return "2-3 Stacked, 1 Independent";
		if (strategy === 'sis') return "1-3 Stacked, 2 Independent";
		if (strategy === 'ssi') return "1-2 Stacked, 3 Independent";
		if (strategy === 'ioo') return "2-3 Opposing, 1 Independent";
		if (strategy === 'oio') return "1-3 Opposing, 2 Independent";
		if (strategy === 'ooi') return "1-2 Opposing, 3 Independent";
		if (strategy === 'oso') return "1-2 Stacked, 1-3 Opposing";
		if (strategy === 'soo') return "1-2 Stacked, 2-3 Opposing";
		if (strategy === 'sos') return "1-2 Opposing, 1-3 Stacked";
		if (strategy === 'oss') return "1-2 Opposing, 2-3 Stacked";
		return strategy;
	}

	const getStrategy = (pick1: Picks.Player, pick2: Picks.Player, pick3: Picks.Player): strategyPattern | null => {
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
	}
	type strategyMap = Map<strategyPattern, ComboGroup>;
	const addStrategy = (strategies: strategyMap, pick1: Choice, pick2: Choice, pick3: Choice) => {
		const strategy = getStrategy(pick1.pick.player, pick2.pick.player, pick3.pick.player);
		if (!strategy) return;
		const combo = strategies.get(strategy);
		if (combo) combo.add(pick1, pick2, pick3);
	}
	const calcCombos = (): {
		top: ComboGroup,
		strategies: strategyMap
	} => {
		const top = new ComboGroup();
		const strategies = new Map<strategyPattern, ComboGroup>();
		for (const strategy of allStrategies) strategies.set(strategy, new ComboGroup());

		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				for (const pick3 of choices3) {
					top.add(pick1, pick2, pick3);
					addStrategy(strategies, pick1, pick2, pick3);
				}
			}
		}
		return {
			top,
			strategies
		};
	}

	const comboPrecision = 2;

	const printStrategy = (strategy: Picks.Strategy, value: number): string => {
		switch (strategy) {
			case 'least1': return `Streak: ${roundToPercent(value, comboPrecision)}`;
			case 'points': return `Points: ${value.toFixed(comboPrecision)}`;
			case 'hits': return `Pick %: ${roundToPercent(value / 3, comboPrecision)}`;
		}
	}
	const printStrategyDiff = (strategy: Picks.Strategy, top: number, value: number): string => {
		let diff = value - top;
		let percent = "";
		if (strategy === 'least1' || strategy === 'hits') {
			diff *= 100;
			percent = "%";
			if (strategy === 'hits') diff /= 3;
		}

		const places = Math.pow(10, comboPrecision);
		diff = Math.round(diff * places) / places;
		if (diff === 0) return "";
		const sign = diff > 0 ? "+" : "";
		return " (" + sign + diff.toFixed(comboPrecision) + percent + ")";
	}
	const logCalcStats = (avgResult: Result) => {
		logHandler.addSection();
		logHandler.addLine(printStrategy('least1', calcAny(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
		logHandler.addLine(printStrategy('points', calcPnt(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
		logHandler.addLine(printStrategy('hits', calcHit(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
	}

	const logHighlights = (avgResult: Result) => {
		addPlayersToHighlight(avgResult.players1);
		addPlayersToHighlight(avgResult.players2);
		addPlayersToHighlight(avgResult.players3);
	}

	const logTopPicks = (avgResult: Result) => {
		logHandler.addLine(`1: ${roundToPercent(avgResult.prob1, precision)} - ${names(avgResult.players1)}`);
		logHandler.addLine(`2: ${roundToPercent(avgResult.prob2, precision)} - ${names(avgResult.players2)}`);
		logHandler.addLine(`3: ${roundToPercent(avgResult.prob3, precision)} - ${names(avgResult.players3)}`);
		logCalcStats(avgResult);
	}

	const logReduced = (avgResult: Result, topResult: Result, strategy: strategyPattern): void => {
		let line1 = `1: ${names(avgResult.players1, true)}`;
		let reducedCount = 0;
		if (avgResult.prob1 !== topResult.prob1) {
			reducedCount++;
			line1 += " " + roundToPercent(avgResult.prob1 - topResult.prob1, comboPrecision);
		}
		let line2 = `2: ${names(avgResult.players2, true)}`;
		if (avgResult.prob2 !== topResult.prob2) {
			reducedCount++;
			line2 += " " + roundToPercent(avgResult.prob2 - topResult.prob2, comboPrecision);
		}
		let line3 = `3: ${names(avgResult.players3, true)}`;
		if (avgResult.prob3 !== topResult.prob3) {
			reducedCount++;
			line3 += " " + roundToPercent(avgResult.prob3 - topResult.prob3, comboPrecision);
		}

		logHandler.addLine(line1);
		logHandler.addLine(line2);
		logHandler.addLine(line3);

		if (reducedCount > 1) {
			const total = avgResult.prob1 + avgResult.prob2 + avgResult.prob3;
			const totalMax = topResult.prob1 + topResult.prob2 + topResult.prob3;
			logHandler.addLine(`Total: ${roundToPercent(total - totalMax, comboPrecision)}`, 'center');
		}
		logHandler.addSection();
		logHandler.addLine(strategyTitle(strategy), 'center');
	}

	const logFooter = () => {
		logHandler.addTitle("Good Values");
		logHandler.addSection();
		logHandler.addLine("Streak: 66% ", 'left');
		logHandler.addLine("Points: 23", 'left');
		logHandler.addLine("Pick %: 30%", 'left');
	}

	const setStrategy = (pick: Picks.PickOdds, mode: Picks.StrategyMode) => {
		if (betKey === 'bet1') pick.strategy1.add(mode);
		else if (betKey === 'bet2') pick.strategy2.add(mode);
		else if (betKey === 'bet3') pick.strategy3.add(mode);
		else if (betKey === 'bet4') pick.strategy4.add(mode);
		else pick.strategyAvg.add(mode);
	};
	const addStrategyHighlights = (result: Result, strategy: Picks.StrategyMode) => {
		for (const pick of result.players1) setStrategy(pick, strategy);
		for (const pick of result.players2) setStrategy(pick, strategy);
		for (const pick of result.players3) setStrategy(pick, strategy);
	}

	// calculate available games from players, rather than use the gamesList.
	// Some games may have started, or players may not be available from a game.
	const gamesSet = new Set<Team>();
	let gameCount = 0;
	for (const pick of [...table1Rows, ...table2Rows, ...table3Rows]) {
		if (gamesSet.has(pick.player.team.code)) continue;
		gamesSet.add(pick.player.team.code);
		gamesSet.add(pick.player.opponent.code);
		gameCount++;
	}

	if (gameCount === 0) return;

	const ref = gameCount === 1 ? correlations['1'] : gameCount === 2 ? correlations['2'] : correlations['3+'];

	const { top, strategies } = calcCombos();
	const topResultRaw = top.merge();
	if (topResultRaw === null) return;
	const topResult: Result = topResultRaw;

	const strategyResults: Map<strategyPattern, Result> = new Map();
	for (const [strategy, combos] of strategies) {
		const combo = combos.merge();
		if (combo !== null) strategyResults.set(strategy, combo);
	}

	type strategyGroup = {
		strategy: strategyPattern;
		result: Result;
	}
	const findMax = (key: Picks.Strategy): strategyGroup[] => {
		let max = 0;
		for (const result of strategyResults.values()) {
			const value = result[key];
			if (value > max) max = value;
		}

		const maxResults: strategyGroup[] = [];
		for (const [strategy, result] of strategyResults) {
			const value = result[key];
			if (value === max) maxResults.push({ strategy, result });
		}
		return maxResults;
	}

	for (const [strategy, result] of strategyResults) {
		result.correlate(strategy, ref);
	}

	const isSameSet = (set1: Set<Picks.PickOdds>, set2: Set<Picks.PickOdds>): boolean => {
		if (set1.size !== set2.size) return false;
		for (const player of set1) if (!set2.has(player)) return false;
		return true;
	}

	const processSameGroup = (groupKey: Picks.Strategy): strategyGroup[] => {
		const groups = findMax(groupKey);
		for (const group of groups) {
			logHighlights(group.result);
			addStrategyHighlights(group.result, groupKey);
		}

		return groups;
	}
	const least1 = processSameGroup('least1');
	const points = processSameGroup('points');
	const hits = processSameGroup('hits');

	const header = betKey === 'betAvg' ? "Average" : `${sportsbooks[betKey].title}`;
	logHandler.addTitle(header + " Top Picks");
	logTopPicks(topResult);
	logHighlights(topResult);
	addStrategyHighlights(topResult, 'top');

	class GroupedPlayer {
		result: Result;
		strategy: strategyPattern;
		strategyCombos: Map<Picks.Strategy, LogLine>;
		constructor(result: Result, strategy: strategyPattern, key: Picks.Strategy) {
			this.result = result;
			this.strategy = strategy;
			this.strategyCombos = new Map();
			this.addStrategyStat(key, result[key]);
		}
		getLogStat(strategy: Picks.Strategy, value: number, max: boolean = true): LogLine {
			const diff = printStrategyDiff(strategy, topResult[strategy], value);
			return {
				text: printStrategy(strategy, value) + diff,
				align: 'left',
				bold: max,
				title: false
			}
		}
		addStrategyStat(strategy: Picks.Strategy, value: number, max: boolean = true) {
			this.strategyCombos.set(strategy, this.getLogStat(strategy, value, max));
		}
		logStrategyStat(strategy: Picks.Strategy) {
			const logLine = this.strategyCombos.get(strategy);
			if (logLine) logHandler.addLogLine(logLine);
			else logHandler.addLogLine(this.getLogStat(strategy, this.result[strategy], false));
		}
	}

	const groupedMap: Map<Set<Picks.PickOdds>, GroupedPlayer> = new Map();
	const mergeSameResults = (groups: strategyGroup[], key: Picks.Strategy): void => {
		for (const group of groups) {
			let same = false;
			const combined = new Set<Picks.PickOdds>();
			for (const pick of group.result.players1) combined.add(pick);
			for (const pick of group.result.players2) combined.add(pick);
			for (const pick of group.result.players3) combined.add(pick);
			for (const [set, groupedPlayer] of groupedMap) {
				if (isSameSet(combined, set)) {
					groupedPlayer.addStrategyStat(key, group.result[key]);
					same = true;
					break;
				};
			}
			if (!same) {
				const groupedPlayer = new GroupedPlayer(group.result, group.strategy, key);
				groupedMap.set(combined, groupedPlayer);
			}
		}
	}

	if (least1) mergeSameResults(least1, 'least1');
	if (points) mergeSameResults(points, 'points');
	if (hits) mergeSameResults(hits, 'hits');

	if (groupedMap.size > 0) {
		logHandler.addTitle("Correlated");
		for (const groupedPlayer of groupedMap.values()) {
			logReduced(groupedPlayer.result, topResult, groupedPlayer.strategy);
			logHandler.addSection();

			groupedPlayer.logStrategyStat('least1');
			groupedPlayer.logStrategyStat('points');
			groupedPlayer.logStrategyStat('hits');

			logHandler.addSection();
		}
	}

	logFooter();
};

export const precalculateLogStats = (
	minSportsbooks: number,
	table1Rows: Picks.PickOdds[],
	table2Rows: Picks.PickOdds[],
	table3Rows: Picks.PickOdds[],
	correlationFactor: number
): SportsbookLog => {
	const cache = {} as SportsbookLog;

	for (const key of LogStatsKeys) {
		const stats: LogLines = [];
		calculateStats(key, minSportsbooks, table1Rows, table2Rows, table3Rows, stats, correlationFactor);
		cache[key] = stats;
	}

	return cloneLogStats(cache);
};
