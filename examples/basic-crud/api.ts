import {
	Conn,
	createCrudApi,
	transformJSON,
} from "@katren/vue-collection-lib";

import type {
	CategoryRow,
	Product,
	ProductDTO,
	ProductKey,
	ProductNew,
	ProductUpd,
} from "./types";

export const http = new Conn("/api", 30_000);

const fromProductDTO = (dto: ProductDTO): Product => {
	const transformed = transformJSON(dto);

	return {
		...transformed,
		price: Number(transformed.price),
	};
};

export const productApi = createCrudApi<
	Product,
	ProductDTO,
	Product,
	ProductDTO,
	ProductKey,
	ProductNew,
	ProductUpd
>({
	api: http,
	basePath: "/products",
	serviceName: "Product",
	getKeyValue: (key) => key.id,
	fromListDTO: fromProductDTO,
	fromDetailDTO: fromProductDTO,
});

export const categoryList = async (params?: Parameters<typeof productApi.list>[0]) => {
	return await http.get<{
		rows: CategoryRow[];
		agg: {
			tot_count: number;
		};
	}>("/categories", {
		...(params ? { params: JSON.stringify(params) } : {}),
	});
};
