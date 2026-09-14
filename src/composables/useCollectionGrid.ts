import {
	computed,
	onMounted,
	ref,
	shallowRef,
	watch,
	type Ref,
} from "vue";

import {
	SortDirect,
	type CollectionParams,
	type CollectionSorter,
} from "../types/collection";
import type {
	CollectionGridApi,
	GridCellPosition,
	GridColumn,
	GridSearchCriterion,
} from "../components/crudGrid/types";
import { errorText } from "../utils/errorText";
import {
	readCollectionGridState,
	writeCollectionGridState,
} from "../components/crudGrid/state";

interface UseCollectionGridOptions<
	TModel extends object,
	TKey,
	TNew,
	TUpd extends object,
	TDetailModel = TModel,
> {
	api: CollectionGridApi<TModel, TKey, TNew, TUpd, TDetailModel>;
	columns: Ref<GridColumn<TModel>[]>;
	getKey: (row: TModel) => TKey;
	stateKey?: string;
	initialParams?: CollectionParams;
	baseParams?: Ref<CollectionParams | undefined>;
	defaultSorter?: CollectionSorter[];
	pageSize?: number;
	rowSelection?: boolean;
}

interface SelectRowOptions {
	resetMarkAnchor?: boolean;
}

const makeStableKey = (key: unknown): string => {
	return JSON.stringify(key);
};

const clamp = (
	value: number,
	min: number,
	max: number,
): number => {
	return Math.min(Math.max(value, min), max);
};

const cloneSorter = (
	sorter: CollectionSorter[] | undefined,
): CollectionSorter[] => {
	return sorter?.map((item) => ({ ...item })) ?? [];
};

const hasSorter = (
	sorter: CollectionSorter[] | undefined,
): sorter is CollectionSorter[] => {
	return Array.isArray(sorter) && sorter.length > 0;
};

const mergeSorter = (
	fixedSorter: CollectionSorter[] | undefined,
	userSorter: CollectionSorter[] | undefined,
): CollectionSorter[] => {
	const result: CollectionSorter[] = [];
	const fixedFields = new Set<string>();

	for (const item of fixedSorter ?? []) {
		if (fixedFields.has(item.f)) {
			continue;
		}

		result.push({ ...item });
		fixedFields.add(item.f);
	}

	for (const item of userSorter ?? []) {
		if (!fixedFields.has(item.f)) {
			result.push({ ...item });
		}
	}

	return result;
};

export const useCollectionGrid = <
	TModel extends object,
	TKey,
	TNew,
	TUpd extends object,
	TDetailModel = TModel,
>(
	options: UseCollectionGridOptions<TModel, TKey, TNew, TUpd, TDetailModel>,
) => {
	const savedState = readCollectionGridState(options.stateKey);
	const rows = shallowRef<TModel[]>([]);
	const agg = ref<Record<string, unknown>>({});
	const loading = ref(false);
	const error = ref<string | null>(null);
	const initialSorter = hasSorter(savedState?.sorter)
		? cloneSorter(savedState?.sorter)
		: hasSorter(options.initialParams?.sorter)
			? cloneSorter(options.initialParams?.sorter)
			: cloneSorter(options.defaultSorter);
	const first = ref(savedState?.first ?? options.initialParams?.from ?? 0);
	const rowsPerPage = ref(savedState?.rowsPerPage ?? options.initialParams?.count ?? options.pageSize ?? 20);
	const sorter = ref<CollectionSorter[]>(initialSorter);
	const searchCriteria = ref<GridSearchCriterion[]>(savedState?.searchCriteria ?? []);
	const totalRecords = ref(0);
	const selectedRow = shallowRef<TModel | null>(null);
	const selectedCell = shallowRef<GridCellPosition<TModel> | null>(null);
	const markedKeySet = ref<Set<string>>(new Set(savedState?.markedKeys ?? []));
	const markAnchorKey = ref<string | null>(savedState?.markAnchorKey ?? null);

	const rowKey = (row: TModel): string => {
		return makeStableKey(options.getKey(row));
	};

	const requestParams = computed<CollectionParams>(() => {
		const searchFilters = searchCriteria.value.flatMap((item) => {
			return item.filters ?? [item.filter];
		});
		const filter = [
			...(options.initialParams?.filter ?? []),
			...(options.baseParams?.value?.filter ?? []),
			...searchFilters,
		];
		const effectiveSorter = mergeSorter(
			options.baseParams?.value?.sorter,
			sorter.value,
		);

		return {
			...options.initialParams,
			...options.baseParams?.value,
			from: first.value,
			count: rowsPerPage.value,
			filter: filter.length > 0 ? filter : undefined,
			sorter: effectiveSorter.length > 0 ? effectiveSorter : undefined,
		};
	});

	const singleSortField = computed(() => sorter.value[0]?.f ?? undefined);
	const singleSortOrder = computed(() => {
		if (!sorter.value[0]) {
			return undefined;
		}

		return sorter.value[0].d === SortDirect.ASC ? 1 : -1;
	});

	const markedRows = computed(() => {
		return rows.value.filter((row) => markedKeySet.value.has(rowKey(row)));
	});

	const selectedRowIndex = computed(() => {
		return selectedRow.value ? rows.value.indexOf(selectedRow.value) : -1;
	});

	const selectedColumn = computed(() => {
		if (selectedCell.value === null) {
			return null;
		}

		return options.columns.value[selectedCell.value.columnIndex] ?? null;
	});

	const saveState = (): void => {
		writeCollectionGridState(options.stateKey, {
			first: first.value,
			rowsPerPage: rowsPerPage.value,
			sorter: sorter.value.map((item) => ({ ...item })),
			selectedKey: selectedRow.value ? rowKey(selectedRow.value) : undefined,
			markedKeys: Array.from(markedKeySet.value),
			markAnchorKey: markAnchorKey.value ?? undefined,
			selectedCell: selectedCell.value
				? {
					rowIndex: selectedCell.value.rowIndex,
					columnIndex: selectedCell.value.columnIndex,
				}
				: undefined,
			searchCriteria: searchCriteria.value.map((item) => ({ ...item })),
		});
	};


	const setSearchCriteria = (criteria: GridSearchCriterion[]): void => {
		searchCriteria.value = criteria.map((item) => ({ ...item }));
		first.value = 0;
		saveState();
	};

	const upsertSearchCriterion = (criterion: GridSearchCriterion): void => {
		const next = searchCriteria.value
			.filter((item) => item.id !== criterion.id && item.field !== criterion.field);

		next.push({ ...criterion });
		setSearchCriteria(next);
	};

	const removeSearchCriterion = (id: string): void => {
		setSearchCriteria(searchCriteria.value.filter((item) => item.id !== id));
	};

	const clearSearchCriteria = (): void => {
		setSearchCriteria([]);
	};

	const setMarkedKeys = (keys: Set<string>): void => {
		markedKeySet.value = new Set(keys);
		saveState();
	};

	const clearMarkedRows = (): void => {
		markedKeySet.value = new Set();
		saveState();
	};

	const isRowMarked = (row: TModel): boolean => {
		return markedKeySet.value.has(rowKey(row));
	};

	const toggleRowMark = (row: TModel): void => {
		const next = new Set(markedKeySet.value);
		const key = rowKey(row);

		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}

		markAnchorKey.value = key;
		setMarkedKeys(next);
	};

	const markAllVisibleRows = (): void => {
		const next = new Set(markedKeySet.value);
		rows.value.forEach((row) => {
			next.add(rowKey(row));
		});
		setMarkedKeys(next);
	};

	const getMarkAnchorIndex = (fallbackIndex: number): number => {
		if (markAnchorKey.value === null) {
			return fallbackIndex;
		}

		const index = rows.value.findIndex((row) => rowKey(row) === markAnchorKey.value);
		return index >= 0 ? index : fallbackIndex;
	};

	const markRowRange = (
		fromIndex: number,
		toIndex: number,
		append: boolean,
	): void => {
		if (rows.value.length === 0) {
			return;
		}

		const start = Math.min(fromIndex, toIndex);
		const end = Math.max(fromIndex, toIndex);
		const next = append ? new Set(markedKeySet.value) : new Set<string>();

		for (let index = start; index <= end; index += 1) {
			const row = rows.value[index];
			if (row) {
				next.add(rowKey(row));
			}
		}

		setMarkedKeys(next);
	};

	const markRangeToRow = (
		row: TModel,
		append: boolean,
	): void => {
		const currentIndex = rows.value.indexOf(row);
		if (currentIndex < 0) {
			return;
		}

		const anchorIndex = getMarkAnchorIndex(currentIndex);
		markRowRange(anchorIndex, currentIndex, append);
	};

	const restoreSelection = (): boolean => {
		const selectedKey = selectedRow.value
			? rowKey(selectedRow.value)
			: savedState?.selectedKey;

		if (!selectedKey) {
			return false;
		}

		const row = rows.value.find((item) => {
			return rowKey(item) === selectedKey;
		});

		if (!row) {
			return false;
		}

		selectedRow.value = row;

		const savedCell = selectedCell.value ?? savedState?.selectedCell;
		if (savedCell) {
			const rowIndex = rows.value.indexOf(row);
			const columnIndex = Math.min(
				savedCell.columnIndex,
				Math.max(options.columns.value.length - 1, 0),
			);
			const column = options.columns.value[columnIndex];

			if (column) {
				selectedCell.value = {
					rowIndex,
					columnIndex,
					field: column.field,
					row,
				};
			}
		}

		return true;
	};

	const ensureSelection = (): void => {
		if (rows.value.length === 0) {
			selectedRow.value = null;
			selectedCell.value = null;
			return;
		}

		if (restoreSelection()) {
			return;
		}

		const row = rows.value[0];
		if (!row) {
			return;
		}

		if (options.rowSelection ?? true) {
			selectRow(row);
			return;
		}

		selectCell(row, 0, 0);
	};

	const load = async (): Promise<void> => {
		loading.value = true;
		error.value = null;

		try {
			const response = await options.api.list(requestParams.value);
			if (!response) {
				return;
			}

			rows.value = response.rows as TModel[];
			agg.value = response.agg as unknown as Record<string, unknown>;
			totalRecords.value = response.agg.tot_count;
			ensureSelection();
			saveState();
		} catch (err: unknown) {
			error.value = errorText(err); // instanceof Error ? err.message : String(err);
			throw err;
		} finally {
			loading.value = false;
		}
	};

	const setPage = (
		newFirst: number,
		newRowsPerPage: number,
	): void => {
		first.value = newFirst;
		rowsPerPage.value = newRowsPerPage;
		clearMarkedRows();
	};

	const setSorter = (newSorter: CollectionSorter[]): void => {
		sorter.value = newSorter;
		first.value = 0;
		clearMarkedRows();
	};

	const selectRow = (
		row: TModel | null,
		selectOptions: SelectRowOptions = {},
	): void => {
		const resetMarkAnchor = selectOptions.resetMarkAnchor ?? true;
		selectedRow.value = row;

		if (row === null) {
			selectedCell.value = null;
			if (resetMarkAnchor) {
				markAnchorKey.value = null;
			}
		} else if (resetMarkAnchor) {
			markAnchorKey.value = rowKey(row);
		}

		saveState();
	};

	const selectCell = (
		row: TModel,
		rowIndex: number,
		columnIndex: number,
	): void => {
		const column = options.columns.value[columnIndex];
		if (!column) {
			return;
		}

		selectedRow.value = row;
		selectedCell.value = {
			rowIndex,
			columnIndex,
			field: column.field,
			row,
		};
		markAnchorKey.value = rowKey(row);
		saveState();
	};

	const moveCursor = (
		dRow: number,
		dColumn: number,
		event?: KeyboardEvent,
	): void => {
		if (rows.value.length === 0) {
			return;
		}

		if (options.rowSelection ?? true) {
			const currentIndex = selectedRowIndex.value >= 0
				? selectedRowIndex.value
				: 0;
			const nextIndex = clamp(currentIndex + dRow, 0, rows.value.length - 1);
			const currentRow = rows.value[currentIndex];
			const nextRow = rows.value[nextIndex];

			if (!nextRow) {
				return;
			}

			if (event?.shiftKey && currentRow && markAnchorKey.value === null) {
				markAnchorKey.value = rowKey(currentRow);
			}

			selectRow(nextRow, {
				resetMarkAnchor: !event?.shiftKey,
			});

			if (event?.shiftKey) {
				const anchorIndex = getMarkAnchorIndex(currentIndex);
				markRowRange(anchorIndex, nextIndex, event.ctrlKey || event.metaKey);
			}

			return;
		}

		const currentRow = selectedCell.value?.rowIndex ?? 0;
		const currentColumn = selectedCell.value?.columnIndex ?? 0;
		const nextRow = clamp(currentRow + dRow, 0, rows.value.length - 1);
		const nextColumn = clamp(currentColumn + dColumn, 0, options.columns.value.length - 1);

		selectCell(rows.value[nextRow], nextRow, nextColumn);
	};

	const handleGridArrowKey = (event: KeyboardEvent): boolean => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
			markAllVisibleRows();
			event.preventDefault();
			return true;
		}

		if ((event.ctrlKey || event.metaKey) && (event.key === " " || event.code === "Space")) {
			if (selectedRow.value) {
				toggleRowMark(selectedRow.value);
			}
			event.preventDefault();
			return true;
		}

		if (event.key === "Escape" && markedKeySet.value.size > 0) {
			clearMarkedRows();
			event.preventDefault();
			return true;
		}

		switch (event.key) {
			case "ArrowUp":
				moveCursor(-1, 0, event);
				break;
			case "ArrowDown":
				moveCursor(1, 0, event);
				break;
			case "ArrowLeft":
				moveCursor(0, -1, event);
				break;
			case "ArrowRight":
				moveCursor(0, 1, event);
				break;
			default:
				return false;
		}

		event.preventDefault();
		return true;
	};

	onMounted(load);
	watch(requestParams, saveState, { deep: true });

	return {
		rows,
		agg,
		searchCriteria,
		loading,
		error,
		first,
		rowsPerPage,
		sorter,
		totalRecords,
		selectedRow,
		selectedCell,
		selectedColumn,
		markedRows,
		markedKeySet,
		markAnchorKey,
		singleSortField,
		singleSortOrder,
		load,
		setPage,
		setSorter,
		selectRow,
		selectCell,
		isRowMarked,
		clearMarkedRows,
		toggleRowMark,
		markRangeToRow,
		markAllVisibleRows,
		setSearchCriteria,
		upsertSearchCriterion,
		removeSearchCriterion,
		clearSearchCriteria,
		handleGridArrowKey,
	};
};
