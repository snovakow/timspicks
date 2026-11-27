import { isTeam, type Team } from './components/logo';
import * as Picks from './components/Table';
import { SportsbookKeys, Sportsbooks, type SportsbookKey } from './dataTypes';
import { addDays, isDay } from './utility';

// Raw player structure from playerId.json, and of each player in rosters.json
export type RawPlayerJson = {
	playerId: number;
	firstName: Picks.LocalizedText;
	lastName: Picks.LocalizedText;
	currentTeamAbbrev: Team;
};

type PickBucket = "1" | "2" | "3";
// dateTimeAvailable is when the feed made the draw, in ET with no offset; files older than the stamp lack it
type PlayerDataByPick = Record<PickBucket, Picks.OddsItem[]> & { dateTimeAvailable?: string };
type GameDataInput = ConstructorParameters<typeof Picks.GameData>[0];
// Structure of games.json
type GameListingData = {
	gameWeek: {
		date?: string;
		games: GameDataInput[];
	}[];
};

// Thrown when the schedule's day has no games, with that day's ET date so the page still knows which day it is
export class NoGamesError extends Error {
	readonly date: string | null;
	constructor(date: string | null) {
		super('NO_GAMES');
		this.name = 'NoGamesError';
		this.date = date;
	}
}

export interface DataStatus {
	processed: Date;
	unfinished: boolean;
	stopped: boolean;
	staleList: boolean;
	earlierDraw: boolean;
	warnings: string[];
}

// A day plus slack for cron timing and daylight saving changes
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;
// A full run takes seconds, so one still going after this has failed
const RUN_GRACE_MS = 10 * 60 * 1000;
// A redraw can't be pulled until the cron's game start buffer clears, and a stale list
// retries on its shorter period, so only a gap past both of those is worth reporting
const REDRAW_GRACE_MS = 10 * 60 * 1000;

// The day's last start. The cron makes no runs between it and midnight, so nothing new
// arrives after it and the app has nothing left to offer for the day
export const getLastGameStart = (gameTimes: Date[]): Date | null => {
	const times = gameTimes.map((time) => time.getTime()).filter((time) => !isNaN(time));
	return times.length > 0 ? new Date(Math.max(...times)) : null;
};

// process.json holds the last complete run's time and warnings. While later runs haven't finished, started is
// when the first of them began ("failingSince", else "started"), so a run of retries can't keep resetting the grace
export const getDataStatus = (processed: Date, started: Date | null, warnings: string[], gameTimes: Date[], earlierDraw = false, now = new Date()): DataStatus | null => {
	const unfinished = started !== null && started.getTime() > processed.getTime() && now.getTime() - started.getTime() > RUN_GRACE_MS;
	const stopped = now.getTime() - processed.getTime() > STALE_AFTER_MS;
	// A game that started since the last run was redrawn upstream without the pull landing.
	// The cron makes no runs after the day's last start, so that one never gets a pull to wait for
	const lastStart = getLastGameStart(gameTimes);
	const staleList = lastStart !== null && gameTimes.some((time) => time.getTime() < lastStart.getTime() && time > processed && now.getTime() - time.getTime() > REDRAW_GRACE_MS);
	return unfinished || stopped || staleList || earlierDraw || warnings.length > 0 ? { processed, unfinished, stopped, staleList, earlierDraw, warnings } : null;
};

export interface SportsbookOddsItem {
	name: string;
	odds: number;
}

export const isRecord = (value: unknown): value is Record<string, unknown> => {
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

const fetchData = async (src: string, query?: string) => {
	const response = await fetch(src + "?t=" + new Date().getTime() + (query ? `&${query}` : ""));
	if (!response.ok) throw new Error(`Failed to load ${src}: ${response.status} ${response.statusText}`);
	return response;
}

const loadData = async (src: string, query?: string): Promise<unknown> => {
	try {
		const response = await fetchData(src, query);
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

// Validate a player object from playerId.json
function isPlayerJson(val: unknown): val is RawPlayerJson {
	if (!isRecord(val)) return false;
	if (typeof val.playerId !== 'number') return false;
	if (!val.firstName || !isStringMap(val.firstName) || typeof val.firstName.default !== 'string') return false;
	if (!val.lastName || !isStringMap(val.lastName) || typeof val.lastName.default !== 'string') return false;
	if (!isTeam(val.currentTeamAbbrev)) return false;
	return true;
}

// A snapshot folder's name: its slot's start as ET HHmm, as the cron names it
export const slotFolder = (time: Date): string => {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = formatter.formatToParts(time);
	const dateMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
	return `${dateMap.hour}${dateMap.minute}`;
};

// The order the games table lists a day's games in: by start, then by the away team's name
const byStart = (a: Picks.GameData, b: Picks.GameData): number => {
	const time = a.time.getTime() - b.time.getTime();
	if (time !== 0) return time;
	return a.away.name.localeCompare(b.away.name);
};

const gameMapOf = (games: Picks.GameData[]): Map<Team, Picks.GameData> => {
	const gameMap = new Map<Team, Picks.GameData>();
	for (const game of games) {
		gameMap.set(game.home.code, game);
		gameMap.set(game.away.code, game);
	}
	return gameMap;
};

// Player files by id, so the snapshots of earlier slots reuse the ones already loaded
const playerFiles = new Map<number, Promise<unknown>>();
const loadPlayerFile = (playerId: number): Promise<unknown> => {
	let file = playerFiles.get(playerId);
	if (!file) {
		file = loadData(`./players/${playerId}.json`);
		playerFiles.set(playerId, file);
	}
	return file;
};

// The player set in his team's game, or null when his team has no game among them
const makePlayer = (playerJson: RawPlayerJson, gameMap: Map<Team, Picks.GameData>): Picks.Player | null => {
	const game = gameMap.get(playerJson.currentTeamAbbrev);
	if (!game) return null;
	const homeGame = game.home.code === playerJson.currentTeamAbbrev;
	const [team, opponent] = homeGame ? [game.home, game.away] : [game.away, game.home];
	return new Picks.Player(playerJson, team, opponent, homeGame, game.time);
};

type GamesAndPlayers = {
	// The pick lists the players were loaded for, so the rows and the players come from one draw
	playerData: PlayerDataByPick;
	playersListing: Picks.Player[];
	gamesListing: Picks.GameData[];
	// The schedule's ET date, which names the day's snapshot folder
	scheduleDate: string | null;
	dataStatus: DataStatus | null;
	processed: Date | null;
};

// Async loader/validator for games.json that merges players into each game
const loadGamesAndPlayers = async (processSrc: string, helperSrc: string, gamesSrc: string): Promise<GamesAndPlayers> => {
	let cutoff: Date | null = null;
	let started: Date | null = null;
	let warnings: string[] = [];

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

		// Status fields only feed the banner, so ignore them rather than fail the page when they're malformed
		const parseTime = (value: unknown): Date | null => typeof value === 'string' && !isNaN(new Date(value).getTime()) ? new Date(value) : null;
		// Each failed attempt restamps "started", and inside the game window the cron retries sooner than the
		// banner's grace, so a run of failures is timed from "failingSince", its first attempt
		started = parseTime(metaData.failingSince) ?? parseTime(metaData.started);
		if (Array.isArray(metaData.warnings)) {
			warnings = metaData.warnings.filter((warning: unknown): warning is string => typeof warning === 'string');
		}
	}

	const promiseHelper = fetchData(helperSrc);
	const promiseGames = fetchData(gamesSrc);
	const [responseHelper, responseGames] = await Promise.all([promiseHelper, promiseGames]);

	const playerData = await responseHelper.json();
	if (!isPlayerDataByPick(playerData)) {
		throw new Error(`Invalid helper data format in ${helperSrc}`);
	}

	const gamesJsonRaw = await responseGames.json();
	if (!isGameDataInput(gamesJsonRaw)) {
		throw new Error(`Invalid games listing data format in ${gamesSrc}`);
	}
	const gamesJson = gamesJsonRaw as GameListingData;
	if (!gamesJson || typeof gamesJson !== 'object' || !Array.isArray(gamesJson.gameWeek) || gamesJson.gameWeek.length === 0) {
		throw new Error(`Invalid games listing data format in ${gamesSrc}`);
	}
	const games: GameDataInput[] = gamesJson.gameWeek[0].games || [];
	if (!Array.isArray(games) || games.length === 0) {
		const date = gamesJson.gameWeek[0].date;
		throw new NoGamesError(typeof date === 'string' ? date : null);
	}

	if (!Array.isArray(games) || !games.every(isGamesListingItem)) {
		throw new Error('Invalid games structure');
	}

	/*
		Every game stays, started or not, and the page sorts them out on the clock: a started game
		and its players leave the tables, or stay greyed while today's history is on. A run can
		land after a start but before the feed redraws, so its lists can still hold that game's
		players, and the clock rather than the run decides whether they're still current.
	*/
	const gamesList: Picks.GameData[] = games.map((gameData) => new Picks.GameData(gameData));
	const gameTimes: Date[] = gamesList.map((game) => game.time);
	const gameMap = gameMapOf(gamesList);

	const promises = [];
	for (const pick of [...playerData['1'], ...playerData['2'], ...playerData['3']]) {
		promises.push(loadPlayerFile(pick.playerId));
	}
	const playersData = await Promise.all(promises);
	const playersList: Picks.Player[] = [];
	for (const playerJson of playersData.flat()) {
		if (!isPlayerJson(playerJson)) throw new Error(`Invalid player data: ${playerJson}`);
		const player = makePlayer(playerJson, gameMap);
		if (player) playersList.push(player);
	}

	gamesList.sort(byStart);

	/*
		The first run after midnight can land before the feed posts the day's first draw, which it
		stamps midnight, so a draw dated other than the schedule's day is yesterday's final list
		set against today's games. Both dates are ET, so they compare as strings.
	*/
	const scheduleDate = gamesJson.gameWeek[0].date;
	const drawn = typeof playerData.dateTimeAvailable === 'string' ? playerData.dateTimeAvailable : null;
	const earlierDraw = drawn !== null && typeof scheduleDate === 'string' && drawn.slice(0, 10) !== scheduleDate;

	const dataStatus = cutoff ? getDataStatus(cutoff, started, warnings, gameTimes, earlierDraw) : null;

	return {
		playerData,
		playersListing: playersList,
		gamesListing: gamesList,
		scheduleDate: typeof scheduleDate === 'string' ? scheduleDate : null,
		dataStatus,
		processed: cutoff,
	};
};

interface InitialData {
	playerData: PlayerDataByPick;
	playersListing: Picks.Player[];
	gamesListing: Picks.GameData[];
	scheduleDate: string | null;
	dataStatus: DataStatus | null;
	processed: Date | null;
	// Each shown book's odds file, by key
	playerOdds: Partial<Record<SportsbookKey, SportsbookOddsItem[]>>;
	roster: RawPlayerJson[];
}

const isOddsList = (value: unknown): value is SportsbookOddsItem[] => Array.isArray(value) && value.every(isSportsbookOddsItem);

export const loadInitialData = async (): Promise<InitialData> => {
	const [gamesAndPlayers, bookOdds, roster] = await Promise.all([
		loadGamesAndPlayers('./data/process.json', './data/helper.json', './data/games.json'),
		Promise.all(SportsbookKeys.map((key) => loadAndValidate(`./data/${key}.json`, isOddsList, `${Sportsbooks[key].title} odds data`))),
		loadRoster(),
	]);

	return {
		...gamesAndPlayers,
		playerOdds: Object.fromEntries(SportsbookKeys.map((key, index) => [key, bookOdds[index]])),
		roster,
	};
};

// Every skater on the teams in rosters.json, or none when it's missing or malformed, since only the player table reads it
const loadRoster = async (): Promise<RawPlayerJson[]> => {
	try {
		const value: unknown = await (await fetchData('./data/rosters.json')).json();
		if (!isRecord(value) || !isRecord(value.teams)) return [];
		return Object.values(value.teams).flatMap((team) => Array.isArray(team) ? team.filter(isPlayerJson) : []);
	} catch {
		return [];
	}
};

/*
	The days the archive holds, oldest first, from its index: each day with a snapshot and final scores. None when
	the index is missing or malformed, since only the calendar reads it, which then offers the loaded day alone.
*/
export const loadArchiveDays = async (): Promise<string[]> => {
	try {
		const value: unknown = await (await fetchData('./data/days.json')).json();
		if (!Array.isArray(value)) return [];
		const days = value.flatMap((entry) => isRecord(entry) && typeof entry.date === 'string' && isDay(entry.date) ? [entry.date] : []);
		return [...new Set(days)].sort();
	} catch {
		return [];
	}
};

// The games a schedule file lists for one day of its week, or null when the file doesn't cover that day
const weekGames = (value: unknown, date: string): unknown[] | null => {
	if (!isGameDataInput(value)) return null;
	const week = value.gameWeek.find((entry) => entry.date === date);
	return week ? week.games : null;
};

// A day's games as the schedule saved with its snapshots lists them, in the order the loaded day's are
const loadDayGames = async (date: string): Promise<Picks.GameData[]> => {
	const src = `./data/${date}/games.json`;
	const games = weekGames(await loadData(src), date);
	if (games === null || !games.every(isGamesListingItem)) throw new Error(`Invalid games listing data format in ${src}`);
	return games.map((game) => new Picks.GameData(game)).sort(byStart);
};

/*
	Whether a day the archive's index lacks had games. The index takes a day only once its games are all
	official, so the day before the loaded one can have games and no entry yet, while its last game is still
	going after midnight. The schedule saved with the latest indexed day before it lists that day's week, so it
	tells such a day from one without games, and no day folder that doesn't exist is asked for. A day more than a
	week past the latest indexed one is taken to have none.
*/
export const scheduledGames = async (date: string, archiveDays: readonly string[]): Promise<boolean> => {
	const latest = archiveDays.filter((day) => day < date).pop();
	if (latest === undefined || addDays(latest, 6) < date) return false;
	try {
		const games = weekGames(await (await fetchData(`./data/${latest}/games.json`)).json(), date);
		return games !== null && games.length > 0;
	} catch {
		return false;
	}
};

/*
	An earlier day's games, for the calendar, which offers only days with games: null when the day's schedule
	won't load, which leaves the page nothing of it to show. Its lists are its slots' snapshots alone.
*/
export const loadEarlierDay = async (date: string): Promise<Picks.GameData[] | null> => {
	try {
		return await loadDayGames(date);
	} catch {
		return null;
	}
};

/*
	A day's goal scorers as its scores file holds them: who has scored, and the teams whose game is over, which
	is what tells a player who didn't score from one who hasn't yet. The scorers are those with a goal the
	contest counts, so none from a shootout.
*/
export interface DayScores {
	// The ET day the scores are for, as the schedule dates it
	date: string;
	scorers: ReadonlySet<number>;
	// The teams whose game has ended
	over: ReadonlySet<string>;
	// The teams whose game needs no further fetch: called official, or off its normal schedule
	settled: ReadonlySet<string>;
}

// How long after its start a game is followed when it is never called official, as the cron follows it
const SCORES_FOLLOW_MS = 8 * 60 * 60 * 1000;

// A day's scores file, or null when it's missing, malformed or for another day: the tables are whole without it
export const loadScores = async (date: string): Promise<DayScores | null> => {
	let value: unknown;
	try { value = await (await fetchData(`./data/${date}/scores.json`)).json(); }
	catch { return null; }
	if (!isRecord(value) || value.date !== date || !Array.isArray(value.games)) return null;

	const scorers = new Set<number>();
	const over = new Set<string>();
	const settled = new Set<string>();
	for (const game of value.games) {
		if (!isRecord(game) || typeof game.away !== 'string' || typeof game.home !== 'string') return null;
		const official = game.state === 'OFF';
		for (const team of [game.away, game.home]) {
			if (official || game.state === 'FINAL') over.add(team);
			if (official || game.schedule !== 'OK') settled.add(team);
		}
		if (!Array.isArray(game.scorers)) return null;
		for (const playerId of game.scorers) if (typeof playerId === 'number') scorers.add(playerId);
	}
	return { date, scorers, over, settled };
};

// True while a game's scores can still change: started, not settled, and within the time a game is followed
// for. Without the day's scores every started game counts
export const scoresInPlay = (games: Picks.GameData[], scores: DayScores | null, now: number): boolean => {
	return games.some((game) => {
		const start = game.time.getTime();
		return start <= now && now < start + SCORES_FOLLOW_MS && !scores?.settled.has(game.home.code);
	});
};

/*
	The roster's players in the games given, outside the lists, whom at least one book prices: the player
	table's players who could still come up in a later draw. The lists are their own entries, so a listed
	player whose file didn't load is still listed, and a player the roster holds twice counts once. The
	books price by name alone, so an unlisted player who shares his name with another of the day's players
	would take that player's prices, and he is left out, unless the id-keyed spellings tell the two apart.
*/
export const unlistedPlayers = (
	roster: RawPlayerJson[],
	games: Picks.GameData[],
	listed: Picks.OddsItem[],
	playerOdds: Partial<Record<SportsbookKey, SportsbookOddsItem[]>>
): Picks.Player[] => {
	const gameMap = gameMapOf(games);
	const listedIds = new Set(listed.map((pick) => pick.playerId));

	// Each of the day's names, folded as the odds lookup folds them, with the players who carry it
	const nameIds = new Map<string, Set<number>>();
	const addName = (fullName: string, playerId: number) => {
		const name = removeAccentsNormalize(fullName);
		const ids = nameIds.get(name) ?? new Set<number>();
		ids.add(playerId);
		nameIds.set(name, ids);
	};
	for (const pick of listed) addName(`${pick.firstName} ${pick.lastName}`, pick.playerId);

	const seen = new Set<number>();
	const candidates: Picks.Player[] = [];
	for (const playerJson of roster) {
		if (seen.has(playerJson.playerId)) continue;
		seen.add(playerJson.playerId);
		const player = makePlayer(playerJson, gameMap);
		if (!player) continue;
		addName(player.fullName, player.playerId);
		if (!listedIds.has(player.playerId)) candidates.push(player);
	}

	const players = candidates.filter((player) => idKeyedName(player.fullName) || nameIds.get(removeAccentsNormalize(player.fullName))!.size === 1);
	compilePlayerList(players, playerOdds);
	return players.filter((player) => SportsbookKeys.some((key) => player.raw[key] != null));
};

export const oddsNameMap = new Map<string, string>();
oddsNameMap.set("Aatu Räty", "Aatu Raty");
oddsNameMap.set("Aleksanteri Kaskimaki", "Alexander Kaskimäki"); // bet4
oddsNameMap.set("Alex DeBrincat", "Alex Debrincat"); // BetMGM
oddsNameMap.set("Alex Kerfoot", "Alexander Kerfoot"); // bet1 bet2 bet4 bet5 bet6
oddsNameMap.set("Alexander Wennberg", "Alex Wennberg"); // FanDuel
oddsNameMap.set("Alexei Toropchenko", "Alexey Toropchenko"); // bet1 bet2 bet3 bet5 bet6
oddsNameMap.set("Alexis Lafrenière", "Alexis Lafreniere"); // DraftKings FanDuel
oddsNameMap.set("Aliaksei Protas", "Alexei Protas"); // BetRivers (lang)
oddsNameMap.set("Anton Silaev", "Anton Silayev"); // bet2 bet4
oddsNameMap.set("Arseny Gritsyuk", "Arseni Gritsyuk"); // BetRivers
oddsNameMap.set("Artem Zub", "Artyom Zub"); // BetRivers
oddsNameMap.set("Axel Sandin-Pellikka", "Axel Sandin Pellikka"); // DraftKings
oddsNameMap.set("Ben Kindel", "Benjamin Kindel"); // BetRivers
oddsNameMap.set("Bo Groulx", "Benoit-Olivier Groulx"); // BetMGM
oddsNameMap.set("Carl Grundstrom", "Carl Grundström"); // BetRivers (lang)
oddsNameMap.set("Charle-Edouard D'Astous", "Charles-Edouard D'Astous"); // BetRivers
oddsNameMap.set("Connor Murphy", "Connor Murphy (EDM)"); // bet2
oddsNameMap.set("Danila Yurov", "Yurov Danila"); // BetMGM
oddsNameMap.set("Dmitri Simashev", "Dimitri Simashev"); // bet4
oddsNameMap.set("Dmitry Orlov", "Dimitri Orlov"); // BetRivers
oddsNameMap.set("Egor Chinakhov", "Yegor Chinakhov"); // DraftKings BetRivers
oddsNameMap.set("Ethan Del Mastro", "Ethan del Mastro"); // FanDuel
oddsNameMap.set("Frederick Gaudreau", "Freddy Gaudreau"); // bet1 bet2 bet3 bet4
oddsNameMap.set("Gabe Perreault", "Gabriel Perreault"); // BetMGM
oddsNameMap.set("Isaac Howard", "Issac Howard"); // bet2
oddsNameMap.set("J.J. Moser", "Janis Jérôme Moser"); // BetRivers
oddsNameMap.set("J.T. Compher", "JT Compher"); // BetRivers
oddsNameMap.set("Jacob Trouba", "Jake Trouba"); // bet3
oddsNameMap.set("Jake Middleton", "Jacob Middleton"); // BetRivers (lang)
oddsNameMap.set("James van Riemsdyk", "James Van Riemsdyk"); // BetMGM
oddsNameMap.set("Jeffrey Viel", "Jeff Viel"); // bet1 bet2 bet3 bet4
oddsNameMap.set("JJ Peterka", "John-Jason Peterka"); // BetRivers
oddsNameMap.set("Joe Veleno", "Joseph Veleno"); // bet4 bet5 bet6
oddsNameMap.set("Josh Morrissey", "Joshua Morrissey"); // BetRivers
oddsNameMap.set("Josh Norris", "Joshua Norris"); // bet1 bet2 bet3 bet4
oddsNameMap.set("Josh Samanski", "Joshua Samanski"); // bet3
oddsNameMap.set("Lenni Hameenaho", "Lenni Hämeenaho"); // BetRivers
oddsNameMap.set("Liam Ohgren", "Liam Öhgren"); // BetRivers (lang)
oddsNameMap.set("MacKenzie Weegar", "MacKenzie Weegar (UTA)"); // bet3
oddsNameMap.set("Martin Fehérváry", "Martin Fehervary");
oddsNameMap.set("Martin Pospisil", "Martin Pospíšil"); // BetRivers (lang)
oddsNameMap.set("Matt Boldy", "Matthew Boldy"); // BetRivers
oddsNameMap.set("Matt Coronato", "Matthew Coronato"); // BetRivers
oddsNameMap.set("Matt Savoie", "Matthew Savoie"); // BetRivers
oddsNameMap.set("Max Crozier", "Maxwell Crozier"); // bet4
oddsNameMap.set("Maxim Tsyplakov", "Maksim Tsyplakov"); // bet1
oddsNameMap.set("Michael McCarron", "Mike McCarron"); // bet3
oddsNameMap.set("Mike Matheson", "Michael Matheson"); // BetRivers
oddsNameMap.set("Mitch Marner", "Mitchell Marner"); // FanDuel BetRivers (lang)
oddsNameMap.set("Nick Paul", "Nicholas Paul"); // FanDuel
oddsNameMap.set("Nick Robertson", "Nicholas Robertson"); // bet1 bet2 bet3 bet4
oddsNameMap.set("Nick Suzuki", "Nicholas Suzuki"); // bet1 bet2 bet3 bet4
oddsNameMap.set("Oliver Bjorkstrand", "Oliver Björkstrand"); // BetRivers
oddsNameMap.set("Olli Määttä", "Olli Maatta"); // DraftKings FanDuel (lang)
oddsNameMap.set("Ondrej Palat", "Ondrej Palát"); // BetRivers (lang mix and match)
oddsNameMap.set("Oskar Bäck", "Oskar Back"); // DraftKings FanDuel
oddsNameMap.set("Sebastian Aho", "Sebastian Aho (CAR)"); // FanDuel, BetRivers
oddsNameMap.set("Shea Theodore", "Shea Théodore"); // BetRivers
oddsNameMap.set("Simon Holmstrom", "Simon Holmström"); // BetRivers (lang)
oddsNameMap.set("T.J. Hughes", "T.J Hughes"); // bet4
oddsNameMap.set("Teuvo Teravainen", "Teuvo Teräväinen"); // BetRivers (lang)
oddsNameMap.set("Tim Stützle", "Tim Stuetzle"); // DraftKings
oddsNameMap.set("Tommy Novak", "Thomas Novak"); // BetRivers (lang)
oddsNameMap.set("Trevor van Riemsdyk", "Trevor Van Riemsdyk"); // BetRivers
oddsNameMap.set("Vasily Podkolzin", "Vasili Podkolzin"); // BetRivers (lang)
oddsNameMap.set("Vincent Trocheck", "Vincent Trochek"); // bet3
oddsNameMap.set("Zachary Bolduc", "Zack Bolduc"); // DraftKings
oddsNameMap.set("Zachary L'Heureux", "Zachary L’Heureux"); // bet4

// The map is keyed by roster names, but the pick-list feed can name a player by the form
// the map points to instead ("Mitchell Marner" for "Mitch Marner"). A lookup that starts
// from the feed's name, as the archive replays do, has to read the map both ways.
const oddsNameReverse = new Map([...oddsNameMap].map(([roster, odds]): [string, string] => [odds, roster]));
export const oddsNameCandidates = (fullName: string): string[] => {
	return [fullName, oddsNameMap.get(fullName), oddsNameReverse.get(fullName)]
		.filter((name): name is string => Boolean(name));
};

export const removeAccentsNormalize = (name: string): string => {
	return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
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
			const playerId = item.playerId;
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

// Each book's spellings for the two Elias Petterssons, by player id, since the plain name can't tell them apart. A
// book that changed its spelling keeps the old one after the new, since older snapshots still carry it
const eliasPettersson: Record<number, Partial<Record<SportsbookKey, string[]>>> = {
	8480012: { bet1: ["Elias Pettersson"], bet2: ["Elias Pettersson #40"], bet3: ["Elias Pettersson", "Elias Pettersson (1998)"], bet4: ["Elias Pettersson (1998)"], bet5: ["Elias Pettersson"], bet6: ["Elias Pettersson"] },
	8483678: { bet1: ["Elias-Nils Pettersson"], bet2: ["Elias Nils Pettersson #25", "Elias Pettersson #25"], bet3: ["Elias Nils Pettersson"], bet4: ["Elias Pettersson (2004)"] },
};
// The name whose players are priced by the table above rather than by name
const idKeyedName = (fullName: string): boolean => fullName === "Elias Pettersson";

/*
	Each player's price from each book, by his name. A player built from a list entry rather than a player file
	carries the pick-list feed's spelling, which can be the form the name map points to, so for him the map is
	read both ways, as the archive replays read it.
*/
export const compilePlayerList = (
	playerList: Picks.Player[],
	playerOdds: Partial<Record<SportsbookKey, SportsbookOddsItem[]>>,
	feedNames = false
) => {
	const nameFind = (player: Picks.Player, oddsMap: Map<string, number>, key: SportsbookKey) => {
		const process = (name: string | undefined): boolean => {
			if (name === undefined) return false;
			const decimal = oddsMap.get(removeAccentsNormalize(name));
			if (decimal === undefined) return false;

			const chance = 1 / decimal;
			player.raw[key] = chance;
			return true;
		};

		if (idKeyedName(player.fullName)) {
			for (const name of eliasPettersson[player.playerId]?.[key] ?? []) if (process(name)) return;
			return;
		}

		const baseName = player.fullName;
		if (process(baseName)) return;

		const mapped = oddsNameMap.get(player.fullName);
		if (mapped && process(mapped)) return;

		const reversed = feedNames ? oddsNameReverse.get(player.fullName) : undefined;
		if (reversed && process(reversed)) return;

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

	const oddsMaps = SportsbookKeys.map((key) => new Map((playerOdds[key] ?? []).map((item): [string, number] => [removeAccentsNormalize(item.name), item.odds])));

	for (const player of playerList) {
		SportsbookKeys.forEach((key, index) => {
			player.raw[key] = null;
			nameFind(player, oddsMaps[index], key);
			player[key] = player.raw[key];
		});
	}
};

export interface PickLists {
	playerList: Picks.Player[];
	// The priced players outside the lists, which only the player table shows
	unlistedPlayers: Picks.Player[];
	table1Rows: Picks.PickOdds[];
	table2Rows: Picks.PickOdds[];
	table3Rows: Picks.PickOdds[];
}

/*
	The players of a slot's list entries as the archive replays read them: by the name and team each entry
	gives, with no player file. A player traded since keeps the team he had that day, and one whose file a later
	season no longer holds is still there. One whose team has no game that day is left out.
*/
const entryPlayers = (picks: Picks.OddsItem[], gameMap: Map<Team, Picks.GameData>): Picks.Player[] => {
	const players = new Map<number, Picks.Player>();
	for (const pick of picks) {
		const team: unknown = (pick as { team?: unknown }).team;
		if (players.has(pick.playerId) || !isTeam(team)) continue;
		const player = makePlayer({ playerId: pick.playerId, firstName: { default: pick.firstName }, lastName: { default: pick.lastName }, currentTeamAbbrev: team }, gameMap);
		if (player) players.set(player.playerId, player);
	}
	return [...players.values()];
};

/*
	A passed slot's lists and odds as its snapshot folder holds them, from the last run before
	its start, or null when the folder has no lists. A book without a file there prices no one,
	as in the archive replays, and a player whose file won't load is left out rather than the slot.
	An earlier day's slot takes its players from its list entries instead, as the replays do.
*/
export const loadSlot = async (date: string, start: Date, games: Picks.GameData[], roster: RawPlayerJson[], fromEntries = false): Promise<PickLists | null> => {
	const folder = `./data/${date}/${slotFolder(start)}`;
	const loadOptional = async (src: string): Promise<unknown> => {
		try { return await (await fetchData(src)).json(); }
		catch { return null; }
	};
	const [helper, ...bookOdds] = await Promise.all([
		loadOptional(`${folder}/helper.json`),
		...SportsbookKeys.map((key) => loadOptional(`${folder}/${key}.json`)),
	]);
	if (!isPlayerDataByPick(helper)) return null;

	const gameMap = gameMapOf(games);
	const picks = [...helper['1'], ...helper['2'], ...helper['3']];
	const playerOdds = Object.fromEntries(SportsbookKeys.map((key, index) => [key, isOddsList(bookOdds[index]) ? bookOdds[index] : []]));
	// Taken before the rows are mapped, since mapping can rewrite an entry's id
	const unlisted = unlistedPlayers(roster, games, picks, playerOdds);
	const playerList: Picks.Player[] = fromEntries ? entryPlayers(picks, gameMap) : [];
	if (!fromEntries) {
		const playerIds = new Set(picks.map((pick) => pick.playerId));
		const files = await Promise.allSettled([...playerIds].map(loadPlayerFile));
		for (const file of files) {
			if (file.status !== 'fulfilled' || !isPlayerJson(file.value)) continue;
			const player = makePlayer(file.value, gameMap);
			if (player) playerList.push(player);
		}
	}

	const rows = mapPlayers(playerList, helper, buildNormalizedNameMap(playerList));
	compilePlayerList(playerList, playerOdds, fromEntries);
	return { playerList, unlistedPlayers: unlisted, ...rows };
};

// De-vig: correct each sportsbook's bias AND compression toward the
// peer average (leave-one-out mean).
export function deVig(playerList: Picks.Player[]) {
	const minProb = 0.0001;
	const maxProb = 0.9999;
	const minBookPlayers = 10;
	const minSlope = 0.8;
	const maxSlope = 1.25;
	const maxConsensusLogitGap = 1.25;

	const clampProb = (value: number): number => Math.min(maxProb, Math.max(minProb, value));
	const logit = (value: number): number => {
		const p = clampProb(value);
		return Math.log(p / (1 - p));
	};
	const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

	interface Correction {
		intercept: number;
		slope: number;
		strength: number;
	}

	const corrections: Partial<Record<SportsbookKey, Correction>> = {};
	for (const key of SportsbookKeys) {
		const xs: number[] = [];
		const ys: number[] = [];
		for (const player of playerList) {
			const bookProb = player[key];
			if (bookProb === null) continue;
			let peerSum = 0, peerCount = 0;
			for (const other of SportsbookKeys) {
				if (other === key) continue;
				if (player[other] !== null) { peerSum += player[other]!; peerCount++; }
			}
			if (peerCount === 0) continue;
			xs.push(logit(peerSum / peerCount));
			ys.push(logit(bookProb));
		}
		if (xs.length < minBookPlayers) continue;

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
		const slopeRaw = (n * sumXY - sumX * sumY) / denom;
		if (slopeRaw <= 0) continue;
		const interceptRaw = (sumY - slopeRaw * sumX) / n;

		let ssRes = 0;
		let ssTot = 0;
		const meanY = sumY / n;
		for (let i = 0; i < n; i++) {
			const pred = interceptRaw + slopeRaw * xs[i];
			const err = ys[i] - pred;
			ssRes += err * err;
			const dy = ys[i] - meanY;
			ssTot += dy * dy;
		}

		const r2 = ssTot > 1e-12 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
		const sampleWeight = Math.max(0, Math.min(1, (n - minBookPlayers + 1) / 30));
		const strength = sampleWeight * r2;

		const slopeUnclamped = 1 + strength * (slopeRaw - 1);
		const slope = Math.min(maxSlope, Math.max(minSlope, slopeUnclamped));
		const intercept = strength * interceptRaw;

		corrections[key] = { intercept, slope, strength };
		// console.log(`De-vig [${key}]: a=${intercept.toFixed(4)}, b=${slope.toFixed(4)}, fit=${strength.toFixed(4)} (${n} players)`);
	}

	// Apply all at once in logit-space to keep tail behavior stable.
	const originalByBook = new Map<SportsbookKey, Array<number | null>>();
	for (const key of SportsbookKeys) {
		originalByBook.set(key, playerList.map((player) => player[key]));
	}

	const getOriginal = (key: SportsbookKey, index: number): number | null => {
		const values = originalByBook.get(key);
		if (!values) return null;
		return values[index] ?? null;
	};

	for (const key of SportsbookKeys) {
		const corr = corrections[key];
		if (corr === undefined) continue;
		const adjustedByPlayer: Array<{ index: number; raw: number; adjusted: number }> = [];
		for (let i = 0; i < playerList.length; i++) {
			const playerBet = getOriginal(key, i);
			if (playerBet === null) continue;

			const correctedLogit = (logit(playerBet) - corr.intercept) / corr.slope;
			let fair = sigmoid(correctedLogit);

			let peerSum = 0;
			let peerCount = 0;
			for (const other of SportsbookKeys) {
				if (other === key) continue;
				const peer = getOriginal(other, i);
				if (peer === null) continue;
				peerSum += peer;
				peerCount++;
			}

			if (peerCount > 0) {
				const peerAvg = peerSum / peerCount;
				const consensusLogit = logit(peerAvg);
				const fairLogit = logit(fair);
				const distance = fairLogit - consensusLogit;
				const bounded = Math.min(maxConsensusLogitGap, Math.max(-maxConsensusLogitGap, distance));

				const boundedFair = sigmoid(consensusLogit + bounded);
				// Weak fits should stay close to consensus to avoid overreacting to one book.
				fair = (corr.strength * boundedFair) + ((1 - corr.strength) * peerAvg);
			}

			adjustedByPlayer.push({ index: i, raw: playerBet, adjusted: clampProb(fair) });
		}

		if (adjustedByPlayer.length === 0) continue;

		const rawSorted = adjustedByPlayer
			.slice()
			.sort((a, b) => (a.raw === b.raw ? a.index - b.index : a.raw - b.raw));
		const adjustedSorted = adjustedByPlayer
			.map((entry) => entry.adjusted)
			.sort((a, b) => a - b);

		// Keep each book's internal ranking identical to raw book order.
		let start = 0;
		while (start < rawSorted.length) {
			let end = start + 1;
			while (end < rawSorted.length && rawSorted[end].raw === rawSorted[start].raw) {
				end++;
			}

			let sum = 0;
			for (let i = start; i < end; i++) {
				sum += adjustedSorted[i];
			}
			const tieValue = sum / (end - start);
			for (let i = start; i < end; i++) {
				const entry = rawSorted[i];
				playerList[entry.index][key] = tieValue;
			}

			start = end;
		}
	}
}
