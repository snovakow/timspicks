import { useState, useEffect } from 'react';
import './App.css';
import * as Picks from './components/Table';
import Popup from './components/Popup';

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

const loadEmbed = async (src: string) => {
	try {
		const response = await fetchData(src);
		const text = await response.text();
		return new Function(text)();
	} catch (error) {
		console.log(error);
		return {
			table_1_data: [],
			table_2_data: [],
			table_3_data: [],
		}
	}
}

const {
	table_1_data: hockey5v5_1,
	table_2_data: hockey5v5_2,
	table_3_data: hockey5v5_3
} = await loadEmbed('./data/bet5v5.txt');

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
	return a.time.getTime() - b.time.getTime();
});

// Implied Odds
const betChance = (x: number | null): number | null => {
	if (x === null) return null;
	if (x < 0) return -x / (100 - x);
	else return 100 / (x + 100);
}

const betChanceRounded = (x: number | null): string => {
	const chance = betChance(x);
	if (chance === null) return "-";
	return Picks.rountdToPercent(chance, 2);
}

const trueOddsToAmerican = (x: number): number => {
	if (x === 0) return 0;
	if (x >= 2) {
		return Math.round(100 * (x - 1));
	} else {
		return Math.round(100 / (1 - x));
	}
}

const sortFunction = (sortConfig: Picks.SortConfig) => {
	return (a: any, b: any): number => {
		for (const key of sortConfig.keyOrder) {
			const aVal = a[key];
			const bVal = b[key];

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
					if (key === 'gg' || key === 'bet5v5') return bVal - aVal;
					else return aVal - bVal;
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

const makeRows = (data: Picks.OddsItem[]): Picks.PickOdds[] => data.map((item): Picks.PickOdds => new Picks.PickOdds(item));
const table1Rows = makeRows(playerData["1"]);
const table2Rows = makeRows(playerData["2"]);
const table3Rows = makeRows(playerData["3"]);

const compilePlayerList = () => {
	const map1 = new Map<number, Picks.PickOdds>();
	const map2 = new Map<number, Picks.PickOdds>();
	const map3 = new Map<number, Picks.PickOdds>();
	for (const player of table1Rows) map1.set(player.playerId, player);
	for (const player of table2Rows) map2.set(player.playerId, player);
	for (const player of table3Rows) map3.set(player.playerId, player);
	for (const player of playerList) {
		const player1 = map1.get(player.playerId);
		if (player1) {
			player.pick = 1;
			player1.fullName = player.fullName;
			player1.firstName = player.firstName.default;
			player1.lastName = player.lastName.default;
		}
		const player2 = map2.get(player.playerId);
		if (player2) {
			player.pick = 2;
			player2.fullName = player.fullName;
			player2.firstName = player.firstName.default;
			player2.lastName = player.lastName.default;
		}
		const player3 = map3.get(player.playerId);
		if (player3) {
			player.pick = 3;
			player3.fullName = player.fullName;
			player3.firstName = player.firstName.default;
			player3.lastName = player.lastName.default;
		}
	}

	const removeAccentsNormalize = (name: string): string => {
		return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
	}

	type betKey = "bet1" | "bet2" | "bet3" | "bet4";
	type betChanceKey = "betChance1" | "betChance2" | "betChance3" | "betChance4";
	const nameFind = (player: Picks.Player, oddsMap: Map<string, number>, betKey: betKey, betChanceKey: betChanceKey) => {
		const process = (name: string | undefined): boolean => {
			if (name === undefined) return false;
			const decimal = oddsMap.get(removeAccentsNormalize(name));
			if (decimal === undefined) return false;

			const odds = trueOddsToAmerican(decimal);
			player[betKey] = odds;
			player[betChanceKey] = betChanceRounded(odds);
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
		for (const lang in player.firstName) {
			if (lang === "default") continue;

			const first = player.firstName[lang];
			const last = player.lastName[lang] ?? player.lastName.default;
			const name = `${first} ${last}`;

			if (process(name)) return;

			firstLang.add(lang);
		}
		for (const lang in player.lastName) {
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
		nameFind(player, bet1, "bet1", "betChance1");
		nameFind(player, bet2, "bet2", "betChance2");
		nameFind(player, bet3, "bet3", "betChance3");
		nameFind(player, bet4, "bet4", "betChance4");
	}

	playerList.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
compilePlayerList();

const processOdds = () => {
	const map = new Map<number, number>();
	for (const item of [...hockey5v5_1, ...hockey5v5_2, ...hockey5v5_3]) {
		map.set(item.player_nhl_id, item.projection_goals);
	}

	const mapAll = new Map<number, Picks.Player>();
	for (const player of playerList) {
		mapAll.set(player.playerId, player);
	}

	for (const row of [...table1Rows, ...table2Rows, ...table3Rows]) {
		const odds = map.get(row.playerId);
		if (odds !== undefined) {
			row.bet5v5 = odds;
			row.betChance5v5 = Picks.ggChance(odds);
		}

		const player = mapAll.get(row.playerId);
		if (!player) continue;
		row.bet1 = player.bet1;
		row.bet2 = player.bet2;
		row.bet3 = player.bet3;
		row.bet4 = player.bet4;
		row.betChance1 = player.betChance1;
		row.betChance2 = player.betChance2;
		row.betChance3 = player.betChance3;
		row.betChance4 = player.betChance4;
	}

}
processOdds();

const dataStats: string[] = [];
const logStats = () => {
	const processRow = (key: 'bet1' | 'bet2' | 'bet3' | 'bet4', rows: Picks.PickOdds[]): Picks.PickOdds[] | null => {
		let max = null;
		for (const row of rows) {
			const val = row[key];
			if (val === null) continue;
			if (!max) {
				max = [row];
				continue;
			}
			const maxrow = max[0];
			const maxval = maxrow[key]!;
			if (val > maxval) continue;
			if (val < maxval) max = [row];
			else max.push(row);
		}
		return max;
	};

	const max1_1row = processRow('bet1', table1Rows);
	const max1_2row = processRow('bet1', table2Rows);
	const max1_3row = processRow('bet1', table3Rows);

	const max2_1row = processRow('bet2', table1Rows);
	const max2_2row = processRow('bet2', table2Rows);
	const max2_3row = processRow('bet2', table3Rows);

	const max3_1row = processRow('bet3', table1Rows);
	const max3_2row = processRow('bet3', table2Rows);
	const max3_3row = processRow('bet3', table3Rows);

	const max4_1row = processRow('bet4', table1Rows);
	const max4_2row = processRow('bet4', table2Rows);
	const max4_3row = processRow('bet4', table3Rows);

	const logs1: string[] = ["Any:"];
	const logs2: string[] = ["Avg:"];
	const logs3: string[] = ["All:"];

	if (max1_1row && max1_2row && max1_3row) {
		const max1a = betChance(max1_1row[0].bet1);
		const max2a = betChance(max1_2row[0].bet1);
		const max3a = betChance(max1_3row[0].bet1);
		if (max1a !== null && max2a !== null && max3a !== null) {
			logs1.push("DraftKings: " + Picks.rountdToPercent(1 - (1 - max1a) * (1 - max2a) * (1 - max3a), 3));
			logs2.push("DraftKings: " + Picks.rountdToPercent((max1a + max2a + max3a) / 3, 3));
			logs3.push("DraftKings:  " + Picks.rountdToPercent(max1a * max2a * max3a, 3));
		}
	}

	if (max2_1row && max2_2row && max2_3row) {
		const max1b = betChance(max2_1row[0].bet2);
		const max2b = betChance(max2_2row[0].bet2);
		const max3b = betChance(max2_3row[0].bet2);
		if (max1b !== null && max2b !== null && max3b !== null) {
			logs1.push("FanDuel: " + Picks.rountdToPercent(1 - (1 - max1b) * (1 - max2b) * (1 - max3b), 3));
			logs2.push("FanDuel: " + Picks.rountdToPercent((max1b + max2b + max3b) / 3, 3));
			logs3.push("FanDuel:  " + Picks.rountdToPercent(max1b * max2b * max3b, 3));
		}
	}

	if (max3_1row && max3_2row && max3_3row) {
		const max1c = betChance(max3_1row[0].bet3);
		const max2c = betChance(max3_2row[0].bet3);
		const max3c = betChance(max3_3row[0].bet3);
		if (max1c !== null && max2c !== null && max3c !== null) {
			logs1.push("BetMGM: " + Picks.rountdToPercent(1 - (1 - max1c) * (1 - max2c) * (1 - max3c), 3));
			logs2.push("BetMGM: " + Picks.rountdToPercent((max1c + max2c + max3c) / 3, 3));
			logs3.push("BetMGM:  " + Picks.rountdToPercent(max1c * max2c * max3c, 3));
		}
	}

	if (max4_1row && max4_2row && max4_3row) {
		const max1d = betChance(max4_1row[0].bet4);
		const max2d = betChance(max4_2row[0].bet4);
		const max3d = betChance(max4_3row[0].bet4);
		if (max1d !== null && max2d !== null && max3d !== null) {
			logs1.push("BetRivers: " + Picks.rountdToPercent(1 - (1 - max1d) * (1 - max2d) * (1 - max3d), 3));
			logs2.push("BetRivers: " + Picks.rountdToPercent((max1d + max2d + max3d) / 3, 3));
			logs3.push("BetRivers:  " + Picks.rountdToPercent(max1d * max2d * max3d, 3));
		}
	}

	logs1.push("(70-74) 79.1  80.793 81.813");
	logs2.push("(33-36) 38-40 42.054 43.073");
	logs3.push("(3-4)   5.5    7.259  7.771");

	console.log(...logs1);
	console.log(...logs2);
	console.log(...logs3);
	dataStats.push(logs1.join(" "), logs2.join(" "), logs3.join(" "));

	const isSameArray = (arr1: string[], arr2: string[]): boolean => {
		if (arr1.length !== arr2.length) return false;
		const set1 = new Set(arr1);
		const set2 = new Set(arr2);
		if (set1.size !== set2.size) return false;
		for (const item of set1) {
			if (!set2.has(item)) return false;
		}
		return true;
	}
	const addPicks = (pick: Map<string, string[]>, rows: Picks.PickOdds[], title: string): void => {
		for (const row of rows) {
			const name = row.fullName;
			if (!pick.has(name)) pick.set(name, []);
			const odds = pick.get(name)!;
			odds.push(title);
		}
	}
	const addLogout = (log: string) => {
		console.log(log);
		dataStats.push(log);
	}
	const printRow = (
		header: string,
		max1row: Picks.PickOdds[] | null,
		max2row: Picks.PickOdds[] | null,
		max3row: Picks.PickOdds[] | null,
		max4row: Picks.PickOdds[] | null
	) => {
		const pick = new Map<string, string[]>();
		const allOdds = [];
		if (max1row) allOdds.push("DraftKings");
		if (max2row) allOdds.push("FanDuel");
		if (max3row) allOdds.push("BetMGM");
		if (max4row) allOdds.push("BetRivers");
		if (max1row) addPicks(pick, max1row, allOdds[0]);
		if (max2row) addPicks(pick, max2row, allOdds[1]);
		if (max3row) addPicks(pick, max3row, allOdds[2]);
		if (max4row) addPicks(pick, max4row, allOdds[3]);

		// Merge player names with the same odds sources
		const entries: [string, string[]][] = [...pick.entries()];
		for (let i = entries.length - 1; i >= 0; i--) {
			const [name_i, odds_i] = entries[i];
			for (let j = 0; j < i; j++) {
				const [name_j, odds_j] = entries[j];
				if (isSameArray(odds_i, odds_j)) {
					// Merge i into j, and delete i
					entries.splice(i, 1);
					const mergedName = `${name_j}, ${name_i}`;
					entries[j] = [mergedName, odds_j];
					break;
				}
			}
		}

		for (const [name, odds] of entries) {
			if (odds.length === allOdds.length) addLogout(`${header}: ${name}`);
			else addLogout(`${header}: ${name} (${odds.join(", ")})`);
		}
	}
	printRow("1", max1_1row, max2_1row, max3_1row, max4_1row);
	printRow("2", max1_2row, max2_2row, max3_2row, max4_2row);
	printRow("3", max1_3row, max2_3row, max3_3row, max4_3row);

	const calulateAvg = (rows: Picks.PickOdds[]): [number, string[]] => {
		let avgMax = 0;
		let avgPlayers: string[] = [];
		for (const row of rows) {
			let avg = 0;
			let count = 0;
			const bet1 = betChance(row.bet1);
			if (bet1 !== null) { avg += bet1; count++; }
			const bet2 = betChance(row.bet2);
			if (bet2 !== null) { avg += bet2; count++; }
			const bet3 = betChance(row.bet3);
			if (bet3 !== null) { avg += bet3; count++; }
			const bet4 = betChance(row.bet4);
			if (bet4 !== null) { avg += bet4; count++; }
			if (count === 0) continue;
			avg /= count;
			if (avg > avgMax) {
				avgMax = avg;
				avgPlayers = [row.fullName];
			} else if (avg === avgMax) {
				avgPlayers.push(row.fullName);
			}
		}
		return [avgMax, avgPlayers];
	}
	const [avg1, avgPlayers1] = calulateAvg(table1Rows);
	const [avg2, avgPlayers2] = calulateAvg(table2Rows);
	const [avg3, avgPlayers3] = calulateAvg(table3Rows);
	addLogout(`Pick 1: ${Picks.rountdToPercent(avg1, 3)} - ${avgPlayers1.join(", ")}`);
	addLogout(`Pick 2: ${Picks.rountdToPercent(avg2, 3)} - ${avgPlayers2.join(", ")}`);
	addLogout(`Pick 3: ${Picks.rountdToPercent(avg3, 3)} - ${avgPlayers3.join(", ")}`);
}
logStats();

const columns: Picks.ColumnData[] = [
	{ key: "fullName", title: "Player", sort: true },
	{ key: "gg", title: "G/GP", sort: true },
	{ key: "bet1", title: "DraftKings", sort: true },
	{ key: "bet2", title: "FanDuel", sort: true },
	{ key: "bet3", title: "BetMGM", sort: true },
	{ key: "bet4", title: "BetRivers", sort: true },
	{ key: "bet5v5", title: "5v5Hockey", sort: true },
];

const columnsPlayer: Picks.ColumnData[] = [
	{ key: "fullName", title: "Player", sort: true },
	{ key: "bet1", title: "DraftKings", sort: true },
	{ key: "bet2", title: "FanDuel", sort: true },
	{ key: "bet3", title: "BetMGM", sort: true },
	{ key: "bet4", title: "BetRivers", sort: true },
	{ key: "pick", title: "Pick", sort: false },
	{ key: "gameTime", title: "Start", sort: true },
];

type processKeys = 'bet1' | 'bet2' | 'bet3' | 'bet4' | 'bet5v5';
const processMax = (row: Picks.PickOdds, max: Picks.PickOdds[], key: processKeys, reverse?: boolean) => {
	const rowVal = row[key];
	if (rowVal === null) return;

	if (max.length === 0) {
		max.push(row);
		return;
	}

	const topBet = max[0][key]!;
	if (rowVal === topBet) {
		max.push(row);
	} else {
		if (reverse) {
			if (rowVal > topBet) max.splice(0, max.length, row);
		} else {
			if (rowVal < topBet) max.splice(0, max.length, row);
		}
	}
}
const processMaxArray = (array: Picks.PickOdds[]) => {
	const max1: Picks.PickOdds[] = [];
	const max2: Picks.PickOdds[] = [];
	const max3: Picks.PickOdds[] = [];
	const max4: Picks.PickOdds[] = [];
	const max5v5: Picks.PickOdds[] = [];
	for (const row of array) {
		row.highlight1 = false;
		row.highlight2 = false;
		row.highlight3 = false;
		row.highlight4 = false;
		row.highlight5v5 = false;
		processMax(row, max1, 'bet1');
		processMax(row, max2, 'bet2');
		processMax(row, max3, 'bet3');
		processMax(row, max4, 'bet4');
		processMax(row, max5v5, 'bet5v5', true);
	}
	for (const row of max1) row.highlight1 = true;
	for (const row of max2) row.highlight2 = true;
	for (const row of max3) row.highlight3 = true;
	for (const row of max4) row.highlight4 = true;
	for (const row of max5v5) row.highlight5v5 = true;
}

for (const i in dataStats) dataStats[i] = dataStats[i].replaceAll(' ', '\u00A0');

function App() {
	const [showPopup, setShowPopup] = useState(false);

	const [chances, setChances] = useState(false);
	const toggleHandler = () => {
		setChances(prev => !prev); // Flips the state to the opposite value
	};

	// Table data and sorting - regenerate when theme changes
	const [rows1, _setRows1] = useState(table1Rows);
	const sortedRows1 = [...rows1];

	const [rows2, _setRows2] = useState(table2Rows);
	const sortedRows2 = [...rows2];

	const [rows3, _setRows3] = useState(table3Rows);
	const sortedRows3 = [...rows3];

	const [rowsPlayer, _setRowsPlayer] = useState(playerList);
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
	const [sortConfigPlayer, setSortConfigPlayer] = useState<Picks.SortConfig>({ keyOrder: ['bet1'] });

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
			<header className='header satisfy-regular'>
				<button className={chances ? 'button chances-on' : 'button chances-off'} onClick={toggleHandler}>%</button>
				Tims Hockey Challenge Picks
				<button className="button" onClick={() => setShowPopup(true)}>?</button>
			</header>
			<main className='content'>
				<Popup showPopUp={showPopup} closePopUp={() => setShowPopup(false)}>
					<h2>Stats</h2>
					{
						dataStats.map((title, index) => (
							<div key={index}>{title}</div>
						))
					}
				</Popup>

				<div className="table-container">
					<h2>Games</h2>
					<Picks.Basic columns={["Home", "Away", "Time"]} games={gamesList} darkTheme={false} />
				</div>
				<div className="table-container">
					<h2>Pick #1</h2>
					<Picks.Table columns={columns} sortedRows={sortedRows1} requestSort={requestSort1} sortConfig={sortConfig1} darkTheme={darkTheme} chances={chances} />
				</div>
				<div className="table-container">
					<h2>Pick #2</h2>
					<Picks.Table columns={columns} sortedRows={sortedRows2} requestSort={requestSort2} sortConfig={sortConfig2} darkTheme={darkTheme} chances={chances} />
				</div>
				<div className="table-container">
					<h2>Pick #3</h2>
					<Picks.Table columns={columns} sortedRows={sortedRows3} requestSort={requestSort3} sortConfig={sortConfig3} darkTheme={darkTheme} chances={chances} />
				</div>
				<div className="table-container">
					<h2>Players</h2>
					<Picks.Table columns={columnsPlayer} sortedRows={sortedRowsPlayer} requestSort={requestSortPlayer} sortConfig={sortConfigPlayer} darkTheme={darkTheme} chances={chances} />
				</div>
			</main>
		</>
	)
}

export default App
