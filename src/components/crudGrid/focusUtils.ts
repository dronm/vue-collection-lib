export interface GridScrollPosition {
	x: number;
	y: number;
}

export interface GridScrollViewport {
	readonly scrollX: number;
	readonly scrollY: number;
	scrollTo: (x: number, y: number) => void;
}

type GridFocusableElement = {
	focus: (options?: FocusOptions) => void;
};

export const readGridScrollPosition = (
	viewport: GridScrollViewport,
): GridScrollPosition => {
	return {
		x: viewport.scrollX,
		y: viewport.scrollY,
	};
};

/**
 * Focus an element without allowing browser focus handling to move the page.
 *
 * `preventScroll` is supported by current browsers, but the explicit scroll
 * restoration is retained as a fallback for older engines and browser-specific
 * pointer-focus behaviour.
 */
export const focusGridElementWithoutScroll = (
	element: GridFocusableElement | null,
	viewport: GridScrollViewport | null,
	position?: GridScrollPosition | null,
): void => {
	if (element === null) {
		return;
	}

	const restorePosition = position
		?? (viewport === null ? null : readGridScrollPosition(viewport));

	try {
		element.focus({
			preventScroll: true,
		});
	} catch {
		// Older browsers can reject FocusOptions. The scroll restoration below
		// still keeps the collection in its original viewport position.
		element.focus();
	}

	if (
		viewport !== null
		&& restorePosition !== null
		&& (
			viewport.scrollX !== restorePosition.x
			|| viewport.scrollY !== restorePosition.y
		)
	) {
		viewport.scrollTo(restorePosition.x, restorePosition.y);
	}
};
