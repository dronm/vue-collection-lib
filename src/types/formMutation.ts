import type {
	ReferenceKeys,
	ReferenceValue,
} from "./reference";

export type FormMutationFieldKind = "plain" | "reference";
export type ReferenceSubmitMode = "keys" | "key" | "value";

export interface ReferenceSubmitConfig {
	mode?: ReferenceSubmitMode;
	keyField?: string;
}

export interface FormMutationField<
	TDetail extends object,
	TSubmit extends object,
> {
	detailField: keyof TDetail & string;
	submitField?: keyof TSubmit & string;
	kind?: FormMutationFieldKind;
	reference?: ReferenceSubmitConfig;
	create?: boolean;
	update?: boolean;
	omitUndefined?: boolean;
	omitNull?: boolean;
	value?: (
		value: unknown,
		detail: TDetail,
	) => unknown;
	compare?: (
		left: unknown,
		right: unknown,
	) => boolean;
}

export type FormMutationFieldConfig<
	TDetail extends object,
	TSubmit extends object,
> = (keyof TDetail & string) | FormMutationField<TDetail, TSubmit>;

export interface UseFormMutationOptions<
	TDetail extends object,
	TCreate extends object,
	TUpdate extends object,
> {
	fields: FormMutationFieldConfig<TDetail, TCreate | TUpdate>[];
	clone?: <TValue>(value: TValue) => TValue;
}

export type ReferenceLike = ReferenceValue<ReferenceKeys> | null | undefined;
