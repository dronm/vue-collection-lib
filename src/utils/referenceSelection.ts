export const REFERENCE_SELECTION_QUERY_PARAM = "__vclReferenceSelect";
export const REFERENCE_SELECTION_MESSAGE_TYPE = "vue-collection-lib:reference-selection";

export const referenceSelectionTokenFromQuery = (
	query: Readonly<Record<string, unknown>>,
): string | null => {
	const value = query[REFERENCE_SELECTION_QUERY_PARAM];

	return typeof value === "string" && value.trim() !== ""
		? value
		: null;
};

export const isReferenceSelectionQuery = (
	query: Readonly<Record<string, unknown>>,
): boolean => {
	return referenceSelectionTokenFromQuery(query) !== null;
};

const REFERENCE_SELECTION_CHANNEL_PREFIX = `${REFERENCE_SELECTION_MESSAGE_TYPE}:`;

export interface ReferenceSelectionMessage<TRow extends object = Record<string, unknown>> {
	type: typeof REFERENCE_SELECTION_MESSAGE_TYPE;
	token: string;
	row: TRow;
}

export const createReferenceSelectionToken = (): string => {
	if (
		typeof globalThis.crypto !== "undefined"
		&& typeof globalThis.crypto.randomUUID === "function"
	) {
		return globalThis.crypto.randomUUID();
	}

	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const referenceSelectionChannelName = (token: string): string => {
	return `${REFERENCE_SELECTION_CHANNEL_PREFIX}${token}`;
};

export const makeReferenceSelectionMessage = <TRow extends object>(
	token: string,
	row: TRow,
): ReferenceSelectionMessage<TRow> => {
	return {
		type: REFERENCE_SELECTION_MESSAGE_TYPE,
		token,
		row,
	};
};

export const isReferenceSelectionMessage = (
	value: unknown,
): value is ReferenceSelectionMessage => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Partial<ReferenceSelectionMessage>;

	return candidate.type === REFERENCE_SELECTION_MESSAGE_TYPE
		&& typeof candidate.token === "string"
		&& candidate.token.length > 0
		&& typeof candidate.row === "object"
		&& candidate.row !== null;
};
