import * as Picks from './components/Table';
import { roundToPercent } from './utility';
import type { Team } from './components/logo';

const precision = Picks.precision;

type LogStatAlign = 'left' | 'center';
export interface LogStat {
	isTitle: boolean;
	align: LogStatAlign;
	lines: string[];
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

	const addLog = (line: string = "\n", align: LogStatAlign = "left", isTitle: boolean = false) => {
		if (dataStatsPrev) {
			const current = stats[logSection];
			if (current) {
				if (current.align === align && current.isTitle === isTitle) {
					current.lines.push(line);
				} else {
					dataStatsPrev = { align, lines: [line], isTitle };
					logSection++;
					stats[logSection] = dataStatsPrev;
				}
			} else {
				dataStatsPrev = { align, lines: [line], isTitle };
				stats[logSection] = dataStatsPrev;
			}
		} else {
			dataStatsPrev = { align, lines: [line], isTitle };
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
		merge(combo: BestCombo): void {
			this.players1.add(combo.pick1.pick);
			this.players2.add(combo.pick2.pick);
			this.players3.add(combo.pick3.pick);
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
			case 'hits': return `Leaderboard: ${value.toFixed(comboPrecision)}`;
			case 'all3': return `All 3: ${roundToPercent(value, comboPrecision)}`;
		}
	}
	const printStrategyDiff = (strategy: Picks.Strategy, top: number, value: number): string => {
		let diff = value - top;
		let percent = "";
		if (strategy === 'least1' || strategy === 'all3') {
			diff *= 100;
			percent = "%";
		}

		const places = Math.pow(10, comboPrecision);
		diff = Math.round(diff * places) / places;
		if (diff === 0) return "";
		const sign = diff > 0 ? "+" : "";
		return " (" + sign + diff.toFixed(comboPrecision) + percent + ")";
	}
	const logCalcStats = (avgResult: Result) => {
		addLog();
		logSection++;
		addLog(printStrategy('least1', calcAny(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
		addLog(printStrategy('points', calcPnt(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
		addLog(printStrategy('hits', calcHit(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
		addLog(printStrategy('all3', calcAll(avgResult.prob1, avgResult.prob2, avgResult.prob3)), 'left');
		addLog();
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

		addLog(line1);
		addLog(line2);
		addLog(line3);

		if (reducedCount > 1) {
			const total = avgResult.prob1 + avgResult.prob2 + avgResult.prob3;
			const totalMax = topResult.prob1 + topResult.prob2 + topResult.prob3;
			addLog(`Total: ${roundToPercent(total - totalMax, comboPrecision)}`, 'center');
		}
		addLog(strategyTitle(strategy), 'center');
	}

	const logFooter = () => {
		addLogTitle("Good Ranges");
		logSection++;
		addLog("Streak: 66-69% ", 'left');
		addLog("Points: 23-24", 'left');
		addLog("Leaderboard: 0.9-1.0", 'left');
		addLog("All 3: 2-3%", 'left');
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
	const findMax = (key: Picks.Strategy): strategyGroup | null => {
		let max = 0;
		let maxResult: Result | null = null;
		let maxStrategy: strategyPattern | null = null;
		for (const [strategy, result] of strategyResults) {
			const value = result[key];
			if (value > max) {
				max = value;
				maxResult = result;
				maxStrategy = strategy;
			}
		}
		if (maxStrategy === null || maxResult === null) return null;
		return { strategy: maxStrategy, result: maxResult };
	}

	for (const [strategy, result] of strategyResults) {
		result.correlate(strategy, ref);
	}

	const isSameSet = (set1: Set<Picks.PickOdds>, set2: Set<Picks.PickOdds>): boolean => {
		if (set1.size !== set2.size) return false;
		for (const player of set1) if (!set2.has(player)) return false;
		return true;
	}
	const isSameResult = (top: Result, group: Result): boolean => {
		if (!isSameSet(top.players1, group.players1)) return false;
		if (!isSameSet(top.players2, group.players2)) return false;
		if (!isSameSet(top.players3, group.players3)) return false;
		return true;
	}

	const processSameGroup = (top: Result, groupKey: Picks.Strategy): strategyGroup | null => {
		const group = findMax(groupKey);
		if (group === null) return null;

		logHighlights(group.result);
		addStrategyHighlights(group.result, groupKey);

		const same = isSameResult(top, group.result);
		if (!same) return group;
		return group;
	}
	const least1 = processSameGroup(topResult, 'least1');
	const points = processSameGroup(topResult, 'points');
	const hits = processSameGroup(topResult, 'hits');
	const all3 = processSameGroup(topResult, 'all3');

	addLogTitle("Top Picks");
	logTopPicks(topResult);
	logHighlights(topResult);
	addStrategyHighlights(topResult, 'top');

	class GroupedPlayer {
		result: Result;
		strategy: strategyPattern;
		strategyCombos: string[];
		constructor(result: Result, strategy: strategyPattern, key: Picks.Strategy) {
			this.result = result;
			this.strategy = strategy;
			this.strategyCombos = [];
			this.add(key, result[key]);
		}
		add(strategy: Picks.Strategy, value: number) {
			const diff = printStrategyDiff(strategy, topResult[strategy], value);
			this.strategyCombos.push(printStrategy(strategy, value) + diff);
		}
	}

	const groupedMap: Map<Set<Picks.PickOdds>, GroupedPlayer> = new Map();
	const mergeSameResults = (group: strategyGroup, key: Picks.Strategy): void => {
		const combined = new Set<Picks.PickOdds>();
		for (const pick of group.result.players1) combined.add(pick);
		for (const pick of group.result.players2) combined.add(pick);
		for (const pick of group.result.players3) combined.add(pick);
		for (const [set, groupedPlayer] of groupedMap) {
			if (isSameSet(combined, set)) {
				groupedPlayer.add(key, group.result[key]);
				return;
			};
		}
		const groupedPlayer = new GroupedPlayer(group.result, group.strategy, key);
		groupedMap.set(combined, groupedPlayer);
	}

	if (least1) mergeSameResults(least1, 'least1');
	if (points) mergeSameResults(points, 'points');
	if (hits) mergeSameResults(hits, 'hits');
	if (all3) mergeSameResults(all3, 'all3');

	if (groupedMap.size > 0) {
		addLogTitle("Top Correlated");
		for (const groupedPlayer of groupedMap.values()) {
			logReduced(groupedPlayer.result, topResult, groupedPlayer.strategy);
			addLog();
			logSection++;
			for (const strategyCombo of groupedPlayer.strategyCombos) addLog(strategyCombo, 'left');
			logSection++;
			addLog();
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
