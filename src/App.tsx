import { useState, useEffect } from 'react';
import './App.css';
import { getLogo, type Team } from './components/logo';
import Table from './components/Table';
import type { KeyType, RowKey, ColumnData, RequestSort, SortConfig } from './components/Table';
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

nameMap2.set("Elias Pettersson", "Elias Pettersson #40");

nameMap3.set("Aliaksei Protas", "Alexei Protas");
nameMap3.set("Artem Zub", "Artyom Zub");
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
nameMap3.set("Vasily Podkolzin", "Vasili Podkolzin");

const nameMap4 = new Map<string, string>(nameMap);
nameMap4.set("Olli Maatta", "Olli Määttä");
nameMap4.set("Matty Beniers", "Matthew Beniers");
nameMap4.set("Tim Stützle", "Tim Stutzle");

const columns: ColumnData[] = [
  { key: "name", title: "Player" },
  { key: "gg", title: "G/GP" },
  { key: "bet1", title: "DraftKings" },
  { key: "bet2", title: "FanDuel" },
  { key: "bet3", title: "BetRivers" },
  { key: "bet5v5", title: "5v5Hockey" },
];

const rountdToPercent = (num: number, places: number): string => {
  return (num * 100).toFixed(places) + "%";
}

// Poisson distribution chance of 0 goals: e^(−μ)
// Chance of at least one goal: 1 − e^(−μ)
const ggChance = (x: number): string => {
  const chance = 1 - Math.exp(-x);
  return rountdToPercent(chance, 2);
}

// Implied Odds
const betChance = (x: number): number => {
  if (x === 0) return 0;
  if (x < 0) return -x / (100 - x);
  else return 100 / (x + 100);
}

const betChanceRounded = (x: number): string => {
  const chance = betChance(x);
  if (chance === 0) return "-";
  return rountdToPercent(chance, 2);
}

const trueOddsToAmerican = (x: number): number => {
  if (x === 0) return 0;
  if (x >= 2) {
    return Math.round(100 * (x - 1));
  } else {
    return Math.round(100 / (1 - x));
  }
}

const makeRows = (data: DataTimsHelper[]): RowKey[] => {
  return data.map((item: DataTimsHelper): RowKey => {
    const gg = item.gamesPlayed > 0 ? item.goals / item.gamesPlayed : 0;
    return {
      name: `${item.firstName} ${item.lastName}`,
      logoLight: getLogo(item.team as Team, false),
      logoDark: getLogo(item.team as Team, true),
      gg: gg,
      ggChance: ggChance(gg),
      bet1: 0,
      betChance1: "-",
      bet2: 0,
      betChance2: "-",
      bet3: 0,
      betChance3: "-",
      bet5v5: 0,
      betChance5v5: "-",
    }
  });
}

const sortFunction = (sortConfig: SortConfig) => {
  return (a: RowKey, b: RowKey): number => {
    for (const key of sortConfig.keyOrder) {
      const aVal = a[key];
      const bVal = b[key];

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

const makeSort = (sortConfig: SortConfig, setSortConfig: (config: SortConfig) => void) => {
  return (keyPrimary: KeyType) => {
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

const betOddsFromMap = (row: RowKey, map: Map<string, number>, buMap: Map<string, string>): number | undefined => {
  const trueOdds = map.get(row.name);
  if (trueOdds === undefined) {
    const name = buMap.get(row.name);
    if (name !== undefined) return map.get(name);
  }
  return trueOdds;
}
type betKeys = "bet1" | "bet2" | "bet3" | "bet5v5";
type betChanceKey = "betChance1" | "betChance2" | "betChance3" | "betChance5v5";
const assignOdds = (row: RowKey, trueOdds: number, betKey: betKeys, betChanceKey: betChanceKey): void => {
  const odds = trueOddsToAmerican(trueOdds);
  row[betKey] = odds;
  row[betChanceKey] = betChanceRounded(odds);
}

const processJSON = (json: any) => {
  const data: DataDraftKings[] = json.selections;
  const map = new Map<string, number>();

  // const arr = [];
  for (const selection of data) {
    const label = selection.participants[0].seoIdentifier;
    const trueOdds = selection.trueOdds;

    // const participant = selection.participants[0];
    // arr.push({ label, trueOdds, seoIdentifier: participant.seoIdentifier });
    const has = map.has(label);
    if (has) console.error("ALREADY HAS", label);
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
async function loadAndParseJSON(url: string, complete: (data: any) => void, init?: RequestInit) {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const json = await response.json();
    complete(json);
  } catch (error) {
    console.error("Error loading or parsing JSON:", error);
  }
}
// 2026 2 4 2200
// const d = new Date(Date.UTC(2026, 2, 4, 22, 0));
// console.log(d.toLocaleString());
if (directLoad) {
  processJSON(playerOddsDraftKings);
} else {
  const url = "https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=42133%2C13809&eventsQuery=%24filter%3DleagueId%20eq%20%2742133%27%20AND%20clientMetadata%2FSubcategories%2Fany%28s%3A%20s%2FId%20eq%20%2713809%27%29&marketsQuery=%24filter%3DclientMetadata%2FsubCategoryId%20eq%20%2713809%27%20AND%20tags%2Fall%28t%3A%20t%20ne%20%27SportcastBetBuilder%27%29&include=Events&entity=events";
  loadAndParseJSON(url, (json: any) => {
    processJSON(json);
    const myCustomEvent = new Event("DraftKings", {
      bubbles: false,
      cancelable: true,
    });
    window.dispatchEvent(myCustomEvent);
  });
}

const processOddsFanDuel = () => {
  const map = new Map<string, number>();

  if (!('attachments' in playerOddsFanDuel)) return;
  const attachments = playerOddsFanDuel.attachments;
  if (!(typeof attachments === 'object' && attachments !== null)) return;
  if (!('markets' in attachments)) return;
  const markets = attachments.markets;
  if (!(typeof markets === 'object' && markets !== null)) return;

  for (const market of Object.values(markets)) {
    if (market.marketType !== 'ANY_TIME_GOAL_SCORER') continue;
    for (const runner of market.runners) {
      if (!('winRunnerOdds' in runner)) return;
      const num = runner.winRunnerOdds.trueOdds.fractionalOdds.numerator;
      const den = runner.winRunnerOdds.trueOdds.fractionalOdds.denominator;
      const trueOdds = num / den + 1;
      map.set(runner.runnerName, trueOdds);
    }
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
    const outcome = item.outcomes[0];
    map.set(item.playerInfo.name, outcome.odds);
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
      row.betChance5v5 = ggChance(odds);
    }
  }
  if (err.length > 0) console.log("5v5Hockey", err);
}
processOdds5v5Hockey();

const logStats = () => {
  const processRow = (key: 'bet1' | 'bet2' | 'bet3', rows: RowKey[]): RowKey[] | null => {
    let max = null;
    for (const row of rows) {
      const val = row[key];
      if (val === 0) continue;
      if (!max) {
        max = [row];
        continue;
      }
      const maxrow = max[0];
      const maxval = maxrow[key];
      if (val > maxval) continue;
      if (val < maxval) max = [row];
      else max.push(row);
    }
    return max;
  };

  let max1_1row = null;
  let max1_2row = null;
  let max1_3row = null;
  let max2_1row = null;
  let max2_2row = null;
  let max2_3row = null;
  let max3_1row = null;
  let max3_2row = null;
  let max3_3row = null;
  max1_1row = processRow('bet1', table1Rows);
  max2_1row = processRow('bet2', table1Rows);
  max3_1row = processRow('bet3', table1Rows);
  max1_2row = processRow('bet1', table2Rows);
  max2_2row = processRow('bet2', table2Rows);
  max3_2row = processRow('bet3', table2Rows);
  max1_3row = processRow('bet1', table3Rows);
  max2_3row = processRow('bet2', table3Rows);
  max3_3row = processRow('bet3', table3Rows);
  if (!max1_1row || !max2_1row || !max3_1row) return;
  if (!max1_2row || !max2_2row || !max3_2row) return;
  if (!max1_3row || !max2_3row || !max3_3row) return;
  const max1a = betChance(max1_1row[0].bet1);
  const max2a = betChance(max1_2row[0].bet1);
  const max3a = betChance(max1_3row[0].bet1);
  const max1b = betChance(max2_1row[0].bet2);
  const max2b = betChance(max2_2row[0].bet2);
  const max3b = betChance(max2_3row[0].bet2);
  const max1c = betChance(max3_1row[0].bet3);
  const max2c = betChance(max3_2row[0].bet3);
  const max3c = betChance(max3_3row[0].bet3);
  console.log("Any:",
    "DraftKings: " + rountdToPercent(1 - (1 - max1a) * (1 - max2a) * (1 - max3a), 3),
    "FanDuel: " + rountdToPercent(1 - (1 - max1b) * (1 - max2b) * (1 - max3b), 3),
    "BetRivers: " + rountdToPercent(1 - (1 - max1c) * (1 - max2c) * (1 - max3c), 3),
    "(70-74) 79.1 80.793"
  );
  console.log("Avg:",
    "DraftKings: " + rountdToPercent((max1a + max2a + max3a) / 3, 3),
    "FanDuel: " + rountdToPercent((max1b + max2b + max3b) / 3, 3),
    "BetRivers: " + rountdToPercent((max1c + max2c + max3c) / 3, 3),
    "(33-36) 38-39.7 42.054"
  );
  console.log("All:",
    "DraftKings:  " + rountdToPercent(max1a * max2a * max3a, 3),
    "FanDuel:  " + rountdToPercent(max1b * max2b * max3b, 3),
    "BetRivers:  " + rountdToPercent(max1c * max2c * max3c, 3),
    "(3-4) 5.5 7.259"
  );

  const addPicks = (pick: Map<string, string[]>, rows: RowKey[], title: string): void => {
    for (const row of rows) {
      const name = row.name;
      if (!pick.has(name)) pick.set(name, []);
      const odds = pick.get(name)!;
      odds.push(title);
    }
  }
  const printRow = (header: string, max1row: RowKey[], max2row: RowKey[], max3row: RowKey[]) => {
    const pick = new Map<string, string[]>();
    const allOdds = ["DraftKings", "FanDuel", "BetRivers"];
    addPicks(pick, max1row, allOdds[0]);
    addPicks(pick, max2row, allOdds[1]);
    addPicks(pick, max3row, allOdds[2]);
    for (const [name, odds] of pick.entries()) {
      if (odds.length === allOdds.length) console.log(`${header}: ${name}`);
      else console.log(`${header}: ${name} (${odds.join(", ")})`);
    }
  }
  printRow("1", max1_1row, max2_1row, max3_1row);
  printRow("2", max1_2row, max2_2row, max3_2row);
  printRow("3", max1_3row, max2_3row, max3_3row);
}
  logStats();

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
  const [rows1, setRows1] = useState(table1Rows);
  const sortedRows1 = [...rows1];

  const [rows2, setRows2] = useState(table2Rows);
  const sortedRows2 = [...rows2];

  const [rows3, setRows3] = useState(table3Rows);
  const sortedRows3 = [...rows3];

  // Update theme when system preference changes
  useEffect(() => {
    const handleChange = (event: MediaQueryListEvent) => {
      setDarkTheme(event.matches);
    };
    const darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
    darkModeMql.addEventListener('change', handleChange);
    return () => darkModeMql.removeEventListener('change', handleChange);
  }, []);

  const [sortConfig1, setSortConfig1] = useState<SortConfig>({ keyOrder: ['gg'] });
  const [sortConfig2, setSortConfig2] = useState<SortConfig>({ keyOrder: ['gg'] });
  const [sortConfig3, setSortConfig3] = useState<SortConfig>({ keyOrder: ['gg'] });

  sortedRows1.sort(sortFunction(sortConfig1));
  sortedRows2.sort(sortFunction(sortConfig2));
  sortedRows3.sort(sortFunction(sortConfig3));

  const requestSort1: RequestSort = makeSort(sortConfig1, setSortConfig1);
  const requestSort2: RequestSort = makeSort(sortConfig2, setSortConfig2);
  const requestSort3: RequestSort = makeSort(sortConfig3, setSortConfig3);

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
          <Table columns={columns} sortedRows={sortedRows1} requestSort={requestSort1} sortConfig={sortConfig1} darkTheme={darkTheme} chances={chances} />
        </div>
        <div className="table-container">
          <h2>Pick #2</h2>
          <Table columns={columns} sortedRows={sortedRows2} requestSort={requestSort2} sortConfig={sortConfig2} darkTheme={darkTheme} chances={chances} />
        </div>
        <div className="table-container">
          <h2>Pick #3</h2>
          <Table columns={columns} sortedRows={sortedRows3} requestSort={requestSort3} sortConfig={sortConfig3} darkTheme={darkTheme} chances={chances} />
        </div>
      </main>
    </>
  )
}

export default App
