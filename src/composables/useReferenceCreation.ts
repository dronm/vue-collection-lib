import { computed } from "vue";
import { useRoute } from "vue-router";

import {
	cancelReferenceCreation,
	completeReferenceCreation,
	isReferenceCreationQuery,
} from "../utils/referenceCreation";

export const useReferenceCreation = () => {
	const route = useRoute();
	const creationMode = computed(() => isReferenceCreationQuery(route.query));

	const complete = <TKey, TRow extends object>(key: TKey, row: TRow): boolean => {
		return completeReferenceCreation(key, row, {
			query: route.query,
		});
	};

	const cancel = (): boolean => {
		return cancelReferenceCreation(route.query);
	};

	return {
		creationMode,
		complete,
		cancel,
	};
};
