import assert from "node:assert/strict";
import test from "node:test";

import { ref } from "vue";

import { useCollectionHierarchy } from "../src/composables/useCollectionHierarchy.ts";
import { FilterOperatorParam, SortDirect } from "../src/types/collection.ts";
import type { CollectionHierarchyConfig } from "../src/types/collectionHierarchy.ts";

type Row = {
	id: number;
	name: string;
	parent_id: number | null;
	is_group: boolean;
};

const makeHierarchy = () => {
	const config = ref<CollectionHierarchyConfig<Row> | undefined>({});
	return useCollectionHierarchy<Row>({
		config,
		dataKey: ref("id"),
		stateKey: ref<string | undefined>(undefined),
	});
};

test("hierarchy scope starts at the root and keeps groups first", () => {
	const hierarchy = makeHierarchy();

	assert.deepEqual(hierarchy.baseParams.value, {
		filter: [{
			f: {
				parent_id: {
					o: FilterOperatorParam.I,
					v: null,
				},
			},
		}],
		sorter: [{
			f: "is_group",
			d: SortDirect.DESC,
		}],
	});
});

test("entering a group scopes by parent id and builds breadcrumbs", () => {
	const hierarchy = makeHierarchy();

	assert.equal(hierarchy.enterGroup({
		id: 17,
		name: "Glass",
		parent_id: null,
		is_group: true,
	}), true);

	assert.equal(hierarchy.currentGroupId.value, 17);
	assert.deepEqual(hierarchy.path.value, [{
		id: 17,
		label: "Glass",
	}]);
	assert.deepEqual(hierarchy.baseParams.value?.filter, [{
		f: {
			parent_id: {
				o: FilterOperatorParam.E,
				v: 17,
			},
		},
	}]);
});

test("flat mode removes hierarchy filtering while preserving the path", () => {
	const hierarchy = makeHierarchy();

	hierarchy.enterGroup({
		id: 17,
		name: "Glass",
		parent_id: null,
		is_group: true,
	});
	hierarchy.toggleViewMode();

	assert.equal(hierarchy.viewMode.value, "flat");
	assert.equal(hierarchy.baseParams.value?.filter, undefined);
	assert.equal(hierarchy.currentGroupId.value, 17);
	assert.deepEqual(hierarchy.createContext("item").initialValues, {
		parent_id: null,
		is_group: false,
	});

	hierarchy.toggleViewMode();
	assert.equal(hierarchy.viewMode.value, "hierarchy");
	assert.deepEqual(hierarchy.createContext("group").initialValues, {
		parent_id: 17,
		is_group: true,
	});
});

test("reference selection defaults to elements only", () => {
	const hierarchy = makeHierarchy();

	assert.equal(hierarchy.isSelectable({
		id: 1,
		name: "Group",
		parent_id: null,
		is_group: true,
	}), false);
	assert.equal(hierarchy.isSelectable({
		id: 2,
		name: "Item",
		parent_id: null,
		is_group: false,
	}), true);
});
