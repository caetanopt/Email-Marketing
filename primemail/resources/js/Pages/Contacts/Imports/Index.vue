<script setup>
import { Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

defineProps({
    imports: { type: Object, required: true },
});

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
</script>

<template>
    <AppLayout title="Importações">
        <template #actions>
            <Link :href="route('imports.create')"
                  class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                Nova Importação
            </Link>
        </template>

        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
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
                            <p class="font-medium text-slate-900 truncate max-w-[200px]">
                                {{ imp.file_name }}
                            </p>
                            <p class="text-xs text-slate-400">
                                {{ imp.total_rows?.toLocaleString('pt-PT') ?? '—' }} linhas
                            </p>
                        </td>
                        <td class="px-4 py-3 text-slate-600">
                            {{ imp.list?.name ?? '—' }}
                        </td>
                        <td class="px-4 py-3">
                            <div class="flex items-center gap-2">
                                <span :class="['px-2.5 py-0.5 rounded-full text-xs font-medium', statusStyle[imp.status?.value ?? imp.status] ?? 'bg-slate-100 text-slate-500']">
                                    {{ statusLabel[imp.status?.value ?? imp.status] ?? imp.status }}
                                </span>
                                <!-- Barra de progresso inline para importações em curso -->
                                <div v-if="(imp.status?.value ?? imp.status) === 'processing'" class="w-16 bg-slate-100 rounded-full h-1.5">
                                    <div class="h-1.5 bg-blue-500 rounded-full"
                                         :style="{ width: (imp.progress ?? 0) + '%' }"></div>
                                </div>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-green-700 font-medium">{{ fmt(imp.imported_count) }}</td>
                        <td class="px-4 py-3 text-yellow-700">{{ fmt(imp.skipped_count) }}</td>
                        <td class="px-4 py-3 text-red-600">{{ fmt(imp.error_count ?? imp.failed_count) }}</td>
                        <td class="px-4 py-3 text-xs text-slate-500">
                            {{ new Date(imp.created_at).toLocaleDateString('pt-PT') }}
                        </td>
                        <td class="px-4 py-3 text-right">
                            <Link :href="route('imports.show', imp.id)"
                                  class="text-xs text-slate-500 hover:text-slate-900 transition-colors">
                                Detalhes
                            </Link>
                        </td>
                    </tr>
                    <tr v-if="!imports.data?.length">
                        <td colspan="8" class="px-4 py-12 text-center text-slate-400">
                            Nenhuma importação realizada.
                            <Link :href="route('imports.create')" class="text-slate-600 underline">Importar agora</Link>
                        </td>
                    </tr>
                </tbody>
            </table>

            <!-- Paginação -->
            <div v-if="imports.last_page > 1"
                 class="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>Mostrando {{ imports.from }}–{{ imports.to }} de {{ imports.total }}</span>
                <div class="flex gap-1">
                    <Link v-for="link in imports.links" :key="link.label"
                          :href="link.url ?? '#'"
                          :class="[
                              'px-3 py-1 rounded border transition-colors',
                              link.active
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'border-slate-200 hover:bg-slate-50',
                              !link.url ? 'opacity-40 pointer-events-none' : ''
                          ]"
                          v-html="link.label"
                    />
                </div>
            </div>
        </div>
    </AppLayout>
</template>
