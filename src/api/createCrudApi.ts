import type {
	CollectionAlterResult,
	CollectionAgg,
	CollectionDTO,
	CollectionParams,
	CollectionResponse,
} from "../types/collection";
import type { ExportFormats } from "../types/exportFormats";
import { validationErrorDetails } from "../utils/validation";

export interface CrudHttpClient {
	get: <T = unknown>(endpoint: string, params?: Record<string, string>) => Promise<T>;
	post: <T = unknown>(endpoint: string, body?: unknown) => Promise<T>;
	patch: <T = unknown>(endpoint: string, body?: unknown) => Promise<T>;
	delete: <T = unknown>(endpoint: string) => Promise<T>;
}

type KeyValue = string | number;

const encodePathSegment = (value: KeyValue): string => {
	return encodeURIComponent(String(value));
};

export interface CreateCrudApiOptions<
	TListModel,
	TListDTO,
	TDetailModel,
	TDetailDTO,
	TKey,
	TNew,
	TUpd,
> {
	api: CrudHttpClient;
	basePath: string;
	serviceName?: string;
	getKeyValue?: (key: TKey) => KeyValue;
	getKeyPath?: (key: TKey) => readonly KeyValue[];
	fromListDTO: (dto: TListDTO) => TListModel;
	fromDetailDTO: (dto: TDetailDTO) => TDetailModel;
	beforeCreate?: (model: TNew) => TNew;
	beforeUpdate?: (model: TUpd) => TUpd;
}

export const buildCollectionQuery = (
	params?: CollectionParams,
	format?: ExportFormats,
): Record<string, string> => {
	return {
		...(params ? { params: JSON.stringify(params) } : {}),
		...(format ? { format } : {}),
	};
};

const resolveKeyPath = <TKey>(
	options: Pick<CreateCrudApiOptions<unknown, unknown, unknown, unknown, TKey, unknown, unknown>, "getKeyValue" | "getKeyPath">,
	key: TKey,
): readonly KeyValue[] => {
	if (options.getKeyPath) {
		const path = options.getKeyPath(key);
		if (path.length === 0) {
			throw new Error("CRUD key path must contain at least one segment");
		}

		return path;
	}

	if (options.getKeyValue) {
		return [options.getKeyValue(key)];
	}

	throw new Error("createCrudApi requires getKeyValue or getKeyPath");
};

const joinPath = (
	basePath: string,
	keyPath: readonly KeyValue[],
): string => {
	return `${basePath}/${keyPath.map(encodePathSegment).join("/")}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const safeJson = (value: unknown): string => {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const errorMessage = (err: unknown): string => {
	const validationDetails = validationErrorDetails(err);
	if (validationDetails) {
		return validationDetails;
	}

	if (err instanceof Error && err.message) {
		return err.message;
	}

	return safeJson(err);
};

const rowIdentity = (row: unknown): string => {
	if (!isRecord(row)) {
		return "";
	}

	for (const field of ["id", "uuid", "code"]) {
		const value = row[field];
		if (typeof value === "string" || typeof value === "number") {
			return ` (${field}: ${String(value)})`;
		}
	}

	return "";
};

export class CollectionRowValidationError extends Error {
	readonly rowIndex: number;
	readonly row: unknown;
	readonly cause: unknown;

	constructor(rowIndex: number, row: unknown, cause: unknown) {
		const rowPath = `rows[${rowIndex}]`;
		const details = validationErrorDetails(cause, rowPath)
			?? `${rowPath}: ${errorMessage(cause)}`;

		super(`Invalid collection row ${rowIndex + 1}${rowIdentity(row)}: ${details}`);
		this.name = "CollectionRowValidationError";
		this.rowIndex = rowIndex;
		this.row = row;
		this.cause = cause;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

const numberFromUnknown = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
};

const normalizeAgg = (
	aggValue: unknown,
	rootValue: unknown,
	rowsLength: number,
): CollectionAgg => {
	if (isRecord(aggValue)) {
		const total = numberFromUnknown(aggValue.tot_count)
			?? numberFromUnknown(aggValue.total)
			?? numberFromUnknown(aggValue.count)
			?? rowsLength;

		return {
			...aggValue,
			tot_count: total,
		};
	}

	if (isRecord(rootValue)) {
		const total = numberFromUnknown(rootValue.tot_count)
			?? numberFromUnknown(rootValue.total)
			?? numberFromUnknown(rootValue.count)
			?? rowsLength;

		return {
			tot_count: total,
		};
	}

	return {
		tot_count: rowsLength,
	};
};

export const normalizeCollectionResponse = <TDTO>(
	value: unknown,
): CollectionDTO<TDTO> => {
	if (!isRecord(value)) {
		throw new Error(
			`Invalid collection response: expected object with rows array, got ${safeJson(value)}`,
		);
	}

	if (Array.isArray(value.rows)) {
		return {
			rows: value.rows as TDTO[],
			agg: normalizeAgg(value.agg, value, value.rows.length),
		};
	}

	const responseText = safeJson(value);
	throw new Error(
		`Invalid collection response: expected rows array. Response keys: ${Object.keys(value).join(", ")}. Body: ${responseText.slice(0, 500)}`,
	);
};

export const createCrudApi = <
	TListModel,
	TListDTO,
	TDetailModel,
	TDetailDTO,
	TKey,
	TNew,
	TUpd,
>(
	options: CreateCrudApiOptions<
		TListModel,
		TListDTO,
		TDetailModel,
		TDetailDTO,
		TKey,
		TNew,
		TUpd
	>,
) => {
	async function list(
		params?: CollectionParams,
	): Promise<CollectionResponse<TListModel>>;
	async function list(
		params: CollectionParams | undefined,
		format: ExportFormats,
	): Promise<void>;
	async function list(
		params?: CollectionParams,
		format?: ExportFormats,
	): Promise<CollectionResponse<TListModel> | void> {
		const response = await options.api.get<unknown>(
			options.basePath,
			buildCollectionQuery(params, format),
		);

		if (format) {
			return;
		}

		const collection = normalizeCollectionResponse<TListDTO>(response);

		return {
			rows: collection.rows.map((row, rowIndex) => {
				try {
					return options.fromListDTO(row);
				} catch (err: unknown) {
					throw new CollectionRowValidationError(rowIndex, row, err);
				}
			}),
			agg: collection.agg,
		};
	}

	const detail = async (
		key: TKey,
	): Promise<TDetailModel> => {
		const response = await options.api.get<TDetailDTO>(
			joinPath(options.basePath, resolveKeyPath(options, key)),
		);

		return options.fromDetailDTO(response);
	};

	const create = async (
		model: TNew,
	): Promise<TKey> => {
		const body = options.beforeCreate
			? options.beforeCreate(model)
			: model;

		return await options.api.post<TKey>(
			options.basePath,
			body,
		);
	};

	const update = async (
		key: TKey,
		model: TUpd,
	): Promise<CollectionAlterResult> => {
		const body = options.beforeUpdate
			? options.beforeUpdate(model)
			: model;

		return await options.api.patch<CollectionAlterResult>(
			joinPath(options.basePath, resolveKeyPath(options, key)),
			body,
		);
	};

	const remove = async (
		key: TKey,
	): Promise<CollectionAlterResult> => {
		return await options.api.delete<CollectionAlterResult>(
			joinPath(options.basePath, resolveKeyPath(options, key)),
		);
	};

	return {
		serviceName: options.serviceName,
		list,
		detail,
		create,
		update,
		delete: remove,
	};
};
