import * as Picks from './components/Table';

// Raw player structure from players_XXX.json
type RawPlayerJson = {
	id: number;
	firstName: Picks.LocalizedText;
	lastName: Picks.LocalizedText;
	headshot: string;
};

type PickBucket = "1" | "2" | "3";
type PlayerDataByPick = Record<PickBucket, Picks.OddsItem[]>;
type GameDataInput = ConstructorParameters<typeof Picks.GameData>[0];
type PlayerInput = ConstructorParameters<typeof Picks.Player>[0];
// Structure of games.json
type GameListingData = {
	gameWeek: {
		games: GameDataInput[];
	}[];
};

interface SportsbookOddsItem {
	name: string;
	odds: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isStringMap = (value: unknown): value is Record<string, string> => {
	if (!isRecord(value)) return false;
	for (const val of Object.values(value)) {
		if (typeof val !== 'string') return false;
	}
	return true;
};

const isOddsItem = (value: unknown): value is Picks.OddsItem => {
	if (!isRecord(value)) return false;
	return (
		typeof value.playerId === 'number'
		&& typeof value.gamesPlayed === 'number'
		&& typeof value.firstName === 'string'
		&& typeof value.lastName === 'string'
		&& typeof value.goals === 'number'
	);
};

const isPlayerDataByPick = (value: unknown): value is PlayerDataByPick => {
	if (!isRecord(value)) return false;
	const buckets: PickBucket[] = ["1", "2", "3"];
	for (const bucket of buckets) {
		const items = value[bucket];
		if (!Array.isArray(items)) return false;
		if (!items.every(isOddsItem)) return false;
	}
	return true;
};

const isGameDataInput = (value: unknown): value is GameListingData => {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.gameWeek)) return false;
	for (const week of value.gameWeek) {
		if (!Array.isArray(week.games)) return false;
		// Validate each game is an object here
		if (!week.games.every(isRecord)) return false;
	}
	return true;
};

const isPlayersInput = (value: unknown): value is PlayerInput => {
	if (!Array.isArray(value)) return false;
	for (const player of value) {
		if (typeof player.id !== 'number') return false;
		if (!isStringMap(player.firstName)) return false;
		if (typeof player.firstName.default !== 'string') return false;
		if (!isStringMap(player.lastName)) return false;
		if (typeof player.lastName.default !== 'string') return false;
	}
	return true;
};

const isTeamInput = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	return (
		isStringMap(value.placeName)
		&& typeof value.placeName.default === 'string'
		&& isStringMap(value.commonName)
		&& typeof value.commonName.default === 'string'
		&& typeof value.abbrev === 'string'
		&& typeof value.logo === 'string'
		&& typeof value.darkLogo === 'string'
	);
};

const isGamesListingItem = (value: unknown): value is GameDataInput => {
	if (!isRecord(value)) return false;
	if (typeof value.gameCenterLink !== 'string') return false;
	if (typeof value.startTimeUTC !== 'string') return false;
	if (!isRecord(value.homeTeam) || !isRecord(value.awayTeam)) return false;
	if (!isTeamInput(value.homeTeam) || !isTeamInput(value.awayTeam)) return false;
	return true;
};

const isSportsbookOddsItem = (value: unknown): value is SportsbookOddsItem => {
	if (!isRecord(value)) return false;
	return typeof value.name === 'string' && typeof value.odds === 'number';
};

const fetchData = async (src: string) => {
	const response = await fetch(src + "?t=" + new Date().getTime());
	if (!response.ok) throw new Error(`Failed to load ${src}: ${response.status} ${response.statusText}`);
	return response;
}

const loadData = async (src: string): Promise<unknown> => {
	try {
		const response = await fetchData(src);
		return await response.json();
	} catch (error) {
		console.error(`Error loading ${src}:`, error);
		throw error;
	}
}

const loadAndValidate = async <T>(
	src: string,
	validator: (value: unknown) => value is T | Promise<boolean>,
	label: string
): Promise<T> => {
	const value = await loadData(src);
	const valid = validator(value);
	if (!valid) {
		throw new Error(`Invalid ${label} format in ${src}`);
	}
	return value as T;
};


// Async loader/validator for games.json that merges players into each game
export const loadGamesAndPlayers = async (processSrc: string, gamesSrc: string): Promise<[Picks.Player[], Picks.GameData[]]> => {
	let cutoff: Date | null = null;

	let metaDataResponse;
	try { metaDataResponse = await fetchData(processSrc); }
	catch (error) { console.warn(`Error loading metadata from ${processSrc}:`, error); }

	let metaData;
	if (metaDataResponse) {
		try { metaData = await metaDataResponse.json(); }
		catch (error) { console.warn(`Error parsing metadata from ${processSrc}:`, error); }
	}

	if (metaData) {
		if (!metaData || typeof metaData !== 'object') {
			throw new Error(`Invalid metadata format in ${processSrc}: ${metaData}`);
		}
		if (typeof metaData.processed !== 'string') {
			throw new Error(`Invalid 'processed' metadata in ${processSrc}: ${metaData.processed}`);
		}

		cutoff = new Date(metaData.processed);
		if (!cutoff || isNaN(cutoff.getTime())) {
			throw new Error(`Invalid 'processed' date in ${processSrc}: ${metaData.processed}`);
		}
	}

	const response = await fetchData(gamesSrc);
	const gamesJsonRaw = await response.json();
	if (!isGameDataInput(gamesJsonRaw)) {
		throw new Error(`Invalid games listing data format in ${gamesSrc}`);
	}
	const gamesJson = gamesJsonRaw as GameListingData;
	if (!gamesJson || typeof gamesJson !== 'object' || !Array.isArray(gamesJson.gameWeek) || gamesJson.gameWeek.length === 0) {
		throw new Error(`Invalid games listing data format in ${gamesSrc}`);
	}
	const games: GameDataInput[] = gamesJson.gameWeek[0].games || [];
	if (!Array.isArray(games) || games.length === 0) {
		throw new Error("NO GAMES");
	}

	if (!Array.isArray(games) || !games.every(isGamesListingItem)) {
		throw new Error('Invalid games structure');
	}

	const gamesList: Picks.GameData[] = [];
	for (const gameData of games) {
		const game = new Picks.GameData(gameData);
		if (!cutoff || cutoff < game.time) gamesList.push(game);
	}

	async function fetchAndValidatePlayers(
		team: Picks.TeamData,
		opponent: Picks.TeamData,
		homeGame: boolean,
		gameTime: Date
	): Promise<Picks.Player[]> {
		const code = team.code;
		const url = `./players/players_${code}.json`;
		const response = await fetchData(url);
		const json = await response.json();
		if (!isPlayersJson(json)) throw new Error(`Invalid players file: ${url}`);
		const allPlayers: RawPlayerJson[] = [...json.forwards, ...json.defensemen];
		if (!isPlayersInput(allPlayers)) throw new Error(`Invalid players listing data format in ${url}`);
		return allPlayers.map((p) => new Picks.Player(p, team, opponent, homeGame, gameTime));
	}

	const promises = [];
	for (const game of gamesList) {
		isGamesListingItem(game); // Type guard for game structure
		promises.push(fetchAndValidatePlayers(game.home, game.away, true, game.time));
		promises.push(fetchAndValidatePlayers(game.away, game.home, false, game.time));
	}
	const playersData = await Promise.all(promises);
	const playersList: Picks.Player[] = playersData.flat();

	gamesList.sort((a: Picks.GameData, b: Picks.GameData): number => {
		const time = a.time.getTime() - b.time.getTime();
		if (time !== 0) return time;
		return a.away.name.localeCompare(b.away.name);
	});

	return [playersList, gamesList];
};

// Validate a player object from players_XXX.json
function isPlayerJson(val: unknown): val is RawPlayerJson {
	if (!isRecord(val)) return false;
	if (typeof val.id !== 'number') return false;
	if (!val.firstName || !isStringMap(val.firstName) || typeof val.firstName.default !== 'string') return false;
	if (!val.lastName || !isStringMap(val.lastName) || typeof val.lastName.default !== 'string') return false;
	if (typeof val.headshot !== 'string') return false;
	return true;
}

// Validate a players_XXX.json file
function isPlayersJson(val: unknown): val is { forwards: RawPlayerJson[]; defensemen: RawPlayerJson[] } {
	if (!isRecord(val)) return false;
	if (!Array.isArray(val.forwards) || !Array.isArray(val.defensemen)) return false;
	if (!val.forwards.every(isPlayerJson)) return false;
	if (!val.defensemen.every(isPlayerJson)) return false;
	return true;
}

export interface InitialData {
	playerData: PlayerDataByPick;
	playersListing: Picks.Player[];
	gamesListing: Picks.GameData[];
	playerOddsDraftKings: SportsbookOddsItem[];
	playerOddsFanDuel: SportsbookOddsItem[];
	playerOddsBetMGM: SportsbookOddsItem[];
	playerOddsBetRivers: SportsbookOddsItem[];
}

export const loadInitialData = async (): Promise<InitialData> => {
	const [playerData, [playersListing, gamesListing], playerOddsDraftKings, playerOddsFanDuel, playerOddsBetMGM, playerOddsBetRivers] = await Promise.all([
		loadAndValidate('./data/helper.json', isPlayerDataByPick, 'helper odds data'),
		loadGamesAndPlayers('./data/process.json', './data/games.json'),
		loadAndValidate('./data/bet1.json', (value): value is SportsbookOddsItem[] => Array.isArray(value) && value.every(isSportsbookOddsItem), 'DraftKings odds data'),
		loadAndValidate('./data/bet2.json', (value): value is SportsbookOddsItem[] => Array.isArray(value) && value.every(isSportsbookOddsItem), 'FanDuel odds data'),
		loadAndValidate('./data/bet3.json', (value): value is SportsbookOddsItem[] => Array.isArray(value) && value.every(isSportsbookOddsItem), 'BetMGM odds data'),
		loadAndValidate('./data/bet4.json', (value): value is SportsbookOddsItem[] => Array.isArray(value) && value.every(isSportsbookOddsItem), 'BetRivers odds data'),
	]);

	return {
		playerData,
		playersListing,
		gamesListing,
		playerOddsDraftKings,
		playerOddsFanDuel,
		playerOddsBetMGM,
		playerOddsBetRivers,
	};
};

export const oddsNameMap = new Map<string, string>();
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

const removeAccentsNormalize = (name: string): string => {
	return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

// Build a normalized name map once for fast lookups
export const buildNormalizedNameMap = (playerList: Picks.Player[]): Map<string, Picks.Player> => {
	const map = new Map<string, Picks.Player>();
	for (const player of playerList) {
		const normalized = removeAccentsNormalize(player.fullName);
		map.set(normalized, player);
	}
	return map;
};

export const mapPlayers = (
	playerList: Picks.Player[],
	playerData: PlayerDataByPick,
	normalizedNameMap: Map<string, Picks.Player>
) => {
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
				const fullName = item.firstName + " " + item.lastName;
				const fullNameNormalized = removeAccentsNormalize(fullName);
				player = normalizedNameMap.get(fullNameNormalized);
				if (player) {
					item.playerId = player.playerId;
				}
			}
			if (player) {
				player.pick = pick;
				row.push(new Picks.PickOdds(player));
			} else {
				console.warn(`Player not found for odds data:`, item);
			}
		}
		return row;
	}

	const table1Rows = makeRows(playerData["1"], 1);
	const table2Rows = makeRows(playerData["2"], 2);
	const table3Rows = makeRows(playerData["3"], 3);
	return { table1Rows, table2Rows, table3Rows };
};

export const compilePlayerList = (
	playerList: Picks.Player[],
	playerOddsDraftKings: SportsbookOddsItem[],
	playerOddsFanDuel: SportsbookOddsItem[],
	playerOddsBetMGM: SportsbookOddsItem[],
	playerOddsBetRivers: SportsbookOddsItem[]
) => {
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
				if (betKey === 'betRaw1' && process("Elias Pettersson")) return;
				if (betKey === 'betRaw2' && process("Elias Pettersson #40")) return;
				if (betKey === 'betRaw4' && process("Elias Pettersson (1998)")) return;
			}
			if (player.playerId === 8483678) {
				if (betKey === 'betRaw1' && process("Elias-Nils Pettersson")) return;
				if (betKey === 'betRaw2' && process("Elias Pettersson #25")) return;
				if (betKey === 'betRaw4' && process("Elias Pettersson (2004)")) return;
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
};
