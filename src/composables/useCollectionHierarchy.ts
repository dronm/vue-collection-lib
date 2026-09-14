import {
	computed,
	ref,
	watch,
	type Ref,
} from "vue";

import {
	FilterOperatorParam,
	SortDirect,
	type CollectionParams,
} from "../types/collection";
import type {
	CollectionHierarchyBreadcrumb,
	CollectionHierarchyConfig,
	CollectionHierarchyViewMode,
} from "../types/collectionHierarchy";
import type { GridCreateContext, GridRowClass } from "../components/crudGrid/types";

interface UseCollectionHierarchyOptions<TModel extends object> {
	config: Ref<CollectionHierarchyConfig<TModel> | undefined>;
	dataKey: Ref<string>;
	stateKey?: Ref<string | undefined>;
}

interface SavedHierarchyState {
	version: 1;
	viewMode: CollectionHierarchyViewMode;
	path: CollectionHierarchyBreadcrumb[];
}

const hierarchyStateKey = (stateKey: string | undefined): string | null => {
	return stateKey ? `${stateKey}:hierarchy` : null;
};

const readState = (stateKey: string | undefined): SavedHierarchyState | null => {
	if (typeof sessionStorage === "undefined") {
		return null;
	}

	const key = hierarchyStateKey(stateKey);
	if (key === null) {
		return null;
	}

	const raw = sessionStorage.getItem(key);
	if (!raw) {
		return null;
	}

	try {
		const value = JSON.parse(raw) as Partial<SavedHierarchyState>;
		if (
			value.version !== 1
			|| (value.viewMode !== "hierarchy" && value.viewMode !== "flat")
			|| !Array.isArray(value.path)
		) {
			return null;
		}

		return value as SavedHierarchyState;
	} catch {
		return null;
	}
};

const writeState = (
	stateKey: string | undefined,
	state: Omit<SavedHierarchyState, "version">,
): void => {
	if (typeof sessionStorage === "undefined") {
		return;
	}

	const key = hierarchyStateKey(stateKey);
	if (key === null) {
		return;
	}

	sessionStorage.setItem(key, JSON.stringify({
		version: 1,
		...state,
	} satisfies SavedHierarchyState));
};

const resolveClass = <TModel extends object>(
	value: GridRowClass | ((row: TModel) => GridRowClass) | undefined,
	row: TModel,
): GridRowClass => {
	return typeof value === "function" ? value(row) : value;
};

export const useCollectionHierarchy = <TModel extends object>(
	options: UseCollectionHierarchyOptions<TModel>,
) => {
	const savedState = readState(options.stateKey?.value);
	const path = ref<CollectionHierarchyBreadcrumb[]>(savedState?.path ?? []);
	const initialViewMode = savedState?.viewMode
		?? options.config.value?.defaultViewMode
		?? "hierarchy";
	const viewMode = ref<CollectionHierarchyViewMode>(
		initialViewMode === "flat" && !(options.config.value?.allowFlatView ?? true)
			? "hierarchy"
			: initialViewMode,
	);

	const enabled = computed(() => options.config.value !== undefined);
	const parentField = computed(() => String(options.config.value?.parentField ?? "parent_id"));
	const groupField = computed(() => String(options.config.value?.groupField ?? "is_group"));
	const idField = computed(() => String(options.config.value?.idField ?? options.dataKey.value));
	const labelField = computed(() => String(options.config.value?.labelField ?? "name"));
	const allowFlatView = computed(() => options.config.value?.allowFlatView ?? true);
	const groupsFirst = computed(() => options.config.value?.groupsFirst ?? true);
	const currentGroupId = computed(() => {
		return path.value[path.value.length - 1]?.id ?? null;
	});

	const saveState = (): void => {
		if (!enabled.value) {
			return;
		}

		writeState(options.stateKey?.value, {
			viewMode: viewMode.value,
			path: path.value.map((item) => ({ ...item })),
		});
	};

	const isGroup = (row: TModel): boolean => {
		const custom = options.config.value?.isGroup;
		if (custom) {
			return custom(row);
		}

		return Boolean((row as Record<string, unknown>)[groupField.value]);
	};

	const getId = (row: TModel): unknown => {
		const custom = options.config.value?.getId;
		if (custom) {
			return custom(row);
		}

		return (row as Record<string, unknown>)[idField.value];
	};

	const getLabel = (row: TModel): string => {
		const custom = options.config.value?.getLabel;
		if (custom) {
			return custom(row);
		}

		const value = (row as Record<string, unknown>)[labelField.value];
		return value === null || value === undefined ? "" : String(value);
	};

	const baseParams = computed<CollectionParams | undefined>(() => {
		if (!enabled.value) {
			return undefined;
		}

		const sorter = groupsFirst.value
			? [{ f: groupField.value, d: SortDirect.DESC }]
			: undefined;

		if (viewMode.value === "flat") {
			return { sorter };
		}

		const parentId = currentGroupId.value;
		return {
			filter: [{
				f: {
					[parentField.value]: parentId === null
						? { o: FilterOperatorParam.I, v: null }
						: { o: FilterOperatorParam.E, v: parentId },
				},
			}],
			sorter,
		};
	});

	const enterGroup = (row: TModel): boolean => {
		if (!enabled.value || viewMode.value !== "hierarchy" || !isGroup(row)) {
			return false;
		}

		path.value = [
			...path.value,
			{
				id: getId(row),
				label: getLabel(row),
			},
		];
		saveState();
		return true;
	};

	const goToBreadcrumb = (displayIndex: number): void => {
		if (!enabled.value || displayIndex < 0) {
			return;
		}

		path.value = displayIndex === 0
			? []
			: path.value.slice(0, displayIndex);
		saveState();
	};

	const setViewMode = (mode: CollectionHierarchyViewMode): void => {
		if (!enabled.value) {
			return;
		}

		viewMode.value = mode === "flat" && !allowFlatView.value
			? "hierarchy"
			: mode;
		saveState();
	};

	const toggleViewMode = (): void => {
		setViewMode(viewMode.value === "hierarchy" ? "flat" : "hierarchy");
	};

	const isSelectable = (row: TModel): boolean => {
		const selectable = options.config.value?.selectable ?? "items";
		if (typeof selectable === "function") {
			return selectable(row);
		}

		if (selectable === "all") {
			return true;
		}

		return selectable === "groups" ? isGroup(row) : !isGroup(row);
	};

	const iconForRow = (row: TModel): string => {
		const config = options.config.value;
		if (!isGroup(row)) {
			return config?.itemIcon ?? "pi pi-file";
		}

		if (viewMode.value === "flat") {
			return config?.flatGroupIcon ?? config?.groupIcon ?? "pi pi-folder";
		}

		return config?.groupIcon ?? "pi pi-folder";
	};

	const openGroupIcon = computed(() => {
		return options.config.value?.openGroupIcon ?? "pi pi-folder-open";
	});

	const rowClass = (row: TModel): GridRowClass => {
		const config = options.config.value;
		return isGroup(row)
			? resolveClass(config?.groupRowClass, row)
			: resolveClass(config?.itemRowClass, row);
	};

	const createContext = (kind: "item" | "group"): GridCreateContext => {
		const parentId = viewMode.value === "hierarchy"
			? currentGroupId.value
			: null;

		return {
			kind,
			initialValues: {
				[parentField.value]: parentId,
				[groupField.value]: kind === "group",
			},
		};
	};

	watch(
		() => options.config.value,
		(config) => {
			if (!config) {
				path.value = [];
				viewMode.value = "hierarchy";
				return;
			}

			if (viewMode.value === "flat" && !(config.allowFlatView ?? true)) {
				viewMode.value = "hierarchy";
			}
		},
	);

	watch(
		() => options.stateKey?.value,
		(newKey, oldKey) => {
			if (newKey === oldKey) {
				return;
			}

			const restored = readState(newKey);
			path.value = restored?.path ?? [];
			const restoredMode = restored?.viewMode
				?? options.config.value?.defaultViewMode
				?? "hierarchy";
			viewMode.value = restoredMode === "flat" && !(options.config.value?.allowFlatView ?? true)
				? "hierarchy"
				: restoredMode;
		},
	);

	return {
		enabled,
		viewMode,
		path,
		currentGroupId,
		allowFlatView,
		baseParams,
		isGroup,
		isSelectable,
		getId,
		getLabel,
		iconForRow,
		openGroupIcon,
		rowClass,
		enterGroup,
		goToBreadcrumb,
		setViewMode,
		toggleViewMode,
		createContext,
	};
};
