<script setup>
import { ref, computed } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

defineProps({
    lists: { type: Array, default: () => [] },
});

const mode       = ref('csv'); // 'csv' | 'txt'
const isDragging = ref(false);
const fileInput  = ref(null);

const form = useForm({
    file:    null,
    list_id: '',
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
    mode.value  = newMode;
    form.file   = null;
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
    // Ficheiro do tipo errado — trocar de tab automaticamente
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
                    >
                        CSV
                    </button>
                    <button
                        type="button"
                        @click="switchMode('txt')"
                        :class="[
                            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                            mode === 'txt' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        ]"
                    >
                        TXT (só emails)
                    </button>
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

                <!-- Informação contextual -->
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
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Adicionar a lista (opcional)</label>
                    <select v-model="form.list_id" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
                        <option value="">Nenhuma — só actualizar base de dados</option>
                        <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
                    </select>
                </div>

                <!-- Acções -->
                <div class="flex items-center gap-3">
                    <button type="submit" :disabled="!form.file || form.processing"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        <span v-if="form.processing">A importar…</span>
                        <span v-else>Iniciar Importação</span>
                    </button>
                    <Link :href="route('contacts.index')" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">
                        Cancelar
                    </Link>
                </div>
            </form>
        </div>
    </AppLayout>
</template>
