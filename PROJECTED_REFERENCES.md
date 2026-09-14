# Projected references

`defineCrudReference().load(id, projectedValue)` accepts a reference object already
returned by a list or detail projection. A matching `{ keys, descr }` object is
used without a detail request and stored in the reference definition's cache.
Null/empty IDs remain empty. Missing, malformed, or mismatched projections use
the existing ID lookup fallback.

Pass the projected field to a key input:

```vue
<ReferenceKeyInput
	v-model="form.supplier_id"
	:projectedValue="form.supplier"
	:reference="supplierReference"
/>
```

`ReferenceKeyLabel` supports the same `projectedValue` prop. For grid columns:

```ts
const columns: GridColumn<ReceiptItem>[] = [
	{
		field: "material_id",
		headerKey: "MaterialReceiptItem.fields.material_id",
		dataType: "reference",
		reference: materialReference,
		referenceField: "material",
		editable: true,
	},
];
```

Both grid labels and inline editors receive the sibling projection. Keep these
fields in DTO parsing and form copies. The grid still writes the ID field;
`referenceField` is not added to mutation payloads. Selected autocomplete values
are cached so subsequent labels can reuse their descriptions after an ID change.

This is backward compatible for ID-only callers. Custom reference definitions
implementing their own `load` should honor the optional second argument if they
want projection support. Definitions created with `defineCrudReference` support
it automatically. Autocomplete searches on user interaction remain enabled.

Apply the accompanying application changes together with this library source.
For a workspace dependency, replace the local library source and restart Vite
with `--force` to clear its dependency cache. For registry dependencies, publish
the library under a new version and update the application dependency first.
