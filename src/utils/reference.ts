import type {
	ReferenceAutocompleteConfig,
	ReferenceKeys,
	ReferenceListResult,
	ReferenceRow,
	ReferenceValue,
} from "../types/reference";

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const isReferenceValue = <TKeys extends ReferenceKeys = ReferenceKeys>(
	value: unknown,
): value is ReferenceValue<TKeys> => {
	return isRecord(value)
		&& "keys" in value
		&& "descr" in value
		&& typeof value.descr === "string";
};

export const normalizeReferenceRows = <TRow extends ReferenceRow>(
	value: ReferenceListResult<TRow>,
): TRow[] => {
	if (!value) {
		return [];
	}

	if (Array.isArray(value)) {
		return value;
	}


	if (isRecord(value) && "rows" in value && Array.isArray(value.rows)) {
		return value.rows as TRow[];
	}

	return [];
};

const readRowField = <TRow extends ReferenceRow>(
	row: TRow,
	field: keyof TRow & string,
): unknown => {
	return (row as Record<string, unknown>)[field];
};

export const referenceRowDescr = <TRow extends ReferenceRow>(
	row: TRow,
	config: ReferenceAutocompleteConfig<TRow>,
): string => {
	if (config.format) {
		return config.format(row);
	}

	const fields = config.descrFields ?? (Object.keys(row) as (keyof TRow & string)[]);
	const values = fields
		.map((field) => readRowField(row, field))
		.filter((value) => value !== null && value !== undefined)
		.map((value) => String(value));

	return values.join(config.descrFieldConcat ?? " ");
};

export const referenceFromRow = <
	TRow extends ReferenceRow,
	TKeys extends ReferenceKeys = ReferenceKeys,
>(
	row: TRow,
	config: ReferenceAutocompleteConfig<TRow, TKeys>,
): ReferenceValue<TKeys> => {
	const keys = {} as Record<string, unknown>;

	config.keyFields.forEach((field) => {
		keys[field] = readRowField(row, field) ?? null;
	});

	const result: ReferenceValue<TKeys> = {
		keys: keys as TKeys,
		descr: referenceRowDescr(row, config),
	};

	if (config.dataType) {
		result.dataType = config.dataType;
	}

	config.dataFields?.forEach((field) => {
		const value = readRowField(row, field);
		if (value !== undefined) {
			result[field] = value;
		}
	});

	return result;
};

export const referenceKeysOnly = <TKeys extends ReferenceKeys>(
	value: ReferenceValue<TKeys> | null | undefined,
): TKeys | null => {
	return value?.keys ?? null;
};

export const referenceSingleKey = <TKeys extends ReferenceKeys>(
	value: ReferenceValue<TKeys> | null | undefined,
	keyField: keyof TKeys & string,
): TKeys[keyof TKeys] | null => {
	return value?.keys?.[keyField] ?? null;
};
