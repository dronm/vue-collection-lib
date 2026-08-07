import assert from "node:assert/strict";
import test from "node:test";

import {
	focusGridElementWithoutScroll,
	readGridScrollPosition,
	type GridScrollViewport,
} from "../src/components/crudGrid/focusUtils.ts";

test("focuses the grid with preventScroll", () => {
	let focusOptions: FocusOptions | undefined;
	const viewport: GridScrollViewport = {
		scrollX: 17,
		scrollY: 240,
		scrollTo: () => undefined,
	};

	focusGridElementWithoutScroll(
		{
			focus: (options?: FocusOptions): void => {
				focusOptions = options;
			},
		},
		viewport,
	);

	assert.deepEqual(focusOptions, {
		preventScroll: true,
	});
});

test("restores the pointer scroll position when focus moves the viewport", () => {
	const scrollCalls: Array<[number, number]> = [];
	const viewport = {
		scrollX: 17,
		scrollY: 240,
		scrollTo: (x: number, y: number): void => {
			scrollCalls.push([x, y]);
			viewport.scrollX = x;
			viewport.scrollY = y;
		},
	};
	const pointerPosition = readGridScrollPosition(viewport);

	focusGridElementWithoutScroll(
		{
			focus: (): void => {
				viewport.scrollX = 0;
				viewport.scrollY = 700;
			},
		},
		viewport,
		pointerPosition,
	);

	assert.deepEqual(scrollCalls, [[17, 240]]);
	assert.deepEqual(readGridScrollPosition(viewport), pointerPosition);
});

test("falls back when FocusOptions are unsupported", () => {
	let focusCalls = 0;
	const viewport = {
		scrollX: 0,
		scrollY: 300,
		scrollTo: (x: number, y: number): void => {
			viewport.scrollX = x;
			viewport.scrollY = y;
		},
	};

	focusGridElementWithoutScroll(
		{
			focus: (options?: FocusOptions): void => {
				focusCalls += 1;
				if (options !== undefined) {
					throw new TypeError("FocusOptions are unsupported");
				}
				viewport.scrollY = 0;
			},
		},
		viewport,
	);

	assert.equal(focusCalls, 2);
	assert.equal(viewport.scrollY, 300);
});
