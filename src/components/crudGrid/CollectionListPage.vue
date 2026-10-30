<script setup lang="ts" generic="TModel extends object, TKey, TNew, TUpd extends object, TDetailModel = TModel">
import { useI18n } from "vue-i18n";

import type { CollectionDefinition } from "../../types/collectionDefinition";
import CollectionGrid from "./CollectionGrid.vue";

const props = defineProps<{
	collection: CollectionDefinition<TModel, TKey, TNew, TUpd, TDetailModel>;
}>();

const { t } = useI18n();
</script>

<template>
	<section class="py-4">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<h3 class="text-2xl font-semibold">{{ t(props.collection.titleKey) }}</h3>
			<slot name="header" />
		</div>
		<CollectionGrid
			:api="props.collection.api"
			:columns="props.collection.columns"
			:commands="props.collection.commands"
			:dataKey="props.collection.dataKey"
			:getKey="props.collection.getKey"
			:editMode="props.collection.editMode ?? 'page'"
			:createRow="props.collection.createRow"
			:createModel="props.collection.createModel"
			:baseParams="props.collection.baseParams"
			:defaultSorter="props.collection.defaultSorter"
			:hierarchy="props.collection.hierarchy"
			:routes="props.collection.routes"
			:stateKey="props.collection.stateKey"
			:pageSize="props.collection.pageSize ?? 30"
			:infiniteScroll="props.collection.infiniteScroll"
			:showCommandShortcuts="props.collection.showCommandShortcuts ?? true"
		/>
	</section>
</template>
