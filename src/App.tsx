import { useState, useEffect } from 'react';
import './App.css';
import * as Picks from './components/Table';
import playerData from './data/helper.json';
import playerOddsDraftKings from './data/draftkings.json';
import playerOddsFanDuel from './data/fanduel.json';
import playerOddsBetRivers from './data/betrivers.json';
import gamesListing from './data/games.json';
import { table_1_data as hockey5v5_1, table_2_data as hockey5v5_2, table_3_data as hockey5v5_3 } from './data/5v5hockey.ts';

const nameMap = new Map<string, string>();
nameMap.set("Alex Wennberg", "Alexander Wennberg"); // DraftKings, BetRivers
nameMap.set("Alexis Lafrenière", "Alexis Lafreniere"); // DraftKings, FanDuel, DUP
nameMap.set("Freddy Gaudreau", "Frederick Gaudreau");
nameMap.set("Joshua Norris", "Josh Norris");
nameMap.set("Martin Fehérváry", "Martin Fehervary");
nameMap.set("Michael Matheson", "Mike Matheson"); // DraftKings, FanDuel
nameMap.set("Nicholas Suzuki", "Nick Suzuki");
nameMap.set("Sebastian Aho", "Sebastian Aho (CAR)"); // FanDuel, BetRivers

nameMap.set("Alex Kerfoot", "Alexander Kerfoot"); // DraftKings, FanDuel, BetRivers Unknown
nameMap.set("Alexei Toropchenko", "Alexey Toropchenko"); // DraftKings, FanDuel, BetRivers Unknown

const nameMap1 = new Map<string, string>(nameMap);
const nameMap2 = new Map<string, string>(nameMap);
const nameMap3 = new Map<string, string>(nameMap);

nameMap1.set("Axel Sandin-Pellikka", "Axel Sandin Pellikka");
nameMap1.set("Mitchell Marner", "Mitch Marner");
nameMap1.set("Tim Stützle", "Tim Stuetzle");
nameMap1.set("Zachary Bolduc", "Zack Bolduc");

nameMap2.set("Elias Pettersson", "Elias Pettersson #40");
nameMap2.set("Yegor Chinakhov", "Egor Chinakhov");

nameMap3.set("Aliaksei Protas", "Alexei Protas");
nameMap3.set("Artem Zub", "Artyom Zub");
nameMap3.set("Carl Grundstrom", "Carl Grundström");
nameMap3.set("Dmitry Orlov", "Dimitri Orlov");
nameMap3.set("Elias Pettersson", "Elias Pettersson (1998)");
nameMap3.set("J.J. Moser", "Janis Jérôme Moser");
nameMap3.set("JJ Peterka", "John-Jason Peterka"); // DUP
nameMap3.set("J.T. Compher", "JT Compher"); // DUP
nameMap3.set("Jake Middleton", "Jacob Middleton");
nameMap3.set("Josh Morrissey", "Joshua Morrissey");
nameMap3.set("Matt Boldy", "Matthew Boldy");
nameMap3.set("Ondrej Palat", "Ondrej Palát");
nameMap3.set("Shea Theodore", "Shea Théodore");
nameMap3.set("Teuvo Teravainen", "Teuvo Teräväinen");
nameMap3.set("Tommy Novak", "Thomas Novak"); // DUP
nameMap3.set("Trevor van Riemsdyk", "Trevor Van Riemsdyk");
nameMap3.set("Vasily Podkolzin", "Vasili Podkolzin");

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

type betKeys = "bet1" | "bet2" | "bet3";
type betChanceKey = "betChance1" | "betChance2" | "betChance3";
const assignOdds = (row: Picks.Player | Picks.PickOdds, trueOdds: number, betKey: betKeys, betChanceKey: betChanceKey): void => {
	const odds = trueOddsToAmerican(trueOdds);
	row[betKey] = odds;
	row[betChanceKey] = betChanceRounded(odds);
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
		if (player1) player.pick = 1;
		const player2 = map2.get(player.playerId);
		if (player2) player.pick = 2;
		const player3 = map3.get(player.playerId);
		if (player3) player.pick = 3;
	}

	type betKey = "bet1" | "bet2" | "bet3";
	type betChanceKey = "betChance1" | "betChance2" | "betChance3";
	const nameFind = (player: Picks.Player, map: Map<string, number>, betKey: betKey, betChanceKey: betChanceKey) => {
		let decimal = map.get(player.fullName);
		/*
			DraftKings FanDuel

			function removeAccents(name: string): string {
				return name.normalize('NFD').replace(/\p{Diacritic}/gu, '');
			}

			Olli Määttä
			Alexis Lafrenière
			Oskar Bäck
		*/
		if (decimal === undefined) {
			if (player.fullName === "Olli Määttä") {
				decimal = map.get("Olli Maatta"); // DraftKings FanDuel alt
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Alexis Lafrenière") {
				decimal = map.get("Alexis Lafreniere"); // DraftKings FanDuel
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Oskar Bäck") {
				decimal = map.get("Oskar Back"); // DraftKings FanDuel
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Matt Coronato") {
				decimal = map.get("Matthew Coronato"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "JJ Peterka") {
				decimal = map.get("John-Jason Peterka"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Arseny Gritsyuk") {
				decimal = map.get("Arseni Gritsyuk"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "J.T. Compher") {
				decimal = map.get("JT Compher"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Ben Kindel") {
				decimal = map.get("Benjamin Kindel"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Tommy Novak") {
				decimal = map.get("Thomas Novak"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Lenni Hameenaho") {
				decimal = map.get("Lenni Hämeenaho"); // BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Martin Pospisil") {
				decimal = map.get("Martin Pospíšil"); // BetRivers alt
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Egor Chinakhov") {
				decimal = map.get("Yegor Chinakhov"); // DraftKings BetRivers
			}
		}
		if (decimal === undefined) {
			if (player.fullName === "Elias Pettersson") {
				if (player.playerId === 8480012) {
					if (betKey === 'bet2') decimal = map.get("Elias Pettersson #40"); // FanDuel
					if (betKey === 'bet3') decimal = map.get("Elias Pettersson (1998)"); // BetRivers
				}
				if (player.playerId === 8483678) {
					if (betKey === 'bet1') decimal = map.get("Elias-Nils Pettersson"); // DraftKings
					if (betKey === 'bet2') decimal = map.get("Elias Pettersson #25"); // FanDuel
					if (betKey === 'bet3') decimal = map.get("Elias Pettersson (2004)"); // BetRivers
				}
			}
		}

		if (decimal !== undefined) {
			const odds = trueOddsToAmerican(decimal);
			player[betKey] = odds;
			player[betChanceKey] = betChanceRounded(odds);
		} else {
			// console.log(player);
		}

	};

	const bet1 = new Map<string, number>();
	for (const item of playerOddsDraftKings) bet1.set(item.name, item.odds);
	const bet2 = new Map<string, number>();
	for (const item of playerOddsFanDuel) bet2.set(item.name, item.odds);
	const bet3 = new Map<string, number>();
	for (const item of playerOddsBetRivers) bet3.set(item.name, item.odds);
	for (const player of playerList) {
		nameFind(player, bet1, "bet1", "betChance1");
		nameFind(player, bet2, "bet2", "betChance2");
		nameFind(player, bet3, "bet3", "betChance3");
	}

	playerList.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
compilePlayerList();

const betOddsFromMap = (row: Picks.PickOdds, map: Map<string, number>, buMap: Map<string, string>): number | undefined => {
	const trueOdds = map.get(row.fullName);
	if (trueOdds === undefined) {
		const name = buMap.get(row.fullName);
		if (name !== undefined) return map.get(name);
	}
	return trueOdds;
}

const processOddsDraftKings = () => {
	const map = new Map<string, number>();

	for (const item of playerOddsDraftKings) map.set(item.name, item.odds);

	const err: string[] = [];
	for (const row of table1Rows) {
		const odds = betOddsFromMap(row, map, nameMap1);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet1", "betChance1");
	}
	for (const row of table2Rows) {
		const odds = betOddsFromMap(row, map, nameMap1);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet1", "betChance1");
	}
	for (const row of table3Rows) {
		const odds = betOddsFromMap(row, map, nameMap1);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet1", "betChance1");
	}
	if (err.length > 0) console.log("DraftKings", err);
}
processOddsDraftKings();

const processOddsFanDuel = () => {
	const map = new Map<string, number>();

	for (const item of playerOddsFanDuel) {
		const label = item.name;
		const trueOdds = item.odds;
		map.set(label, trueOdds);
	}

	const err: string[] = [];
	for (const row of table1Rows) {
		const odds = betOddsFromMap(row, map, nameMap2);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet2", "betChance2");
	}
	for (const row of table2Rows) {
		const odds = betOddsFromMap(row, map, nameMap2);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet2", "betChance2");
	}
	for (const row of table3Rows) {
		const odds = betOddsFromMap(row, map, nameMap2);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet2", "betChance2");
	}
	if (err.length > 0) console.log("FanDuel", err);
}
processOddsFanDuel();

const processOddsBetRivers = () => {
	const map = new Map<string, number>();
	for (const item of playerOddsBetRivers) {
		const label = item.name;
		const trueOdds = item.odds;
		map.set(label, trueOdds);
	}

	const err: string[] = [];
	for (const row of table1Rows) {
		const odds = betOddsFromMap(row, map, nameMap3);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet3", "betChance3");
	}
	for (const row of table2Rows) {
		const odds = betOddsFromMap(row, map, nameMap3);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet3", "betChance3");
	}
	for (const row of table3Rows) {
		const odds = betOddsFromMap(row, map, nameMap3);
		if (odds === undefined) err.push(row.fullName);
		else assignOdds(row, odds, "bet3", "betChance3");
	}
	if (err.length > 0) console.log("BetRivers", err);
}
processOddsBetRivers();

const processOdds5v5Hockey = () => {
	const map = new Map<number, number>();
	for (const item of [...hockey5v5_1, ...hockey5v5_2, ...hockey5v5_3]) {
		map.set(item.player_nhl_id, item.projection_goals);
	}

	for (const row of [...table1Rows, ...table2Rows, ...table3Rows]) {
		const odds = map.get(row.playerId);
		if (odds === undefined) continue;
		row.bet5v5 = odds;
		row.betChance5v5 = Picks.ggChance(odds);
	}
}
processOdds5v5Hockey();

const logStats = () => {
	const processRow = (key: 'bet1' | 'bet2' | 'bet3', rows: Picks.PickOdds[]): Picks.PickOdds[] | null => {
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
			logs1.push("BetRivers: " + Picks.rountdToPercent(1 - (1 - max1c) * (1 - max2c) * (1 - max3c), 3));
			logs2.push("BetRivers: " + Picks.rountdToPercent((max1c + max2c + max3c) / 3, 3));
			logs3.push("BetRivers:  " + Picks.rountdToPercent(max1c * max2c * max3c, 3));
		}
	}

	logs1.push("(70-74) 79.1 80.793");
	logs2.push("(33-36) 38-39.7 42.054");
	logs3.push("(3-4) 5.5 7.259");

	console.log(...logs1);
	console.log(...logs2);
	console.log(...logs3);

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
	const printRow = (header: string, max1row: Picks.PickOdds[] | null, max2row: Picks.PickOdds[] | null, max3row: Picks.PickOdds[] | null) => {
		const pick = new Map<string, string[]>();
		const allOdds = [];
		if (max1row) allOdds.push("DraftKings");
		if (max2row) allOdds.push("FanDuel");
		if (max3row) allOdds.push("BetRivers");
		if (max1row) addPicks(pick, max1row, allOdds[0]);
		if (max2row) addPicks(pick, max2row, allOdds[1]);
		if (max3row) addPicks(pick, max3row, allOdds[2]);

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
			if (odds.length === allOdds.length) console.log(`${header}: ${name}`);
			else console.log(`${header}: ${name} (${odds.join(", ")})`);
		}
	}
	printRow("1", max1_1row, max2_1row, max3_1row);
	printRow("2", max1_2row, max2_2row, max3_2row);
	printRow("3", max1_3row, max2_3row, max3_3row);
}
logStats();

const columns: Picks.ColumnData[] = [
	{ key: "fullName", title: "Player", sort: true },
	{ key: "gg", title: "G/GP", sort: true },
	{ key: "bet1", title: "DraftKings", sort: true },
	{ key: "bet2", title: "FanDuel", sort: true },
	{ key: "bet3", title: "BetRivers", sort: true },
	{ key: "bet5v5", title: "5v5Hockey", sort: true },
];

const columnsPlayer: Picks.ColumnData[] = [
	{ key: "fullName", title: "Player", sort: true },
	{ key: "bet1", title: "DraftKings", sort: true },
	{ key: "bet2", title: "FanDuel", sort: true },
	{ key: "bet3", title: "BetRivers", sort: true },
	{ key: "pick", title: "Pick", sort: false },
	{ key: "gameTime", title: "Start", sort: true },
];

type processKeys = 'bet1' | 'bet2' | 'bet3' | 'bet5v5';
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
	const max5v5: Picks.PickOdds[] = [];
	for (const row of array) {
		row.highlight1 = false;
		row.highlight2 = false;
		row.highlight3 = false;
		row.highlight5v5 = false;
		processMax(row, max1, 'bet1');
		processMax(row, max2, 'bet2');
		processMax(row, max3, 'bet3');
		processMax(row, max5v5, 'bet5v5', true);
	}
	for (const row of max1) row.highlight1 = true;
	for (const row of max2) row.highlight2 = true;
	for (const row of max3) row.highlight3 = true;
	for (const row of max5v5) row.highlight5v5 = true;
}

function App() {

	const [chances, setChances] = useState(false);
	const toggleHandler = () => {
		setChances(prev => !prev); // Flips the state to the opposite value
	};

	// Theme state
	const [darkTheme, setDarkTheme] = useState(() => {
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	});

	// Table data and sorting - regenerate when theme changes
	const [rows1, _setRows1] = useState(table1Rows);
	const sortedRows1 = [...rows1];

	const [rows2, _setRows2] = useState(table2Rows);
	const sortedRows2 = [...rows2];

	const [rows3, _setRows3] = useState(table3Rows);
	const sortedRows3 = [...rows3];

	const [rowsPlayer, _setRowsPlayer] = useState(playerList);
	const sortedRowsPlayer = [...rowsPlayer];

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
				<span></span>
				Tims Hockey Challenge Picks
				<button className={chances ? 'chances-on' : 'chances-off'} onClick={toggleHandler}>%</button>
			</header>
			<main className='content'>
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
