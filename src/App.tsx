import { useState, useEffect } from 'react';
import './App.css';
import * as Picks from './components/Table';
import Popup from './components/Popup';
import { roundToPercent } from './utility';
import logo1 from './images/sb-logo-16-draftkings.svg';
import logo2 from './images/sb-logo-16-fanduel.svg';
import logo3 from './images/sb-logo-16-mgm.svg';
import logo4 from './images/sb-logo-16-betrivers.svg';
import stats from './images/leaderboard.svg';
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
			const aVal = key === 'gg' ? (a as Picks.PickOdds)[key] : aPlayer[key];
			const bVal = key === 'gg' ? (b as Picks.PickOdds)[key] : bPlayer[key];

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
				console.warn(`Player not found for odds data:`, data);
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
	type betKey = "bet1" | "bet2" | "bet3" | "bet4";
	type betDisplayKey = "betDisplay1" | "betDisplay2" | "betDisplay3" | "betDisplay4";
	const nameFind = (player: Picks.Player, oddsMap: Map<string, number>, betKey: betKey, betDisplayKey: betDisplayKey) => {
		const process = (name: string | undefined): boolean => {
			if (name === undefined) return false;
			const decimal = oddsMap.get(removeAccentsNormalize(name));
			if (decimal === undefined) return false;

			const chance = 1 / decimal;
			player[betKey] = chance;
			player[betDisplayKey] = betDisplayRounded(chance);
			return true;
		};

		if (player.fullName === "Elias Pettersson") {
			if (player.playerId === 8480012) {
				if (betKey === 'bet1' && process("Elias Pettersson")) return; // DraftKings
				if (betKey === 'bet2' && process("Elias Pettersson #40")) return; // FanDuel
				if (betKey === 'bet4' && process("Elias Pettersson (1998)")) return; // BetRivers
			}
			if (player.playerId === 8483678) {
				if (betKey === 'bet1' && process("Elias-Nils Pettersson")) return; // DraftKings
				if (betKey === 'bet2' && process("Elias Pettersson #25")) return; // FanDuel
				if (betKey === 'bet4' && process("Elias Pettersson (2004)")) return; // BetRivers
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
		nameFind(player, bet1, "bet1", "betDisplay1");
		nameFind(player, bet2, "bet2", "betDisplay2");
		nameFind(player, bet3, "bet3", "betDisplay3");
		nameFind(player, bet4, "bet4", "betDisplay4");
	}

	const deVig = true;
	if (deVig) {
		const minProb = 0.0001;
		const maxProb = 0.9999;
		// Fully normalize each book to the cross-book level for the most accurate average.
		const shrinkage = 1;
		const betKeys = ["bet1", "bet2", "bet3", "bet4"] as const;

		// Compute per-book global average across all players that have 2+ books.
		const bookTotals: Record<string, { sum: number; count: number }> = {};
		const crossBookTotals: Record<string, { sum: number; count: number }> = {};
		for (const key of betKeys) {
			bookTotals[key] = { sum: 0, count: 0 };
			crossBookTotals[key] = { sum: 0, count: 0 };
		}
		for (const player of playerList) {
			let peerSum = 0, peerCount = 0;
			for (const key of betKeys) {
				if (player[key] !== null) { peerSum += player[key]!; peerCount++; }
			}
			if (peerCount < 2) continue;
			const crossMean = peerSum / peerCount;
			for (const key of betKeys) {
				if (player[key] === null) continue;
				bookTotals[key].sum += player[key]!;
				bookTotals[key].count++;
				crossBookTotals[key].sum += crossMean;
				crossBookTotals[key].count++;
			}
		}

		// Scale each book uniformly toward the cross-book level (preserves relative player diffs).
		for (const key of betKeys) {
			if (bookTotals[key].count === 0) continue;
			const bookAvg = bookTotals[key].sum / bookTotals[key].count;
			const crossAvg = crossBookTotals[key].sum / crossBookTotals[key].count;
			if (bookAvg === 0) continue;
			const rawScale = crossAvg / bookAvg;
			// Blend: 1 = no adjustment, rawScale = full adjustment.
			const scale = 1 + (rawScale - 1) * shrinkage;

			for (const player of playerList) {
				if (player[key] === null) continue;
				const scaled = Math.min(maxProb, Math.max(minProb, player[key]! * scale));
				player[key] = scaled;
				const displayKey = `betDisplay${key.slice(-1)}` as betDisplayKey;
				player[displayKey] = betDisplayRounded(scaled);
			}
		}
	}

	for (const player of playerList) {
		let count = 0;
		let avg = 0;
		if (player.bet1 !== null) { avg += player.bet1; count++; }
		if (player.bet2 !== null) { avg += player.bet2; count++; }
		if (player.bet3 !== null) { avg += player.bet3; count++; }
		if (player.bet4 !== null) { avg += player.bet4; count++; }
		if (count > 0) {
			avg /= count;
			player.betAvg = avg;
			player.betDisplayAvg = betDisplayRounded(avg);
		}
	}
	playerList.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
compilePlayerList();

type LogStatAlign = "left" | "center";
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
			if (current.align === align) {
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
const logStats = (betKey: 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg') => {
	interface Avg {
		avg: number;
		player: Picks.Player;
	}
	interface AvgResult {
		avg: number;
		players: Picks.Player[];
	}

	const calulateAvgRows = (rows: Picks.PickOdds[]): Avg[] => {
		const avgs: Avg[] = [];
		for (const row of rows) {
			const playerBetKey = row.player[betKey];
			if (playerBetKey === null) continue;
			avgs.push({ avg: playerBetKey, player: row.player });
		}
		return avgs;
	}
	const avg1rows: Avg[] = calulateAvgRows(table1Rows);
	const avg2rows: Avg[] = calulateAvgRows(table2Rows);
	const avg3rows: Avg[] = calulateAvgRows(table3Rows);

	const processRow = (rows: Avg[]): AvgResult | null => {
		let max: AvgResult | null = null;
		for (const row of rows) {
			const player = row.player;
			const val = row.avg;
			if (!max) {
				max = { avg: val, players: [player] };
				continue;
			}

			const maxval = max.avg;
			if (val < maxval) continue;
			if (val > maxval) max = { avg: val, players: [player] };
			else max.players.push(player);
		}
		return max;
	};

	const max1row = processRow(avg1rows);
	const max2row = processRow(avg2rows);
	const max3row = processRow(avg3rows);

	if (!max1row || !max2row || !max3row) return;

	const printName = (player: Picks.Player) => `${player.fullName} (${player.team.code})`;

	const names = (players: AvgResult) => {
		return players.players.map(player => printName(player)).join("\n           ");
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

	const logRoot = () => {
		addLog(`1: ${roundToPercent(max1row.avg, precision)} - ${names(max1row)}`);
		addLog(`2: ${roundToPercent(max2row.avg, precision)} - ${names(max2row)}`);
		addLog(`3: ${roundToPercent(max3row.avg, precision)} - ${names(max3row)}`);

		const any = roundToPercent(calcAny(max1row.avg, max2row.avg, max3row.avg), precision);
		const avg = roundToPercent(calcAvg(max1row.avg, max2row.avg, max3row.avg), precision);
		const all = roundToPercent(calcAll(max1row.avg, max2row.avg, max3row.avg), precision);
		addLog(`Any: ${any} - Avg: ${avg} - All: ${all}`, "center");
		logSection++;
	}

	if (gamesList.length < 3) {
		logRoot();
	} else {
		const gamesMap = new Map<Team, Team>();
		for (const game of gamesList) {
			gamesMap.set(game.home.code, game.away.code);
			gamesMap.set(game.away.code, game.home.code);
		}

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
			collides(player: Picks.Player): boolean {
				return this.on === player.team.code || this.opp === player.team.code;
			}
		}

		const makeChoices = (list: Picks.PickOdds[]): Choice[] => {
			const choices: Choice[] = [];
			for (const row of list) {
				const avg = row.player[betKey];
				if (avg === null) continue;
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
			total: number;
		}

		let bestCombos: BestCombo[] = [];
		let maxCombo = 0;
		for (const pick1 of choices1) {
			for (const pick2 of choices2) {
				if (pick2.collides(pick1.player)) continue;
				for (const pick3 of choices3) {
					if (pick3.collides(pick1.player) || pick3.collides(pick2.player)) continue;
					const total = pick1.avg + pick2.avg + pick3.avg;
					if (total > maxCombo) maxCombo = total;
					const bestCombo = bestCombos[0];
					if (bestCombo === undefined || total > bestCombo.total) {
						bestCombos = [{ pick1, pick2, pick3, total }];
					} else if (total === bestCombo.total) {
						bestCombos.push({ pick1, pick2, pick3, total });
					}
				}
			}
		}

		const totalMax = max1row.avg + max2row.avg + max3row.avg;

		let optimized = bestCombos.length === 0;
		if (!optimized) {
			if (maxCombo === totalMax) {
				const keepPlayers1 = new Set<Picks.Player>();
				const keepPlayers2 = new Set<Picks.Player>();
				const keepPlayers3 = new Set<Picks.Player>();
				for (const combo of bestCombos) {
					keepPlayers1.add(combo.pick1.player);
					keepPlayers2.add(combo.pick2.player);
					keepPlayers3.add(combo.pick3.player);
				}
				for (let i = max1row.players.length - 1; i >= 0; i--) {
					const player = max1row.players[i];
					if (!keepPlayers1.has(player)) max1row.players.splice(i, 1);
				}
				for (let i = max2row.players.length - 1; i >= 0; i--) {
					const player = max2row.players[i];
					if (!keepPlayers2.has(player)) max2row.players.splice(i, 1);
				}
				for (let i = max3row.players.length - 1; i >= 0; i--) {
					const player = max3row.players[i];
					if (!keepPlayers3.has(player)) max3row.players.splice(i, 1);
				}

				optimized = true;
			}
		}

		logRoot();
		if (!optimized) {
			const comboPrecision = 2;
			for (const bestCombo of bestCombos) {
				let line1 = `1: ${printName(bestCombo.pick1.player)}`;
				if (bestCombo.pick1.avg !== max1row.avg) line1 += " " + roundToPercent(bestCombo.pick1.avg - max1row.avg, comboPrecision);
				let line2 = `2: ${printName(bestCombo.pick2.player)}`;
				if (bestCombo.pick2.avg !== max2row.avg) line2 += " " + roundToPercent(bestCombo.pick2.avg - max2row.avg, comboPrecision);
				let line3 = `3: ${printName(bestCombo.pick3.player)}`;
				if (bestCombo.pick3.avg !== max3row.avg) line3 += " " + roundToPercent(bestCombo.pick3.avg - max3row.avg, comboPrecision);

				addLog(line1);
				addLog(line2);
				addLog(line3);

				addLog(`Total: ${roundToPercent(bestCombo.total - totalMax, comboPrecision)}`, "center");

				const any = roundToPercent(calcAny(bestCombo.pick1.avg, bestCombo.pick2.avg, bestCombo.pick3.avg), precision);
				const avg = roundToPercent(calcAvg(bestCombo.pick1.avg, bestCombo.pick2.avg, bestCombo.pick3.avg), precision);
				const all = roundToPercent(calcAll(bestCombo.pick1.avg, bestCombo.pick2.avg, bestCombo.pick3.avg), precision);
				addLog(`Any: ${any} - Avg: ${avg} - All: ${all}`, "center");

				logSection++;
			}
		}
	}
	addLog("Any: (70-74 81.8) - Avg: (33-36 43.1) - All: (3-4 7.8)", "center");
}

const oddsColumns: Picks.ColumnData[] = sportsbooks.map((book) => ({
	key: book.key,
	title: book.title,
	sort: true,
	logo: book.logo,
}));

const columns: Picks.ColumnData[] = [
	{ key: "fullName", title: "Player", sort: true },
	{ key: "gg", title: "G/GP", sort: true },
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
const processMaxArray = (array: Picks.PickOdds[]) => {
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
		processMax(row, maxAvg, 'betAvg');
	}
	for (const row of max1) row.highlight1 = true;
	for (const row of max2) row.highlight2 = true;
	for (const row of max3) row.highlight3 = true;
	for (const row of max4) row.highlight4 = true;
	for (const row of maxAvg) row.highlightAvg = true;
}

function App() {
	const [showPopup, setShowPopup] = useState({ visible: false, title: 'Stats', key: 'betAvg' });
	const [popupStats, setPopupStats] = useState<LogStat[]>([]);

	const openStatsPopup = (key: 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'betAvg', title: string) => {
		const shouldRefresh = showPopup.key !== key || popupStats.length === 0;
		if (shouldRefresh) {
			resetLogStats();
			logStats(key);
			setPopupStats(dataStats.map((stat) => ({
				...stat,
				lines: [...stat.lines],
			})));
		}
		setShowPopup({ visible: true, title, key });
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

	const [sortConfig1, setSortConfig1] = useState<Picks.SortConfig>({ keyOrder: ['gg'] });
	const [sortConfig2, setSortConfig2] = useState<Picks.SortConfig>({ keyOrder: ['gg'] });
	const [sortConfig3, setSortConfig3] = useState<Picks.SortConfig>({ keyOrder: ['gg'] });
	const [sortConfigPlayer, setSortConfigPlayer] = useState<Picks.SortConfig>({ keyOrder: ['betAvg'] });

	sortedRows1.sort(sortFunction(sortConfig1));
	sortedRows2.sort(sortFunction(sortConfig2));
	sortedRows3.sort(sortFunction(sortConfig3));
	sortedRowsPlayer.sort(sortFunction(sortConfigPlayer));

	const requestSort1: Picks.RequestSort = makeSort(sortConfig1, setSortConfig1);
	const requestSort2: Picks.RequestSort = makeSort(sortConfig2, setSortConfig2);
	const requestSort3: Picks.RequestSort = makeSort(sortConfig3, setSortConfig3);
	const requestSortPlayer: Picks.RequestSort = makeSort(sortConfigPlayer, setSortConfigPlayer);

	processMaxArray(sortedRows1);
	processMaxArray(sortedRows2);
	processMaxArray(sortedRows3);

	return (
		<>
			<header>
				<span className="header-title">Tims Hockey Picks</span>
				<button className="button"
					onClick={
						() => {
							if (showPopup.visible) setShowPopup({ ...showPopup, visible: false });
							else openStatsPopup('betAvg', 'Stats');
						}
					}>
					<img src={stats} alt="?" />
				</button>
			</header>
			<main className='content'>
				<Popup title={showPopup.title} showPopUp={showPopup.visible} closePopUp={() => setShowPopup({ ...showPopup, visible: false })}>
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
