import type {
	GridColumn,
	GridEnumOption,
} from "@katren/vue-collection-lib";

export const materialStatusOptions = [
	{
		value: "at_work",
		labelKey: "MaterialStatusType.at_work",
	},
	{
		value: "on_maintenance",
		labelKey: "MaterialStatusType.on_maintenance",
		disabled: false,
	},
] as const satisfies readonly GridEnumOption[];

export interface MaterialStatusRow {
	id: number;
	status: "at_work" | "on_maintenance";
}

export const materialStatusColumns: GridColumn<MaterialStatusRow>[] = [
	{
		field: "status",
		headerKey: "MaterialStatus.fields.status",
		sortable: true,
		editable: true,
		dataType: "enum",
		enumOptions: materialStatusOptions,
		editorProps: {
			showClear: false,
		},
	},
];
