<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
  rows?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editorRef = ref<HTMLElement | null>(null)
const isFocused = ref(false)
const isEmpty = ref(true)

// Hauteur approximative selon rows (20px par ligne + padding)
const minHeight = `${((props.rows ?? 3) * 22) + 16}px`

function checkEmpty() {
  isEmpty.value = !editorRef.value?.innerText?.trim()
}

function onInput() {
  checkEmpty()
  emit('update:modelValue', editorRef.value?.innerHTML ?? '')
}

function exec(command: string, value?: string) {
  document.execCommand(command, false, value)
  editorRef.value?.focus()
  onInput()
}

// Sync modelValue → DOM (seulement si diff pour éviter le curseur qui saute)
watch(() => props.modelValue, (val) => {
  if (!editorRef.value) return
  if (editorRef.value.innerHTML !== val) {
    editorRef.value.innerHTML = val ?? ''
    checkEmpty()
  }
})

onMounted(async () => {
  await nextTick()
  if (editorRef.value && props.modelValue) {
    editorRef.value.innerHTML = props.modelValue
    checkEmpty()
  }
})
</script>

<template>
  <div class="rte-wrapper" :class="{ 'rte-focused': isFocused, 'rte-disabled': disabled }">

    <!-- Toolbar -->
    <div v-if="!disabled" class="rte-toolbar">
      <button type="button" @mousedown.prevent="exec('bold')" class="rte-btn" title="Gras (Ctrl+B)">
        <strong>B</strong>
      </button>
      <button type="button" @mousedown.prevent="exec('italic')" class="rte-btn" title="Italique (Ctrl+I)">
        <em>I</em>
      </button>
      <button type="button" @mousedown.prevent="exec('underline')" class="rte-btn" title="Souligné (Ctrl+U)">
        <u>S</u>
      </button>
      <div class="rte-sep"></div>
      <button type="button" @mousedown.prevent="exec('insertUnorderedList')" class="rte-btn" title="Liste à puces">
        ☰
      </button>
      <button type="button" @mousedown.prevent="exec('insertOrderedList')" class="rte-btn" title="Liste numérotée">
        1≡
      </button>
      <div class="rte-sep"></div>
      <button type="button" @mousedown.prevent="exec('removeFormat')" class="rte-btn rte-btn-clear" title="Effacer le formatage">
        ✕
      </button>
    </div>

    <!-- Zone éditable -->
    <div
      ref="editorRef"
      class="rte-content"
      :contenteditable="!disabled"
      :style="{ minHeight }"
      @input="onInput"
      @focus="isFocused = true"
      @blur="isFocused = false"
    ></div>

    <!-- Placeholder -->
    <div v-if="isEmpty && !disabled" class="rte-placeholder">{{ placeholder }}</div>
  </div>
</template>

<style scoped>
.rte-wrapper {
  border: 1.5px solid #e5e5e5;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
  transition: border-color 0.15s;
  position: relative;
}
.rte-wrapper.rte-focused {
  border-color: #E30613;
}
.rte-wrapper.rte-disabled {
  background: #f9f9f9;
}

/* Toolbar */
.rte-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
  flex-wrap: wrap;
}
.rte-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 13px;
  cursor: pointer;
  color: #444;
  line-height: 1.6;
  transition: background 0.1s, border-color 0.1s;
  min-width: 28px;
  text-align: center;
}
.rte-btn:hover {
  background: #e9ecef;
  border-color: #d0d0d0;
}
.rte-btn-clear {
  color: #888;
  font-size: 11px;
}
.rte-sep {
  width: 1px;
  height: 18px;
  background: #e0e0e0;
  margin: 0 3px;
}

/* Zone de saisie */
.rte-content {
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  color: #333;
  outline: none;
  line-height: 1.6;
  overflow-y: auto;
}
.rte-content:empty { min-height: inherit; }

/* Styles dans le contenu */
.rte-content :deep(ul) { padding-left: 20px; margin: 4px 0; }
.rte-content :deep(ol) { padding-left: 20px; margin: 4px 0; }
.rte-content :deep(li) { margin: 2px 0; }

/* Placeholder */
.rte-placeholder {
  position: absolute;
  top: calc(30px + 8px); /* toolbar height + padding */
  left: 12px;
  color: #bbb;
  font-size: 13px;
  pointer-events: none;
  line-height: 1.6;
}
.rte-wrapper.rte-disabled .rte-placeholder {
  top: 8px;
}
</style>
