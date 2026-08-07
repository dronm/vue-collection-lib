# Form composables

## useFormErrors

`useFormErrors()` keeps field-level and form-level errors in one place.

Use it in a parent form container and pass it to the form component:

```ts
const formErrors = useFormErrors();
```

```vue
<MyForm :errors="formErrors" />
```

In the form component:

```vue
<InputText
	v-model="form.name"
	:invalid="errors?.has('name')"
/>
<small v-if="errors?.has('name')">
	{{ errors.first('name') }}
</small>
```

`setFromError()` supports:

- `FieldValidationError` created by `utils/validation.ts`;
- API errors with `body.field_errors`, `body.fieldErrors`, or `body.errors`;
- ordinary `Error` objects.

## useCollectionFormSubmit

`useCollectionFormSubmit()` handles create/update submit logic:

- builds create payload;
- builds update payload with only changed fields;
- maps detail fields to submit fields;
- extracts reference keys via `useFormMutation()` mapping;
- validates with Valibot schemas;
- supports custom validation;
- writes errors to `useFormErrors()`.

For edit mode, call `setInitialModel(detail)` after loading the detail object.
This is what lets update submit send only changed fields.
