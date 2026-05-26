import * as Picks from './components/Table';
import { roundToPercent } from './utility';
import { calcAny, calcPnt, calcHit, resolvePoolKey, gamesCount } from './picksOptimizer';
import { correlations, } from './correlationData';
import type { CorrelationStrategy } from './correlationData';
import type {
	LogStatsKey, LogLines, LogLine, LogStatAlign, SportsbookLog,
	Strategy, StrategyMode, ComboPattern
} from './dataTypes';
import { LogStatsKeys, Sportsbooks, StrategyLabels, strategyTitle } from './dataTypes';
import type { MergedSelection, SelectionCandidate } from './strategySelection';
import { getStrategy, selectStrategyCombos } from './strategySelection';
import * as Feature from './features';

const precision = Picks.precision;
const comboPrecision = Picks.comboPrecision;

export const cloneLogStats = (stats: SportsbookLog): SportsbookLog => {
	const cache = {} as SportsbookLog;
	for (const key of LogStatsKeys) {
		cache[key] = stats[key].map((stat) => stat.map((line) => ({ ...line })));
	}
	return cache;
};

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

const calculateStats = (
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
	const names = (prefix: string, players: Set<Picks.PickOdds>) => {
		const names: string[] = [];
		for (const pick of players) names.push(printName(pick.player));
		return prefix + names.join(`\n${" ".repeat(prefix.length)}`);
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

		constructor(selection: MergedSelection<Picks.PickOdds>) {
			this.players1 = selection.picks1;
			this.players2 = selection.picks2;
			this.players3 = selection.picks3;
			this.prob1 = selection.prob1;
			this.prob2 = selection.prob2;
			this.prob3 = selection.prob3;

			this.least1 = calcAny(this.prob1, this.prob2, this.prob3);
			this.points = calcPnt(this.prob1, this.prob2, this.prob3);
			this.hits = calcHit(this.prob1, this.prob2, this.prob3);
		}

		// Scale correlation effect with linear interpolation:
		// factor=0 => no effect, factor=1 => full effect, factor>1 => amplified effect.
		correlate(strategy: ComboPattern, ref: CorrelationStrategy): void {
			const least1 = ref.least1[strategy];
			if (least1 !== null && least1 >= 1) this.least1 *= (least1 - 1) * factor + 1;
			const points = ref.points[strategy];
			if (points !== null && points >= 1) this.points *= (points - 1) * factor + 1;
			const hits = ref.hits[strategy];
			if (hits !== null && hits >= 1) this.hits *= (hits - 1) * factor + 1;
		}
	}

	const calcCombos = (): {
		top: ReturnType<typeof selectStrategyCombos<Picks.PickOdds>>['top'],
		strategies: ReturnType<typeof selectStrategyCombos<Picks.PickOdds>>['strategies']
	} => {
		const candidates: SelectionCandidate<Picks.PickOdds>[] = [];

		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				for (const pick3 of choices3) {
					candidates.push({
						pick1: pick1.pick,
						pick2: pick2.pick,
						pick3: pick3.pick,
						prob1: pick1.prob,
						prob2: pick2.prob,
						prob3: pick3.prob,
						strategy: getStrategy(pick1.pick.player, pick2.pick.player, pick3.pick.player),
					});
				}
			}
		}
		return selectStrategyCombos(candidates);
	}

	const printStrategy = (strategy: Strategy, value: number): string => {
		const label = StrategyLabels[strategy];
		switch (strategy) {
			case 'least1': return `${label}: ${roundToPercent(value, comboPrecision)}`;
			case 'points': return `${label}: ${value.toFixed(comboPrecision)}`;
			case 'hits': return `${label}: ${roundToPercent(value / 3, comboPrecision)}`;
		}
	}
	const printStrategyDiff = (strategy: Strategy, top: number, value: number): string => {
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
		const line1 = `1: ${roundToPercent(avgResult.prob1, precision)} - `;
		const line2 = `2: ${roundToPercent(avgResult.prob2, precision)} - `;
		const line3 = `3: ${roundToPercent(avgResult.prob3, precision)} - `;
		logHandler.addLine(names(line1, avgResult.players1));
		logHandler.addLine(names(line2, avgResult.players2));
		logHandler.addLine(names(line3, avgResult.players3));
		logCalcStats(avgResult);
	}

	const logReduced = (avgResult: Result, topResult: Result, strategy: ComboPattern): void => {
		let line1 = names("1: ", avgResult.players1);
		let reducedCount = 0;
		if (avgResult.prob1 !== topResult.prob1) {
			reducedCount++;
			line1 += " " + roundToPercent(avgResult.prob1 - topResult.prob1, comboPrecision);
		}
		let line2 = names("2: ", avgResult.players2);
		if (avgResult.prob2 !== topResult.prob2) {
			reducedCount++;
			line2 += " " + roundToPercent(avgResult.prob2 - topResult.prob2, comboPrecision);
		}
		let line3 = names("3: ", avgResult.players3);
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

	const setStrategy = (pick: Picks.PickOdds, mode: StrategyMode) => {
		if (betKey === 'bet1') pick.strategy1.add(mode);
		else if (betKey === 'bet2') pick.strategy2.add(mode);
		else if (betKey === 'bet3') pick.strategy3.add(mode);
		else if (betKey === 'bet4') pick.strategy4.add(mode);
		else pick.strategyAvg.add(mode);
	};
	const addStrategyHighlights = (result: Result, strategy: StrategyMode) => {
		for (const pick of result.players1) setStrategy(pick, strategy);
		for (const pick of result.players2) setStrategy(pick, strategy);
		for (const pick of result.players3) setStrategy(pick, strategy);
	}

	const gameCount = gamesCount(table1Rows, table2Rows, table3Rows);
	if (gameCount === 0) return;

	const { top, strategies } = calcCombos();
	const topSelection = top.merge();
	if (topSelection === null) return;
	const topResult = new Result(topSelection);

	const strategyResults: Map<ComboPattern, Result> = new Map();
	for (const [strategy, combos] of strategies) {
		const selection = combos.merge();
		if (selection !== null) strategyResults.set(strategy, new Result(selection));
	}

	type strategyGroup = {
		strategy: ComboPattern;
		result: Result;
	}
	const findMax = (key: Strategy): strategyGroup[] => {
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

	const ref = correlations[resolvePoolKey(gameCount)][betKey];
	for (const [strategy, result] of strategyResults) {
		result.correlate(strategy, ref);
	}

	const isSameSet = (set1: Set<Picks.PickOdds>, set2: Set<Picks.PickOdds>): boolean => {
		if (set1.size !== set2.size) return false;
		for (const player of set1) if (!set2.has(player)) return false;
		return true;
	}

	const processSameGroup = (groupKey: Strategy): strategyGroup[] => {
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

	const header = betKey === 'betAvg' ? "Average" : `${Sportsbooks[betKey].title}`;
	logHandler.addTitle(header + " Top Picks");
	logTopPicks(topResult);
	logHighlights(topResult);
	addStrategyHighlights(topResult, 'top');

	if (Feature.correlation) {
		class GroupedPlayer {
			result: Result;
			strategy: ComboPattern;
			strategyCombos: Map<Strategy, LogLine>;
			constructor(result: Result, strategy: ComboPattern, key: Strategy) {
				this.result = result;
				this.strategy = strategy;
				this.strategyCombos = new Map();
				this.addStrategyStat(key, result[key]);
			}
			getLogStat(strategy: Strategy, value: number, max: boolean = true): LogLine {
				const diff = printStrategyDiff(strategy, topResult[strategy], value);
				return {
					text: printStrategy(strategy, value) + diff,
					align: 'left',
					bold: max,
					title: false
				}
			}
			addStrategyStat(strategy: Strategy, value: number, max: boolean = true) {
				this.strategyCombos.set(strategy, this.getLogStat(strategy, value, max));
			}
			logStrategyStat(strategy: Strategy) {
				const logLine = this.strategyCombos.get(strategy);
				if (logLine) logHandler.addLogLine(logLine);
				else logHandler.addLogLine(this.getLogStat(strategy, this.result[strategy], false));
			}
		}

		const groupedMap: Map<Set<Picks.PickOdds>, GroupedPlayer> = new Map();
		const mergeSameResults = (groups: strategyGroup[], key: Strategy): void => {
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
	}
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
