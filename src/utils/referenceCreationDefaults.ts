import { referenceCreationTokenFromQuery } from "./referenceCreation";

const STORAGE_PREFIX = "vue-collection-lib:reference-creation-defaults:";
const UNSAFE_FIELDS = new Set(["__proto__", "constructor", "prototype"]);

export const referenceCreationDefaultsStorageKey = (token: string): string => {
	return `${STORAGE_PREFIX}${token}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const isJsonValue = (value: unknown, seen = new Set<object>()): boolean => {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return true;
	}
	if (typeof value === "number") {
		return Number.isFinite(value);
	}
	if (typeof value !== "object" || seen.has(value)) {
		return false;
	}
	if (!Array.isArray(value) && !isRecord(value)) {
		return false;
	}
	seen.add(value);
	const valid = Object.entries(value).every(([field, item]) => {
		return !UNSAFE_FIELDS.has(field) && isJsonValue(item, seen);
	});
	seen.delete(value);
	return valid;
};

/** Call before opening a same-origin creation tab; its session storage is cloned. */
export const prepareReferenceCreationDefaults = (
	token: string,
	values: Record<string, unknown>,
): void => {
	if (typeof token !== "string" || token.trim() === "") {
		throw new Error("Reference creation defaults require a valid creation token.");
	}
	if (!isRecord(values) || !isJsonValue(values)) {
		throw new Error("Reference creation defaults must contain plain JSON-compatible values.");
	}
	if (Object.keys(values).length === 0) {
		return;
	}

	try {
		if (typeof window === "undefined") {
			throw new Error("browser storage is unavailable");
		}
		window.sessionStorage.setItem(referenceCreationDefaultsStorageKey(token), JSON.stringify({
			token,
			values,
		}));
	} catch {
		throw new Error("Creation defaults could not be prepared because browser session storage is unavailable. Allow session storage and try again.");
	}
};

/** Cleanup affects only the current tab's storage, not a creation tab's clone. */
export const clearReferenceCreationDefaults = (token: string): void => {
	if (typeof token !== "string" || token.trim() === "" || typeof window === "undefined") {
		return;
	}
	try {
		window.sessionStorage.removeItem(referenceCreationDefaultsStorageKey(token));
	} catch {
		// Cleanup must not prevent result delivery or popup-blocked recovery.
	}
};

/** Reading is non-consuming so shell hooks cannot drain a creation form's defaults. */
export const readReferenceCreationDefaults = (
	query: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined => {
	const token = referenceCreationTokenFromQuery(query);
	if (token === null || typeof window === "undefined") {
		return undefined;
	}
	try {
		const serialized = window.sessionStorage.getItem(referenceCreationDefaultsStorageKey(token));
		if (serialized === null) {
			return undefined;
		}
		const entry: unknown = JSON.parse(serialized);
		if (
			!isRecord(entry)
			|| entry.token !== token
			|| !isRecord(entry.values)
			|| !isJsonValue(entry.values)
		) {
			clearReferenceCreationDefaults(token);
			return undefined;
		}
		return entry.values;
	} catch {
		clearReferenceCreationDefaults(token);
		return undefined;
	}
};

export const consumeReferenceCreationDefaults = (
	query: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined => {
	const values = readReferenceCreationDefaults(query);
	const token = referenceCreationTokenFromQuery(query);
	if (values !== undefined && token !== null) {
		try {
			window.sessionStorage.removeItem(referenceCreationDefaultsStorageKey(token));
		} catch {
			throw new Error("Creation defaults could not be consumed because browser session storage is unavailable.");
		}
	}
	return values;
};
