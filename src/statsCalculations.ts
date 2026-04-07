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
export type StatsHighlightMode = 'opp' | 'independent';
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
			highlightByPick[pick].set(player.playerId, mode);
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

	type Collide = "on" | "opp" | "game" | "none";
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

	const calcCombo = (type: Collide): ComboGroup => {
		const group = new ComboGroup();
		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				if (pick2.collides(pick1.player, type)) continue;
				for (const pick3 of choices3) {
					if (pick3.collides(pick1.player, type) || pick3.collides(pick2.player, type)) continue;
					group.add(pick1, pick2, pick3);
				}
			}
		}
		return group;
	}

	const calcComboWithOpposing = (oppTeam: Team): ComboGroup => {
		const group = new ComboGroup();
		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				for (const pick3 of choices3) {
					if (
						pick1.player.team.code !== oppTeam
						&& pick2.player.team.code !== oppTeam
						&& pick3.player.team.code !== oppTeam
					) continue;
					group.add(pick1, pick2, pick3);
				}
			}
		}
		return group;
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
	}

	const logReduced = (avgResult: Result, topResult: Result, totalMax: number) => {
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
	}

	const logFooter = () => {
		addLogTitle("Good Ranges");
		addLog("Any: 66-67% - Avg: 30-31% - All: 2-3%", 'center');
		return highlightByPick;
	}

	const comboNone = calcCombo('none');
	if (comboNone.combos.length === 0) return highlightByPick;

	const comboIndependent = calcCombo('game');
	const independentResult: Result[] = comboIndependent.merge();
	const totalMax = comboNone.total;

	if (comboIndependent.total === totalMax) {
		addLogTitle("Top Picks");
		for (const avgResult of independentResult) {
			logTopPicks(avgResult);
			logCalcStats(avgResult);
			logHighlights(avgResult, 'independent');
		}
		return logFooter();
	}

	const noneResult: Result[] = comboNone.merge();
	const topResult: Result = noneResult[0];

	const comboAny = calcCombo('on');
	const anyResult = comboAny.merge();

	if (comboAny.total === totalMax) {
		addLogTitle("Top Picks (Any Game)");
		for (const avgResult of anyResult) {
			logTopPicks(avgResult);
			logCalcStats(avgResult);
			logHighlights(avgResult, 'opp');
		}

		if (comboIndependent.total > 0) {
			addLogTitle("Independent Games");
			for (const avgResult of independentResult) {
				logReduced(avgResult, topResult, totalMax);
				logCalcStats(avgResult);
				logHighlights(avgResult, 'independent');
			}
		}
		return logFooter();
	}

	addLogTitle("Top Picks");
	for (const avgResult of noneResult) {
		logTopPicks(avgResult);
		logCalcStats(avgResult);
	}

	if (comboAny.total > comboIndependent.total) {
		addLogTitle("Any Game");
		for (const avgResult of anyResult) {
			logReduced(avgResult, topResult, totalMax);
			logCalcStats(avgResult);
			logHighlights(avgResult, 'opp');
		}
	}

	if (comboIndependent.total > 0) {
		addLogTitle("Independent Games");
		for (const avgResult of independentResult) {
			logReduced(avgResult, topResult, totalMax);
			logCalcStats(avgResult);
			logHighlights(avgResult, 'independent');
		}
	}

	if (gamesList.length === 1) {
		const topTeams = new Set<Team>();
		for (const avgResult of noneResult) {
			for (const player of avgResult.players1) topTeams.add(player.team.code);
			for (const player of avgResult.players2) topTeams.add(player.team.code);
			for (const player of avgResult.players3) topTeams.add(player.team.code);
		}
		if (topTeams.size === 1) {
			const [topTeam] = topTeams;
			const oppTeam = gamesMap.get(topTeam);
			if (oppTeam !== undefined) {
				const oppCombo = calcComboWithOpposing(oppTeam);
				if (oppCombo.total > 0) {
					addLogTitle("Any Game");
					for (const avgResult of oppCombo.merge()) {
						logReduced(avgResult, topResult, totalMax);
						logCalcStats(avgResult);
						logHighlights(avgResult, 'opp');
					}
				}
			}
		}
	}

	return logFooter();
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
		const highlightByPick = calculateStats(key, minSportsbooks, gamesList, table1Rows, table2Rows, table3Rows, stats);
		cache[key] = {
			stats: cloneLogStats(stats),
			highlightByPick,
		};
	}

	return cache;
};
