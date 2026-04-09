import * as Picks from './components/Table';
import { roundToPercent } from './utility';
import type { Team } from './components/logo';
import { type Pick, optimizePicks } from './picksOptimizer';

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
export type StatsHighlightMode = 'top' | 'top-optimum' | 'optimum';
export type HighlightByPick = Record<PickIndex, Map<number, StatsHighlightMode>>;

export interface LogStatsCacheItem {
	stats: LogStat[];
	highlightByPick: HighlightByPick;
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
): HighlightByPick => {
	let logSection = 0;
	let dataStatsPrev: LogStat | null = null;

	if (betKey === 'betAvg') {
		const gamesMap = new Map<Team, string>();
		for (const game of gamesList) {
			const gameName = `${game.away.code} @ ${game.home.code}`;
			gamesMap.set(game.home.code, gameName);
			gamesMap.set(game.away.code, gameName);
		}

		const mod = (players: Picks.PickOdds[]): Pick[] => {
			return players.filter((item) => item.player.betAvg).map(
				(item: Picks.PickOdds): Pick => {
					const player = item.player;
					return {
						name: player.fullName,
						prob: player.betAvg ?? 0,
						team: player.team.code,
						gameId: gamesMap.get(player.team.code) ?? player.team.code,
					};
				}
			)
		};
		const p1 = mod(table1Rows);
		const p2 = mod(table2Rows);
		const p3 = mod(table3Rows);
		console.log(optimizePicks(p1, p2, p3));
	}

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

	const highlightByPick: HighlightByPick = {
		1: new Map<number, StatsHighlightMode>(),
		2: new Map<number, StatsHighlightMode>(),
		3: new Map<number, StatsHighlightMode>(),
	};

	const addPlayersToHighlight = (pick: PickIndex, players: Set<Picks.Player>, mode: StatsHighlightMode) => {
		for (const player of players) {
			const has = highlightByPick[pick].get(player.playerId);
			if (has) {
				if (has === 'top-optimum') continue;
				if (has === 'top' && mode === 'optimum') highlightByPick[pick].set(player.playerId, 'top-optimum');
				else highlightByPick[pick].set(player.playerId, mode);
			} else {
				highlightByPick[pick].set(player.playerId, mode);
			}
		}
	};

	const printName = (player: Picks.Player) => `${player.fullName} (${player.team.code})`;
	const names = (players: Set<Picks.Player>, shortTab: boolean = false) => {
		const names: string[] = [];
		for (const player of players) names.push(printName(player));
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
		player: Picks.Player;
		on: Team;
		opp: Team;
		constructor(player: Picks.Player, avg: number, opp: Team) {
			this.avg = avg;
			this.player = player;
			this.on = player.team.code;
			this.opp = opp;
		}
		collides(player: Picks.Player, mode: Collide): boolean {
			switch (mode) {
				case "on":
					return this.on === player.team.code;
				case "opp":
					return this.opp === player.team.code;
				case "game":
					return this.on === player.team.code || this.opp === player.team.code;
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
			choices.push(new Choice(row.player, avg, opp));
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
		players1: Set<Picks.Player>;
		players2: Set<Picks.Player>;
		players3: Set<Picks.Player>;
		avg1: number;
		avg2: number;
		avg3: number;
		constructor(combo: BestCombo) {
			this.players1 = new Set([combo.pick1.player]);
			this.players2 = new Set([combo.pick2.player]);
			this.players3 = new Set([combo.pick3.player]);
			this.avg1 = combo.pick1.avg;
			this.avg2 = combo.pick2.avg;
			this.avg3 = combo.pick3.avg;
		}
		merge(combo: BestCombo): boolean {
			if (this.avg1 !== combo.pick1.avg || this.avg2 !== combo.pick2.avg || this.avg3 !== combo.pick3.avg) return false;
			this.players1.add(combo.pick1.player);
			this.players2.add(combo.pick2.player);
			this.players3.add(combo.pick3.player);
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
		- streak: independent games
		- points: hybrid, best balance, still good for streaks, but leaderboard upside
		- leaderboard: stacking, high variance, bad for streaks

		- streak = all picks from different games
		- points = two picks from the same team, one pick from another game
		- leaderboard = all three picks from the same team

		2 games:
		- streak = same as points

		1 game:
		- streak = two picks from the same team, one pick from the opposing team
			Select top picks from opposing teams, and the 3rd from the same team as the stonger player
		- points = same as leaderboard
	*/
	const calcCombos = (): { top: ComboGroup, streak: ComboGroup, points: ComboGroup, leader: ComboGroup } => {
		const top = new ComboGroup();
		const streak = new ComboGroup();
		const points = new ComboGroup();
		const leader = new ComboGroup();
		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				for (const pick3 of choices3) {
					top.add(pick1, pick2, pick3);
					if (gamesList.length >= 3) {
						if (!pick1.collides(pick2.player, 'game') &&
							!pick2.collides(pick3.player, 'game') &&
							!pick1.collides(pick3.player, 'game')) {
							streak.add(pick1, pick2, pick3);
						}
					}

					if (pick1.collides(pick2.player, 'on') &&
						!pick3.collides(pick1.player, 'game')) {
						points.add(pick1, pick2, pick3);
						if (gamesList.length === 2) streak.add(pick1, pick2, pick3);
					}
					if (pick1.collides(pick3.player, 'on') &&
						!pick2.collides(pick1.player, 'game')) {
						points.add(pick1, pick2, pick3);
						if (gamesList.length === 2) streak.add(pick1, pick2, pick3);
					}
					if (pick2.collides(pick3.player, 'on') &&
						!pick1.collides(pick2.player, 'game')) {
						points.add(pick1, pick2, pick3);
						if (gamesList.length === 2) streak.add(pick1, pick2, pick3);
					}

					if (pick1.collides(pick2.player, 'on') && pick2.collides(pick3.player, 'on')) {
						leader.add(pick1, pick2, pick3);
						if (gamesList.length === 1) points.add(pick1, pick2, pick3);
					}

					if (gamesList.length === 1) {
						if (pick1.collides(pick2.player, 'on') &&
							pick3.collides(pick1.player, 'opp')) {
							streak.add(pick1, pick2, pick3);
						}
						if (pick1.collides(pick3.player, 'on') &&
							pick2.collides(pick1.player, 'opp')) {
							streak.add(pick1, pick2, pick3);
						}
						if (pick2.collides(pick3.player, 'on') &&
							pick1.collides(pick2.player, 'opp')) {
							streak.add(pick1, pick2, pick3);
						}
					}
				}
			}
		}
		return {
			top,
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

	const logHighlights = (avgResult: Result, mode: StatsHighlightMode) => {
		addPlayersToHighlight(1, avgResult.players1, mode);
		addPlayersToHighlight(2, avgResult.players2, mode);
		addPlayersToHighlight(3, avgResult.players3, mode);
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
		addLog("Any: 66-67% - Avg: 30-31% - All: 2-3%", 'center');
		return highlightByPick;
	}

	const { top, streak, points, leader } = calcCombos();
	if (top.combos.length === 0) return highlightByPick;

	const topResult: Result[] = top.merge();
	const streakResult: Result[] = streak.merge();
	const pointsResult: Result[] = points.merge();
	const leaderResult: Result[] = leader.merge();

	addLogTitle("Top Picks");
	for (const avgResult of topResult) {
		logTopPicks(avgResult);
		logHighlights(avgResult, 'top');
	}

	const maxResult: Result = topResult[0];

	if (gamesList.length > 2 && streak.total > 0) {
		addLogTitle("Streak");
		for (const avgResult of streakResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult, 'optimum');
		}
	}
	if (gamesList.length > 1 && points.total > 0) {
		if (gamesList.length === 2) addLogTitle("Streak/Points");
		else addLogTitle("Points");
		for (const avgResult of pointsResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult, 'optimum');
		}
	}
	if (leader.total > 0) {
		if (gamesList.length === 1) addLogTitle("Points/Leaderboard");
		else addLogTitle("Leaderboard");
		for (const avgResult of leaderResult) {
			logReduced(avgResult, maxResult, top.total);
			logHighlights(avgResult, 'optimum');
		}
	}

	return logFooter();
};

// 2023-10-10 2024-04-19 2024-04-20 2024-06-24
// 2024-10-04 2025-04-17 2025-04-19 2025-06-17
// 2025-10-07 2026-04-16 2026-04-18
// https://api.hockeychallengehelper.com/api/history?datetime=2026-04-08

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
		const highlightByPick = calculateStats(key, minSportsbooks, gamesList, table1Rows, table2Rows, table3Rows, stats);
		cache[key] = {
			stats: cloneLogStats(stats),
			highlightByPick,
		};
	}

	return cache;
};
