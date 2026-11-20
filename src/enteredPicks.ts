import { isTeam, type Team } from './components/logo';
import { isRecord } from './dataProcessor';

/*
	The picks the user marks as the ones entered in the contest's own app, one per list and day, by the
	schedule's ET date: the one thing the page keeps between loads. Each holds what the my-picks table shows of
	it once that day's lists are gone. They live in this browser's local storage, which can refuse access, fill
	up or hold anything at all, so what is read back is checked like a feed, and a failure leaves the store in
	memory for the page's life. Every change reads the store afresh first, so one tab doesn't undo another's.
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
// The latest day, which the my-picks table shows, and the one before it, which it shows again once the
// latest day's picks are all cleared
const KEEP_DAYS = 2;
const EMPTY: EnteredStore = { days: {} };

const isDay = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return !isNaN(time) && new Date(time).toISOString().startsWith(value);
};

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

// The latest days, which are the only ones a table can still show
const latest = (store: EnteredStore): EnteredStore => {
	const dates = Object.keys(store.days).sort().reverse();
	if (dates.length <= KEEP_DAYS) return store;
	return { ...store, days: Object.fromEntries(dates.slice(0, KEEP_DAYS).map((date) => [date, store.days[date]])) };
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
	return latest({ days });
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
	return write(latest({ ...store, days }));
};

// The latest day with picks up to the one given, or of them all when the page has no day of its own
export const latestDay = (store: EnteredStore, date: string | null): string | null => {
	const dates = Object.keys(store.days).filter((day) => date === null || day <= date).sort();
	return dates.length > 0 ? dates[dates.length - 1] : null;
};
