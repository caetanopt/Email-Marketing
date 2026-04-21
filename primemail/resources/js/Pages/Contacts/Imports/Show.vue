<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    import: { type: Object, required: true },
});

const data     = ref({ ...props.import });
const polling  = ref(null);

const progress = computed(() => {
    if (!data.value.total_rows) return 0;
    const done = (data.value.imported_count ?? 0) + (data.value.skipped_count ?? 0) + (data.value.failed_count ?? 0);
    return Math.min(100, Math.round((done / data.value.total_rows) * 100));
});

const statusLabel = computed(() => ({
    pending:    'A aguardar…',
    processing: 'Em processamento',
    completed:  'Concluído',
    failed:     'Falhado',
}[data.value.status] ?? data.value.status));

const statusColor = computed(() => ({
    pending:    'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    completed:  'bg-green-100 text-green-700',
    failed:     'bg-red-100 text-red-700',
}[data.value.status] ?? 'bg-slate-100 text-slate-700'));

const poll = async () => {
    try {
        const res = await fetch(route('imports.progress', data.value.id));
        const json = await res.json();
        Object.assign(data.value, json);
        if (json.is_terminal) clearInterval(polling.value);
    } catch { /* ignore network errors during polling */ }
};

onMounted(() => {
    if (!['completed', 'failed'].includes(data.value.status)) {
        polling.value = setInterval(poll, 2000);
    }
});

onUnmounted(() => clearInterval(polling.value));
</script>

<template>
    <AppLayout :title="`Importação — ${data.file_name ?? data.filename}`">
        <div class="max-w-2xl space-y-5">
            <!-- Status card -->
            <div class="bg-white rounded-xl border border-slate-200 p-6">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="font-semibold text-slate-900 truncate mr-4">{{ data.file_name ?? data.filename }}</h2>
                    <span :class="['px-2.5 py-1 rounded-full text-xs font-medium', statusColor]">
                        {{ statusLabel }}
                    </span>
                </div>

                <!-- Barra de progresso -->
                <div class="mb-4">
                    <div class="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>{{ progress }}% completo</span>
                        <span>{{ data.total_rows?.toLocaleString('pt-PT') }} linhas</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2">
                        <div
                            class="h-2 rounded-full transition-all duration-500"
                            :class="data.status === 'failed' ? 'bg-red-500' : 'bg-slate-900'"
                            :style="{ width: progress + '%' }"
                        ></div>
                    </div>
                </div>

                <!-- Contadores -->
                <div class="grid grid-cols-3 gap-4">
                    <div class="text-center p-3 bg-green-50 rounded-lg">
                        <p class="text-2xl font-semibold text-green-700">{{ (data.imported_count ?? 0).toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-green-600 mt-0.5">Importados</p>
                    </div>
                    <div class="text-center p-3 bg-yellow-50 rounded-lg">
                        <p class="text-2xl font-semibold text-yellow-700">{{ (data.skipped_count ?? 0).toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-yellow-600 mt-0.5">Ignorados</p>
                    </div>
                    <div class="text-center p-3 bg-red-50 rounded-lg">
                        <p class="text-2xl font-semibold text-red-700">{{ (data.failed_count ?? 0).toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-red-600 mt-0.5">Falhados</p>
                    </div>
                </div>
            </div>

            <!-- Acções -->
            <div class="flex gap-3">
                <Link v-if="data.status === 'completed'" :href="route('contacts.index')"
                      class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors">
                    Ver Contactos
                </Link>
                <Link :href="route('imports.index')" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">
                    Ver todas as importações
                </Link>
            </div>
        </div>
    </AppLayout>
</template>
