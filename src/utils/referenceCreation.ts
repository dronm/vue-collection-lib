import { createReferenceSelectionToken } from "./referenceSelection";

export const REFERENCE_CREATION_QUERY_PARAM = "__vclReferenceCreate";
export const REFERENCE_CREATION_MESSAGE_TYPE = "vue-collection-lib:reference-creation";

export interface ReferenceCreationMessage<
	TKey = unknown,
	TRow extends object = Record<string, unknown>,
> {
	type: typeof REFERENCE_CREATION_MESSAGE_TYPE;
	token: string;
	key: TKey;
	row: TRow;
}

export interface CompleteReferenceCreationOptions {
	query?: Readonly<Record<string, unknown>>;
	closeWindow?: boolean;
}

export const referenceCreationTokenFromQuery = (
	query: Readonly<Record<string, unknown>>,
): string | null => {
	const value = query[REFERENCE_CREATION_QUERY_PARAM];

	return typeof value === "string" && value.trim() !== ""
		? value
		: null;
};

export const isReferenceCreationQuery = (
	query: Readonly<Record<string, unknown>>,
): boolean => {
	return referenceCreationTokenFromQuery(query) !== null;
};

export const createReferenceCreationToken = (): string => {
	return createReferenceSelectionToken();
};

export const referenceCreationChannelName = (token: string): string => {
	return `${REFERENCE_CREATION_MESSAGE_TYPE}:${token}`;
};

export const makeReferenceCreationMessage = <TKey, TRow extends object>(
	token: string,
	key: TKey,
	row: TRow,
): ReferenceCreationMessage<TKey, TRow> => {
	return {
		type: REFERENCE_CREATION_MESSAGE_TYPE,
		token,
		key,
		row,
	};
};

export const isReferenceCreationMessage = (
	value: unknown,
): value is ReferenceCreationMessage => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const candidate = value as Partial<ReferenceCreationMessage>;

	return candidate.type === REFERENCE_CREATION_MESSAGE_TYPE
		&& typeof candidate.token === "string"
		&& candidate.token.trim() !== ""
		&& candidate.key !== undefined
		&& candidate.key !== null
		&& typeof candidate.row === "object"
		&& candidate.row !== null
		&& !Array.isArray(candidate.row);
};

const browserQuery = (): Readonly<Record<string, unknown>> => {
	if (typeof window === "undefined") {
		return {};
	}

	const query = new URLSearchParams(window.location.search);
	const tokens = query.getAll(REFERENCE_CREATION_QUERY_PARAM);

	return {
		[REFERENCE_CREATION_QUERY_PARAM]: tokens.length === 1 ? tokens[0] : null,
	};
};

/** Returns false outside a reference-creation context; throws if delivery fails. */
export const completeReferenceCreation = <TKey, TRow extends object>(
	key: TKey,
	row: TRow,
	options: CompleteReferenceCreationOptions = {},
): boolean => {
	const token = referenceCreationTokenFromQuery(options.query ?? browserQuery());
	if (token === null) {
		return false;
	}

	const message = makeReferenceCreationMessage(token, key, row);
	if (!isReferenceCreationMessage(message)) {
		throw new Error("Reference creation requires a saved key and detail object.");
	}

	if (typeof window === "undefined") {
		throw new Error("Reference creation cannot return a result outside the browser.");
	}

	let delivered = false;
	if (typeof BroadcastChannel !== "undefined") {
		let channel: BroadcastChannel | null = null;
		try {
			channel = new BroadcastChannel(referenceCreationChannelName(token));
			channel.postMessage(message);
			delivered = true;
		} catch {
			// The opener transport can still work when channels are unavailable.
		} finally {
			channel?.close();
		}
	}

	try {
		if (window.opener !== null && !window.opener.closed) {
			window.opener.postMessage(message, window.location.origin);
			delivered = true;
		}
	} catch {
		// A blocked opener must not invalidate a successful channel delivery.
	}

	if (!delivered) {
		throw new Error("The created record could not be returned to the reference field. Keep this page open and retry.");
	}

	if (options.closeWindow !== false) {
		setTimeout(() => window.close(), 0);
	}

	return true;
};

export const cancelReferenceCreation = (
	query?: Readonly<Record<string, unknown>>,
): boolean => {
	if (
		!isReferenceCreationQuery(query ?? browserQuery())
		|| typeof window === "undefined"
	) {
		return false;
	}

	window.close();
	return true;
};
