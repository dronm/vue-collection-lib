import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	defineComponent,
	h,
	reactive,
	Teleport,
	type Component,
	type PropType,
} from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";
import AutoComplete from "primevue/autocomplete";
import * as v from "valibot";

import CollectionDirtyGuard from "../../src/components/form/CollectionDirtyGuard.vue";
import CollectionCreateForm from "../../src/components/form/CollectionCreateForm.vue";
import GridFieldEditor from "../../src/components/crudGrid/GridFieldEditor.vue";
import ReferenceInput from "../../src/components/reference/ReferenceInput.vue";
import ReferenceKeyInput from "../../src/components/reference/ReferenceKeyInput.vue";
import { applyGridInlineValue } from "../../src/components/crudGrid/inlineEditing";
import type { GridColumn } from "../../src/components/crudGrid/types";
import type { CollectionDefinition } from "../../src/types/collectionDefinition";
import type { ReferenceCreateAction, ReferenceValue } from "../../src/types/reference";
import { defineCrudReference } from "../../src/utils/crudReference";
import {
	makeReferenceCreationMessage,
	REFERENCE_CREATION_QUERY_PARAM,
	referenceCreationChannelName,
} from "../../src/utils/referenceCreation";
import { collectionFormSubmitSuccessEvent } from "../../src/composables/form/events";
import en from "../../src/locales/en";
import { useReferenceCreation } from "../../src/composables/useReferenceCreation";

interface CategoryRow {
	id: number;
	name: string;
	quantity: number;
	active: boolean;
	started_at: Date | null;
	status: string;
	code: string;
	internal_note: string;
}

type CategoryKey = { id: number };
type CategoryCreate = Omit<CategoryRow, "id" | "internal_note">;
type CategoryCollection = CollectionDefinition<CategoryRow, CategoryKey, CategoryCreate, Partial<CategoryCreate>>;

const oldReference = { keys: { id: 1 }, descr: "Existing category" };
const autocomplete = {
	keyFields: ["id"] as (keyof CategoryRow)[],
	descrFields: ["name"] as (keyof CategoryRow)[],
	rows: [] as CategoryRow[],
};
const mounted: VueWrapper[] = [];

const inputControl = (name: string, type = "text") => defineComponent({
	name,
	inheritAttrs: false,
	props: {
		modelValue: { type: null },
		inputId: String,
		disabled: Boolean,
	},
	emits: ["update:modelValue"],
	setup: (props, { attrs, emit }) => {
		return () => h("input", {
			...attrs,
			id: props.inputId ?? attrs.id,
			"data-control": name,
			type,
			value: props.modelValue instanceof Date
				? props.modelValue.toISOString()
				: props.modelValue,
			checked: type === "checkbox" ? Boolean(props.modelValue) : undefined,
			disabled: props.disabled,
			onInput: (event: Event) => {
				const input = event.target as HTMLInputElement;
				const value = type === "number"
					? input.value === "" ? null : Number(input.value)
					: type === "checkbox" ? input.checked : input.value;
				emit("update:modelValue", value);
			},
		});
	},
});

const AutoCompleteStub = defineComponent({
	name: "AutoComplete",
	props: {
		modelValue: { type: null },
		inputId: String,
		disabled: Boolean,
	},
	emits: ["update:modelValue", "item-select", "complete"],
	setup: (props) => {
		return () => h("input", {
			id: props.inputId,
			"data-control": "AutoComplete",
			value: (props.modelValue as { descr?: string } | null)?.descr ?? "",
			disabled: props.disabled,
		});
	},
});

const SelectStub = defineComponent({
	name: "Select",
	props: {
		modelValue: { type: null },
		inputId: String,
		disabled: Boolean,
		options: {
			type: Array as PropType<{ value: string | number; label: string; disabled?: boolean }[]>,
			default: () => [],
		},
	},
	emits: ["update:modelValue"],
	setup: (props, { emit }) => {
		return () => h("select", {
			id: props.inputId,
			"data-control": "Select",
			value: props.modelValue,
			disabled: props.disabled,
			onChange: (event: Event) => {
				const value = (event.target as HTMLSelectElement).value;
				emit("update:modelValue", props.options.find((option) => String(option.value) === value)?.value);
			},
		}, props.options.map((option) => h("option", {
			value: option.value,
			disabled: option.disabled,
		}, option.label)));
	},
});

// Preserve the dialog's teleport boundary: the creation form must stay outside
// the originating form, otherwise child input/submit events affect its parent.
const DialogStub = defineComponent({
	name: "Dialog",
	inheritAttrs: false,
	props: { visible: Boolean, header: String },
	emits: ["update:visible", "hide"],
	setup: (props, { slots }) => {
		return () => props.visible
			? h(Teleport, { to: "body" }, h("section", {
				role: "dialog",
				"aria-label": props.header,
			}, [slots.default?.(), slots.footer?.()]))
			: null;
	},
});

const mountSubject = async (
	component: Component,
	props: Record<string, unknown> = {},
	options: { realAutocomplete?: boolean; initialRoute?: string } = {},
) => {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: "/parent", name: "Parent", component: { render: () => h("div") } },
			{ path: "/categories/create", name: "CategoryCreate", component: { render: () => h("div") } },
			{ path: "/other", name: "Other", component: { render: () => h("div") } },
		],
	});
	await router.push(options.initialRoute ?? "/parent");
	await router.isReady();
	const i18n = createI18n({
		legacy: false,
		locale: "en",
		missingWarn: false,
		fallbackWarn: false,
		messages: {
			en: {
				...en,
				Category: { title: "Categories", fields: { name: "Name" } },
				CategoryStatus: { active: "Active", pending: "Pending" },
			},
		},
	});
	const wrapper = mount(component, {
		props,
		attachTo: document.body,
		global: {
			plugins: [router, i18n, [PrimeVue, { unstyled: true }]],
			stubs: {
				AutoComplete: options.realAutocomplete ? false : AutoCompleteStub,
				Dialog: DialogStub,
				InputText: options.realAutocomplete ? false : inputControl("InputText"),
				InputNumber: inputControl("InputNumber", "number"),
				Checkbox: inputControl("Checkbox", "checkbox"),
				DatePicker: inputControl("DatePicker"),
				Select: SelectStub,
			},
		},
	});
	mounted.push(wrapper);
	await flushPromises();
	return { wrapper, router };
};

const categoryFixture = () => {
	const saved: CategoryRow = {
		id: 42,
		name: "Server canonical name",
		quantity: 3,
		active: true,
		started_at: null,
		status: "active",
		code: "CANONICAL",
		internal_note: "Server-only value",
	};
	const create = vi.fn(async (_model: CategoryCreate) => ({ id: saved.id }));
	const detail = vi.fn(async (_key: CategoryKey) => saved);
	const normalizeValue = vi.fn((value: unknown) => String(value).trim().toUpperCase());
	const setValue = vi.fn((row: CategoryRow, value: unknown) => {
		row.code = `CODE:${String(value)}`;
	});
	const collection: CategoryCollection = {
		titleKey: "Category.title",
		dataKey: "id",
		getKey: (row) => ({ id: row.id }),
		editMode: "inline",
		api: {
			list: async () => ({ rows: [], agg: { tot_count: 0 } }),
			create,
			detail,
		},
		createRow: () => ({
			id: 0,
			name: "",
			quantity: 1,
			active: false,
			started_at: null,
			status: "pending",
			code: "",
			internal_note: "Not offered for creation",
		}),
		columns: [
			{ field: "id", headerKey: "id", editable: false, dataType: "number" },
			{
				field: "name",
				headerKey: "Category.fields.name",
				editable: true,
				dataType: "string",
				normalizeValue,
				setValue,
			},
			{ field: "quantity", headerKey: "quantity", header: "Quantity", editable: true, dataType: "number" },
			{ field: "active", headerKey: "active", header: "Active", editable: true, dataType: "boolean" },
			{ field: "started_at", headerKey: "started_at", header: "Start date", editable: true, dataType: "date" },
			{
				field: "status",
				headerKey: "status",
				header: "Status",
				editable: true,
				dataType: "enum",
				enumOptions: [
					{ value: "active", labelKey: "CategoryStatus.active" },
					{ value: "pending", labelKey: "CategoryStatus.pending" },
				],
			},
			{ field: "code", headerKey: "code", header: "Code", editable: true, dataType: "string" },
			{
				field: "internal_note",
				headerKey: "internal_note",
				editable: true,
				createEditable: false,
				dataType: "string",
			},
		],
	};
	const createAction: ReferenceCreateAction<CategoryRow> = { mode: "dialog", collection: () => collection };
	const reference = defineCrudReference<CategoryRow, CategoryKey>({
		list: async () => [],
		detail,
		keyField: "id",
		searchField: "name",
		descrFields: ["name"],
		create: createAction,
	});
	return { collection, createAction, reference, create, detail, normalizeValue, setValue, saved };
};

const creationButton = (wrapper: VueWrapper) => wrapper.find('button[title="Create new"]');
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const creationForm = () => dialog().querySelector("form") as HTMLFormElement;
const submitCreation = async () => {
	creationForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	await flushPromises();
};

const typedReferenceHost = (fixture: ReturnType<typeof categoryFixture>, initialValue: number | null = null) => {
	const selected = reactive<{ category_id: number | null }>({ category_id: initialValue });
	fixture.reference.autocomplete.delay = 0;
	const Host = defineComponent({
		setup: () => () => h(ReferenceKeyInput, {
			reference: fixture.reference,
			modelValue: selected.category_id,
			projectedValue: selected.category_id === 1 ? oldReference : undefined,
			"onUpdate:modelValue": (value: number | null) => {
				selected.category_id = value;
			},
		}),
	});
	return { Host, selected };
};

const typeAndBlur = async (wrapper: VueWrapper, text: string) => {
	const input = wrapper.find(".crud-reference-input-field input");
	(input.element as HTMLInputElement).focus();
	(input.element as HTMLInputElement).value = text;
	await input.trigger("input");
	await flushPromises();
	await input.trigger("keydown", { key: "Tab" });
	await input.trigger("change");
	(input.element as HTMLInputElement).blur();
	await flushPromises();
	return input;
};

afterEach(() => {
	for (const wrapper of mounted.splice(0)) {
		wrapper.unmount();
	}
	document.body.innerHTML = "";
	window.sessionStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("reference creation components", () => {
	it("hides Create new unless a creation action is configured, including key wrappers", async () => {
		const { wrapper } = await mountSubject(ReferenceInput, { autocomplete, modelValue: oldReference });
		expect(creationButton(wrapper).exists()).toBe(false);
		const fixture = categoryFixture();
		const { create: _create, ...reference } = fixture.reference;
		void _create;
		const keyInput = await mountSubject(ReferenceKeyInput, { reference, modelValue: null });
		expect(creationButton(keyInput.wrapper).exists()).toBe(false);
	});

	it("honors showCreate and both input-level and action-level disabled settings", async () => {
		const fixture = categoryFixture();
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: fixture.createAction,
			showCreate: false,
		});
		expect(creationButton(wrapper).exists()).toBe(false);
		await wrapper.setProps({ showCreate: true, disabled: true });
		expect((creationButton(wrapper).element as HTMLButtonElement).disabled).toBe(true);
		await creationButton(wrapper).trigger("click");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await wrapper.setProps({ disabled: false, createAction: { ...fixture.createAction, disabled: true } });
		expect((creationButton(wrapper).element as HTMLButtonElement).disabled).toBe(true);
		await wrapper.setProps({ createAction: fixture.createAction });
		expect((creationButton(wrapper).element as HTMLButtonElement).disabled).toBe(false);
	});

	it("opens creation without submitting the enclosing form and cancellation preserves its selection", async () => {
		const fixture = categoryFixture();
		const parentSubmit = vi.fn();
		const Host = defineComponent({
			setup: () => () => h("form", {
				onSubmit: (event: Event) => {
					event.preventDefault();
					parentSubmit();
				},
			}, [h(ReferenceInput, {
				autocomplete,
				modelValue: oldReference,
				createAction: fixture.createAction,
			})]),
		});
		const { wrapper } = await mountSubject(Host);
		expect(creationButton(wrapper).attributes("type")).toBe("button");
		(creationButton(wrapper).element as HTMLButtonElement).click();
		await flushPromises();
		expect(parentSubmit).not.toHaveBeenCalled();
		expect(dialog()).toBeTruthy();
		expect(wrapper.element.contains(creationForm())).toBe(false);
		const cancel = Array.from(dialog().querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
		cancel.click();
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(wrapper.findComponent(ReferenceInput).emitted("update:modelValue")).toBeUndefined();
		expect(fixture.create).not.toHaveBeenCalled();
		expect(parentSubmit).not.toHaveBeenCalled();
	});

	it("renders creation fields using shared typed editors, labels, normalization, and dependent-field hooks", async () => {
		const fixture = categoryFixture();
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: fixture.createAction,
			modelValue: oldReference,
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const form = wrapper.findComponent(CollectionCreateForm);
		expect(form.exists()).toBe(true);
		expect(form.findAllComponents(GridFieldEditor).map((editor) => editor.props("column").field)).toEqual([
			"name", "quantity", "active", "started_at", "status", "code",
		]);
		expect(dialog().textContent).toContain("Name");
		expect(dialog().querySelector('[id$="-quantity"]')?.getAttribute("data-control")).toBe("InputNumber");
		expect(dialog().querySelector('[id$="-active"]')?.getAttribute("data-control")).toBe("Checkbox");
		expect(dialog().querySelector('[id$="-started_at"]')?.getAttribute("data-control")).toBe("DatePicker");
		expect(dialog().querySelector('[id$="-status"]')?.textContent).toContain("Pending");
		await form.find('input[id$="-name"]').setValue("  typed name  ");
		await form.find('input[id$="-quantity"]').setValue("7");
		await form.find('select[id$="-status"]').setValue("active");
		await flushPromises();
		expect(fixture.normalizeValue).toHaveBeenCalled();
		expect(fixture.setValue).toHaveBeenCalledWith(expect.objectContaining({ name: "TYPED NAME" }), "TYPED NAME");
		expect((form.find('input[id$="-code"]').element as HTMLInputElement).value).toBe("CODE:TYPED NAME");
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({
			name: "TYPED NAME",
			quantity: 7,
			status: "active",
			code: "CODE:TYPED NAME",
		}));
		expect(fixture.create.mock.calls[0]![0]).not.toHaveProperty("id");
		expect(fixture.create.mock.calls[0]![0]).not.toHaveProperty("internal_note");
		expect(fixture.detail).toHaveBeenCalledWith({ id: 42 });
		expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
			{ keys: { id: 42 }, descr: "Server canonical name" },
		]);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("selects the authoritative saved detail through ReferenceKeyInput without saving the parent", async () => {
		const fixture = categoryFixture();
		const parentSubmit = vi.fn();
		const selected = reactive({ category_id: 1 });
		const Host = defineComponent({
			setup: () => () => h("form", { onSubmit: parentSubmit }, [h(ReferenceKeyInput, {
				reference: fixture.reference,
				modelValue: selected.category_id,
				projectedValue: oldReference,
				"onUpdate:modelValue": (value: number | null) => {
					selected.category_id = value ?? 0;
				},
			})]),
		});
		const { wrapper } = await mountSubject(Host);
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(selected.category_id).toBe(42);
		expect((wrapper.find('[data-control="AutoComplete"]').element as HTMLInputElement).value).toBe("Server canonical name");
		expect(parentSubmit).not.toHaveBeenCalled();
		expect(fixture.create).toHaveBeenCalledTimes(1);
	});

	it("runs the grid's reference normalization and setValue hooks on its draft without submitting the row", async () => {
		const fixture = categoryFixture();
		const row = reactive({ category_id: 1, category_ref: oldReference, dependent: "before" });
		const setValue = vi.fn((draft: typeof row, value: unknown) => {
			draft.dependent = `category:${String(value)}`;
		});
		const column: GridColumn<typeof row> = {
			field: "category_id",
			headerKey: "category_id",
			editable: true,
			dataType: "reference",
			reference: fixture.reference,
			referenceField: "category_ref",
			normalizeValue: (value) => Number(value),
			setValue,
		};
		const parentSubmit = vi.fn();
		const Host = defineComponent({
			setup: () => () => h("form", { onSubmit: parentSubmit }, [h(GridFieldEditor, {
				column,
				row,
				modelValue: row.category_id,
				projectedValue: row.category_ref,
				"onUpdate:modelValue": (value: unknown) => applyGridInlineValue(row, column, value),
			})]),
		});
		const { wrapper } = await mountSubject(Host);
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(row.category_id).toBe(42);
		expect(row.dependent).toBe("category:42");
		expect(setValue).toHaveBeenCalledTimes(1);
		expect(parentSubmit).not.toHaveBeenCalled();
	});

	it("keeps a dirty parent dirty after the child save, and marks a clean parent dirty when the reference changes", async () => {
		const fixture = categoryFixture();
		const selected = reactive({ category_id: 1 });
		const globalSuccess = vi.fn();
		window.addEventListener(collectionFormSubmitSuccessEvent, globalSuccess);
		const Host = defineComponent({
			setup: () => () => h(CollectionDirtyGuard, {}, {
				default: () => h("form", [h(ReferenceKeyInput, {
					reference: fixture.reference,
					modelValue: selected.category_id,
					projectedValue: oldReference,
					"onUpdate:modelValue": (value: number | null) => {
						selected.category_id = value ?? 0;
					},
				})]),
			}),
		});
		const { wrapper } = await mountSubject(Host);
		const guard = wrapper.findComponent(CollectionDirtyGuard);
		expect((guard.vm as unknown as { dirty: boolean }).dirty).toBe(false);
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const form = wrapper.findComponent(CollectionCreateForm);
		await form.find('input[id$="-name"]').setValue("child change");
		expect((guard.vm as unknown as { dirty: boolean }).dirty).toBe(false);
		await submitCreation();
		expect((guard.vm as unknown as { dirty: boolean }).dirty).toBe(true);
		expect(globalSuccess).not.toHaveBeenCalled();
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect((guard.vm as unknown as { dirty: boolean }).dirty).toBe(true);
		window.removeEventListener(collectionFormSubmitSuccessEvent, globalSuccess);
	});

	it("offers retry after detail loading fails without issuing another create request", async () => {
		const fixture = categoryFixture();
		fixture.detail.mockRejectedValueOnce(new Error("Detail temporarily unavailable"));
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			modelValue: oldReference,
			createAction: fixture.createAction,
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledTimes(1);
		expect(dialog().textContent).toContain("Detail temporarily unavailable");
		expect(wrapper.emitted("update:modelValue")).toBeUndefined();
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).disabled).toBe(true);
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledTimes(1);
		expect(fixture.detail).toHaveBeenCalledTimes(2);
		expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
			{ keys: { id: 42 }, descr: "Server canonical name" },
		]);
	});

	it("shows field validation before creating and clears it when the user corrects the field", async () => {
		const fixture = categoryFixture();
		fixture.collection.createSchema = v.object({
			name: v.pipe(v.string(), v.minLength(1, "Name is required")),
			quantity: v.number(),
			active: v.boolean(),
			started_at: v.nullable(v.date()),
			status: v.string(),
			code: v.string(),
		});
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: fixture.createAction,
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(fixture.create).not.toHaveBeenCalled();
		expect(dialog().textContent).toContain("Name is required");
		const form = wrapper.findComponent(CollectionCreateForm);
		expect(form.findAllComponents(GridFieldEditor).find((editor) => editor.props("column").field === "name")?.props("invalid")).toBe(true);
		await form.find('input[id$="-name"]').setValue("valid name");
		await flushPromises();
		expect(dialog().textContent).not.toContain("Name is required");
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledTimes(1);
	});

	it("disables cancellation and editors while saving and ignores a duplicate submit", async () => {
		const fixture = categoryFixture();
		let resolveCreate!: (key: CategoryKey) => void;
		fixture.create.mockImplementationOnce(() => new Promise<CategoryKey>((resolve) => {
			resolveCreate = resolve;
		}));
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: fixture.createAction,
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledTimes(1);
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).disabled).toBe(true);
		const cancel = Array.from(dialog().querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
		expect(cancel.disabled).toBe(true);
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledTimes(1);
		resolveCreate({ id: fixture.saved.id });
		await flushPromises();
		expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("uses reusable custom editors and ordinary reference editors in generated forms", async () => {
		const fixture = categoryFixture();
		const CustomEditor = defineComponent({
			props: { modelValue: String, disabled: Boolean },
			emits: ["update:modelValue"],
			setup: (props, { emit }) => () => h("textarea", {
				"data-control": "CustomEditor",
				value: props.modelValue,
				disabled: props.disabled,
				onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
			}),
		});
		fixture.collection.columns.find((column) => column.field === "code")!.editorComponent = CustomEditor;
		const quantity = fixture.collection.columns.find((column) => column.field === "quantity")!;
		quantity.dataType = "reference";
		quantity.reference = defineCrudReference<{ id: number; name: string }, CategoryKey>({
			list: async () => [],
			detail: async ({ id }) => ({ id, name: "Unit" }),
			keyField: "id",
			searchField: "name",
			descrFields: ["name"],
		});
		const { wrapper } = await mountSubject(ReferenceInput, { autocomplete, createAction: fixture.createAction });
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const form = wrapper.findComponent(CollectionCreateForm);
		expect(form.findComponent(ReferenceKeyInput).exists()).toBe(true);
		expect(creationButton(form).exists()).toBe(false);
		await form.find('[data-control="CustomEditor"]').setValue("CUSTOM");
		await flushPromises();
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ code: "CUSTOM" }));
	});

	it("uses rowFromDetail when creation and autocomplete detail projections differ", async () => {
		const fixture = categoryFixture();
		fixture.collection.loadCreated = async () => ({ ...fixture.saved, name: "Unadapted" });
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: {
				...fixture.createAction,
				rowFromDetail: (detail: object) => ({ ...(detail as CategoryRow), name: "Adapted description" }),
			},
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
			{ keys: { id: 42 }, descr: "Adapted description" },
		]);
	});

	it("rejects dialog detail whose key differs from the key returned by create", async () => {
		const fixture = categoryFixture();
		fixture.detail.mockResolvedValueOnce({ ...fixture.saved, id: 999 });
		const { wrapper } = await mountSubject(ReferenceInput, { autocomplete, createAction: fixture.createAction });
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledTimes(1);
		expect(wrapper.emitted("update:modelValue")).toBeUndefined();
		expect(dialog().textContent).toContain(en.Reference.create.invalidResult);
	});

	it("maps API creation keys to the reference's keys before selecting a dialog result", async () => {
		const fixture = categoryFixture();
		const keysFromCreated = vi.fn((key: unknown) => ({ category_id: (key as CategoryKey).id }));
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete: { keyFields: ["category_id"], descrFields: ["name"], rows: [] },
			createAction: {
				...fixture.createAction,
				keysFromCreated,
				rowFromDetail: (detail: object) => ({
					category_id: (detail as CategoryRow).id,
					name: (detail as CategoryRow).name,
				}),
			},
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		await submitCreation();
		expect(keysFromCreated).toHaveBeenCalledWith({ id: 42 });
		expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
			{ keys: { category_id: 42 }, descr: "Server canonical name" },
		]);
	});
});

describe("reference creation page transport", () => {
	it("rejects a page result whose detail key differs from the returned creation key", async () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: { mode: "page", route: { name: "CategoryCreate" } },
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const token = new URL(String(open.mock.calls[0]![0]), window.location.origin).searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		window.dispatchEvent(new MessageEvent("message", {
			origin: window.location.origin,
			data: makeReferenceCreationMessage(token, { id: 42 }, { ...categoryFixture().saved, id: 999 }),
		}));
		await flushPromises();
		expect(wrapper.emitted("update:modelValue")).toBeUndefined();
		expect(wrapper.text()).toContain(en.Reference.create.invalidResult);
		expect(wrapper.text()).toContain("Retry selection");
	});

	it("maps a page's returned API key to the autocomplete key fields", async () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const keysFromCreated = vi.fn((key: unknown) => ({ category_id: (key as CategoryKey).id }));
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete: { keyFields: ["category_id"], descrFields: ["name"], rows: [] },
			createAction: {
				mode: "page",
				route: { name: "CategoryCreate" },
				keysFromCreated,
				rowFromDetail: (detail: object) => ({
					category_id: (detail as CategoryRow).id,
					name: (detail as CategoryRow).name,
				}),
			},
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const token = new URL(String(open.mock.calls[0]![0]), window.location.origin).searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		window.dispatchEvent(new MessageEvent("message", {
			origin: window.location.origin,
			data: makeReferenceCreationMessage(token, { id: 42 }, categoryFixture().saved),
		}));
		await flushPromises();
		expect(keysFromCreated).toHaveBeenCalledWith({ id: 42 });
		expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
			{ keys: { category_id: 42 }, descr: "Server canonical name" },
		]);
	});

	it.each(["clear", "type"])("abandons a pending creation session when the user chooses to %s", async (action) => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			modelValue: oldReference,
			createAction: { mode: "page", route: { name: "CategoryCreate" } },
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const token = new URL(String(open.mock.calls[0]![0]), window.location.origin).searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		if (action === "clear") {
			await wrapper.find('button[title="Clear"]').trigger("click");
		} else {
			wrapper.findComponent(AutoCompleteStub).vm.$emit("update:modelValue", "a different choice");
			await flushPromises();
		}
		expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
		expect((creationButton(wrapper).element as HTMLButtonElement).disabled).toBe(false);
		window.dispatchEvent(new MessageEvent("message", {
			origin: window.location.origin,
			data: makeReferenceCreationMessage(token, { id: 42 }, categoryFixture().saved),
		}));
		await flushPromises();
		expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
	});

	it.each(["clear", "select"])("resets a failed return's retry state after the user chooses to %s", async (action) => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			modelValue: oldReference,
			createAction: { mode: "page", route: { name: "CategoryCreate" } },
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const token = new URL(String(open.mock.calls[0]![0]), window.location.origin).searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		window.dispatchEvent(new MessageEvent("message", {
			origin: window.location.origin,
			data: makeReferenceCreationMessage(token, { id: 42 }, { ...categoryFixture().saved, id: 999 }),
		}));
		await flushPromises();
		expect(wrapper.text()).toContain("Retry selection");
		if (action === "clear") {
			await wrapper.find('button[title="Clear"]').trigger("click");
		} else {
			wrapper.findComponent(AutoCompleteStub).vm.$emit("item-select", {
				value: {
					keys: { id: 77 },
					descr: "Manual category",
					__row: { ...categoryFixture().saved, id: 77, name: "Manual category" },
				},
			});
			await flushPromises();
		}
		expect(wrapper.text()).not.toContain("Retry selection");
		expect(wrapper.text()).not.toContain(en.Reference.create.invalidResult);
		expect((creationButton(wrapper).element as HTMLButtonElement).disabled).toBe(false);
		expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
	});

	it("uses unique creation tokens and accepts only a same-origin message correlated with its own session", async () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const createAction = { mode: "page", route: { name: "CategoryCreate", query: { source: "reference" }, hash: "#details" } };
		const first = await mountSubject(ReferenceInput, { autocomplete, createAction, modelValue: oldReference });
		const second = await mountSubject(ReferenceInput, { autocomplete, createAction, modelValue: oldReference });
		await creationButton(first.wrapper).trigger("click");
		await creationButton(second.wrapper).trigger("click");
		await flushPromises();
		expect(open).toHaveBeenCalledTimes(2);
		const firstUrl = new URL(String(open.mock.calls[0]![0]), window.location.origin);
		const secondUrl = new URL(String(open.mock.calls[1]![0]), window.location.origin);
		const firstToken = firstUrl.searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		const secondToken = secondUrl.searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		expect(firstToken).toBeTruthy();
		expect(secondToken).not.toBe(firstToken);
		expect(firstUrl.searchParams.get("source")).toBe("reference");
		expect(firstUrl.hash).toBe("#details");
		expect(first.router.currentRoute.value.path).toBe("/parent");
		const fixture = categoryFixture();
		const emitMessage = (token: string, origin = window.location.origin) => {
			window.dispatchEvent(new MessageEvent("message", {
				origin,
				data: makeReferenceCreationMessage(token, { id: 42 }, fixture.saved),
			}));
		};
		emitMessage("unknown-session");
		emitMessage(firstToken, "https://untrusted.example");
		expect(first.wrapper.emitted("update:modelValue")).toBeUndefined();
		emitMessage(firstToken);
		await flushPromises();
		expect(first.wrapper.emitted("update:modelValue")).toHaveLength(1);
		expect(second.wrapper.emitted("update:modelValue")).toBeUndefined();
		emitMessage(firstToken);
		expect(first.wrapper.emitted("update:modelValue")).toHaveLength(1);
		emitMessage(secondToken);
		await flushPromises();
		expect(second.wrapper.emitted("update:modelValue")).toHaveLength(1);
	});

	it("accepts a correlated BroadcastChannel result and closes the channel after selection", async () => {
		class TestChannel {
			static channels: TestChannel[] = [];
			name: string;
			onmessage: ((event: MessageEvent) => void) | null = null;
			close = vi.fn();
			constructor(name: string) {
				this.name = name;
				TestChannel.channels.push(this);
			}
		}
		vi.stubGlobal("BroadcastChannel", TestChannel);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			createAction: { mode: "page", route: { name: "CategoryCreate" } },
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const token = new URL(String(open.mock.calls[0]![0]), window.location.origin).searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		const channel = TestChannel.channels[0]!;
		expect(channel.name).toBe(referenceCreationChannelName(token));
		const fixture = categoryFixture();
		channel.onmessage?.(new MessageEvent("message", {
			data: makeReferenceCreationMessage("other-session", { id: 42 }, fixture.saved),
		}));
		expect(wrapper.emitted("update:modelValue")).toBeUndefined();
		channel.onmessage?.(new MessageEvent("message", {
			data: makeReferenceCreationMessage(token, { id: 42 }, fixture.saved),
		}));
		await flushPromises();
		expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([
			{ keys: { id: 42 }, descr: "Server canonical name" },
		]);
		expect(channel.close).toHaveBeenCalledTimes(1);
	});

	it("cleans up a blocked popup and accepts no later creation message", async () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const { wrapper } = await mountSubject(ReferenceInput, {
			autocomplete,
			modelValue: oldReference,
			createAction: { mode: "page", route: { name: "CategoryCreate" } },
		});
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const token = new URL(String(open.mock.calls[0]![0]), window.location.origin).searchParams.get(REFERENCE_CREATION_QUERY_PARAM)!;
		window.dispatchEvent(new MessageEvent("message", {
			origin: window.location.origin,
			data: makeReferenceCreationMessage(token, { id: 42 }, categoryFixture().saved),
		}));
		expect(wrapper.emitted("update:modelValue")).toBeUndefined();
	});
});

describe("typed reference creation prefill", () => {
	it.each(["null", "keyless"])("discards remembered genuine typing when the parent externally replaces its model with %s", async (replacement) => {
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		fixture.createAction.prefill = prefill;
		const parent = reactive<{ value: ReferenceValue<CategoryKey> | null }>({ value: null });
		const Host = defineComponent({
			setup: () => () => h(ReferenceInput, {
				autocomplete: { ...autocomplete, forceSelection: true, delay: 0 },
				modelValue: parent.value,
				createAction: fixture.createAction,
				"onUpdate:modelValue": (value: ReferenceValue<CategoryKey> | null) => {
					parent.value = value;
				},
			}),
		});
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		const input = wrapper.find(".crud-reference-input-field input");
		(input.element as HTMLInputElement).focus();
		(input.element as HTMLInputElement).value = "Earlier genuine typing";
		await input.trigger("input");
		await flushPromises();
		expect(parent.value).toEqual({ keys: null, descr: "Earlier genuine typing" });
		parent.value = replacement === "null" ? null : { keys: null, descr: "External draft replacement" };
		await flushPromises();
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill).not.toHaveBeenCalled();
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("");
	});

	it("prefills from genuine unmatched input after forceSelection clears it and allows correcting the creation draft", async () => {
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text.trim() }));
		fixture.createAction.prefill = prefill;
		const { Host, selected } = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		expect(wrapper.findComponent(AutoComplete).exists()).toBe(true);
		const input = await typeAndBlur(wrapper, "  Newly typed category  ");
		expect(selected.category_id).toBeNull();
		expect((input.element as HTMLInputElement).value).toBe("");
		(creationButton(wrapper).element as HTMLButtonElement).focus();
		(creationButton(wrapper).element as HTMLButtonElement).click();
		await flushPromises();
		expect(prefill).toHaveBeenCalledExactlyOnceWith("  Newly typed category  ");
		const form = wrapper.findComponent(CollectionCreateForm);
		expect((form.find('input[id$="-name"]').element as HTMLInputElement).value).toBe("Newly typed category");
		await form.find('input[id$="-name"]').setValue("Corrected name");
		await flushPromises();
		await submitCreation();
		expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ name: "CORRECTED NAME" }));
		expect(selected.category_id).toBe(42);
	});

	it("retains typed defaults after cancelling a generated dialog", async () => {
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		fixture.createAction.prefill = prefill;
		const { Host } = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		await typeAndBlur(wrapper, "Keep this pending name");
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		const cancel = Array.from(dialog().querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
		cancel.click();
		await flushPromises();
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill.mock.calls).toEqual([["Keep this pending name"], ["Keep this pending name"]]);
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("Keep this pending name");
		expect(fixture.create).not.toHaveBeenCalled();
	});

	it("skips prefill for whitespace and an already selected existing reference", async () => {
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		fixture.createAction.prefill = prefill;
		const first = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(first.Host, {}, { realAutocomplete: true });
		await typeAndBlur(wrapper, "Erase this earlier draft");
		await typeAndBlur(wrapper, "   ");
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill).not.toHaveBeenCalled();
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("");
		Array.from(dialog().querySelectorAll("button")).find((button) => button.textContent === "Cancel")!.click();
		await flushPromises();
		wrapper.unmount();
		mounted.splice(mounted.indexOf(wrapper), 1);
		const existing = typedReferenceHost(fixture, 1);
		const second = await mountSubject(existing.Host, {}, { realAutocomplete: true });
		await creationButton(second.wrapper).trigger("click");
		await flushPromises();
		expect(prefill).not.toHaveBeenCalled();
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("");
	});

	it("discards the remembered text after explicit Clear even when forceSelection already cleared the visible input", async () => {
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		fixture.createAction.prefill = prefill;
		const { Host } = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		await typeAndBlur(wrapper, "Discard this name");
		const clear = wrapper.find('button[title="Clear"]');
		expect((clear.element as HTMLButtonElement).disabled).toBe(false);
		await clear.trigger("click");
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill).not.toHaveBeenCalled();
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("");
	});

	it("discards remembered text after an existing suggestion is selected", async () => {
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		fixture.createAction.prefill = prefill;
		const { Host, selected } = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		await typeAndBlur(wrapper, "Do not reuse this after selecting");
		const option = { ...oldReference, __row: { ...fixture.saved, id: 1, name: oldReference.descr } };
		const control = wrapper.findComponent(AutoComplete);
		control.vm.$emit("update:modelValue", option);
		control.vm.$emit("item-select", { value: option });
		await flushPromises();
		expect(selected.category_id).toBe(1);
		// Resetting the parent draft must not revive text typed before a successful
		// selection; only genuine new typing should supply a later creation seed.
		selected.category_id = null;
		await flushPromises();
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill).not.toHaveBeenCalled();
		expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("");
	});

	it("sends page defaults before opening and applies them once to an editable page model", async () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		fixture.reference.create = { mode: "page", route: { name: "CategoryCreate" }, prefill };
		let childStorage: [string, string][] = [];
		const open = vi.spyOn(window, "open").mockImplementation(() => {
			childStorage = Object.entries(window.sessionStorage);
			return { closed: false } as Window;
		});
		const { Host } = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		await typeAndBlur(wrapper, "Typed page category");
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill).toHaveBeenCalledExactlyOnceWith("Typed page category");
		expect(open).toHaveBeenCalledTimes(1);
		expect(childStorage.length).toBeGreaterThan(0);
		const url = new URL(String(open.mock.calls[0]![0]), window.location.origin);
		expect(url.href).not.toContain("Typed%20page%20category");
		expect(url.href).not.toContain("Typed+page+category");
		// An opener-created tab gets a cloned sessionStorage before window.open
		// returns; restore that clone to emulate the child tab in this jsdom window.
		window.sessionStorage.clear();
		for (const [key, value] of childStorage) {
			window.sessionStorage.setItem(key, value);
		}
		const model = reactive({ name: "", code: "PAGE_DEFAULT" });
		let receivedDefaults: Readonly<Record<string, unknown>> | undefined;
		let applyAgain!: () => void;
		const TargetPage = defineComponent({
			setup: () => {
				const creation = useReferenceCreation();
				receivedDefaults = creation.defaultValues;
				creation.applyDefaultValues(model);
				applyAgain = () => creation.applyDefaultValues(model);
				return () => h("input", {
					"data-test": "page-name",
					value: model.name,
					onInput: (event: Event) => {
						model.name = (event.target as HTMLInputElement).value;
					},
				});
			},
		});
		const child = await mountSubject(TargetPage, {}, { initialRoute: `${url.pathname}${url.search}${url.hash}` });
		expect(model.name).toBe("Typed page category");
		expect(model.code).toBe("PAGE_DEFAULT");
		expect(receivedDefaults).toEqual({ name: "Typed page category" });
		await child.wrapper.find('[data-test="page-name"]').setValue("Corrected page name");
		applyAgain();
		expect(model.name).toBe("Corrected page name");
	});

	it.each(["dialog", "page"])("shows a %s prefill failure without opening or submitting, and retries using the remembered input", async (mode) => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
		const fixture = categoryFixture();
		const prefill = vi.fn((text: string) => ({ name: text }));
		prefill.mockImplementationOnce(() => {
			throw new Error("Cannot map the typed category");
		});
		fixture.reference.create = mode === "dialog"
			? { ...fixture.createAction, prefill }
			: { mode: "page", route: { name: "CategoryCreate" }, prefill };
		const { Host } = typedReferenceHost(fixture);
		const { wrapper } = await mountSubject(Host, {}, { realAutocomplete: true });
		await typeAndBlur(wrapper, "Recover this name");
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("Cannot map the typed category");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(open).not.toHaveBeenCalled();
		expect(fixture.create).not.toHaveBeenCalled();
		await creationButton(wrapper).trigger("click");
		await flushPromises();
		expect(prefill.mock.calls).toEqual([["Recover this name"], ["Recover this name"]]);
		if (mode === "dialog") {
			expect((dialog().querySelector('input[id$="-name"]') as HTMLInputElement).value).toBe("Recover this name");
		} else {
			expect(open).toHaveBeenCalledTimes(1);
		}
	});
});
