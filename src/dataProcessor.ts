import * as Picks from './components/Table';

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

export interface InitialData {
	playerData: Picks.OddsItem[][];
	gamesListing: any[];
	playerOddsDraftKings: any[];
	playerOddsFanDuel: any[];
	playerOddsBetMGM: any[];
	playerOddsBetRivers: any[];
}

export const loadInitialData = async (): Promise<InitialData> => {
	const [playerData, gamesListing, playerOddsDraftKings, playerOddsFanDuel, playerOddsBetMGM, playerOddsBetRivers] = await Promise.all([
		loadData('./data/helper.json'),
		loadData('./data/games.json'),
		loadData('./data/bet1.json'),
		loadData('./data/bet2.json'),
		loadData('./data/bet3.json'),
		loadData('./data/bet4.json'),
	]);

	return {
		playerData,
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

export const buildGamesList = (gamesListing: any[]): Picks.GameData[] => {
	const gamesList: Picks.GameData[] = [];
	for (const data of gamesListing) {
		const game = new Picks.GameData(data);
		gamesList.push(game);
	}
	gamesList.sort((a: Picks.GameData, b: Picks.GameData): number => {
		const time = a.time.getTime() - b.time.getTime();
		if (time !== 0) return time;
		return a.away.name.localeCompare(b.away.name);
	});
	return gamesList;
};

export const buildPlayerList = (gamesListing: any[]): Picks.Player[] => {
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
	}
	return playerList;
};

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
	playerData: any[],
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
				row.push(new Picks.PickOdds(player, item));
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
	playerOddsDraftKings: any[],
	playerOddsFanDuel: any[],
	playerOddsBetMGM: any[],
	playerOddsBetRivers: any[]
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

	// De-vig: correct each sportsbook's bias AND compression toward the
	// peer average (leave-one-out mean).
	{
		const minProb = 0.0001;
		const maxProb = 0.9999;
		const minBookPlayers = 10;
		const betKeys = ["bet1", "bet2", "bet3", "bet4"] as const;

		const corrections: Partial<Record<typeof betKeys[number], { c: number; alpha: number }>> = {};
		for (const key of betKeys) {
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

			if (alpha <= 0.5 || alpha > 2) continue;

			corrections[key] = { c, alpha };
			// console.log(`De-vig [${key}]: c=${c.toFixed(4)}, α=${alpha.toFixed(4)} (${n} players)`);
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
};
