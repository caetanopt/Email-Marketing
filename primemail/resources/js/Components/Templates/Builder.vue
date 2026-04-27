<script setup>
import { ref, computed, watch, h } from 'vue';
import { blockTypes, newBlock, blocksToMjml, defaultBlocks } from './blocks.js';

const props = defineProps({
    modelValue: { type: Array, default: () => [] },
    bodyBg:     { type: String, default: '#f5f7fa' },
});
const emit = defineEmits(['update:modelValue', 'mjml']);

// Working copy
const blocks   = ref(props.modelValue.length ? [...props.modelValue] : defaultBlocks());
const selected = ref(blocks.value[0]?.id ?? null);

const selectedBlock = computed(() => blocks.value.find((b) => b.id === selected.value) ?? null);
const selectedDef   = computed(() => selectedBlock.value ? blockTypes[selectedBlock.value.type] : null);

// Emit upwards on every change
watch(blocks, (val) => {
    emit('update:modelValue', val);
    emit('mjml', blocksToMjml(val, { bodyBg: props.bodyBg }));
}, { deep: true, immediate: true });

// ── Drag and Drop ─────────────────────────────────────────────────────────────
const dragData = ref(null);
const dropIdx  = ref(null);

function onPaletteDragStart(type, e) {
    dragData.value = { kind: 'add', payload: type };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', `add:${type}`);
}
function onBlockDragStart(id, e) {
    dragData.value = { kind: 'reorder', payload: id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `reorder:${id}`);
}
function onDropZoneOver(idx, e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragData.value?.kind === 'add' ? 'copy' : 'move';
    dropIdx.value = idx;
}
function onDropZoneLeave() {
    if (dropIdx.value !== null) dropIdx.value = null;
}
function onDrop(idx, e) {
    e.preventDefault();
    const data = dragData.value;
    if (!data) { dropIdx.value = null; return; }

    if (data.kind === 'add') {
        const block = newBlock(data.payload);
        blocks.value.splice(idx, 0, block);
        selected.value = block.id;
    } else if (data.kind === 'reorder') {
        const fromIdx = blocks.value.findIndex((b) => b.id === data.payload);
        if (fromIdx === -1) return;
        const adjusted = idx > fromIdx ? idx - 1 : idx;
        const [moved]  = blocks.value.splice(fromIdx, 1);
        blocks.value.splice(adjusted, 0, moved);
        selected.value = moved.id;
    }
    dragData.value = null;
    dropIdx.value  = null;
}

// ── Block actions ─────────────────────────────────────────────────────────────
function addBlock(type) {
    const b = newBlock(type);
    blocks.value.push(b);
    selected.value = b.id;
}
function deleteBlock(id) {
    const idx = blocks.value.findIndex((b) => b.id === id);
    if (idx === -1) return;
    blocks.value.splice(idx, 1);
    if (selected.value === id) selected.value = blocks.value[idx]?.id ?? blocks.value[idx - 1]?.id ?? null;
}
function duplicateBlock(id) {
    const idx = blocks.value.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const orig = blocks.value[idx];
    const copy = { id: `${Date.now()}-${Math.random()}`, type: orig.type, props: { ...orig.props } };
    blocks.value.splice(idx + 1, 0, copy);
    selected.value = copy.id;
}
function moveBlock(id, dir) {
    const idx = blocks.value.findIndex((b) => b.id === id);
    const newIdx = idx + dir;
    if (idx === -1 || newIdx < 0 || newIdx >= blocks.value.length) return;
    const [moved] = blocks.value.splice(idx, 1);
    blocks.value.splice(newIdx, 0, moved);
}
function updateProp(key, value) {
    if (!selectedBlock.value) return;
    selectedBlock.value.props[key] = value;
}

// ── In-canvas visual rendering for each block ─────────────────────────────────
function renderBlock(b) {
    const p = b.props;
    switch (b.type) {
        case 'header':
            return h('div', { style: { background: p.bgColor, color: p.textColor, fontSize: p.fontSize + 'px', fontWeight: p.fontWeight, textAlign: p.align, padding: p.padding + 'px' } }, p.text);
        case 'heading':
            return h('div', { style: { background: p.bgColor, color: p.color, fontSize: p.fontSize + 'px', fontWeight: p.fontWeight, textAlign: p.align, padding: p.padding } }, p.text);
        case 'text':
            return h('div', { style: { background: p.bgColor, color: p.color, fontSize: p.fontSize + 'px', lineHeight: p.lineHeight + 'px', textAlign: p.align, padding: p.padding, whiteSpace: 'pre-wrap' } }, p.text);
        case 'button':
            return h('div', { style: { background: p.sectionBg, padding: p.padding, textAlign: p.align } },
                h('span', { style: { display: 'inline-block', background: p.bgColor, color: p.color, padding: '12px 24px', borderRadius: p.radius + 'px', fontSize: p.fontSize + 'px', fontWeight: 600 } }, p.label));
        case 'image':
            return h('div', { style: { background: p.bgColor, padding: p.padding, textAlign: p.align } },
                h('img', { src: p.src, alt: p.alt, style: { maxWidth: p.width + 'px', width: '100%', display: 'inline-block' } }));
        case 'divider':
            return h('div', { style: { background: p.bgColor, padding: p.padding } },
                h('hr', { style: { border: 'none', borderTop: `${p.width}px solid ${p.color}`, margin: 0 } }));
        case 'spacer':
            return h('div', { style: { background: p.bgColor, height: p.height + 'px' } });
        case 'footer':
            return h('div', { style: { background: p.bgColor, color: p.color, fontSize: p.fontSize + 'px', textAlign: 'center', padding: p.padding + 'px' } }, [
                p.text,
                h('br'),
                h('a', { href: '#', style: { color: p.color, textDecoration: 'underline' } }, p.unsubText),
            ]);
        default:
            return h('div', {}, '');
    }
}

function blockClasses(b) {
    return [
        'group relative border-2 transition-all cursor-pointer',
        selected.value === b.id ? 'border-blue-500 shadow-md' : 'border-transparent hover:border-blue-200',
    ];
}
</script>

<template>
    <div class="grid grid-cols-[180px_1fr_260px] gap-3 h-full">

        <!-- ── Palette ─────────────────────────────────────────────── -->
        <aside class="bg-white border border-slate-200 rounded-xl p-3 overflow-y-auto">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Blocos</h4>
            <div class="grid grid-cols-2 gap-2">
                <button
                    v-for="(def, type) in blockTypes"
                    :key="type"
                    type="button"
                    draggable="true"
                    @dragstart="onPaletteDragStart(type, $event)"
                    @click="addBlock(type)"
                    class="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors cursor-grab active:cursor-grabbing"
                    :title="`Arrasta ou clica para adicionar — ${def.label}`"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" :d="def.icon" />
                    </svg>
                    <span class="text-[11px] font-medium">{{ def.label }}</span>
                </button>
            </div>
            <p class="mt-3 text-[10px] text-slate-400 leading-relaxed">
                Arrasta para o canvas ou clica para adicionar ao fim.
            </p>
        </aside>

        <!-- ── Canvas ─────────────────────────────────────────────── -->
        <div class="bg-slate-100 border border-slate-200 rounded-xl overflow-y-auto">
            <div class="max-w-[640px] mx-auto py-6 px-4">

                <!-- Drop zone at the top -->
                <div
                    @dragover="onDropZoneOver(0, $event)"
                    @dragleave="onDropZoneLeave"
                    @drop="onDrop(0, $event)"
                    :class="[
                        'rounded transition-all',
                        dropIdx === 0 ? 'h-10 bg-blue-100 border-2 border-dashed border-blue-400' : 'h-2'
                    ]"
                />

                <template v-for="(b, idx) in blocks" :key="b.id">
                    <!-- Block -->
                    <div
                        :class="blockClasses(b)"
                        draggable="true"
                        @dragstart="onBlockDragStart(b.id, $event)"
                        @click="selected = b.id"
                    >
                        <component :is="renderBlock(b)" />

                        <!-- Toolbar -->
                        <div
                            v-if="selected === b.id"
                            class="absolute -top-3 right-2 flex items-center gap-1 bg-white border border-slate-200 rounded-md shadow-sm px-1 py-0.5 z-10"
                            @click.stop
                        >
                            <button type="button" @click="moveBlock(b.id, -1)" :disabled="idx === 0"
                                    class="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30" title="Subir">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                                </svg>
                            </button>
                            <button type="button" @click="moveBlock(b.id, 1)" :disabled="idx === blocks.length - 1"
                                    class="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30" title="Descer">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                                </svg>
                            </button>
                            <button type="button" @click="duplicateBlock(b.id)"
                                    class="p-1 text-slate-500 hover:text-slate-900" title="Duplicar">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                </svg>
                            </button>
                            <button type="button" @click="deleteBlock(b.id)"
                                    class="p-1 text-red-500 hover:text-red-700" title="Eliminar">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Drop zone after this block -->
                    <div
                        @dragover="onDropZoneOver(idx + 1, $event)"
                        @dragleave="onDropZoneLeave"
                        @drop="onDrop(idx + 1, $event)"
                        :class="[
                            'rounded transition-all',
                            dropIdx === idx + 1 ? 'h-10 bg-blue-100 border-2 border-dashed border-blue-400' : 'h-2'
                        ]"
                    />
                </template>

                <!-- Empty state -->
                <div v-if="!blocks.length" class="text-center py-16 text-slate-400">
                    <svg class="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    <p class="text-sm">Arrasta blocos da palete para começar</p>
                </div>
            </div>
        </div>

        <!-- ── Property panel ────────────────────────────────────── -->
        <aside class="bg-white border border-slate-200 rounded-xl p-4 overflow-y-auto">
            <div v-if="selectedBlock">
                <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                    <h4 class="text-sm font-semibold text-slate-800">{{ selectedDef.label }}</h4>
                    <button type="button" @click="deleteBlock(selectedBlock.id)"
                            class="text-xs text-red-500 hover:text-red-700">Remover</button>
                </div>
                <div class="space-y-3">
                    <div v-for="field in selectedDef.schema" :key="field.key">
                        <label class="block text-xs font-medium text-slate-600 mb-1">{{ field.label }}</label>

                        <input
                            v-if="field.type === 'text'"
                            type="text"
                            :value="selectedBlock.props[field.key]"
                            @input="updateProp(field.key, $event.target.value)"
                            class="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />

                        <textarea
                            v-else-if="field.type === 'textarea'"
                            :value="selectedBlock.props[field.key]"
                            @input="updateProp(field.key, $event.target.value)"
                            rows="3"
                            class="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 resize-y"
                        />

                        <input
                            v-else-if="field.type === 'number'"
                            type="number"
                            :value="selectedBlock.props[field.key]"
                            @input="updateProp(field.key, Number($event.target.value))"
                            class="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />

                        <div v-else-if="field.type === 'color'" class="flex items-center gap-2">
                            <input
                                type="color"
                                :value="selectedBlock.props[field.key]"
                                @input="updateProp(field.key, $event.target.value)"
                                class="w-9 h-8 rounded border border-slate-200 cursor-pointer"
                            />
                            <input
                                type="text"
                                :value="selectedBlock.props[field.key]"
                                @input="updateProp(field.key, $event.target.value)"
                                class="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                            />
                        </div>

                        <select
                            v-else-if="field.type === 'select'"
                            :value="selectedBlock.props[field.key]"
                            @change="updateProp(field.key, isNaN(Number($event.target.value)) ? $event.target.value : Number($event.target.value))"
                            class="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                        >
                            <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                        </select>
                    </div>
                </div>
            </div>
            <div v-else class="text-center py-12 text-slate-400">
                <svg class="w-10 h-10 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                </svg>
                <p class="text-xs">Selecciona um bloco para editar.</p>
            </div>
        </aside>
    </div>
</template>
