<script setup>
import { ref, computed, watch } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    imports: { type: Object, required: true },
    lists:   { type: Array,  default: () => [] },
});

/* ── Upload ─────────────────────────────────────────── */
const mode       = ref('csv');
const isDragging = ref(false);
const fileInput  = ref(null);

const LIST_NEW_SENTINEL = '__new__';

const form = useForm({
    file:          null,
    list_id:       '',
    new_list_name: '',
});

const isNewList   = computed(() => form.list_id === LIST_NEW_SENTINEL);
const acceptAttr  = computed(() => mode.value === 'txt' ? '.txt' : '.csv');
const canSubmit   = computed(() =>
    form.file && !form.processing &&
    !(isNewList.value && !form.new_list_name.trim())
);

watch(() => form.list_id, (val) => {
    if (val !== LIST_NEW_SENTINEL) form.new_list_name = '';
});

const switchMode = (m) => { mode.value = m; form.file = null; form.clearErrors('file'); };

const pickFile = () => fileInput.value?.click();

const onFileChange = (e) => { form.file = e.target.files[0] ?? null; };

const onDrop = (e) => {
    isDragging.value = false;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const isCsv = file.name.endsWith('.csv');
    const isTxt = file.name.endsWith('.txt');
    if (isCsv) { mode.value = 'csv'; form.file = file; }
    else if (isTxt) { mode.value = 'txt'; form.file = file; }
};

const clearFile = () => { form.file = null; };

const submit = () => form.post(route('imports.store'), { forceFormData: true });

/* ── Histórico ──────────────────────────────────────── */
const statusLabel = {
    pending:    'A aguardar',
    processing: 'Em processamento',
    completed:  'Concluído',
    failed:     'Falhado',
    cancelled:  'Cancelado',
};
const statusStyle = {
    pending:    'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    completed:  'bg-green-100 text-green-700',
    failed:     'bg-red-100 text-red-700',
    cancelled:  'bg-slate-100 text-slate-500',
};
const fmt = (n) => (n ?? 0).toLocaleString('pt-PT');
const statusKey = (imp) => imp.status?.value ?? imp.status;
</script>

<template>
    <AppLayout title="Importações">
        <div class="space-y-6">

            <!-- ── Formulário de upload ──────────────────────── -->
            <form @submit.prevent="submit" class="bg-white border border-slate-200 rounded-xl overflow-hidden">

                <!-- Cabeçalho da zona de upload -->
                <div class="px-6 pt-6 pb-4 border-b border-slate-100">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="font-semibold text-slate-900">Importar contactos</h2>
                        <!-- Abas CSV / TXT -->
                        <div class="flex gap-1 bg-slate-100 p-1 rounded-lg">
                            <button type="button" @click="switchMode('csv')"
                                :class="['px-3 py-1 rounded-md text-xs font-medium transition-colors',
                                         mode === 'csv' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700']">
                                CSV
                            </button>
                            <button type="button" @click="switchMode('txt')"
                                :class="['px-3 py-1 rounded-md text-xs font-medium transition-colors',
                                         mode === 'txt' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700']">
                                TXT (só emails)
                            </button>
                        </div>
                    </div>

                    <!-- Zona de drop + botão -->
                    <div class="grid grid-cols-5 gap-4 items-stretch">

                        <!-- Drop zone — ocupa 3/5 -->
                        <div
                            @dragenter.prevent="isDragging = true"
                            @dragleave.prevent="isDragging = false"
                            @dragover.prevent
                            @drop.prevent="onDrop"
                            :class="[
                                'col-span-3 border-2 border-dashed rounded-xl transition-all',
                                isDragging
                                    ? 'border-slate-900 bg-slate-50 scale-[1.01]'
                                    : form.file
                                        ? 'border-green-400 bg-green-50'
                                        : 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white'
                            ]"
                        >
                            <input ref="fileInput" type="file" :accept="acceptAttr" class="sr-only" @change="onFileChange" />

                            <!-- Sem ficheiro -->
                            <div v-if="!form.file" class="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
                                <svg class="w-10 h-10 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                                </svg>
                                <p class="text-sm font-medium text-slate-600 mb-1">
                                    Arrasta o ficheiro aqui
                                </p>
                                <p class="text-xs text-slate-400">
                                    {{ mode === 'txt' ? 'Ficheiro .txt — um email por linha' : 'Ficheiro .csv — separador auto-detectado' }}
                                </p>
                            </div>

                            <!-- Ficheiro seleccionado -->
                            <div v-else class="flex items-center justify-between h-full px-5 py-4">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                                        <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                        </svg>
                                    </div>
                                    <div>
                                        <p class="text-sm font-semibold text-slate-900">{{ form.file.name }}</p>
                                        <p class="text-xs text-slate-500">{{ (form.file.size / 1024 / 1024).toFixed(2) }} MB</p>
                                    </div>
                                </div>
                                <button type="button" @click="clearFile"
                                        class="w-7 h-7 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors flex-shrink-0">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Separador "ou" + botão — ocupa 2/5 -->
                        <div class="col-span-2 flex flex-col items-center justify-center gap-3">
                            <div class="flex items-center gap-3 w-full">
                                <div class="flex-1 h-px bg-slate-200"></div>
                                <span class="text-xs text-slate-400 font-medium">ou</span>
                                <div class="flex-1 h-px bg-slate-200"></div>
                            </div>
                            <button
                                type="button"
                                @click="pickFile"
                                class="w-full flex items-center justify-center gap-2 px-5 py-3 border-2 border-slate-900 text-slate-900 font-semibold text-sm rounded-xl hover:bg-slate-900 hover:text-white transition-all"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                                </svg>
                                Escolher ficheiro
                            </button>
                            <p class="text-xs text-slate-400 text-center">
                                {{ mode === 'txt' ? '.txt, max. 100 MB' : '.csv, max. 100 MB' }}
                            </p>
                        </div>
                    </div>

                    <p v-if="form.errors.file" class="mt-2 text-xs text-red-600">{{ form.errors.file }}</p>
                </div>

                <!-- Opções inferiores: lista + submeter -->
                <div class="px-6 py-4 bg-slate-50 flex items-end gap-4 flex-wrap">

                    <!-- Info formato -->
                    <div v-if="mode === 'txt'" class="text-xs text-slate-500 flex-1 min-w-[200px]">
                        <span class="font-medium text-slate-700">TXT:</span> um endereço de email por linha. Linhas em branco são ignoradas.
                    </div>
                    <div v-else class="text-xs text-slate-500 flex-1 min-w-[200px]">
                        <span class="font-medium text-slate-700">CSV:</span> colunas detectadas automaticamente —
                        <em>email</em> obrigatório; <em>first_name, last_name, phone, company</em> opcionais.
                    </div>

                    <!-- Seletor de lista -->
                    <div class="flex items-end gap-3 flex-wrap">
                        <!-- Cartões Lista existente / Nova lista -->
                        <div class="flex gap-2">
                            <button type="button"
                                @click="form.list_id = ''; form.new_list_name = ''"
                                :class="['px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                                         !isNewList
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400']">
                                Lista existente
                            </button>
                            <button type="button"
                                @click="form.list_id = LIST_NEW_SENTINEL"
                                :class="['px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                                         isNewList
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300']">
                                Nova lista
                            </button>
                        </div>

                        <!-- Input dinâmico -->
                        <select v-if="!isNewList" v-model="form.list_id"
                                class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 min-w-[200px]">
                            <option value="">Nenhuma — só base de dados</option>
                            <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
                        </select>
                        <input v-else v-model="form.new_list_name" type="text"
                               placeholder="Nome da nova lista" maxlength="255"
                               :class="['px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]',
                                        form.errors.new_list_name ? 'border-red-400' : 'border-slate-200']" />
                    </div>

                    <!-- Botão submeter -->
                    <button type="submit" :disabled="!canSubmit"
                            class="flex items-center gap-2 px-5 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                        <svg v-if="form.processing" class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                        </svg>
                        {{ form.processing ? 'A importar…' : 'Importar' }}
                    </button>
                </div>
            </form>

            <!-- ── Histórico de importações ───────────────────── -->
            <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div class="px-5 py-3 border-b border-slate-200">
                    <h2 class="font-semibold text-slate-900 text-sm">Histórico de importações</h2>
                </div>
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-slate-200 bg-slate-50">
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Ficheiro</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Lista</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Estado</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Importados</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Ignorados</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Falhados</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Data</th>
                            <th class="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="imp in imports.data" :key="imp.id"
                            class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <td class="px-4 py-3">
                                <p class="font-medium text-slate-900 truncate max-w-[200px]">{{ imp.file_name }}</p>
                                <p class="text-xs text-slate-400">{{ imp.total_rows?.toLocaleString('pt-PT') ?? '—' }} linhas</p>
                            </td>
                            <td class="px-4 py-3 text-slate-600">{{ imp.list?.name ?? '—' }}</td>
                            <td class="px-4 py-3">
                                <div class="flex items-center gap-2">
                                    <span :class="['px-2.5 py-0.5 rounded-full text-xs font-medium', statusStyle[statusKey(imp)] ?? 'bg-slate-100 text-slate-500']">
                                        {{ statusLabel[statusKey(imp)] ?? statusKey(imp) }}
                                    </span>
                                    <div v-if="statusKey(imp) === 'processing'" class="w-16 bg-slate-100 rounded-full h-1.5">
                                        <div class="h-1.5 bg-blue-500 rounded-full" :style="{ width: (imp.progress ?? 0) + '%' }"></div>
                                    </div>
                                </div>
                            </td>
                            <td class="px-4 py-3 text-green-700 font-medium">{{ fmt(imp.imported_count) }}</td>
                            <td class="px-4 py-3 text-yellow-700">{{ fmt(imp.skipped_count) }}</td>
                            <td class="px-4 py-3 text-red-600">{{ fmt(imp.error_count ?? imp.failed_count) }}</td>
                            <td class="px-4 py-3 text-xs text-slate-500">{{ new Date(imp.created_at).toLocaleDateString('pt-PT') }}</td>
                            <td class="px-4 py-3 text-right">
                                <Link :href="route('imports.show', imp.id)" class="text-xs text-slate-500 hover:text-slate-900 transition-colors">
                                    Detalhes
                                </Link>
                            </td>
                        </tr>
                        <tr v-if="!imports.data?.length">
                            <td colspan="8" class="px-4 py-10 text-center text-slate-400 text-sm">
                                Ainda não foi realizada nenhuma importação.
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div v-if="imports.last_page > 1"
                     class="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                    <span>Mostrando {{ imports.from }}–{{ imports.to }} de {{ imports.total }}</span>
                    <div class="flex gap-1">
                        <Link v-for="link in imports.links" :key="link.label"
                              :href="link.url ?? '#'"
                              :class="['px-3 py-1 rounded border transition-colors',
                                       link.active ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 hover:bg-slate-50',
                                       !link.url ? 'opacity-40 pointer-events-none' : '']"
                              v-html="link.label" />
                    </div>
                </div>
            </div>

        </div>
    </AppLayout>
</template>
