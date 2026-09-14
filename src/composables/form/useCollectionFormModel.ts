import {
	ref,
	toValue,
	watch,
	type MaybeRefOrGetter,
	type Ref,
} from "vue";

export interface UseCollectionFormModelOptions<TModel extends object> {
	model: MaybeRefOrGetter<Partial<TModel> | null | undefined>;
	defaults: () => TModel;
	fromModel?: (model: Partial<TModel>, defaults: TModel) => TModel;
}

export const useCollectionFormModel = <TModel extends object>(
	options: UseCollectionFormModelOptions<TModel>,
): {
	form: Ref<TModel>;
	reset: () => void;
} => {
	const makeModel = (): TModel => {
		const defaults = options.defaults();
		const model = toValue(options.model) ?? {};

		return options.fromModel
			? options.fromModel(model, defaults)
			: {
				...defaults,
				...model,
			};
	};
	const form = ref(makeModel()) as Ref<TModel>;
	const reset = (): void => {
		form.value = makeModel();
	};

	watch(
		() => toValue(options.model),
		() => reset(),
		{ deep: true },
	);

	return {
		form,
		reset,
	};
};
