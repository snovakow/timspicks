import * as Picks from './components/Table';
import { roundToPercent } from './utility';
import type { Team } from './components/logo';

const precision = Picks.precision;

type LogStatAlign = 'left' | 'center';
export interface LogStat {
	isTitle: boolean;
	align: LogStatAlign;
	lines: string[];
	break: boolean;
}

export type LogStatsKey = 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg';
export type PickIndex = 1 | 2 | 3;

export interface LogStatsCacheItem {
	stats: LogStat[];
}

export const cloneLogStats = (stats: LogStat[]): LogStat[] => {
	return stats.map((stat) => ({
		...stat,
		lines: [...stat.lines],
	}));
};

export const allStrategies = [
	'iii', 'sss',
	'iss', 'sis', 'ssi',
	'ioo', 'oio', 'ooi',
	'oso', 'soo', 'sos', 'oss'
] as const;
export type strategyPattern = typeof allStrategies[number];

export const calculateStats = (
	betKey: LogStatsKey,
	minSportsbooks: number,
	table1Rows: Picks.PickOdds[],
	table2Rows: Picks.PickOdds[],
	table3Rows: Picks.PickOdds[],
	stats: LogStat[]
): void => {
	let logSection = 0;
	let dataStatsPrev: LogStat | null = null;

	const addLog = (line: string, align: LogStatAlign = "left", isTitle: boolean = false) => {
		if (dataStatsPrev) {
			const current = stats[logSection];
			if (current) {
				if (current.align === align && current.isTitle === isTitle) {
					current.lines.push(line);
				} else {
					dataStatsPrev = { align, lines: [line], break: false, isTitle };
					logSection++;
					stats[logSection] = dataStatsPrev;
				}
			} else {
				dataStatsPrev.break = true;
				dataStatsPrev = { align, lines: [line], break: false, isTitle };
				stats[logSection] = dataStatsPrev;
			}
		} else {
			dataStatsPrev = { align, lines: [line], break: false, isTitle };
			stats[logSection] = dataStatsPrev;
		}
	}

	const addLogTitle = (title: string) => {
		addLog(title, 'center', true);
	}

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
			if (betKey === 'betAvg' && row.player.betCount < minSportsbooks) continue;
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
	const calcAll = (prob1: number, prob2: number, prob3: number): number => {
		return prob1 * prob2 * prob3;
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
		all3: number;
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
			this.all3 = calcAll(this.prob1, this.prob2, this.prob3);
			this.points = calcPnt(this.prob1, this.prob2, this.prob3);
			this.hits = calcHit(this.prob1, this.prob2, this.prob3);
		}
		merge(combo: BestCombo): boolean {
			if (this.prob1 !== combo.pick1.prob || this.prob2 !== combo.pick2.prob || this.prob3 !== combo.pick3.prob) return false;
			this.players1.add(combo.pick1.pick);
			this.players2.add(combo.pick2.pick);
			this.players3.add(combo.pick3.pick);
			return true;
		}

		correlate(strategy: strategyPattern, ref: Correlation) {
			const least1 = ref.least1[strategy];
			if (least1 !== null) this.least1 *= least1;
			const all3 = ref.all3[strategy];
			if (all3 !== null) this.all3 *= all3;
			const points = ref.points[strategy];
			if (points !== null) this.points *= points;
			const hits = ref.hits[strategy];
			if (hits !== null) this.hits *= hits;
		}
	}

	class ComboGroup {
		combos: BestCombo[] = [];
		total: number = 0;
		add(pick1: Choice, pick2: Choice, pick3: Choice) {
			const total = pick1.prob + pick2.prob + pick3.prob;
			if (total > this.total) {
				this.combos.splice(0, this.combos.length, { pick1, pick2, pick3 });
				this.total = total;
			} else if (total === this.total) {
				this.combos.push({ pick1, pick2, pick3 });
			}
		}
		merge(): Result[] {
			const avgResults: Result[] = [];
			if (this.combos.length === 0) return avgResults;
			let prev: Result | null = null;
			for (const combo of this.combos) {
				if (prev && prev.merge(combo)) continue;
				prev = new Result(combo);
				avgResults.push(prev);
			}
			return avgResults;
		}
	}

	type Correlation = {
		least1: Record<typeof allStrategies[number], number | null>;
		all3: Record<typeof allStrategies[number], number | null>;
		points: Record<typeof allStrategies[number], number | null>;
		hits: Record<typeof allStrategies[number], number | null>;
	};

	// 1000000 iterations per night
	/*
		1 Game Night
		aa71 nights simulated
	*/
	const historical1Night: Correlation = {
		"least1": {
			"iii": null,
			"sss": 0.996044409833046,
			"iss": null,
			"sis": null,
			"ssi": null,
			"ioo": null,
			"oio": null,
			"ooi": null,
			"oso": 1.000471434119312,
			"soo": 1.0005066302537835,
			"sos": 1.0032197931415312,
			"oss": 0.9874751028404549
		},
		"all3": {
			"iii": null,
			"sss": 1.3540216030239554,
			"iss": null,
			"sis": null,
			"ssi": null,
			"ioo": null,
			"oio": null,
			"ooi": null,
			"oso": 0.8010380217902658,
			"soo": 0.8024247814536987,
			"sos": 0.5815555113456835,
			"oss": 1.3517805525973952
		},
		"points": {
			"iii": null,
			"sss": 1.0000044621770354,
			"iss": null,
			"sis": null,
			"ssi": null,
			"ioo": null,
			"oio": null,
			"ooi": null,
			"oso": 0.9982959010571092,
			"soo": 0.9984362009567944,
			"sos": 0.9926526374958418,
			"oss": 0.9984341962105899
		},
		"hits": {
			"iii": null,
			"sss": 0.9980372747743135,
			"iss": null,
			"sis": null,
			"ssi": null,
			"ioo": null,
			"oio": null,
			"ooi": null,
			"oso": 0.9993920152572664,
			"soo": 0.9995253888823101,
			"sos": 0.9949370045350285,
			"oss": 0.996470736194448
		}
	};

	/*
		2 Game Nights
		66 nights simulated
	*/
	const historical2Night: Correlation = {
		"least1": {
			"iii": null,
			"sss": 1.001891024635451,
			"iss": 0.9945713961806759,
			"sis": 0.9978982650536891,
			"ssi": 1.0015005405341784,
			"ioo": 0.9891612031697926,
			"oio": 0.9921797804707926,
			"ooi": 1.0022393189575538,
			"oso": 0.9964253606142546,
			"soo": 0.9962914349062009,
			"sos": 1.0022683070339111,
			"oss": 1.0005349075489127
		},
		"all3": {
			"iii": null,
			"sss": 0.9605476613129262,
			"iss": 1.100342288320579,
			"sis": 0.9785793760669967,
			"ssi": 1.19402566737729,
			"ioo": 0.9566491417311466,
			"oio": 0.618845392697283,
			"ooi": 0.7596592405106297,
			"oso": 1.1016757688746954,
			"soo": 1.0967325479670793,
			"sos": 1.0220746239499903,
			"oss": 1.1731571213807046
		},
		"points": {
			"iii": null,
			"sss": 1.0050709299378218,
			"iss": 0.9938816350410576,
			"sis": 0.9956518085772835,
			"ssi": 1.00243616322993,
			"ioo": 0.9882783239160793,
			"oio": 0.9870636694984828,
			"ooi": 0.9972667318124117,
			"oso": 0.9983220650447268,
			"soo": 0.9981049164277052,
			"sos": 1.0017908411020824,
			"oss": 0.9953538337725771
		},
		"hits": {
			"iii": null,
			"sss": 1.0052540709643187,
			"iss": 0.9934437221490953,
			"sis": 0.995722033942835,
			"ssi": 1.0016480832093186,
			"ioo": 0.9884084266931554,
			"oio": 0.9885782903983196,
			"ooi": 0.9982441012015953,
			"oso": 0.997896932209778,
			"soo": 0.9976992237137838,
			"sos": 1.0017074062392177,
			"oss": 0.9946224616695668
		}
	};

	/*
		3+ Game Nights
		485 nights simulated
	*/
	const historical3PlusNight: Correlation = {
		"least1": {
			"iii": 1,
			"sss": 0.9955411129995313,
			"iss": 0.9960620128161661,
			"sis": 0.9972240240199007,
			"ssi": 0.998841124703338,
			"ioo": 1.0008954025396748,
			"oio": 0.9962086403180294,
			"ooi": 1.0082513551168613,
			"oso": 0.9992936683818823,
			"soo": 0.9992127857830574,
			"sos": 1.0078187801762248,
			"oss": 1.0031276144454642
		},
		"all3": {
			"iii": 1,
			"sss": 0.9596266393469162,
			"iss": 1.0141953472690364,
			"sis": 1.0109199318960629,
			"ssi": 0.9756804379927416,
			"ioo": 0.9126589561526434,
			"oio": 0.946397419250924,
			"ooi": 0.9848933602193917,
			"oso": 0.8616628915134652,
			"soo": 0.8604581378232579,
			"sos": 0.8571923803553235,
			"oss": 0.9014267737994256
		},
		"points": {
			"iii": 1,
			"sss": 0.9916880244789621,
			"iss": 0.9957658650221768,
			"sis": 0.9967264916116636,
			"ssi": 0.9958811701609408,
			"ioo": 0.9981700461974617,
			"oio": 0.9941509948861489,
			"ooi": 1.0044981724413817,
			"oso": 0.9922012869409813,
			"soo": 0.9920786005371944,
			"sos": 1.0005809152874516,
			"oss": 0.9972299228351148
		},
		"hits": {
			"iii": 1,
			"sss": 0.9918963658990133,
			"iss": 0.9956461064875312,
			"sis": 0.9966342597417027,
			"ssi": 0.9960124386388516,
			"ioo": 0.99872571470201,
			"oio": 0.9944613073607782,
			"ooi": 1.0046255685099341,
			"oso": 0.9930495520599889,
			"soo": 0.992933897150135,
			"sos": 1.0015126832339643,
			"oss": 0.9978524712382256
		}
	};

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
		if (strategy === 'iii') return "Independent";
		if (strategy === 'sss') return "Stacked";
		if (strategy === 'iss') return "Stacked + Pick 1 Independent";
		if (strategy === 'sis') return "Stacked + Pick 2 Independent";
		if (strategy === 'ssi') return "Stacked + Pick 3 Independent";
		if (strategy === 'ioo') return "Opposing + Pick 1 Independent";
		if (strategy === 'oio') return "Opposing + Pick 2 Independent";
		if (strategy === 'ooi') return "Opposing + Pick 3 Independent";
		if (strategy === 'oso') return "Stacked + Pick 1 Opposing Pick 3";
		if (strategy === 'soo') return "Stacked + Pick 2 Opposing Pick 3";
		if (strategy === 'sos') return "Opposing + Pick 1 Stacked Pick 3";
		if (strategy === 'oss') return "Opposing + Pick 2 Stacked Pick 3";
		return strategy;
	}

	const getStrategy = (pick1: Choice, pick2: Choice, pick3: Choice): strategyPattern | null => {
		const p1 = pick1.pick.player;
		const p2 = pick2.pick.player;
		const p3 = pick3.pick.player;

		if (!p1.sameGame(p2) && !p2.sameGame(p3) && !p1.sameGame(p3)) return 'iii';
		if (p1.sameGame(p2) && p2.sameGame(p3)) return 'sss';

		if (p2.sameTeam(p3) && !p1.sameGame(p2)) return 'iss';
		if (p1.sameTeam(p3) && !p2.sameGame(p1)) return 'sis';
		if (p1.sameTeam(p2) && !p3.sameGame(p1)) return 'ssi';

		if (p2.opponentTeam(p3) && !p1.sameGame(p2)) return 'ioo';
		if (p1.opponentTeam(p3) && !p2.sameGame(p1)) return 'oio';
		if (p1.opponentTeam(p2) && !p3.sameGame(p1)) return 'ooi';

		if (p1.sameTeam(p2) && p3.opponentTeam(p1)) return 'oso';
		if (p1.sameTeam(p2) && p3.opponentTeam(p2)) return 'soo';
		if (p1.sameTeam(p3) && p1.opponentTeam(p2)) return 'sos';
		if (p2.sameTeam(p3) && p1.opponentTeam(p2)) return 'oss';

		return null;
	}
	type strategyMap = Map<strategyPattern, ComboGroup>;
	const addStrategy = (strategies: strategyMap, pick1: Choice, pick2: Choice, pick3: Choice) => {
		let strategy = getStrategy(pick1, pick2, pick3);
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
	const logCalcStats = (avgResult: Result) => {
		const any = roundToPercent(calcAny(avgResult.prob1, avgResult.prob2, avgResult.prob3), 1);
		const all = roundToPercent(calcAll(avgResult.prob1, avgResult.prob2, avgResult.prob3), 2);
		const pnt = calcPnt(avgResult.prob1, avgResult.prob2, avgResult.prob3).toFixed(1);
		const hit = calcHit(avgResult.prob1, avgResult.prob2, avgResult.prob3).toFixed(2);
		addLog(`Any: ${any}`, 'center');
		addLog(`All: ${all}`, 'center');
		addLog(`Points: ${pnt}`, 'center');
		addLog(`Hits: ${hit}`, 'center');
		logSection++;
	}

	const logHighlights = (avgResult: Result) => {
		addPlayersToHighlight(avgResult.players1);
		addPlayersToHighlight(avgResult.players2);
		addPlayersToHighlight(avgResult.players3);
	}

	const logTopPicks = (avgResult: Result) => {
		addLog(`1: ${roundToPercent(avgResult.prob1, precision)} - ${names(avgResult.players1)}`);
		addLog(`2: ${roundToPercent(avgResult.prob2, precision)} - ${names(avgResult.players2)}`);
		addLog(`3: ${roundToPercent(avgResult.prob3, precision)} - ${names(avgResult.players3)}`);
		logCalcStats(avgResult);
	}

	const logReduced = (avgResult: Result, topResult: Result, totalMax: number): void => {
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

		addLog(line1);
		addLog(line2);
		addLog(line3);

		if (reducedCount > 1) {
			const total = avgResult.prob1 + avgResult.prob2 + avgResult.prob3;
			addLog(`Total: ${roundToPercent(total - totalMax, comboPrecision)}`, 'center');
		}
		if (reducedCount < 0) logCalcStats(avgResult);
		else logSection++;
	}

	const logFooter = () => {
		addLogTitle("Good Ranges");
		addLog("Any: 66-69% - Avg: 30-32% - All: 2-3%", 'center');
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

	const ref = gameCount === 1 ? historical1Night : gameCount === 2 ? historical2Night : historical3PlusNight;

	const { top, strategies } = calcCombos();
	if (top.combos.length === 0) return;

	const topResult: Result[] = top.merge();
	const maxResult: Result = topResult[0];
	const strategyResults: Map<strategyPattern, Result[]> = new Map();
	for (const [strategy, combo] of strategies) {
		if (combo.total > 0) strategyResults.set(strategy, combo.merge());
	}

	addLogTitle("Top Picks");
	for (const avgResult of topResult) {
		logTopPicks(avgResult);
		logHighlights(avgResult);
		addStrategyHighlights(avgResult, 'top');
	}

	type strategyType = 'least1' | 'all3' | 'points' | 'hits';
	const findMax = (key: strategyType): { strategy: strategyPattern, result: Result } => {
		let max = 0;
		let maxResult: Result | null = null;
		let maxStrategy: strategyPattern | null = null;
		for (const [strategy, result] of strategyResults) {
			const value = result[0][key];
			if (value > max) {
				max = value;
				maxResult = result[0];
				maxStrategy = strategy;
			}
		}
		return { strategy: maxStrategy!, result: maxResult! };
	}

	for (const [strategy, result] of strategyResults) {
		for (const avgResult of result) {
			avgResult.correlate(strategy, ref);
		}
	}

	const least1 = findMax('least1');
	const all3 = findMax('all3');
	const points = findMax('points');
	const hits = findMax('hits');

	const logCorrelation = (strategy: strategyPattern, key: strategyType) => {
		let value = ref[key][strategy];
		if (value === null) return "-";
		value -= 1;
		return roundToPercent(value, comboPrecision);
	}
	addLogTitle("Any" + " " + logCorrelation(least1.strategy, 'least1'));
	logReduced(least1.result, maxResult, top.total);

	addLogTitle("All" + " " + logCorrelation(all3.strategy, 'all3'));
	logReduced(all3.result, maxResult, top.total);

	addLogTitle("Pnt" + " " + logCorrelation(points.strategy, 'points'));
	logReduced(points.result, maxResult, top.total);

	addLogTitle("Hit" + " " + logCorrelation(hits.strategy, 'hits'));
	logReduced(hits.result, maxResult, top.total);

	for (const [strategy, result] of strategyResults) {
		addLogTitle(strategyTitle(strategy));
		for (const avgResult of result) {
			avgResult.correlate(strategy, ref);
			logReduced(avgResult, maxResult, top.total);
			// logHighlights(avgResult);
			// addStrategyHighlights(avgResult, 'streak');
		}
	}

	logFooter();
};

export const precalculateLogStats = (
	minSportsbooks: number,
	table1Rows: Picks.PickOdds[],
	table2Rows: Picks.PickOdds[],
	table3Rows: Picks.PickOdds[]
): Record<LogStatsKey, LogStatsCacheItem> => {
	const keys: LogStatsKey[] = ['bet1', 'bet2', 'bet3', 'bet4', 'betAvg'];
	const cache = {} as Record<LogStatsKey, LogStatsCacheItem>;

	for (const key of keys) {
		const stats: LogStat[] = [];
		calculateStats(key, minSportsbooks, table1Rows, table2Rows, table3Rows, stats);
		cache[key] = {
			stats: cloneLogStats(stats),
		};
	}

	return cache;
};
