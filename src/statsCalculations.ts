import * as Picks from './components/Table';
import { roundToPercent } from './utility';
import type { Team } from './components/logo';
// import { runSimulation } from './picksOptimizer';
// runSimulation();

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

export const calculateStats = (
	betKey: LogStatsKey,
	minSportsbooks: number,
	gamesList: Picks.GameData[],
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

	const calcAny = (max1: number, max2: number, max3: number): number => {
		return 1 - (1 - max1) * (1 - max2) * (1 - max3);
	}
	const calcAvg = (max1: number, max2: number, max3: number): number => {
		return (max1 + max2 + max3) / 3;
	}
	const calcAll = (max1: number, max2: number, max3: number): number => {
		return max1 * max2 * max3;
	}

	const gamesMap = new Map<Team, Team>();
	for (const game of gamesList) {
		gamesMap.set(game.home.code, game.away.code);
		gamesMap.set(game.away.code, game.home.code);
	}

	type Collide = 'on' | 'opp' | 'game' | 'none';
	class Choice {
		avg: number;
		pick: Picks.PickOdds;
		on: Team;
		opp: Team;
		constructor(pick: Picks.PickOdds, avg: number, opp: Team) {
			this.avg = avg;
			this.pick = pick;
			this.on = pick.player.team.code;
			this.opp = opp;
		}
		same(choice: Choice, mode: Collide): boolean {
			switch (mode) {
				case "on":
					return this.on === choice.pick.player.team.code;
				case "opp":
					return this.opp === choice.pick.player.team.code;
				case "game":
					return this.on === choice.pick.player.team.code || this.opp === choice.pick.player.team.code;
				case "none":
					return false;
			}
		}
	}

	const makeChoices = (list: Picks.PickOdds[]): Choice[] => {
		const choices: Choice[] = [];
		for (const row of list) {
			const avg = row.player[betKey];
			if (avg === null) continue;
			if (betKey === 'betAvg' && row.player.betCount < minSportsbooks) continue;
			const opp = gamesMap.get(row.player.team.code);
			if (opp === undefined) continue;
			choices.push(new Choice(row, avg, opp));
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

	class Result {
		players1: Set<Picks.PickOdds>;
		players2: Set<Picks.PickOdds>;
		players3: Set<Picks.PickOdds>;
		avg1: number;
		avg2: number;
		avg3: number;
		constructor(combo: BestCombo) {
			this.players1 = new Set([combo.pick1.pick]);
			this.players2 = new Set([combo.pick2.pick]);
			this.players3 = new Set([combo.pick3.pick]);
			this.avg1 = combo.pick1.avg;
			this.avg2 = combo.pick2.avg;
			this.avg3 = combo.pick3.avg;
		}
		merge(combo: BestCombo): boolean {
			if (this.avg1 !== combo.pick1.avg || this.avg2 !== combo.pick2.avg || this.avg3 !== combo.pick3.avg) return false;
			this.players1.add(combo.pick1.pick);
			this.players2.add(combo.pick2.pick);
			this.players3.add(combo.pick3.pick);
			return true;
		}
	}

	class ComboGroup {
		combos: BestCombo[] = [];
		total: number = 0;
		add(pick1: Choice, pick2: Choice, pick3: Choice) {
			const total = pick1.avg + pick2.avg + pick3.avg;
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

	/*
		- opposing: 2 picks from opposing teams in the same game, one pick from another game
		- streak: independent games
		- points: hybrid, best balance, still good for streaks, but leaderboard upside
		- leaderboard: stacking, high variance, bad for streaks

		- streak = all picks from different games
		- points = two picks from the same team, one pick from another game
		- leaderboard = all three picks from the same team
	*/
	const calcCombos = (gameCount: number): {
		top: ComboGroup,
		streak: ComboGroup,
		points: ComboGroup,
		leader: ComboGroup,
		opposing: ComboGroup
	} => {
		const top = new ComboGroup();
		const streak = new ComboGroup();
		const points = new ComboGroup();
		const leader = new ComboGroup();
		const opposing = new ComboGroup();
		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				for (const pick3 of choices3) {
					top.add(pick1, pick2, pick3);
					if (gameCount >= 3) {
						if (!pick1.same(pick2, 'game') &&
							!pick2.same(pick3, 'game') &&
							!pick1.same(pick3, 'game')) {
							streak.add(pick1, pick2, pick3);
						}
					} else if (gameCount === 1) {
						if (pick1.same(pick2, 'on') && pick3.same(pick1, 'opp')) streak.add(pick1, pick2, pick3);
						if (pick1.same(pick3, 'on') && pick2.same(pick1, 'opp')) streak.add(pick1, pick2, pick3);
						if (pick2.same(pick3, 'on') && pick1.same(pick2, 'opp')) streak.add(pick1, pick2, pick3);
					}

					if (gameCount >= 2) {
						if (pick1.same(pick2, 'opp') && !pick3.same(pick1, 'game')) opposing.add(pick1, pick2, pick3);
						if (pick1.same(pick3, 'opp') && !pick2.same(pick1, 'game')) opposing.add(pick1, pick2, pick3);
						if (pick2.same(pick3, 'opp') && !pick1.same(pick2, 'game')) opposing.add(pick1, pick2, pick3);
					} else {
						if (pick1.same(pick2, 'opp')) opposing.add(pick1, pick2, pick3);
						if (pick1.same(pick3, 'opp')) opposing.add(pick1, pick2, pick3);
						if (pick2.same(pick3, 'opp')) opposing.add(pick1, pick2, pick3);
					}

					if (pick1.same(pick2, 'on') && !pick3.same(pick1, 'game')) points.add(pick1, pick2, pick3);
					if (pick1.same(pick3, 'on') && !pick2.same(pick1, 'game')) points.add(pick1, pick2, pick3);
					if (pick2.same(pick3, 'on') && !pick1.same(pick2, 'game')) points.add(pick1, pick2, pick3);

					if (pick1.same(pick2, 'on') && pick2.same(pick3, 'on')) leader.add(pick1, pick2, pick3);
				}
			}
		}
		return {
			top,
			opposing,
			streak,
			points,
			leader
		};
	}

	const comboPrecision = 2;
	const logCalcStats = (avgResult: Result) => {
		const any = roundToPercent(calcAny(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		const avg = roundToPercent(calcAvg(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		const all = roundToPercent(calcAll(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		addLog(`Any: ${any} - Avg: ${avg} - All: ${all}`, 'center');
		logSection++;
	}

	const logHighlights = (avgResult: Result) => {
		addPlayersToHighlight(avgResult.players1);
		addPlayersToHighlight(avgResult.players2);
		addPlayersToHighlight(avgResult.players3);
	}

	const logTopPicks = (avgResult: Result) => {
		addLog(`1: ${roundToPercent(avgResult.avg1, precision)} - ${names(avgResult.players1)}`);
		addLog(`2: ${roundToPercent(avgResult.avg2, precision)} - ${names(avgResult.players2)}`);
		addLog(`3: ${roundToPercent(avgResult.avg3, precision)} - ${names(avgResult.players3)}`);
		logCalcStats(avgResult);
	}

	const logReduced = (avgResult: Result, topResult: Result, totalMax: number): void => {
		let line1 = `1: ${names(avgResult.players1, true)}`;
		let reducedCount = 0;
		if (avgResult.avg1 !== topResult.avg1) {
			reducedCount++;
			line1 += " " + roundToPercent(avgResult.avg1 - topResult.avg1, comboPrecision);
		}
		let line2 = `2: ${names(avgResult.players2, true)}`;
		if (avgResult.avg2 !== topResult.avg2) {
			reducedCount++;
			line2 += " " + roundToPercent(avgResult.avg2 - topResult.avg2, comboPrecision);
		}
		let line3 = `3: ${names(avgResult.players3, true)}`;
		if (avgResult.avg3 !== topResult.avg3) {
			reducedCount++;
			line3 += " " + roundToPercent(avgResult.avg3 - topResult.avg3, comboPrecision);
		}

		addLog(line1);
		addLog(line2);
		addLog(line3);

		if (reducedCount > 1) {
			const total = avgResult.avg1 + avgResult.avg2 + avgResult.avg3;
			addLog(`Total: ${roundToPercent(total - totalMax, comboPrecision)}`, 'center');
		}
		if (reducedCount > 0) logCalcStats(avgResult);
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
	for (const pick of table1Rows) {
		const team = pick.player.team.code;
		if (gamesSet.has(team)) continue;
		gamesSet.add(team);
		const opponent = gamesMap.get(team);
		if (opponent) gamesSet.add(opponent);
		gameCount++;
	}

	const { top, opposing, streak, points, leader } = calcCombos(gameCount);
	if (top.combos.length === 0) return;

	const topResult: Result[] = top.merge();
	const opposingResult: Result[] = opposing.merge();
	const streakResult: Result[] = streak.merge();
	const pointsResult: Result[] = points.merge();
	const leaderResult: Result[] = leader.merge();
	const maxResult: Result = topResult[0];

	addLogTitle("Top Picks");
	for (const avgResult of topResult) {
		logTopPicks(avgResult);
		logHighlights(avgResult);
		addStrategyHighlights(avgResult, 'top');
	}

	/*
		2 games:
		- streak = same as points

		1 game:
		- opposing = 2 picks from opposing teams in the same game, one pick from a same team
		- streak = two picks from the same team, one pick from the opposing team
			Select top picks from opposing teams, and the 3rd from the same team as the stonger player
		- points = same as leaderboard
	*/

	if (gameCount !== 2 && streak.total > 0) {
		addLogTitle("Streak");
		for (const avgResult of streakResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult);
			addStrategyHighlights(avgResult, 'streak');
		}
	}

	if (opposing.total > 0) {
		addLogTitle("Opposing");
		for (const avgResult of opposingResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult);
			addStrategyHighlights(avgResult, 'hybrid');
		}
	}

	if (gameCount > 1 && points.total > 0) {
		if (gameCount === 2) addLogTitle("Streak/Points");
		else addLogTitle("Points");
		for (const avgResult of pointsResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult);
			if (gameCount === 2) addStrategyHighlights(avgResult, 'streak');
			addStrategyHighlights(avgResult, 'point');
		}
	}
	if (leader.total > 0) {
		if (gameCount === 1) addLogTitle("Points/Leaderboard");
		else addLogTitle("Leaderboard");
		for (const avgResult of leaderResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult);
			if (gameCount === 1) addStrategyHighlights(avgResult, 'point');
			addStrategyHighlights(avgResult, 'leaderboard');
		}
	}

	logFooter();
};

export const precalculateLogStats = (
	minSportsbooks: number,
	gamesList: Picks.GameData[],
	table1Rows: Picks.PickOdds[],
	table2Rows: Picks.PickOdds[],
	table3Rows: Picks.PickOdds[]
): Record<LogStatsKey, LogStatsCacheItem> => {
	const keys: LogStatsKey[] = ['bet1', 'bet2', 'bet3', 'bet4', 'betAvg'];
	const cache = {} as Record<LogStatsKey, LogStatsCacheItem>;

	for (const key of keys) {
		const stats: LogStat[] = [];
		calculateStats(key, minSportsbooks, gamesList, table1Rows, table2Rows, table3Rows, stats);
		cache[key] = {
			stats: cloneLogStats(stats),
		};
	}

	return cache;
};
