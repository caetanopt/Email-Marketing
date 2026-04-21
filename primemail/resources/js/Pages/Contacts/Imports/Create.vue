<script setup>
import { ref, computed, watch } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

defineProps({
    lists: { type: Array, default: () => [] },
});

const mode        = ref('csv'); // 'csv' | 'txt'
const isDragging  = ref(false);
const fileInput   = ref(null);

const LIST_NEW_SENTINEL = '__new__';

const form = useForm({
    file:          null,
    list_id:       '',
    new_list_name: '',
});

const isNewList = computed(() => form.list_id === LIST_NEW_SENTINEL);

// Quando muda para outra opção limpa o nome
watch(() => form.list_id, (val) => {
    if (val !== LIST_NEW_SENTINEL) form.new_list_name = '';
});

const acceptAttr   = computed(() => mode.value === 'txt' ? '.txt' : '.csv');
const dropHintMain = computed(() =>
    mode.value === 'txt'
        ? 'Arrasta um ficheiro TXT ou clica para seleccionar'
        : 'Arrasta um ficheiro CSV ou clica para seleccionar'
);
const dropHintSub = computed(() =>
    mode.value === 'txt'
        ? 'TXT, max. 100 MB — um email por linha'
        : 'CSV, max. 100 MB — separadores: vírgula, ponto-e-vírgula ou tab'
);

const switchMode = (newMode) => {
    mode.value = newMode;
    form.file  = null;
    form.clearErrors('file');
};

const onFileChange = (e) => {
    form.file = e.target.files[0] ?? null;
};

const onDrop = (e) => {
    isDragging.value = false;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const isCsv = file.name.endsWith('.csv');
    const isTxt = file.name.endsWith('.txt');
    if (mode.value === 'csv' && isCsv) { form.file = file; return; }
    if (mode.value === 'txt' && isTxt) { form.file = file; return; }
    if (isCsv) { mode.value = 'csv'; form.file = file; }
    if (isTxt) { mode.value = 'txt'; form.file = file; }
};

const submit = () => {
    form.post(route('imports.store'), { forceFormData: true });
};
</script>

<template>
    <AppLayout title="Importar Contactos">
        <div class="max-w-2xl">
            <form @submit.prevent="submit" class="space-y-5">

                <!-- Abas CSV / TXT -->
                <div class="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
                    <button
                        type="button"
                        @click="switchMode('csv')"
                        :class="[
                            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                            mode === 'csv' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        ]"
                    >CSV</button>
                    <button
                        type="button"
                        @click="switchMode('txt')"
                        :class="[
                            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                            mode === 'txt' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        ]"
                    >TXT (só emails)</button>
                </div>

                <!-- Drop zone -->
                <div
                    @dragenter.prevent="isDragging = true"
                    @dragleave.prevent="isDragging = false"
                    @dragover.prevent
                    @drop.prevent="onDrop"
                    @click="fileInput.click()"
                    :class="[
                        'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors',
                        isDragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
                    ]"
                >
                    <input
                        ref="fileInput"
                        type="file"
                        :accept="acceptAttr"
                        class="sr-only"
                        @change="onFileChange"
                    />
                    <div v-if="!form.file">
                        <svg class="w-10 h-10 mx-auto text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                        </svg>
                        <p class="text-sm font-medium text-slate-700">{{ dropHintMain }}</p>
                        <p class="text-xs text-slate-400 mt-1">{{ dropHintSub }}</p>
                    </div>
                    <div v-else class="flex items-center justify-center gap-3">
                        <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <div class="text-left">
                            <p class="text-sm font-medium text-slate-900">{{ form.file.name }}</p>
                            <p class="text-xs text-slate-500">{{ (form.file.size / 1024 / 1024).toFixed(2) }} MB</p>
                        </div>
                        <button type="button" @click.stop="form.file = null" class="ml-2 text-slate-400 hover:text-red-500">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <p v-if="form.errors.file" class="text-xs text-red-600 -mt-2">{{ form.errors.file }}</p>

                <!-- Info contextual -->
                <div v-if="mode === 'txt'" class="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
                    <p class="font-medium mb-1">Formato TXT — um email por linha</p>
                    <pre class="text-xs text-slate-500 mt-1 leading-relaxed">joao@empresa.pt
ana.costa@mail.pt
pedro@exemplo.com</pre>
                    <p class="text-xs text-slate-400 mt-2">Linhas em branco e espaços extra são ignorados. Emails inválidos são descartados.</p>
                </div>
                <div v-else class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                    <p class="font-medium mb-1">Colunas reconhecidas automaticamente</p>
                    <p class="text-xs text-blue-700">
                        <strong>Obrigatório:</strong> email (ou e-mail, mail) •
                        <strong>Opcional:</strong> first_name, last_name, phone, company (aceita variantes em PT/EN)
                    </p>
                </div>

                <!-- Lista destino -->
                <div class="space-y-3">
                    <label class="block text-sm font-medium text-slate-700">Adicionar a lista</label>

                    <div class="grid grid-cols-2 gap-3">
                        <!-- Opção A — Lista existente -->
                        <button
                            type="button"
                            @click="form.list_id = ''; form.new_list_name = ''"
                            :class="[
                                'relative text-left p-4 rounded-xl border-2 transition-all',
                                !isNewList
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                            ]"
                        >
                            <span :class="['block text-sm font-semibold mb-0.5', !isNewList ? 'text-white' : 'text-slate-900']">
                                Lista existente
                            </span>
                            <span :class="['block text-xs', !isNewList ? 'text-slate-300' : 'text-slate-400']">
                                Seleccionar de entre as listas criadas
                            </span>
                            <svg v-if="!isNewList" class="absolute top-3 right-3 w-4 h-4 text-slate-300" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </button>

                        <!-- Opção B — Nova lista -->
                        <button
                            type="button"
                            @click="form.list_id = LIST_NEW_SENTINEL"
                            :class="[
                                'relative text-left p-4 rounded-xl border-2 transition-all',
                                isNewList
                                    ? 'border-indigo-600 bg-indigo-600 text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                            ]"
                        >
                            <span :class="['block text-sm font-semibold mb-0.5', isNewList ? 'text-white' : 'text-slate-900']">
                                Criar nova lista
                            </span>
                            <span :class="['block text-xs', isNewList ? 'text-indigo-200' : 'text-slate-400']">
                                Cria a lista e importa em simultâneo
                            </span>
                            <svg v-if="isNewList" class="absolute top-3 right-3 w-4 h-4 text-indigo-200" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </button>
                    </div>

                    <!-- Dropdown — só visível na opção "existente" -->
                    <select
                        v-if="!isNewList"
                        v-model="form.list_id"
                        class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                        <option value="">Nenhuma — só actualizar base de dados</option>
                        <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
                    </select>

                    <!-- Campo de nome — só visível na opção "nova lista" -->
                    <div v-if="isNewList">
                        <input
                            v-model="form.new_list_name"
                            type="text"
                            placeholder="Nome da nova lista"
                            maxlength="255"
                            autofocus
                            :class="[
                                'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
                                form.errors.new_list_name ? 'border-red-400' : 'border-slate-200'
                            ]"
                        />
                        <p v-if="form.errors.new_list_name" class="mt-1 text-xs text-red-600">{{ form.errors.new_list_name }}</p>
                    </div>
                </div>

                <!-- Acções -->
                <div class="flex items-center gap-3">
                    <button
                        type="submit"
                        :disabled="!form.file || (isNewList && !form.new_list_name.trim()) || form.processing"
                        class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    >
                        <span v-if="form.processing">A importar…</span>
                        <span v-else>Iniciar Importação</span>
                    </button>
                    <Link :href="route('imports.index')" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">
                        Cancelar
                    </Link>
                </div>

            </form>
        </div>
    </AppLayout>
</template>
