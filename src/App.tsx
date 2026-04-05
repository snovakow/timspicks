import { useState, useEffect, useMemo } from 'react';
import './App.css';
import './Stats.css';
import * as Picks from './components/Table';
import Popup from './components/Popup';
import InfoPopupContent from './InfoPopupContent';
import SettingsPanel from './components/Settings';
import { poissonChance, roundToPercent, probabilityToAmerican } from './utility';
import logo1 from './images/sb-logo-16-draftkings.svg';
import logo2 from './images/sb-logo-16-fanduel.svg';
import logo3 from './images/sb-logo-16-mgm.svg';
import logo4 from './images/sb-logo-16-betrivers.svg';
import iconSettings from './images/settings_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconStats from './images/leaderboard_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconInfo from './images/info_i_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyDark from './images/sports_hockey_24dp_000000_FILL0_wght400_GRAD0_opsz24.svg';
import iconHockeyLight from './images/sports_hockey_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg';
import type { Team } from './components/logo';

const precision = Picks.precision;

type Sportsbook = {
	key: "bet1" | "bet2" | "bet3" | "bet4";
	title: string;
	logo: string;
};

const sportsbooks: Sportsbook[] = [
	{ key: "bet1", title: "DraftKings", logo: logo1 },
	{ key: "bet2", title: "FanDuel", logo: logo2 },
	{ key: "bet3", title: "BetMGM", logo: logo3 },
	{ key: "bet4", title: "BetRivers", logo: logo4 },
];

const fetchData = async (src: string) => {
	const response = await fetch(src + "?t=" + new Date().getTime());
	if (!response.ok) throw new Error(`Failed to load ${src}: ${response.status} ${response.statusText}`);
	return response;
}
const loadData = async (src: string) => {
	try {
		const response = await fetchData(src);
		const json = await response.json();
		return json;
	} catch (error) {
		console.log(error);
		return [];
	}
}
const playerData = await loadData('./data/helper.json');
const gamesListing = await loadData('./data/games.json');
const playerOddsDraftKings = await loadData('./data/bet1.json');
const playerOddsFanDuel = await loadData('./data/bet2.json');
const playerOddsBetMGM = await loadData('./data/bet3.json');
const playerOddsBetRivers = await loadData('./data/bet4.json');

const oddsNameMap = new Map<string, string>();
oddsNameMap.set("Aatu Räty", "Aatu Raty");
oddsNameMap.set("Alex DeBrincat", "Alex Debrincat"); // BetMGM
oddsNameMap.set("Alexander Wennberg", "Alex Wennberg"); // FanDuel
oddsNameMap.set("Alexis Lafrenière", "Alexis Lafreniere"); // DraftKings FanDuel
oddsNameMap.set("Aliaksei Protas", "Alexei Protas"); // BetRivers (lang)
oddsNameMap.set("Arseny Gritsyuk", "Arseni Gritsyuk"); // BetRivers
oddsNameMap.set("Artem Zub", "Artyom Zub"); // BetRivers
oddsNameMap.set("Axel Sandin-Pellikka", "Axel Sandin Pellikka"); // DraftKings
oddsNameMap.set("Ben Kindel", "Benjamin Kindel"); // BetRivers
oddsNameMap.set("Bo Groulx", "Benoit-Olivier Groulx"); // BetMGM
oddsNameMap.set("Carl Grundstrom", "Carl Grundström"); // BetRivers (lang)
oddsNameMap.set("Charle-Edouard D'Astous", "Charles-Edouard D'Astous"); // BetRivers
oddsNameMap.set("Dmitry Orlov", "Dimitri Orlov"); // BetRivers
oddsNameMap.set("Egor Chinakhov", "Yegor Chinakhov"); // DraftKings BetRivers
oddsNameMap.set("Ethan Del Mastro", "Ethan del Mastro"); // FanDuel
oddsNameMap.set("Gabe Perreault", "Gabriel Perreault"); // BetMGM
oddsNameMap.set("J.J. Moser", "Janis Jérôme Moser"); // BetRivers
oddsNameMap.set("J.T. Compher", "JT Compher"); // BetRivers
oddsNameMap.set("Jake Middleton", "Jacob Middleton"); // BetRivers (lang)
oddsNameMap.set("James van Riemsdyk", "James Van Riemsdyk"); // BetMGM
oddsNameMap.set("JJ Peterka", "John-Jason Peterka"); // BetRivers
oddsNameMap.set("Josh Morrissey", "Joshua Morrissey"); // BetRivers
oddsNameMap.set("Lenni Hameenaho", "Lenni Hämeenaho"); // BetRivers
oddsNameMap.set("Liam Ohgren", "Liam Öhgren"); // BetRivers (lang)
oddsNameMap.set("Martin Fehérváry", "Martin Fehervary");
oddsNameMap.set("Martin Pospisil", "Martin Pospíšil"); // BetRivers (lang)
oddsNameMap.set("Matt Boldy", "Matthew Boldy"); // BetRivers
oddsNameMap.set("Matt Coronato", "Matthew Coronato"); // BetRivers
oddsNameMap.set("Matt Savoie", "Matthew Savoie"); // BetRivers
oddsNameMap.set("Mike Matheson", "Michael Matheson"); // BetRivers
oddsNameMap.set("Mitch Marner", "Mitchell Marner"); // FanDuel BetRivers (lang)
oddsNameMap.set("Nick Paul", "Nicholas Paul"); // FanDuel
oddsNameMap.set("Oliver Bjorkstrand", "Oliver Björkstrand"); // BetRivers
oddsNameMap.set("Olli Määttä", "Olli Maatta"); // DraftKings FanDuel (lang)
oddsNameMap.set("Ondrej Palat", "Ondrej Palát"); // BetRivers (lang mix and match)
oddsNameMap.set("Oskar Bäck", "Oskar Back"); // DraftKings FanDuel
oddsNameMap.set("Sebastian Aho", "Sebastian Aho (CAR)"); // FanDuel, BetRivers
oddsNameMap.set("Shea Theodore", "Shea Théodore"); // BetRivers
oddsNameMap.set("Simon Holmstrom", "Simon Holmström"); // BetRivers (lang)
oddsNameMap.set("Teuvo Teravainen", "Teuvo Teräväinen"); // BetRivers (lang)
oddsNameMap.set("Tim Stützle", "Tim Stuetzle"); // DraftKings
oddsNameMap.set("Tommy Novak", "Thomas Novak"); // BetRivers (lang)
oddsNameMap.set("Trevor van Riemsdyk", "Trevor Van Riemsdyk"); // BetRivers
oddsNameMap.set("Vasily Podkolzin", "Vasili Podkolzin"); // BetRivers (lang)
oddsNameMap.set("Zachary Bolduc", "Zack Bolduc"); // DraftKings

const gamesList: Picks.GameData[] = [];
const playerList: Picks.Player[] = [];

for (const data of gamesListing) {
	const game = new Picks.GameData(data);
	for (const item of data.homeTeam.players) {
		const player = new Picks.Player(item, game.home, game.time);
		playerList.push(player);
	}
	for (const item of data.awayTeam.players) {
		const player = new Picks.Player(item, game.away, game.time);
		playerList.push(player);
	}
	gamesList.push(game);
}
gamesList.sort((a: Picks.GameData, b: Picks.GameData): number => {
	const time = a.time.getTime() - b.time.getTime();
	if (time !== 0) return time;
	return a.away.name.localeCompare(b.away.name);
});

const betDisplayRounded = (chance: number | null): string => {
	if (chance === null) return "-";
	return roundToPercent(chance, precision);
}

const sortFunction = (sortConfig: Picks.SortConfig) => {
	return (a: Picks.PickOdds | Picks.Player, b: Picks.PickOdds | Picks.Player): number => {
		const aPlayer = a instanceof Picks.PickOdds ? a.player : a;
		const bPlayer = b instanceof Picks.PickOdds ? b.player : b;
		for (const key of sortConfig.keyOrder) {
			const aVal = key === 'ggRaw' ? (a as Picks.PickOdds)[key] : aPlayer[key];
			const bVal = key === 'ggRaw' ? (b as Picks.PickOdds)[key] : bPlayer[key];

			if (aVal === null) {
				if (bVal === null) continue;
				return 1;
			}
			if (bVal === null) return -1;

			if (typeof aVal === 'number' && typeof bVal === 'number') {
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

const makeSort = (sortConfig: Picks.SortConfig, setSortConfig: (config: Picks.SortConfig) => void) => {
	return (keyPrimary: Picks.ColumnKeys) => {
		if (sortConfig.keyOrder[0] === keyPrimary) return;
		const keyOrder = [keyPrimary];
		for (const key of sortConfig.keyOrder) {
			if (key === keyPrimary) continue;
			keyOrder.push(key);
		}
		setSortConfig({ keyOrder });
	};
}

const removeAccentsNormalize = (name: string): string => {
	return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

const mapPlayers = () => {
	const playerMap = new Map<number, Picks.Player>();
	for (const player of playerList) {
		playerMap.set(player.playerId, player);
	}

	const makeRows = (data: Picks.OddsItem[], pick: 1 | 2 | 3): Picks.PickOdds[] => {
		const row: Picks.PickOdds[] = [];
		for (const item of data) {
			const playerId = item.playerId < 0 ? -item.playerId : item.playerId;
			let player = playerMap.get(playerId);
			if (!player) {
				console.warn(`Player not found for odds data:`, item);
				const fullName = item.firstName + " " + item.lastName;
				const fullNameNormalized = removeAccentsNormalize(fullName);
				for (const playerItem of playerList) {
					const playerItemNormalized = removeAccentsNormalize(playerItem.fullName);
					if (playerItemNormalized === fullNameNormalized) {
						console.log(`Found player with matching ID:`, playerItem);
						item.playerId = playerItem.playerId;
						player = playerItem;
						break;
					}
				}
			}
			if (player) {
				player.pick = pick;
				row.push(new Picks.PickOdds(player, item));
			}
		}
		return row;
	}

	const table1Rows = makeRows(playerData["1"], 1);
	const table2Rows = makeRows(playerData["2"], 2);
	const table3Rows = makeRows(playerData["3"], 3);
	return { table1Rows, table2Rows, table3Rows };
}
const { table1Rows, table2Rows, table3Rows } = mapPlayers();

const compilePlayerList = () => {
	type betKey = "betRaw1" | "betRaw2" | "betRaw3" | "betRaw4";
	const nameFind = (player: Picks.Player, oddsMap: Map<string, number>, betKey: betKey) => {
		const process = (name: string | undefined): boolean => {
			if (name === undefined) return false;
			const decimal = oddsMap.get(removeAccentsNormalize(name));
			if (decimal === undefined) return false;

			const chance = 1 / decimal;
			player[betKey] = chance;
			return true;
		};

		if (player.fullName === "Elias Pettersson") {
			if (player.playerId === 8480012) {
				if (betKey === 'betRaw1' && process("Elias Pettersson")) return; // DraftKings
				if (betKey === 'betRaw2' && process("Elias Pettersson #40")) return; // FanDuel
				if (betKey === 'betRaw4' && process("Elias Pettersson (1998)")) return; // BetRivers
			}
			if (player.playerId === 8483678) {
				if (betKey === 'betRaw1' && process("Elias-Nils Pettersson")) return; // DraftKings
				if (betKey === 'betRaw2' && process("Elias Pettersson #25")) return; // FanDuel
				if (betKey === 'betRaw4' && process("Elias Pettersson (2004)")) return; // BetRivers
			}
			return;
		}

		const baseName = player.fullName;
		if (process(baseName)) return;

		const mapped = oddsNameMap.get(player.fullName);
		if (mapped && process(mapped)) return;

		const firstLang: Set<string> = new Set();
		for (const lang of Object.keys(player.firstName)) {
			if (lang === "default") continue;

			const first = player.firstName[lang];
			const last = player.lastName[lang] ?? player.lastName.default;
			const name = `${first} ${last}`;

			if (process(name)) return;

			firstLang.add(lang);
		}
		for (const lang of Object.keys(player.lastName)) {
			if (lang === "default") continue;
			if (firstLang.has(lang)) continue;

			const first = player.firstName.default;
			const last = player.lastName[lang];
			const name = `${first} ${last}`;
			if (process(name)) return;
		}
	};

	const bet1 = new Map<string, number>();
	const bet2 = new Map<string, number>();
	const bet3 = new Map<string, number>();
	const bet4 = new Map<string, number>();
	const mapNames = (
		item: { name: string; odds: number },
		betMap: Map<string, number>
	): void => {
		betMap.set(removeAccentsNormalize(item.name), item.odds);
	}
	for (const item of playerOddsDraftKings) mapNames(item, bet1);
	for (const item of playerOddsFanDuel) mapNames(item, bet2);
	for (const item of playerOddsBetMGM) mapNames(item, bet3);
	for (const item of playerOddsBetRivers) mapNames(item, bet4);
	for (const player of playerList) {
		nameFind(player, bet1, 'betRaw1');
		nameFind(player, bet2, 'betRaw2');
		nameFind(player, bet3, 'betRaw3');
		nameFind(player, bet4, 'betRaw4');
		player.bet1 = player.betRaw1;
		player.bet2 = player.betRaw2;
		player.bet3 = player.betRaw3;
		player.bet4 = player.betRaw4;
	}

	// De-vig: correct each sportsbook's bias AND compression toward the
	// peer average (leave-one-out mean).
	//
	// Model: book_prob = c × peer_prob^α  (power-law in probability space)
	//   - c captures uniform multiplicative bias (vig level)
	//   - α captures compression (α<1: highs too low, lows too high)
	//     or expansion (α>1: highs too high, lows too low)
	//
	// Estimated via linear regression in log-log space:
	//   log(book) = log(c) + α·log(peer)
	//
	// Correction: fair = (book / c) ^ (1/α)
	{
		const minProb = 0.0001;
		const maxProb = 0.9999;
		const minBookPlayers = 10;
		const betKeys = ["bet1", "bet2", "bet3", "bet4"] as const;

		// Compute all corrections first (from unmodified values)
		const corrections: Partial<Record<typeof betKeys[number], { c: number; alpha: number }>> = {};
		for (const key of betKeys) {
			// Collect log-log pairs: y = log(book), x = log(peerMean)
			const xs: number[] = [];
			const ys: number[] = [];
			for (const player of playerList) {
				const bookProb = player[key];
				if (bookProb === null) continue;
				let peerSum = 0, peerCount = 0;
				for (const other of betKeys) {
					if (other === key) continue;
					if (player[other] !== null) { peerSum += player[other]!; peerCount++; }
				}
				if (peerCount === 0) continue;
				xs.push(Math.log(peerSum / peerCount));
				ys.push(Math.log(bookProb));
			}
			if (xs.length < minBookPlayers) continue;

			// OLS: y = a + b*x
			const n = xs.length;
			let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
			for (let i = 0; i < n; i++) {
				sumX += xs[i];
				sumY += ys[i];
				sumXX += xs[i] * xs[i];
				sumXY += xs[i] * ys[i];
			}
			const denom = n * sumXX - sumX * sumX;
			if (Math.abs(denom) < 1e-12) continue;
			const alpha = (n * sumXY - sumX * sumY) / denom;
			const logC = (sumY - alpha * sumX) / n;
			const c = Math.exp(logC);

			// Guard: alpha must be positive and reasonable
			if (alpha <= 0.5 || alpha > 2) continue;

			corrections[key] = { c, alpha };
			console.log(`De-vig [${key}]: c=${c.toFixed(4)}, α=${alpha.toFixed(4)} (${n} players)`);
		}

		// Apply all at once: fair = (book / c) ^ (1/α)
		for (const key of betKeys) {
			const corr = corrections[key];
			if (corr === undefined) continue;
			const invAlpha = 1 / corr.alpha;
			for (const player of playerList) {
				if (player[key] === null) continue;
				const fair = Math.pow(player[key]! / corr.c, invAlpha);
				player[key] = Math.min(maxProb, Math.max(minProb, fair));
			}
		}
	}
}
compilePlayerList();

type LogStatAlign = 'left' | 'center';
interface LogStat {
	isTitle: boolean;
	align: LogStatAlign;
	lines: string[];
	break: boolean;
}
const dataStats: LogStat[] = [];

let logSection = 0;
let dataStatsPrev: LogStat | null = null;
const resetLogStats = () => {
	dataStats.length = 0;
	logSection = 0;
	dataStatsPrev = null;
}
const addLog = (line: string, align: LogStatAlign = "left", isTitle: boolean = false) => {
	// console.log(line);
	if (dataStatsPrev) {
		const current = dataStats[logSection];
		if (current) {
			if (current.align === align && current.isTitle === isTitle) {
				current.lines.push(line);
			} else {
				dataStatsPrev = { align, lines: [line], break: false, isTitle };
				logSection++;
				dataStats[logSection] = dataStatsPrev;
			}
		} else {
			dataStatsPrev.break = true;
			dataStatsPrev = { align, lines: [line], break: false, isTitle };
			dataStats[logSection] = dataStatsPrev;
		}
	} else {
		dataStatsPrev = { align, lines: [line], break: false, isTitle };
		dataStats[logSection] = dataStatsPrev;
	}
}
type LogStatsKey = 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg';
type PickIndex = 1 | 2 | 3;
type HighlightByPick = Record<PickIndex, Set<number>>;
interface LogStatsCacheItem {
	stats: LogStat[];
	highlightByPick: HighlightByPick;
}

const logStats = (betKey: LogStatsKey, minSportsbooks: number): HighlightByPick => {
	const highlightByPick: HighlightByPick = {
		1: new Set<number>(),
		2: new Set<number>(),
		3: new Set<number>(),
	};
	const addPlayersToHighlight = (pick: PickIndex, players: Set<Picks.Player>) => {
		for (const player of players) highlightByPick[pick].add(player.playerId);
	};

	const printName = (player: Picks.Player) => `${player.fullName} (${player.team.code})`;

	const names = (players: Set<Picks.Player>) => {
		const names: string[] = [];
		for (const player of players) names.push(printName(player));
		return names.join("\n           ");
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

	type Collide = "on" | "opp" | "team" | "none";
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
				case "team":
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
		type: Collide;
		constructor(type: Collide) {
			this.type = type;
		}
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
		const group = new ComboGroup(type);
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

	/*
		Calculate top picks (None). This reveals the max total.
	
		Top Picks (Independent Games)
		1 - Independent Games with max total

		Top Picks (Any Game / All Games)
		1 - Any or All with max total			
		2 - Remaining Any Game / All Games greater than Independent Games
		3 - Independent Games

		Top Picks
		1 - None
		2 - Any Game greater than Independent Games	
		3 - All Games greater than Independent Games	
		4 - Independent Games

		1: Process team
		If has max total merge and log as Independent Games.

		Process none

	*/

	const comboNone = calcCombo('none');
	if (comboNone.combos.length === 0) return highlightByPick;

	const comboTeam = calcCombo('team');
	const teamResult: Result[] = comboTeam.merge();
	if (comboTeam.total === comboNone.total) {
		addLogTitle("Top Picks");
		for (const avgResult of teamResult) {
			addLog(`1: ${roundToPercent(avgResult.avg1, precision)} - ${names(avgResult.players1)}`);
			addLog(`2: ${roundToPercent(avgResult.avg2, precision)} - ${names(avgResult.players2)}`);
			addLog(`3: ${roundToPercent(avgResult.avg3, precision)} - ${names(avgResult.players3)}`);

			const any = roundToPercent(calcAny(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
			const avg = roundToPercent(calcAvg(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
			const all = roundToPercent(calcAll(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
			addLog(`Any: ${any} - Avg: ${avg} - All: ${all}`, 'center');

			addPlayersToHighlight(1, avgResult.players1);
			addPlayersToHighlight(2, avgResult.players2);
			addPlayersToHighlight(3, avgResult.players3);

			logSection++;
		}
		addLogTitle("Good Ranges");
		addLog("Any: 64.6-70-74% - Avg: 28.7-33-36% - All: 2-3-4%", 'center');

		return highlightByPick;
	}

	const comboAll = calcCombo('opp');
	const comboAny = calcCombo('on');

	const noneResult: Result[] = comboNone.merge();

	const topResult: Result = noneResult[0];
	const totalMax = topResult.avg1 + topResult.avg2 + topResult.avg3;

	const comboPrecision = 2;

	addLogTitle("Top Picks");
	for (const avgResult of noneResult) {
		addLog(`1: ${roundToPercent(avgResult.avg1, precision)} - ${names(avgResult.players1)}`);
		addLog(`2: ${roundToPercent(avgResult.avg2, precision)} - ${names(avgResult.players2)}`);
		addLog(`3: ${roundToPercent(avgResult.avg3, precision)} - ${names(avgResult.players3)}`);

		const any = roundToPercent(calcAny(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		const avg = roundToPercent(calcAvg(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		const all = roundToPercent(calcAll(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		addLog(`Any: ${any} - Avg: ${avg} - All: ${all}`, 'center');
		logSection++;
	}
	addLogTitle("Independent Games");
	for (const avgResult of teamResult) {
		let line1 = `1: ${names(avgResult.players1)}`;
		let reducedCount = 0;
		if (avgResult.avg1 !== topResult.avg1) {
			reducedCount++;
			line1 += " " + roundToPercent(avgResult.avg1 - topResult.avg1, comboPrecision);
		}
		let line2 = `2: ${names(avgResult.players2)}`;
		if (avgResult.avg2 !== topResult.avg2) {
			reducedCount++;
			line2 += " " + roundToPercent(avgResult.avg2 - topResult.avg2, comboPrecision);
		}
		let line3 = `3: ${names(avgResult.players3)}`;
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

		const any = roundToPercent(calcAny(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		const avg = roundToPercent(calcAvg(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		const all = roundToPercent(calcAll(avgResult.avg1, avgResult.avg2, avgResult.avg3), precision);
		addLog(`Any: ${any} - Avg: ${avg} - All: ${all}`, 'center');

		addPlayersToHighlight(1, avgResult.players1);
		addPlayersToHighlight(2, avgResult.players2);
		addPlayersToHighlight(3, avgResult.players3);
		logSection++;
	}
	addLogTitle("Good Ranges");
	addLog("Any: 64.6-70-74% - Avg: 28.7-33-36% - All: 2-3-4%", 'center');

	return highlightByPick;
}
const addLogTitle = (title: string) => {
	addLog(title, 'center', true);
}

const cloneLogStats = (stats: LogStat[]): LogStat[] => {
	return stats.map((stat) => ({
		...stat,
		lines: [...stat.lines],
	}));
};

const precalculateLogStats = (minSportsbooks: number): Record<LogStatsKey, LogStatsCacheItem> => {
	const keys: LogStatsKey[] = ['bet1', 'bet2', 'bet3', 'bet4', 'betAvg'];
	const cache = {} as Record<LogStatsKey, LogStatsCacheItem>;
	for (const key of keys) {
		resetLogStats();
		const highlightByPick = logStats(key, minSportsbooks);
		cache[key] = {
			stats: cloneLogStats(dataStats),
			highlightByPick,
		};
	}
	resetLogStats();
	return cache;
};

const oddsColumns: Picks.ColumnData[] = sportsbooks.map((book) => ({
	key: book.key,
	title: book.title,
	sort: true,
	logo: book.logo,
}));

const columns: Picks.ColumnData[] = [
	{ key: "fullName", title: "Player", sort: true },
	{ key: "ggRaw", title: "G/GP", sort: true },
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

type processKeys = 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg';
const processMax = (row: Picks.PickOdds, max: Picks.PickOdds[], key: processKeys) => {
	const rowVal = row.player[key];
	if (rowVal === null) return;

	if (max.length === 0) {
		max.push(row);
		return;
	}

	const topBet = max[0].player[key]!;
	if (rowVal === topBet) {
		max.push(row);
	} else {
		if (rowVal > topBet) max.splice(0, max.length, row);
	}
}
const processMaxArray = (array: Picks.PickOdds[], minSportsbooks: number) => {
	const max1: Picks.PickOdds[] = [];
	const max2: Picks.PickOdds[] = [];
	const max3: Picks.PickOdds[] = [];
	const max4: Picks.PickOdds[] = [];
	const maxAvg: Picks.PickOdds[] = [];
	for (const row of array) {
		row.highlight1 = false;
		row.highlight2 = false;
		row.highlight3 = false;
		row.highlight4 = false;
		row.highlightAvg = false;
		processMax(row, max1, 'bet1');
		processMax(row, max2, 'bet2');
		processMax(row, max3, 'bet3');
		processMax(row, max4, 'bet4');
		if (row.player.betCount >= minSportsbooks) processMax(row, maxAvg, 'betAvg');
	}
	for (const row of max1) row.highlight1 = true;
	for (const row of max2) row.highlight2 = true;
	for (const row of max3) row.highlight3 = true;
	for (const row of max4) row.highlight4 = true;
	for (const row of maxAvg) row.highlightAvg = true;
}

const applyAllStatsHighlights = (statsCache: Record<LogStatsKey, LogStatsCacheItem>, minSportsbooks: number) => {
	const rows = [table1Rows, table2Rows, table3Rows];
	for (const tableRows of rows) {
		for (const row of tableRows) {
			row.statsHighlight1 = false;
			row.statsHighlight2 = false;
			row.statsHighlight3 = false;
			row.statsHighlight4 = false;
			row.statsHighlightAvg = false;
		}
	}

	const applyToRows = (
		rows: Picks.PickOdds[],
		pick: PickIndex,
		highlightByPick: HighlightByPick,
		key: LogStatsKey,
	) => {
		const playerIds = highlightByPick[pick];
		for (const row of rows) {
			if (!playerIds.has(row.player.playerId)) continue;
			if (key === 'bet1') row.statsHighlight1 = true;
			else if (key === 'bet2') row.statsHighlight2 = true;
			else if (key === 'bet3') row.statsHighlight3 = true;
			else if (key === 'bet4') row.statsHighlight4 = true;
			else if (row.player.betCount >= minSportsbooks) row.statsHighlightAvg = true;
		}
	};

	const keys: LogStatsKey[] = ['bet1', 'bet2', 'bet3', 'bet4', 'betAvg'];
	for (const key of keys) {
		const highlightByPick = statsCache[key].highlightByPick;
		applyToRows(table1Rows, 1, highlightByPick, key);
		applyToRows(table2Rows, 2, highlightByPick, key);
		applyToRows(table3Rows, 3, highlightByPick, key);
	}
};

type DisplayState = {
	showPercentage: boolean;
	deVigEnabled: boolean;
	minSportsbooks: number;
};

const updateDisplayState = (state: DisplayState): Record<LogStatsKey, LogStatsCacheItem> => {
	type keyType = 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betRaw1' | 'betRaw2' | 'betRaw3' | 'betRaw4';
	const [key1, key2, key3, key4]: keyType[] = state.deVigEnabled
		? ['bet1', 'bet2', 'bet3', 'bet4']
		: ['betRaw1', 'betRaw2', 'betRaw3', 'betRaw4'];

	const allRows = [table1Rows, table2Rows, table3Rows];
	for (const rows of allRows) {
		for (const row of rows) {
			row.ggDisplay = state.showPercentage
				? poissonChance(row.ggRaw, precision)
				: row.ggRaw.toFixed(2);
		}
	}

	for (const player of playerList) {
		const values = [player[key1], player[key2], player[key3], player[key4]];
		const rawValues = [player.betRaw1, player.betRaw2, player.betRaw3, player.betRaw4];
		const displays = ['betDisplay1', 'betDisplay2', 'betDisplay3', 'betDisplay4'] as const;

		for (let i = 0; i < values.length; i++) {
			const value = values[i];
			if (value === null) continue;
			player[displays[i]] = state.showPercentage
				? roundToPercent(value, precision)
				: probabilityToAmerican(rawValues[i]);
		}

		let count = 0;
		let avg = 0;
		for (const value of values) {
			if (value === null) continue;
			avg += value;
			count++;
		}

		player.betCount = count;
		if (count > 0) {
			player.betAvg = avg / count;
			player.betDisplayAvg = betDisplayRounded(player.betAvg);
		} else {
			player.betAvg = null;
			player.betDisplayAvg = '-';
		}
	}

	processMaxArray(table1Rows, state.minSportsbooks);
	processMaxArray(table2Rows, state.minSportsbooks);
	processMaxArray(table3Rows, state.minSportsbooks);

	const statsCache = precalculateLogStats(state.minSportsbooks);
	applyAllStatsHighlights(statsCache, state.minSportsbooks);
	return statsCache;
}
function App() {
	const [showPercentage, setShowPercentage] = useState(true);
	const [deVigEnabled, setDeVigEnabled] = useState(true);
	const [minSportsbooks, setMinSportsbooks] = useState(3);

	const statsCache = useMemo(
		() => updateDisplayState({ showPercentage, deVigEnabled, minSportsbooks }),
		[showPercentage, deVigEnabled, minSportsbooks]
	);

	const [showPopup, setShowPopup] = useState({ visible: false, title: 'Stats', key: 'betAvg' });
	const [popupStats, setPopupStats] = useState<LogStat[]>(() => cloneLogStats(statsCache.betAvg.stats));
	const [popupView, setPopupView] = useState<'info' | 'stats' | 'settings'>('stats');

	const closePopup = () => {
		setShowPopup({ ...showPopup, visible: false });
	};

	const openStatsPopup = (key: LogStatsKey, title: string) => {
		const cached = statsCache[key];
		setPopupStats(cloneLogStats(cached.stats));
		setPopupView('stats');
		setShowPopup({ visible: true, title, key });
	};

	const openInfoPopup = () => {
		setPopupView('info');
		setShowPopup({ visible: true, title: 'Info', key: showPopup.key });
	};

	const openSettingsPopup = () => {
		setPopupView('settings');
		setShowPopup({ visible: true, title: 'Settings', key: showPopup.key });
	};

	const [rows1] = useState(table1Rows);
	const sortedRows1 = [...rows1];

	const [rows2] = useState(table2Rows);
	const sortedRows2 = [...rows2];

	const [rows3] = useState(table3Rows);
	const sortedRows3 = [...rows3];

	const [rowsPlayer] = useState(playerList);
	const sortedRowsPlayer = [...rowsPlayer];

	// Theme state
	const [darkTheme, setDarkTheme] = useState(() => {
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	});
	// Update theme when system preference changes
	useEffect(() => {
		const handleChange = (event: MediaQueryListEvent) => {
			setDarkTheme(event.matches);
		};
		const darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
		darkModeMql.addEventListener('change', handleChange);
		return () => darkModeMql.removeEventListener('change', handleChange);
	}, []);

	const [sortConfig1, setSortConfig1] = useState<Picks.SortConfig>({ keyOrder: ['ggRaw'] });
	const [sortConfig2, setSortConfig2] = useState<Picks.SortConfig>({ keyOrder: ['ggRaw'] });
	const [sortConfig3, setSortConfig3] = useState<Picks.SortConfig>({ keyOrder: ['ggRaw'] });
	const [sortConfigPlayer, setSortConfigPlayer] = useState<Picks.SortConfig>({ keyOrder: ['betAvg'] });

	sortedRows1.sort(sortFunction(sortConfig1));
	sortedRows2.sort(sortFunction(sortConfig2));
	sortedRows3.sort(sortFunction(sortConfig3));
	sortedRowsPlayer.sort(sortFunction(sortConfigPlayer));

	const requestSort1: Picks.RequestSort = makeSort(sortConfig1, setSortConfig1);
	const requestSort2: Picks.RequestSort = makeSort(sortConfig2, setSortConfig2);
	const requestSort3: Picks.RequestSort = makeSort(sortConfig3, setSortConfig3);
	const requestSortPlayer: Picks.RequestSort = makeSort(sortConfigPlayer, setSortConfigPlayer);

	return (
		<>
			<header>
				<div className='toolBar' style={{ justifySelf: 'start' }}>
					<button className="button"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'settings') closePopup();
								else openSettingsPopup();
							}
						}
						aria-label="Settings">
						<img src={iconSettings} alt="⚙" />
					</button>
					<button className="button"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'stats') closePopup();
								else openStatsPopup('betAvg', 'Stats');
							}
						}>
						<img src={iconStats} alt="?" />
					</button>
				</div>
				<span className="header-title">
					<img className="header-title-icon" src={darkTheme ? iconHockeyLight : iconHockeyDark} alt="" aria-hidden="true" />
					Tims Hockey Picks
				</span>
				<div className='toolBar' style={{ justifySelf: 'end' }}>
					<button className="button"
						onClick={
							() => {
								if (showPopup.visible && popupView === 'info') closePopup();
								else openInfoPopup();
							}
						}>
						<img src={iconInfo} alt="i" />
					</button>
				</div>
			</header>
			<main className='content'>
				<Popup title={showPopup.title} showPopUp={showPopup.visible} closePopUp={closePopup}>
					{popupView === 'info' ? (
						<InfoPopupContent />
					) : popupView === 'settings' ? (
						<SettingsPanel
							showPercentage={showPercentage}
							onShowPercentageChange={setShowPercentage}
							deVigEnabled={deVigEnabled}
							onDeVigEnabledChange={setDeVigEnabled}
							minSportsbooks={minSportsbooks}
							onMinSportsbooksChange={setMinSportsbooks}
						/>
					) : (
						<>
							{
								popupStats.map((stat, i) => {
									let className = 'popup-section';
									if (stat.break) className += ' popup-section-break';
									if (stat.isTitle) className += ' popup-section-title';
									return (
										<div key={i} className={className} style={{ textAlign: stat.align }}>
											{stat.lines.map((line, j) => (
												<div key={j}>{line}</div>
											))}
										</div>
									)
								})
							}
						</>
					)}
				</Popup>

				<div className="table-container">
					<h2>Sportsbooks</h2>
					<div className="sportsbook-list">
						{sportsbooks.map((book) => (
							<button
								key={book.key}
								type="button"
								className="sportsbook-item"
								aria-label={book.title}
								onClick={() => openStatsPopup(book.key, book.title)}>
								<img className="sportsbook-logo logo-rounded" src={book.logo} alt={`${book.title} logo`} />
								<span>{book.title}</span>
							</button>
						))}
					</div>
				</div>
				<div className="table-container">
					<h2>Games</h2>
					<Picks.Basic games={gamesList} darkTheme={darkTheme} />
				</div>
				<div className="table-container">
					<h2>Pick #1</h2>
					<Picks.Table columns={columns} sortedRows={sortedRows1} requestSort={requestSort1} sortConfig={sortConfig1} darkTheme={darkTheme} />
				</div>
				<div className="table-container">
					<h2>Pick #2</h2>
					<Picks.Table columns={columns} sortedRows={sortedRows2} requestSort={requestSort2} sortConfig={sortConfig2} darkTheme={darkTheme} />
				</div>
				<div className="table-container">
					<h2>Pick #3</h2>
					<Picks.Table columns={columns} sortedRows={sortedRows3} requestSort={requestSort3} sortConfig={sortConfig3} darkTheme={darkTheme} />
				</div>
				<div className="table-container">
					<h2>Players</h2>
					<Picks.Table columns={columnsPlayer} sortedRows={sortedRowsPlayer} requestSort={requestSortPlayer} sortConfig={sortConfigPlayer} darkTheme={darkTheme} />
				</div>
			</main>
		</>
	)
}

export default App
