export type { CollectionResponse } from "./collection";

export interface KeyedUpdate<TKey, TUpdate> {
	key: TKey;
	model: TUpdate;
}
