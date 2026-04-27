<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';
import TemplateBuilder from '@/Components/Templates/Builder.vue';
import { defaultBlocks } from '@/Components/Templates/blocks.js';

// CodeMirror 6
import { EditorView, basicSetup } from 'codemirror';
import { EditorState }            from '@codemirror/state';
import { xml }                    from '@codemirror/lang-xml';
import { oneDark }                from '@codemirror/theme-one-dark';

const props = defineProps({
    template:   { type: Object, default: null },
    isCreating: { type: Boolean, default: false },
});

// ── Mode ──────────────────────────────────────────────────────────────────────
// 'visual' = drag-and-drop builder, 'code' = direct MJML editing.
// If the template has builder_data we open in visual; otherwise in code.
const initialMode = props.template?.builder_data ? 'visual' : (props.isCreating ? 'visual' : 'code');
const mode = ref(initialMode);

const form = useForm({
    name:         props.template?.name         ?? '',
    description:  props.template?.description  ?? '',
    mjml_source:  props.template?.mjml_source  ?? '',
    content_text: props.template?.content_text ?? '',
    is_shared:    props.template?.is_shared    ?? false,
    builder_data: props.template?.builder_data ?? null,
});

// Initial blocks come from server, otherwise defaults for new templates.
const blocks = ref(props.template?.builder_data ?? (props.isCreating ? defaultBlocks() : []));

// When the visual builder updates, sync back into the form.
function onBuilderUpdate(newBlocks) {
    blocks.value        = newBlocks;
    form.builder_data   = newBlocks;
}
function onBuilderMjml(mjml) {
    if (mode.value !== 'visual') return;
    form.mjml_source = mjml;
}

// ── CodeMirror (code mode) ────────────────────────────────────────────────────
const editorEl  = ref(null);
let   cmView    = null;
let   skipWatch = false;

function mountEditor() {
    if (cmView || !editorEl.value) return;

    const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
            skipWatch = true;
            form.mjml_source = update.state.doc.toString();
            // If user edits MJML directly, builder data becomes stale → drop it.
            form.builder_data = null;
            skipWatch = false;
        }
    });

    cmView = new EditorView({
        state: EditorState.create({
            doc: form.mjml_source,
            extensions: [
                basicSetup,
                xml(),
                oneDark,
                updateListener,
                EditorView.lineWrapping,
            ],
        }),
        parent: editorEl.value,
    });
}
function unmountEditor() {
    cmView?.destroy();
    cmView = null;
}

watch(mode, async (m) => {
    if (m === 'code') {
        await nextTick();
        mountEditor();
    } else {
        unmountEditor();
    }
});

onMounted(() => {
    if (mode.value === 'code') mountEditor();
});
onBeforeUnmount(() => {
    unmountEditor();
    clearTimeout(debounceTimer);
});

// Keep editor in sync when form value changes externally
watch(() => form.mjml_source, (val) => {
    if (skipWatch || !cmView) return;
    const current = cmView.state.doc.toString();
    if (current !== val) {
        cmView.dispatch({ changes: { from: 0, to: current.length, insert: val } });
    }
});

// ── Live preview (debounced) ──────────────────────────────────────────────────
const previewHtml  = ref('');
const previewError = ref(props.template?.compile_error ?? '');
const isCompiling  = ref(false);
let debounceTimer  = null;

watch(() => form.mjml_source, (mjml) => {
    previewError.value = '';
    clearTimeout(debounceTimer);
    if (!mjml || !mjml.trim()) return;

    debounceTimer = setTimeout(async () => {
        isCompiling.value = true;
        try {
            const res = await fetch(route('templates.preview'), {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                },
                body: JSON.stringify({ mjml }),
            });
            const json = await res.json();
            if (json.html) {
                previewHtml.value  = json.html;
                previewError.value = '';
            } else {
                previewError.value = json.error ?? 'Erro desconhecido.';
            }
        } catch {
            previewError.value = 'Erro de rede ao compilar preview.';
        } finally {
            isCompiling.value = false;
        }
    }, 600);
}, { immediate: true });

// ── Submit ────────────────────────────────────────────────────────────────────
const submit = () => {
    props.isCreating
        ? form.post(route('templates.store'))
        : form.put(route('templates.update', props.template.id));
};

// Switching from code → visual would let the visual state overwrite manual MJML
// edits, so warn the user before doing that.
function switchToVisual() {
    if (mode.value === 'visual') return;
    if (form.builder_data === null && form.mjml_source) {
        const ok = confirm('Mudar para o modo visual vai substituir o MJML actual pela estrutura dos blocos. Continuar?');
        if (!ok) return;
        // Reset to default blocks since we cannot reliably parse arbitrary MJML.
        blocks.value      = defaultBlocks();
        form.builder_data = blocks.value;
    }
    mode.value = 'visual';
}
function switchToCode() {
    mode.value = 'code';
}
</script>

<template>
    <AppLayout :title="isCreating ? 'Novo Template' : `Editar — ${template?.name}`">
        <form @submit.prevent="submit" class="h-full">
            <div class="flex flex-col gap-4 h-[calc(100vh-120px)]">

                <!-- ── Top bar: metadata + mode switcher ───────────── -->
                <div class="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-4">
                    <div class="flex-1 min-w-[200px]">
                        <label class="block text-xs font-medium text-slate-600 mb-1">Nome *</label>
                        <input v-model="form.name" type="text" required
                               :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900',
                                        form.errors.name ? 'border-red-400' : 'border-slate-200']" />
                    </div>
                    <div class="flex-1 min-w-[200px]">
                        <label class="block text-xs font-medium text-slate-600 mb-1">Descrição</label>
                        <input v-model="form.description" type="text"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                               placeholder="Para que serve este template?" />
                    </div>
                    <label class="flex items-center gap-2 cursor-pointer pb-2">
                        <input type="checkbox" v-model="form.is_shared" class="rounded border-slate-300" />
                        <span class="text-sm text-slate-700">Partilhado</span>
                    </label>

                    <!-- Mode tabs -->
                    <div class="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                        <button type="button" @click="switchToVisual"
                                :class="[
                                    'px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors',
                                    mode === 'visual' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                                ]">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/>
                            </svg>
                            Visual
                        </button>
                        <button type="button" @click="switchToCode"
                                :class="[
                                    'px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors',
                                    mode === 'code' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                                ]">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                            </svg>
                            MJML
                        </button>
                    </div>

                    <button type="submit" :disabled="form.processing"
                            class="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        {{ isCreating ? 'Criar Template' : 'Guardar' }}
                    </button>
                    <Link :href="route('templates.index')" class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">Cancelar</Link>
                </div>

                <!-- ── Editor area (mode-dependent) ────────────────── -->
                <div class="flex-1 min-h-0">

                    <!-- Visual builder fills the whole area (it has its own preview-like canvas) -->
                    <div v-show="mode === 'visual'" class="h-full">
                        <TemplateBuilder
                            :model-value="blocks"
                            @update:model-value="onBuilderUpdate"
                            @mjml="onBuilderMjml"
                        />
                    </div>

                    <!-- Code mode: editor + iframe preview side by side -->
                    <div v-show="mode === 'code'" class="grid grid-cols-2 gap-4 h-full">
                        <!-- Editor -->
                        <div class="bg-[#282c34] border border-slate-700 rounded-xl flex flex-col min-h-0 overflow-hidden">
                            <div class="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-[#21252b]">
                                <span class="text-xs font-mono font-semibold text-slate-300">MJML · XML</span>
                                <div>
                                    <span v-if="isCompiling" class="text-xs text-slate-400 flex items-center gap-1">
                                        <svg class="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                        </svg>
                                        A compilar…
                                    </span>
                                    <span v-else-if="previewError" class="text-xs text-red-400">Erro</span>
                                    <span v-else-if="previewHtml" class="text-xs text-green-400">Compilado</span>
                                </div>
                            </div>
                            <div ref="editorEl" class="flex-1 overflow-auto text-sm" />
                        </div>

                        <!-- Preview -->
                        <div class="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                            <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                                <div class="w-3 h-3 rounded-full bg-red-400"></div>
                                <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                                <div class="w-3 h-3 rounded-full bg-green-400"></div>
                                <span class="ml-2 text-xs text-slate-500 font-mono">preview</span>
                            </div>
                            <div class="flex-1 overflow-hidden">
                                <iframe v-if="previewHtml" :srcdoc="previewHtml" class="w-full h-full border-0" sandbox="allow-same-origin" title="Preview MJML" />
                                <div v-else-if="previewError" class="p-4 bg-red-50 text-xs text-red-700 font-mono whitespace-pre-wrap overflow-auto h-full">{{ previewError }}</div>
                                <div v-else class="flex items-center justify-center h-full text-slate-400 text-sm">O preview aparece aqui ao editar.</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Plain-text fallback -->
                <details class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <summary class="px-4 py-2.5 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50">
                        Texto plain-text (fallback opcional)
                    </summary>
                    <div class="p-4 border-t border-slate-100">
                        <textarea v-model="form.content_text" rows="3"
                                  class="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                                  placeholder="Versão plain-text para clientes sem suporte HTML" />
                    </div>
                </details>
            </div>
        </form>
    </AppLayout>
</template>

<style>
.cm-editor {
    height: 100%;
    font-size: 13px;
}
.cm-editor.cm-focused {
    outline: none;
}
.cm-scroller {
    font-family: 'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Menlo', monospace;
    line-height: 1.6;
}
</style>
