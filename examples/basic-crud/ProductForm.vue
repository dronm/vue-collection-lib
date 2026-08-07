<script setup lang="ts">
import {
	computed,
	onMounted,
	ref,
} from "vue";
import { useRouter } from "vue-router";
import * as v from "valibot";

import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";

import {
	ReferenceInput,
	referenceAutocompleteEq,
	useCollectionFormSubmit,
	useFormErrors,
	type CollectionFormMode,
} from "@katren/vue-collection-lib";

import {
	categoryList,
	productApi,
} from "./api";
import type {
	CategoryKey,
	CategoryRow,
	Product,
	ProductKey,
	ProductNew,
	ProductUpd,
} from "./types";

const props = defineProps<{
	mode: CollectionFormMode;
	id?: number;
}>();

const router = useRouter();
const errors = useFormErrors();
const loading = ref(false);

const emptyProduct = (): Product => {
	return {
		id: 0,
		name: "",
		price: 0,
		active: true,
		category_ref: null,
	};
};

const form = ref<Product>(emptyProduct());

const key = computed<ProductKey | null>(() => {
	if (props.mode !== "edit" || props.id === undefined) {
		return null;
	}

	return {
		id: props.id,
	};
});

const categoryAutocomplete = referenceAutocompleteEq<CategoryRow, CategoryKey>({
	searchField: "name",
	keyFields: ["id"],
	descrFields: ["name"],
	list: categoryList,
	completeOnFocus: true,
	minLength: 0,
});

const ProductNewSchema = v.object({
	name: v.pipe(
		v.string(),
		v.minLength(1, "Name is required"),
	),
	price: v.pipe(
		v.number(),
		v.minValue(0, "Price cannot be negative"),
	),
	active: v.boolean(),
	category_ref: v.nullable(v.object({
		id: v.number(),
	})),
});

const ProductUpdSchema: v.GenericSchema<ProductUpd> = v.partial(ProductNewSchema);

const submitter = useCollectionFormSubmit<
	Product,
	ProductKey,
	ProductNew,
	ProductUpd
>({
	api: productApi,
	mode: computed(() => props.mode),
	key,
	fields: [
		"name",
		"price",
		"active",
		{
			detailField: "category_ref",
			kind: "reference",
			reference: {
				mode: "keys",
			},
		},
	],
	createSchema: ProductNewSchema,
	updateSchema: ProductUpdSchema,
	errors,
	onSuccess: async () => {
		await router.push({
			name: "ProductList",
		});
	},
});

const load = async (): Promise<void> => {
	if (props.id === undefined) {
		return;
	}

	loading.value = true;
	try {
		const detail = await productApi.detail({
			id: props.id,
		});
		form.value = detail;

		if (props.mode === "edit") {
			submitter.setInitialModel(detail);
		}
	} finally {
		loading.value = false;
	}
};

const submitForm = async (): Promise<void> => {
	await submitter.submit(form.value);
};

onMounted(() => {
	void load();
});
</script>

<template>
	<form
		class="product-form"
		@submit.prevent="submitForm"
	>
		<div
			v-if="errors.formErrors.length > 0"
			class="product-form-errors"
		>
			<div
				v-for="message in errors.formErrors"
				:key="message"
			>
				{{ message }}
			</div>
		</div>

		<label for="product-name">Name</label>
		<InputText
			id="product-name"
			v-model="form.name"
			v-bind="errors.fieldProps('name')"
		/>
		<small v-if="errors.has('name')">
			{{ errors.first("name") }}
		</small>

		<label for="product-category">Category</label>
		<ReferenceInput
			id="product-category"
			v-model="form.category_ref"
			:autocomplete="categoryAutocomplete"
			:invalid="errors.has('category_ref')"
			:error="errors.first('category_ref')"
			:openAction="form.category_ref?.keys ? {
				route: {
					name: 'CategoryEdit',
					params: form.category_ref.keys,
				},
			} : undefined"
			:selectAction="{
				route: {
					name: 'CategoryList',
				},
			}"
		/>

		<label for="product-price">Price</label>
		<InputNumber
			inputId="product-price"
			v-model="form.price"
			:minFractionDigits="2"
			:maxFractionDigits="2"
			:invalid="errors.has('price')"
		/>
		<small v-if="errors.has('price')">
			{{ errors.first("price") }}
		</small>

		<label class="product-form-checkbox">
			<Checkbox
				v-model="form.active"
				binary
			/>
			<span>Active</span>
		</label>

		<div class="product-form-actions">
			<Button
				type="submit"
				label="Save"
				icon="pi pi-check"
				:loading="submitter.submitting.value || loading"
			/>
		</div>
	</form>
</template>

<style scoped>
.product-form {
	display: grid;
	gap: 0.5rem;
	max-width: 40rem;
}

.product-form-errors {
	color: var(--p-red-700, rgb(185 28 28));
}

.product-form-checkbox,
.product-form-actions {
	align-items: center;
	display: flex;
	gap: 0.5rem;
}

.product-form-actions {
	justify-content: flex-end;
	margin-top: 0.5rem;
}
</style>
