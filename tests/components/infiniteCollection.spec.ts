import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	Comment,
	Fragment,
	defineComponent,
	h,
	onMounted,
	ref,
	type PropType,
	type VNode,
} from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";

import CollectionGrid from "../../src/components/crudGrid/CollectionGrid.vue";
import type { CollectionGridExpose, GridColumn } from "../../src/components/crudGrid/types";
import type { CollectionParams, CollectionResponse, CollectionWhere } from "../../src/types/collection";
import en from "../../src/locales/en";

interface TestRow {
	id: number;
	name: string;
	customer_id: number;
}

interface VirtualOptions {
	itemSize?: number;
	onScrollIndexChange?: (range: { first: number; last: number }) => void;
	onScroll?: (event: unknown) => void;
}

const flattenNodes = (nodes: VNode[]): VNode[] => nodes.flatMap((node) => {
	if (node.type === Comment) {
		return [];
	}
	return node.type === Fragment
		? flattenNodes(node.children as VNode[])
		: [node];
});

// Keep the grid, its slots, command handling, and data composables real. This
// replaces only PrimeVue's layout-dependent virtual viewport, which jsdom cannot
// measure. Indexes passed to column slots are indexes into the complete cache.
const DataTableStub = defineComponent({
	name: "DataTable",
	inheritAttrs: false,
	props: {
		value: { type: Array as PropType<TestRow[]>, default: () => [] },
		paginator: Boolean,
		scrollable: Boolean,
		loading: Boolean,
		first: Number,
		rows: Number,
		totalRecords: Number,
		scrollHeight: String,
		virtualScrollerOptions: Object as PropType<VirtualOptions>,
		rowClass: Function as PropType<(row: TestRow) => string>,
		editingRows: { type: Array as PropType<TestRow[]>, default: () => [] },
	},
	emits: ["page", "sort", "row-click", "row-edit-init", "row-edit-cancel", "update:editingRows"],
	setup: (props, { slots, emit, expose }) => {
		const viewport = ref<HTMLElement | null>(null);
		let range = { first: 0, last: 2 };
		const scrollTo = vi.fn((options: { top?: number; left?: number }) => {
			if (viewport.value && options.top !== undefined) {
				viewport.value.scrollTop = options.top;
				const first = Math.floor(options.top / (props.virtualScrollerOptions?.itemSize ?? 40));
				range = { first, last: first + 2 };
			}
		});
		const scrollToIndex = vi.fn((index: number) => {
			scrollTo({ top: index * (props.virtualScrollerOptions?.itemSize ?? 40) });
		});
		const scrollInView = vi.fn((index: number) => {
			const itemSize = props.virtualScrollerOptions?.itemSize ?? 40;
			const first = Math.floor((viewport.value?.scrollTop ?? 0) / itemSize);
			if (index < first || index >= first + 2) {
				scrollToIndex(index);
			}
		});
		const virtualScroller = {
			get $el() { return viewport.value; },
			scrollTo,
			scrollToIndex,
			scrollInView,
			getRenderedRange: () => ({ first: range.first, last: range.last, viewport: { ...range } }),
		};
		expose({
			getVirtualScrollerRef: () => virtualScroller,
			reportRange: (first: number, last: number) => {
				range = { first, last };
				if (viewport.value) {
					viewport.value.scrollTop = first * (props.virtualScrollerOptions?.itemSize ?? 40);
					const event = new Event("scroll");
					Object.defineProperty(event, "target", { value: viewport.value });
					props.virtualScrollerOptions?.onScroll?.(event);
				}
				props.virtualScrollerOptions?.onScrollIndexChange?.(range);
			},
		});
		onMounted(() => {
			if (viewport.value) {
				Object.defineProperties(viewport.value, {
					clientHeight: { configurable: true, get: () => 80 },
					scrollHeight: { configurable: true, get: () => props.value.length * 40 },
				});
			}
		});
		return () => {
			const columns = flattenNodes(slots.default?.() ?? []);
			return h("div", { "data-table-stub": "" }, [
				h("div", {
					ref: viewport,
					class: "p-virtualscroller",
					"data-pc-name": "virtualscroller",
				}, [h("table", [h("tbody", props.value.map((row, index) => h("tr", {
					key: row.id,
					class: props.rowClass?.(row),
					"data-row-id": row.id,
					onClick: (originalEvent: MouseEvent) => emit("row-click", { data: row, originalEvent }),
				}, columns.map((column) => {
					const columnSlots = column.children as Record<string, (context: unknown) => VNode[]> | null;
					return h("td", columnSlots?.body?.({ data: row, index, field: column.props?.field }));
				}))))])]),
				props.paginator ? h("nav", { "aria-label": "Pagination" }, "Pages") : null,
			]);
		};
	},
});

const SearchDialogStub = defineComponent({
	name: "GridSearchDialog",
	props: { visible: Boolean },
	emits: ["apply", "update:visible"],
	setup: () => () => null,
});

const matchesWhere = (row: TestRow, where?: CollectionWhere): boolean => {
	if (!where) {
		return true;
	}
	if ("and" in where) {
		return where.and.every((child) => matchesWhere(row, child));
	}
	if ("or" in where) {
		return where.or.some((child) => matchesWhere(row, child));
	}
	const value = row[where.f as keyof TestRow];
	const comparison = typeof value === "number" && typeof where.v === "number"
		? value - where.v
		: String(value).localeCompare(String(where.v));
	switch (where.o) {
		case "e": return value === where.v;
		case "l": return comparison < 0;
		case "g": return comparison > 0;
		case "le": return comparison <= 0;
		case "ge": return comparison >= 0;
		case "i": return value === null;
		case "in": return value !== null;
		default: throw new Error(`Unsupported fixture operator: ${where.o}`);
	}
};

const makeServer = (rowCount = 12) => {
	const records: TestRow[] = Array.from({ length: rowCount }, (_, index) => ({
		id: index + 1,
		name: `Item ${String(index + 1).padStart(2, "0")}`,
		customer_id: (index + 1) % 2 === 0 ? 10 : 20,
	}));
	const list = vi.fn(async (params: CollectionParams = {}): Promise<CollectionResponse<TestRow>> => {
		const filtered = records.filter((row) => {
			const legacyMatches = (params.filter ?? []).every((filter) => {
				return Object.entries(filter.f).every(([field, condition]) => {
					return matchesWhere(row, { f: field, ...condition });
				});
			});
			return legacyMatches && matchesWhere(row, params.where);
		});
		filtered.sort((left, right) => {
			for (const sort of params.sorter ?? []) {
				const leftValue = left[sort.f as keyof TestRow];
				const rightValue = right[sort.f as keyof TestRow];
				if (leftValue !== rightValue) {
					return (leftValue < rightValue ? -1 : 1) * (sort.d === "d" ? -1 : 1);
				}
			}
			return 0;
		});
		const from = params.from ?? 0;
		return {
			rows: filtered.slice(from, from + (params.count ?? 20)).map((row) => ({ ...row })),
			agg: { tot_count: filtered.length },
		};
	});
	return { list, records };
};

const mounted: VueWrapper[] = [];
const columns: GridColumn<TestRow>[] = [
	{ field: "id", headerKey: "ID", dataType: "number", sortable: true },
	{ field: "name", headerKey: "Name", dataType: "string", sortable: true, editable: true },
];

const mountGrid = async (
	api: { list: ReturnType<typeof makeServer>["list"] },
	props: Record<string, unknown> = {},
	slots: Record<string, unknown> = {},
) => {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{ path: "/", component: { render: () => h("div") } }],
	});
	await router.push("/");
	await router.isReady();
	const i18n = createI18n({
		legacy: false,
		locale: "en",
		missingWarn: false,
		fallbackWarn: false,
		messages: { en },
	});
	const wrapper = mount(CollectionGrid, {
		props: {
			api,
			columns,
			dataKey: "id",
			getKey: (row: TestRow) => row.id,
			defaultSorter: [{ f: "id", d: "d" }],
			showCommandPanel: false,
			...props,
		},
		slots,
		attachTo: document.body,
		global: {
			plugins: [router, i18n, [PrimeVue, { unstyled: true }]],
			stubs: { DataTable: DataTableStub, GridSearchDialog: SearchDialogStub },
		},
	});
	mounted.push(wrapper);
	await flushPromises();
	return wrapper;
};

const infiniteOptions = {
	keyFields: ["id"],
	chunkSize: 3,
	prefetchRows: 0,
	maxCachedChunks: 3,
	scrollHeight: "80px",
	itemSize: 40,
};

const tableOf = (wrapper: VueWrapper) => wrapper.findComponent(DataTableStub);
const cachedIds = (wrapper: VueWrapper): number[] => (tableOf(wrapper).props("value") as TestRow[]).map((row) => row.id);
const reportRange = async (wrapper: VueWrapper, first: number, last: number): Promise<void> => {
	(tableOf(wrapper).vm as unknown as { reportRange: (first: number, last: number) => void }).reportRange(first, last);
	await flushPromises();
};
const currentCell = (wrapper: VueWrapper) => (wrapper.vm as unknown as CollectionGridExpose).getCurrentCell();

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => { resolve = complete; });
	return { promise, resolve };
};

afterEach(() => {
	for (const wrapper of mounted.splice(0)) {
		wrapper.unmount();
	}
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("CollectionGrid infinite scrolling", () => {
	it("keeps offset pagination as the unchanged default", async () => {
		const server = makeServer(50);
		const wrapper = await mountGrid(server);
		expect(tableOf(wrapper).props("paginator")).toBe(true);
		expect(tableOf(wrapper).props("virtualScrollerOptions")).toBeUndefined();
		expect(server.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: 0, count: 20 }));
		tableOf(wrapper).vm.$emit("page", { first: 20, rows: 20 });
		await flushPromises();
		expect(server.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: 20, count: 20 }));
		expect(cachedIds(wrapper)).toHaveLength(20);
	});

	it("enables a virtual viewport and requests one lookahead row with a stable sorting key", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, {
			infiniteScroll: infiniteOptions,
			defaultSorter: [{ f: "name", d: "a" }],
		});
		expect(tableOf(wrapper).props("paginator")).toBe(false);
		expect(tableOf(wrapper).props("scrollable")).toBe(true);
		expect(tableOf(wrapper).props("scrollHeight")).toBe("80px");
		expect(tableOf(wrapper).props("virtualScrollerOptions")).toEqual(expect.objectContaining({ itemSize: 40 }));
		expect(server.list).toHaveBeenCalledTimes(1);
		expect(server.list).toHaveBeenLastCalledWith(expect.objectContaining({
			from: 0,
			count: 4,
			sorter: [{ f: "name", d: "a" }, { f: "id", d: "a" }],
		}));
		expect(cachedIds(wrapper)).toEqual([1, 2, 3]);
	});

	it("prefetches the next chunk from visible rows without replacing the selected record", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		await wrapper.get('[data-grid-row-index="1"][data-grid-column-index="1"]').trigger("click");
		expect(currentCell(wrapper)?.row.id).toBe(11);
		await reportRange(wrapper, 1, 3);
		expect(server.list).toHaveBeenCalledTimes(2);
		expect(cachedIds(wrapper)).toEqual([12, 11, 10, 9, 8, 7]);
		expect(currentCell(wrapper)?.row.id).toBe(11);
		expect(server.list.mock.calls[1][0]).toEqual(expect.objectContaining({
			from: 0,
			count: 4,
			where: { f: "id", o: "l", v: 10 },
		}));
	});

	it("prefetches before the end when the configured buffer threshold becomes visible", async () => {
		const server = makeServer(20);
		const wrapper = await mountGrid(server, {
			infiniteScroll: { ...infiniteOptions, chunkSize: 6, prefetchRows: 2 },
		});
		expect(server.list).toHaveBeenCalledTimes(1);
		expect(cachedIds(wrapper)).toEqual([20, 19, 18, 17, 16, 15]);
		await reportRange(wrapper, 2, 4);
		expect(server.list).toHaveBeenCalledTimes(2);
		expect(cachedIds(wrapper)).toHaveLength(12);
	});

	it("bounds the cache and restores the visible record when loading earlier discarded chunks", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, {
			infiniteScroll: { ...infiniteOptions, maxCachedChunks: 2 },
		});
		await reportRange(wrapper, 1, 3);
		await reportRange(wrapper, 4, 6);
		expect(cachedIds(wrapper)).toEqual([9, 8, 7, 6, 5, 4]);
		const viewport = wrapper.get<HTMLElement>(".p-virtualscroller").element;
		expect(viewport.scrollTop).toBe(40);
		expect((tableOf(wrapper).props("value") as TestRow[])[1].id).toBe(8);
		await reportRange(wrapper, 0, 2);
		expect(cachedIds(wrapper)).toEqual([12, 11, 10, 9, 8, 7]);
		expect(viewport.scrollTop).toBe(120);
		expect((tableOf(wrapper).props("value") as TestRow[])[3].id).toBe(9);
		expect(server.list.mock.lastCall?.[0]?.sorter).toEqual([{ f: "id", d: "a" }]);
	});

	it("continues keyboard navigation from the visible rows after mouse scrolling evicts the selected record", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, {
			infiniteScroll: { ...infiniteOptions, maxCachedChunks: 2 },
		});
		await wrapper.get('[data-grid-row-index="0"][data-grid-column-index="1"]').trigger("click");
		expect(currentCell(wrapper)?.row.id).toBe(12);
		await reportRange(wrapper, 1, 3);
		await reportRange(wrapper, 4, 6);
		expect(cachedIds(wrapper)).toEqual([9, 8, 7, 6, 5, 4]);
		expect(wrapper.get<HTMLElement>(".p-virtualscroller").element.scrollTop).toBe(40);
		await wrapper.trigger("keydown", { key: "ArrowDown" });
		await flushPromises();
		expect(currentCell(wrapper)?.row.id).toBe(7);
		expect(currentCell(wrapper)?.columnIndex).toBe(1);
	});

	it("retains marked records for batch commands after their chunks leave the cache", async () => {
		const server = makeServer();
		const handler = vi.fn();
		const wrapper = await mountGrid(server, {
			infiniteScroll: { ...infiniteOptions, maxCachedChunks: 2 },
			commands: [{ name: "inspect", label: "Inspect marked", shortcut: "F8", handler }],
		});
		await wrapper.get('[data-grid-row-index="0"][data-grid-column-index="1"]').trigger("click");
		await wrapper.trigger("keydown", { key: " ", code: "Space", ctrlKey: true });
		const exposed = wrapper.vm as unknown as CollectionGridExpose;
		expect(exposed.getMarkedRows()).toEqual([expect.objectContaining({ id: 12 })]);
		await reportRange(wrapper, 1, 3);
		await reportRange(wrapper, 4, 6);
		expect(cachedIds(wrapper)).not.toContain(12);
		expect(exposed.getMarkedRows()).toEqual([expect.objectContaining({ id: 12 })]);
		await wrapper.trigger("keydown", { key: "F8" });
		await flushPromises();
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler.mock.calls[0][0]).toMatchObject({
			keys: [12],
			rows: [expect.objectContaining({ id: 12 })],
			markedRows: [expect.objectContaining({ id: 12 })],
		});
		exposed.clearMarkedRows();
		expect(exposed.getMarkedRows()).toEqual([]);
	});

	it("loads and advances across a keyboard boundary while preserving the current column", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, {
			infiniteScroll: { ...infiniteOptions, prefetchRows: 0 },
		});
		await wrapper.get('[data-grid-row-index="2"][data-grid-column-index="1"]').trigger("click");
		expect(currentCell(wrapper)?.row.id).toBe(10);
		await wrapper.trigger("keydown", { key: "ArrowDown" });
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(2);
		expect(currentCell(wrapper)?.row.id).toBe(9);
		expect(currentCell(wrapper)?.columnIndex).toBe(1);
	});

	it("keeps legacy filters and grouped base conditions on every continuation request", async () => {
		const server = makeServer(20);
		const filter = [{ j: "and" as const, f: { customer_id: { o: "e" as const, v: 10 } } }];
		const where: CollectionWhere = { f: "id", o: "g", v: 2 };
		const wrapper = await mountGrid(server, {
			infiniteScroll: infiniteOptions,
			baseParams: { filter, where },
		});
		expect(cachedIds(wrapper)).toEqual([20, 18, 16]);
		await reportRange(wrapper, 1, 3);
		expect(server.list.mock.calls[1][0]).toEqual(expect.objectContaining({
			filter,
			where: { and: [where, { f: "id", o: "l", v: 16 }] },
		}));
		expect(cachedIds(wrapper)).toEqual([20, 18, 16, 14, 12, 10]);
	});

	it("resets the cursor and viewport when the user changes sorting", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		await reportRange(wrapper, 1, 3);
		expect(cachedIds(wrapper)).toHaveLength(6);
		tableOf(wrapper).vm.$emit("sort", { sortField: "id", sortOrder: 1 });
		await flushPromises();
		expect(server.list).toHaveBeenLastCalledWith(expect.objectContaining({
			from: 0,
			count: 4,
			sorter: [{ f: "id", d: "a" }],
		}));
		expect(server.list.mock.lastCall?.[0]?.where).toBeUndefined();
		expect(cachedIds(wrapper)).toEqual([1, 2, 3]);
	});

	it("restarts from the beginning when a search criterion changes", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		await reportRange(wrapper, 1, 3);
		wrapper.findComponent(SearchDialogStub).vm.$emit("apply", {
			field: "name",
			operation: "exact",
			value: "Item 12",
		});
		await flushPromises();
		expect(server.list.mock.lastCall?.[0]?.where).toBeUndefined();
		expect(server.list.mock.lastCall?.[0]?.filter).toEqual([
			{ j: "and", f: { name: { o: "e", v: "Item 12" } } },
		]);
		expect(cachedIds(wrapper)).toEqual([12]);
	});

	it("clears marked records when searching changes the collection scope", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		await wrapper.get('[data-grid-row-index="0"][data-grid-column-index="1"]').trigger("click");
		await wrapper.trigger("keydown", { key: " ", code: "Space", ctrlKey: true });
		const exposed = wrapper.vm as unknown as CollectionGridExpose;
		expect(exposed.getMarkedRows()).toEqual([expect.objectContaining({ id: 12 })]);
		wrapper.findComponent(SearchDialogStub).vm.$emit("apply", {
			field: "name",
			operation: "exact",
			value: "Item 11",
		});
		await flushPromises();
		expect(cachedIds(wrapper)).toEqual([11]);
		expect(exposed.getMarkedRows()).toEqual([]);
	});

	it("ignores an old neighbor response after sorting has started a different collection", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		const pending = deferred<CollectionResponse<TestRow>>();
		server.list.mockImplementationOnce(() => pending.promise);
		await reportRange(wrapper, 1, 3);
		expect(server.list).toHaveBeenCalledTimes(2);
		tableOf(wrapper).vm.$emit("sort", { sortField: "id", sortOrder: 1 });
		await flushPromises();
		expect(cachedIds(wrapper)).toEqual([1, 2, 3]);
		pending.resolve({
			rows: server.records.filter((row) => row.id <= 9 && row.id >= 6).reverse(),
			agg: { tot_count: 9 },
		});
		await flushPromises();
		expect(cachedIds(wrapper)).toEqual([1, 2, 3]);
		await reportRange(wrapper, 1, 3);
		expect(cachedIds(wrapper)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("keeps loaded rows after a neighbor error and retries the same boundary", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		server.list.mockRejectedValueOnce(new Error("Temporary chunk failure"));
		await reportRange(wrapper, 1, 3);
		expect(cachedIds(wrapper)).toEqual([12, 11, 10]);
		expect(wrapper.text()).toContain("Temporary chunk failure");
		const failedRequest = server.list.mock.calls[1][0];
		const retry = wrapper.findAll("button").find((button) => /retry/i.test(button.text()));
		expect(retry, "the failed direction must offer a retry action").toBeDefined();
		await retry!.trigger("click");
		await flushPromises();
		expect(server.list.mock.lastCall?.[0]).toEqual(failedRequest);
		expect(cachedIds(wrapper)).toEqual([12, 11, 10, 9, 8, 7]);
		expect(wrapper.text()).not.toContain("Temporary chunk failure");
	});

	it("renders an initial loading failure and retries the first chunk explicitly", async () => {
		const server = makeServer();
		server.list.mockRejectedValueOnce(new Error("Initial chunk failure"));
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions });
		expect(cachedIds(wrapper)).toEqual([]);
		expect(server.list).toHaveBeenCalledTimes(1);
		expect(wrapper.get('[role="alert"]').text()).toContain("Initial chunk failure");
		const retry = wrapper.findAll("button").find((button) => /retry/i.test(button.text()));
		expect(retry).toBeDefined();
		await retry!.trigger("click");
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(2);
		expect(cachedIds(wrapper)).toEqual([12, 11, 10]);
		expect(server.list.mock.lastCall?.[0]?.where).toBeUndefined();
		expect(wrapper.find('[role="alert"]').exists()).toBe(false);
	});

	it("retains custom body slots and row classes across loaded chunks", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, {
			infiniteScroll: infiniteOptions,
			getRowClass: (row: TestRow) => row.id % 2 === 0 ? "even-record" : "odd-record",
		}, {
			"body-name": ({ data }: { data: TestRow }) => h("strong", { "data-custom-name": data.id }, data.name),
		});
		await reportRange(wrapper, 1, 3);
		expect(wrapper.get('[data-custom-name="9"]').text()).toBe("Item 09");
		expect(wrapper.get('[data-row-id="9"]').classes()).toContain("odd-record");
		expect(wrapper.get('[data-row-id="8"]').classes()).toContain("even-record");
	});

	it("pauses neighbor loading and keyboard navigation while an inline row is edited", async () => {
		const server = makeServer();
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions, editMode: "inline" });
		const row = (tableOf(wrapper).props("value") as TestRow[])[0];
		tableOf(wrapper).vm.$emit("row-edit-init", { data: row });
		tableOf(wrapper).vm.$emit("update:editingRows", [row]);
		await flushPromises();
		await reportRange(wrapper, 1, 3);
		await wrapper.trigger("keydown", { key: "ArrowDown" });
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(1);
		expect(cachedIds(wrapper)).toEqual([12, 11, 10]);
	});

	it("defers a changed base scope until the active inline draft is closed", async () => {
		const server = makeServer(2);
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions, editMode: "inline" });
		expect(cachedIds(wrapper)).toEqual([2, 1]);
		expect(server.list).toHaveBeenCalledTimes(1);
		const draft = (tableOf(wrapper).props("value") as TestRow[])[0];
		tableOf(wrapper).vm.$emit("row-edit-init", { data: draft });
		tableOf(wrapper).vm.$emit("update:editingRows", [draft]);
		await flushPromises();
		draft.name = "Unsaved inline draft";
		const filter = [{ j: "and" as const, f: { id: { o: "e" as const, v: 1 } } }];
		await wrapper.setProps({ baseParams: { filter } });
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(1);
		expect(cachedIds(wrapper)).toEqual([2, 1]);
		expect((tableOf(wrapper).props("value") as TestRow[])[0]).toBe(draft);
		expect(draft.name).toBe("Unsaved inline draft");
		expect(tableOf(wrapper).props("editingRows")).toEqual([draft]);
		tableOf(wrapper).vm.$emit("row-edit-cancel", { data: draft });
		tableOf(wrapper).vm.$emit("update:editingRows", []);
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(2);
		expect(server.list.mock.lastCall?.[0]).toEqual(expect.objectContaining({ from: 0, count: 4, filter }));
		expect(server.list.mock.lastCall?.[0]?.where).toBeUndefined();
		expect(cachedIds(wrapper)).toEqual([1]);
	});

	it("retries a pending scope reset after an editor prevents its response from replacing the draft", async () => {
		const server = makeServer(2);
		const wrapper = await mountGrid(server, { infiniteScroll: infiniteOptions, editMode: "inline" });
		const pending = deferred<CollectionResponse<TestRow>>();
		server.list.mockImplementationOnce(() => pending.promise);
		const filter = [{ j: "and" as const, f: { id: { o: "e" as const, v: 1 } } }];
		await wrapper.setProps({ baseParams: { filter } });
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(2);
		const draft = (tableOf(wrapper).props("value") as TestRow[])[0];
		tableOf(wrapper).vm.$emit("row-edit-init", { data: draft });
		tableOf(wrapper).vm.$emit("update:editingRows", [draft]);
		await flushPromises();
		draft.name = "Draft started during reset";
		pending.resolve({ rows: [{ ...server.records[0] }], agg: { tot_count: 1 } });
		await flushPromises();
		expect(cachedIds(wrapper)).toEqual([2, 1]);
		expect((tableOf(wrapper).props("value") as TestRow[])[0]).toBe(draft);
		expect(draft.name).toBe("Draft started during reset");
		tableOf(wrapper).vm.$emit("row-edit-cancel", { data: draft });
		tableOf(wrapper).vm.$emit("update:editingRows", []);
		await flushPromises();
		expect(server.list).toHaveBeenCalledTimes(3);
		expect(server.list.mock.lastCall?.[0]).toEqual(expect.objectContaining({ from: 0, count: 4, filter }));
		expect(cachedIds(wrapper)).toEqual([1]);
	});
});
