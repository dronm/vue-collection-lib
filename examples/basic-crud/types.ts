import type { ReferenceValue } from "@katren/vue-collection-lib";

export interface CategoryRow {
	id: number;
	name: string;
}

export type CategoryKey = {
	id: number;
};

export type CategoryReference = ReferenceValue<CategoryKey>;

export interface ProductDTO {
	id: number;
	name: string;
	price: number | string;
	active: boolean;
	category_ref: CategoryReference | null;
}

export interface Product {
	id: number;
	name: string;
	price: number;
	active: boolean;
	category_ref: CategoryReference | null;
}

export type ProductKey = {
	id: number;
};

export interface ProductNew {
	name: string;
	price: number;
	active: boolean;
	category_ref: CategoryKey | null;
}

export type ProductUpd = Partial<ProductNew>;
