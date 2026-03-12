import { useState, useEffect } from 'react';
import './App.css';
import * as Picks from './components/Table';
import type { DataTimsHelper } from './data/Data';
import playerData from './data/helper.json';
import playerOddsDraftKings from './data/draftkings.json';
import playerOddsFanDuel from './data/fanduel.json';
import playerOddsBetRivers from './data/betrivers.json';
import { table_1_data as hockey5v5_1, table_2_data as hockey5v5_2, table_3_data as hockey5v5_3 } from './data/5v5hockey.ts';

const nameMap = new Map<string, string>();
nameMap.set("Alex Wennberg", "Alexander Wennberg"); // DraftKings, BetRivers
nameMap.set("Alexis Lafrenière", "Alexis Lafreniere"); // DraftKings, FanDuel
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

nameMap3.set("Aliaksei Protas", "Alexei Protas");
nameMap3.set("Artem Zub", "Artyom Zub");
nameMap3.set("Carl Grundstrom", "Carl Grundström");
nameMap3.set("Dmitry Orlov", "Dimitri Orlov");
nameMap3.set("Elias Pettersson", "Elias Pettersson (1998)");
nameMap3.set("J.J. Moser", "Janis Jérôme Moser");
nameMap3.set("JJ Peterka", "John-Jason Peterka");
nameMap3.set("J.T. Compher", "JT Compher");
nameMap3.set("Jake Middleton", "Jacob Middleton");
nameMap3.set("Josh Morrissey", "Joshua Morrissey");
nameMap3.set("Matt Boldy", "Matthew Boldy");
nameMap3.set("Ondrej Palat", "Ondrej Palát");
nameMap3.set("Shea Theodore", "Shea Théodore");
nameMap3.set("Teuvo Teravainen", "Teuvo Teräväinen");
nameMap3.set("Tommy Novak", "Thomas Novak");
nameMap3.set("Trevor van Riemsdyk", "Trevor Van Riemsdyk");
nameMap3.set("Vasily Podkolzin", "Vasili Podkolzin");

const nameMap4 = new Map<string, string>(nameMap);
nameMap4.set("Olli Maatta", "Olli Määttä");
nameMap4.set("Matty Beniers", "Matthew Beniers");
nameMap4.set("Tim Stützle", "Tim Stutzle");

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
const assignOdds = (row: Picks.PlayerOdds | Picks.PickOdds, trueOdds: number, betKey: betKeys, betChanceKey: betChanceKey): void => {
	const odds = trueOddsToAmerican(trueOdds);
	row[betKey] = odds;
	row[betChanceKey] = betChanceRounded(odds);
}

const tablePlayers: Picks.PlayerOdds[] = [];
const compilePlayerList = () => {
	const reverse1 = new Map<string, string>();
	const reverse2 = new Map<string, string>();
	const reverse3 = new Map<string, string>();
	for (const [key, value] of nameMap1.entries()) reverse1.set(value, key);
	for (const [key, value] of nameMap2.entries()) reverse2.set(value, key);
	for (const [key, value] of nameMap3.entries()) reverse3.set(value, key);

	const allMap: Map<string, Picks.PlayerOdds> = new Map();
	for (const item of playerOddsDraftKings) {
		const name = reverse1.get(item.name) ?? item.name;
		const player = new Picks.PlayerOdds(name);
		assignOdds(player, item.odds, "bet1", "betChance1");
		allMap.set(name, player);
	}
	for (const item of playerOddsFanDuel) {
		const name = reverse2.get(item.name) ?? item.name;
		let player = allMap.get(name);
		if (!player) {
			player = new Picks.PlayerOdds(name);
			allMap.set(name, player);
		}
		assignOdds(player, item.odds, "bet2", "betChance2");
	}
	for (const item of playerOddsBetRivers) {
		const name = reverse3.get(item.name) ?? item.name;
		let player = allMap.get(name);
		if (!player) {
			player = new Picks.PlayerOdds(name);
			allMap.set(name, player);
		}
		assignOdds(player, item.odds, "bet3", "betChance3");
	}

	tablePlayers.push(...allMap.values());
	tablePlayers.sort((a, b) => a.name.localeCompare(b.name));
}
compilePlayerList();

const makeRows = (data: DataTimsHelper[]): Picks.PickOdds[] => {
	return data.map((item: DataTimsHelper): Picks.PickOdds => new Picks.PickOdds(item));
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

const table1Data: DataTimsHelper[] = playerData.playerLists[0].players;
const table2Data: DataTimsHelper[] = playerData.playerLists[1].players;
const table3Data: DataTimsHelper[] = playerData.playerLists[2].players;

const table1Rows = makeRows(table1Data);
const table2Rows = makeRows(table2Data);
const table3Rows = makeRows(table3Data);

const betOddsFromMap = (row: Picks.PickOdds, map: Map<string, number>, buMap: Map<string, string>): number | undefined => {
	const trueOdds = map.get(row.name);
	if (trueOdds === undefined) {
		const name = buMap.get(row.name);
		if (name !== undefined) return map.get(name);
	}
	return trueOdds;
}

const processJSON = (json: any) => {
	const map = new Map<string, number>();

	// const arr = [];
	for (const item of json) {
		const label = item.name;
		const trueOdds = item.odds;

		// const participant = selection.participants[0];
		// arr.push({ label, trueOdds, seoIdentifier: participant.seoIdentifier });
		map.set(label, trueOdds);
	}
	// arr.sort((a, b) => { return a.label.localeCompare(b.label); });
	// console.log(arr);

	const err: string[] = [];
	for (const row of table1Rows) {
		const odds = betOddsFromMap(row, map, nameMap1);
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet1", "betChance1");
	}
	for (const row of table2Rows) {
		const odds = betOddsFromMap(row, map, nameMap1);
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet1", "betChance1");
	}
	for (const row of table3Rows) {
		const odds = betOddsFromMap(row, map, nameMap1);
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet1", "betChance1");
	}
	if (err.length > 0) console.log("DraftKings", err);
}
processJSON(playerOddsDraftKings);

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
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet2", "betChance2");
	}
	for (const row of table2Rows) {
		const odds = betOddsFromMap(row, map, nameMap2);
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet2", "betChance2");
	}
	for (const row of table3Rows) {
		const odds = betOddsFromMap(row, map, nameMap2);
		if (odds === undefined) err.push(row.name);
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
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet3", "betChance3");
	}
	for (const row of table2Rows) {
		const odds = betOddsFromMap(row, map, nameMap3);
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet3", "betChance3");
	}
	for (const row of table3Rows) {
		const odds = betOddsFromMap(row, map, nameMap3);
		if (odds === undefined) err.push(row.name);
		else assignOdds(row, odds, "bet3", "betChance3");
	}
	if (err.length > 0) console.log("BetRivers", err);
}
processOddsBetRivers();

const processOdds5v5Hockey = () => {
	const map1 = new Map<string, number>();
	for (const item of [...hockey5v5_1, ...hockey5v5_2, ...hockey5v5_3]) {
		map1.set(item.player_name, item.projection_goals); // item.predicted_probability
	}

	const err: string[] = [];
	for (const row of [...table1Rows, ...table2Rows, ...table3Rows]) {
		const odds = betOddsFromMap(row, map1, nameMap4);
		if (odds === undefined) err.push(row.name);
		else {
			row.bet5v5 = odds;
			row.betChance5v5 = Picks.ggChance(odds);
		}
	}
	// if (err.length > 0) console.log("5v5Hockey", err);
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
			const name = row.name;
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
	{ key: "name", title: "Player" },
	{ key: "gg", title: "G/GP" },
	{ key: "bet1", title: "DraftKings" },
	{ key: "bet2", title: "FanDuel" },
	{ key: "bet3", title: "BetRivers" },
	{ key: "bet5v5", title: "5v5Hockey" },
];

const columnsPlayer: Picks.ColumnData[] = [
	{ key: "name", title: "Player" },
	{ key: "bet1", title: "DraftKings" },
	{ key: "bet2", title: "FanDuel" },
	{ key: "bet3", title: "BetRivers" },
];

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

	const [rowsPlayer, _setRowsPlayer] = useState(tablePlayers);
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

	return (
		<>
			<header className='header satisfy-regular'>
				<span></span>
				Tims Hockey Challenge Picks
				<button className={chances ? 'chances-on' : 'chances-off'} onClick={toggleHandler}>%</button>
			</header>
			<main className='content'>
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
