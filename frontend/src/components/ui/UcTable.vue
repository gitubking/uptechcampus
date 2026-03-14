<template>
  <div class="uc-table-wrap">
    <table class="uc-table">
      <thead>
        <tr>
          <th
            v-for="col in cols"
            :key="col.key"
            :style="col.align ? ({ textAlign: col.align } as any) : {}"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!data || data.length === 0">
          <td :colspan="cols.length" style="text-align:center;padding:24px;color:#aaa;font-size:13px;">
            {{ emptyText }}
          </td>
        </tr>
        <tr v-for="(item, index) in data" :key="index">
          <slot name="row" :item="item" :index="index" />
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  cols: { key: string; label: string; align?: string }[]
  data: any[]
  emptyText?: string
}>(), {
  emptyText: 'Aucune donnée',
})
</script>
