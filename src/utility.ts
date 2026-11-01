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
