import type { GenericSchema } from "valibot";

import type { CollectionParams, CollectionSorter } from "./collection";
import type { InfiniteScrollOptions } from "./infiniteCollection";
import type {
	CollectionGridApi,
	GridColumn,
	GridCommand,
	GridCreateContext,
	GridEditMode,
	GridHierarchyConfig,
	GridRouteConfig,
} from "../components/crudGrid/types";

export interface CollectionDefinition<
	TModel extends object,
	TKey,
	TNew = unknown,
	TUpd extends object = Record<string, unknown>,
	TDetailModel = TModel,
> {
	titleKey: string;
	api: CollectionGridApi<TModel, TKey, TNew, TUpd, TDetailModel>;
	columns: GridColumn<TModel>[];
	dataKey: string;
	getKey: (row: TModel) => TKey;
	routes?: GridRouteConfig<TModel>;
	commands?: GridCommand<TModel, TKey>[];
	editMode?: GridEditMode;
	createRow?: (context?: GridCreateContext) => TModel;
	createModel?: (row: TModel) => TNew;
	/** Validation shared by metadata-driven creation forms. */
	createSchema?: GenericSchema<TNew>;
	validateCreate?: (model: TNew, row: TModel) => TNew | void | Promise<TNew | void>;
	/** Loads the authoritative saved detail when api.detail is unavailable or needs adaptation. */
	loadCreated?: (key: TKey) => Promise<TDetailModel>;
	baseParams?: CollectionParams;
	defaultSorter?: CollectionSorter[];
	hierarchy?: GridHierarchyConfig<TModel>;
	stateKey?: string;
	pageSize?: number;
	/** Opt in to buffered cursor scrolling. Omit to retain ordinary pagination. */
	infiniteScroll?: InfiniteScrollOptions<TModel>;
	showCommandShortcuts?: boolean;
}

export const defineCollection = <
	TModel extends object,
	TKey,
	TNew = unknown,
	TUpd extends object = Record<string, unknown>,
	TDetailModel = TModel,
>(
	definition: CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel>,
): CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel> => definition;
