import {
	computed,
	type ComputedRef,
} from "vue";
import { useRoute } from "vue-router";

import { isReferenceSelectionQuery } from "../utils/referenceSelection";

export const useReferenceSelectionMode = (): ComputedRef<boolean> => {
	const route = useRoute();

	return computed(() => isReferenceSelectionQuery(route.query));
};
