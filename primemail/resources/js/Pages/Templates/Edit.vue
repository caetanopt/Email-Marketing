<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

// CodeMirror 6
import { EditorView, basicSetup } from 'codemirror';
import { EditorState }            from '@codemirror/state';
import { xml }                    from '@codemirror/lang-xml';
import { oneDark }                from '@codemirror/theme-one-dark';

const props = defineProps({
    template:   { type: Object, default: null },
    isCreating: { type: Boolean, default: false },
});

const form = useForm({
    name:         props.template?.name         ?? '',
    description:  props.template?.description  ?? '',
    mjml_source:  props.template?.mjml_source  ?? defaultMjml(),
    content_text: props.template?.content_text ?? '',
    is_shared:    props.template?.is_shared    ?? false,
});

// ── CodeMirror ────────────────────────────────────────────────────────────────
const editorEl  = ref(null);
let   cmView    = null;
let   skipWatch = false;

onMounted(() => {
    const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
            skipWatch = true;
            form.mjml_source = update.state.doc.toString();
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
});

onBeforeUnmount(() => cmView?.destroy());

// Keep editor in sync when form value changes externally
watch(() => form.mjml_source, (val) => {
    if (skipWatch || !cmView) return;
    const current = cmView.state.doc.toString();
    if (current !== val) {
        cmView.dispatch({
            changes: { from: 0, to: current.length, insert: val },
        });
    }
});

// ── Live preview ──────────────────────────────────────────────────────────────
const previewHtml  = ref('');
const previewError = ref(props.template?.compile_error ?? '');
const isCompiling  = ref(false);
let debounceTimer  = null;

watch(() => form.mjml_source, (mjml) => {
    previewError.value = '';
    clearTimeout(debounceTimer);
    if (!mjml.trim()) return;

    debounceTimer = setTimeout(async () => {
        isCompiling.value = true;
        try {
            const res  = await fetch(route('templates.preview'), {
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
});

// ── Submit ────────────────────────────────────────────────────────────────────
const submit = () => {
    props.isCreating
        ? form.post(route('templates.store'))
        : form.put(route('templates.update', props.template.id));
};

function defaultMjml() {
    return `<mjml>
  <mj-head>
    <mj-title>{{ subject }}</mj-title>
    <mj-preview>{{ preview_text }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f7fa">
    <mj-section background-color="#1A1A2E" padding="24px">
      <mj-column>
        <mj-text color="#ffffff" font-size="20px" font-weight="700" align="center">
          {{ brand_name }}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#ffffff" padding="32px 24px">
      <mj-column>
        <mj-text font-size="24px" font-weight="700" color="#1A1A2E">
          Olá {{ first_name }},
        </mj-text>
        <mj-text>
          Escreve aqui o teu conteúdo...
        </mj-text>
        <mj-button background-color="#1A1A2E" href="{{ cta_url }}">
          {{ cta_label }}
        </mj-button>
      </mj-column>
    </mj-section>

    <mj-section background-color="#1A1A2E" padding="16px">
      <mj-column>
        <mj-text color="#8b949e" font-size="11px" align="center">
          <a href="{{ unsubscribe_url }}" style="color:#8b949e">Cancelar subscrição</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
</script>

<template>
    <AppLayout :title="isCreating ? 'Novo Template' : `Editar — ${template?.name}`">
        <form @submit.prevent="submit">
            <div class="grid grid-cols-2 gap-6 h-[calc(100vh-120px)]">

                <!-- ── Editor (esquerda) ─────────────────────────────── -->
                <div class="flex flex-col gap-4 overflow-y-auto pr-1">

                    <!-- Metadados -->
                    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
                            <input v-model="form.name" type="text" required
                                   :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900',
                                            form.errors.name ? 'border-red-400' : 'border-slate-200']" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Descrição</label>
                            <input v-model="form.description" type="text"
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                                   placeholder="Para que serve este template?" />
                        </div>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" v-model="form.is_shared" class="rounded border-slate-300" />
                            <span class="text-sm text-slate-700">Partilhado — visível em todas as marcas</span>
                        </label>
                    </div>

                    <!-- Editor MJML -->
                    <div class="bg-[#282c34] border border-slate-700 rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">
                        <!-- Barra de título -->
                        <div class="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-[#21252b]">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-mono font-semibold text-slate-300">MJML</span>
                                <span class="text-xs text-slate-500">· XML</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <span v-if="isCompiling" class="text-xs text-slate-400 flex items-center gap-1">
                                    <svg class="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                    </svg>
                                    A compilar…
                                </span>
                                <span v-else-if="previewError" class="text-xs text-red-400 flex items-center gap-1">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                    </svg>
                                    Erro de compilação
                                </span>
                                <span v-else-if="previewHtml" class="text-xs text-green-400 flex items-center gap-1">
                                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                                    </svg>
                                    Compilado
                                </span>
                            </div>
                        </div>

                        <!-- CodeMirror mount point -->
                        <div ref="editorEl" class="flex-1 overflow-auto text-sm" />
                    </div>

                    <!-- Erro de compilação -->
                    <div v-if="previewError"
                         class="bg-red-950 border border-red-800 rounded-lg p-3 text-xs text-red-300 font-mono whitespace-pre-wrap">
                        {{ previewError }}
                    </div>

                    <!-- Texto plain-text -->
                    <div class="bg-white border border-slate-200 rounded-xl p-4">
                        <label class="block text-sm font-medium text-slate-700 mb-1">Texto Plain-text (opcional)</label>
                        <textarea v-model="form.content_text" rows="4"
                                  class="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                                  placeholder="Versão plain-text para clientes sem suporte HTML" />
                    </div>

                    <!-- Acções -->
                    <div class="flex items-center gap-3">
                        <button type="submit" :disabled="form.processing"
                                class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                            {{ isCreating ? 'Criar Template' : 'Guardar Alterações' }}
                        </button>
                        <Link :href="route('templates.index')" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">Cancelar</Link>
                    </div>
                </div>

                <!-- ── Preview (direita) ─────────────────────────────── -->
                <div class="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                    <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                        <div class="w-3 h-3 rounded-full bg-red-400"></div>
                        <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                        <div class="w-3 h-3 rounded-full bg-green-400"></div>
                        <span class="ml-2 text-xs text-slate-500 font-mono">preview do email</span>
                    </div>
                    <div class="flex-1 overflow-hidden">
                        <iframe
                            v-if="previewHtml"
                            :srcdoc="previewHtml"
                            class="w-full h-full border-0"
                            sandbox="allow-same-origin"
                            title="Preview MJML"
                        />
                        <div v-else class="flex items-center justify-center h-full text-slate-400">
                            <div class="text-center">
                                <svg class="w-10 h-10 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                                </svg>
                                <p class="text-sm">O preview aparece aqui enquanto editas o MJML</p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </form>
    </AppLayout>
</template>

<style>
/* Make the CodeMirror editor fill its container */
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
