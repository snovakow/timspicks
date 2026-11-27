export const roundToPercent = (num: number, places: number): string => {
	return (num * 100).toFixed(places) + "%";
};

export const probabilityToAmerican = (chance: number | null): string => {
	if (chance === null || chance <= 0) return "-";
	const decimal = 1 / chance;
	const american = decimal >= 2
		? Math.round(100 * (decimal - 1))
		: Math.round(100 / (1 - decimal));
	return (american > 0 ? "+" : "") + american;
};

type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][];
export const getEntries = <T extends object>(obj: T) => Object.entries(obj) as Entries<T>;

// How the page shows a start time
export const timeFormat: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

// Every start time cell's text
export const startTime = new Intl.DateTimeFormat([], timeFormat);

const DAY_MS = 24 * 60 * 60 * 1000;

// A Y-m-d day's midnight in UTC, which a day's arithmetic and labels go through so the viewer's zone can't move it
export const dayTime = (date: string): number => Date.parse(`${date}T00:00:00Z`);

// A Y-m-d day moved by whole days
export const addDays = (date: string, days: number): string => new Date(dayTime(date) + days * DAY_MS).toISOString().slice(0, 10);

// True for a real Y-m-d day
export const isDay = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = dayTime(value);
	return !isNaN(time) && new Date(time).toISOString().startsWith(value);
};

// A day as the page names it in full
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const fullDay = (date: string): string => dayLabel.format(dayTime(date));
