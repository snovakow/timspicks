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
	// The my-picks table last closed, by tableKey, which stays closed until it's shown again
	closed: string | null;
}

const KEY = 'timspicks.entered';
// The loaded day and the earlier one the my-picks table can show
const KEEP_DAYS = 2;
const EMPTY: EnteredStore = { days: {}, closed: null };

// The name of a my-picks table: its day, and whether it shows as the loaded day or an earlier one, since one
// day's picks get a table of each kind
export const tableKey = (date: string, today: boolean): string => `${date}/${today ? 'today' : 'earlier'}`;

const isDay = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return !isNaN(time) && new Date(time).toISOString().startsWith(value);
};

const isTableKey = (value: unknown): value is string => {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}\/(today|earlier)$/.test(value) && isDay(value.slice(0, 10));
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
	return latest({ days, closed: isTableKey(value.closed) ? value.closed : null });
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
		const raw = Object.keys(store.days).length === 0 && store.closed === null ? null : JSON.stringify(store);
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

// Closes the my-picks table tableKey names, or with null shows whichever is due
export const setClosed = (closed: string | null): EnteredStore => {
	const store = read();
	return store.closed === closed ? store : write({ ...store, closed });
};

// Drops the days before the one given, which no table shows again
export const prune = (date: string): EnteredStore => {
	const store = read();
	const dates = Object.keys(store.days);
	const kept = dates.filter((day) => day >= date);
	const closed = store.closed !== null && store.closed.slice(0, 10) < date ? null : store.closed;
	if (kept.length === dates.length && closed === store.closed) return store;
	return write({ days: Object.fromEntries(kept.map((day) => [day, store.days[day]])), closed });
};

// The latest day with picks before the one given, or before none when the page has no day of its own
export const earlierDay = (store: EnteredStore, date: string | null): string | null => {
	const dates = Object.keys(store.days).filter((day) => date === null || day < date).sort();
	return dates.length > 0 ? dates[dates.length - 1] : null;
};
