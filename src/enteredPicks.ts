import { isTeam, type Team } from './components/logo';
import { isRecord } from './dataProcessor';
import { addDays, isDay } from './utility';

/*
	The picks the user marks as the ones entered in the contest's own app, one per list and day, by the
	schedule's ET date: the one thing the page keeps between loads. Only the loaded day's and the day before's
	are kept, the two days the my-picks table shows. Each holds what that table shows of it, so the table needs
	nothing from the day's lists. They live in this browser's local storage, which can refuse access, fill up or
	hold anything at all, so what is read back is checked like a feed, and a failure leaves the store in memory
	for the page's life. Every change reads the store afresh first, so one tab doesn't undo another's.
*/

export type PickTable = 1 | 2 | 3;
export const PickTables: readonly PickTable[] = [1, 2, 3];

export interface EnteredPick {
	playerId: number;
	name: string;
	team: Team;
	// The team's logos as the pick's table showed them, since a game can carry an alternate one
	logoLight: string | null;
	logoDark: string | null;
}

// A day's picks by list, none for a list left unmarked
export type EnteredDay = Readonly<Partial<Record<PickTable, EnteredPick>>>;

export interface EnteredStore {
	// Only days with a pick
	days: Readonly<Record<string, EnteredDay>>;
}

const KEY = 'timspicks.entered';
const EMPTY: EnteredStore = { days: {} };

const logoOf = (value: unknown): string | null => {
	return typeof value === 'string' && value.length <= 300 && value.startsWith('https://') ? value : null;
};

const pickOf = (value: unknown): EnteredPick | null => {
	if (!isRecord(value)) return null;
	const { playerId, name, team } = value;
	if (typeof playerId !== 'number' || !Number.isSafeInteger(playerId)) return null;
	if (typeof name !== 'string' || name.length === 0 || name.length > 80 || !isTeam(team)) return null;
	return { playerId, name, team, logoLight: logoOf(value.logoLight), logoDark: logoOf(value.logoDark) };
};

// What a stored value holds that passes the checks, a day and a pick at a time
const storeOf = (raw: string): EnteredStore => {
	let value: unknown;
	try { value = JSON.parse(raw); }
	catch { return EMPTY; }
	if (!isRecord(value) || !isRecord(value.days) || Array.isArray(value.days)) return EMPTY;

	const days: Record<string, EnteredDay> = {};
	for (const [date, entry] of Object.entries(value.days)) {
		if (!isDay(date) || !isRecord(entry)) continue;
		const day: Partial<Record<PickTable, EnteredPick>> = {};
		for (const table of PickTables) {
			const pick = pickOf(entry[table]);
			if (pick) day[table] = pick;
		}
		if (Object.keys(day).length > 0) days[date] = day;
	}
	return { days };
};

// The store as last read or written, which is all there is once storage has failed
let memory: EnteredStore = EMPTY;
// The stored text memory came from, so an unchanged one gives back the same store
let memoryRaw: string | null = null;
let usable = true;

const read = (): EnteredStore => {
	if (!usable) return memory;
	try {
		const raw = window.localStorage.getItem(KEY);
		if (raw !== memoryRaw) {
			memory = raw === null ? EMPTY : storeOf(raw);
			memoryRaw = raw;
		}
	} catch {
		usable = false;
	}
	return memory;
};

const write = (store: EnteredStore): EnteredStore => {
	memory = store;
	if (!usable) return store;
	try {
		const raw = Object.keys(store.days).length === 0 ? null : JSON.stringify(store);
		if (raw === null) window.localStorage.removeItem(KEY);
		else window.localStorage.setItem(KEY, raw);
		memoryRaw = raw;
	} catch {
		usable = false;
	}
	return store;
};

export const load = (): EnteredStore => read();

// Marks a list's pick for a day, or clears it when he is the one already marked
export const toggle = (date: string, table: PickTable, pick: EnteredPick): EnteredStore => {
	const store = read();
	const day: Partial<Record<PickTable, EnteredPick>> = { ...store.days[date] };
	if (day[table]?.playerId === pick.playerId) delete day[table];
	else day[table] = pick;

	const days: Record<string, EnteredDay> = { ...store.days };
	if (Object.keys(day).length > 0) days[date] = day;
	else delete days[date];
	return write({ ...store, days });
};

// Drops every day earlier than the one before the loaded day, once the page knows which day it loaded. Marks only
// ever go to those two days, so nothing older builds up while the page is open
export const prune = (today: string): EnteredStore => {
	const store = read();
	const from = addDays(today, -1);
	const dates = Object.keys(store.days);
	if (dates.every((date) => date >= from)) return store;
	return write({ ...store, days: Object.fromEntries(dates.filter((date) => date >= from).map((date) => [date, store.days[date]])) });
};
