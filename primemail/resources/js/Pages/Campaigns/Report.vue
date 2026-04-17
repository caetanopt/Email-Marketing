<script setup>
import { ref } from 'vue';
import { router, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';
import Pagination from '@/Components/Pagination.vue';

const props = defineProps({
    campaign:   { type: Object, required: true },
    recipients: { type: Object, required: true },
    totals:     { type: Object, required: true },
    filters:    { type: Object, default: () => ({}) },
});

const search = ref(props.filters.search ?? '');
const status = ref(props.filters.status ?? '');

const filter = () => {
    router.get(route('campaigns.report', props.campaign.id), {
        search: search.value, status: status.value,
    }, { preserveState: true, replace: true });
};

const statusStyle = {
    sent:       'bg-green-100 text-green-700',
    failed:     'bg-red-100 text-red-700',
    suppressed: 'bg-orange-100 text-orange-700',
    bounced:    'bg-red-100 text-red-800',
    pending:    'bg-slate-100 text-slate-600',
};

const statusLabel = {
    sent: 'Enviado', failed: 'Falhado', suppressed: 'Suprimido',
    bounced: 'Bounce', pending: 'Pendente',
};
</script>

<template>
    <AppLayout :title="`Relatório — ${campaign.name}`">
        <template #actions>
            <Link :href="route('campaigns.show', campaign.id)"
                  class="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                ← Campanha
            </Link>
        </template>

        <!-- Totais -->
        <div class="grid grid-cols-4 gap-4 mb-6">
            <button @click="status = 'sent'; filter()"
                    :class="['bg-white border rounded-xl p-4 text-center transition-all', status === 'sent' ? 'border-green-400 ring-2 ring-green-100' : 'border-slate-200 hover:border-slate-300']">
                <p class="text-2xl font-semibold text-green-700">{{ totals.sent.toLocaleString('pt-PT') }}</p>
                <p class="text-xs text-slate-500 mt-0.5">Enviados</p>
            </button>
            <button @click="status = 'failed'; filter()"
                    :class="['bg-white border rounded-xl p-4 text-center transition-all', status === 'failed' ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200 hover:border-slate-300']">
                <p class="text-2xl font-semibold text-red-600">{{ totals.failed.toLocaleString('pt-PT') }}</p>
                <p class="text-xs text-slate-500 mt-0.5">Falhados</p>
            </button>
            <button @click="status = 'bounced'; filter()"
                    :class="['bg-white border rounded-xl p-4 text-center transition-all', status === 'bounced' ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200 hover:border-slate-300']">
                <p class="text-2xl font-semibold text-red-800">{{ totals.bounced.toLocaleString('pt-PT') }}</p>
                <p class="text-xs text-slate-500 mt-0.5">Bounces</p>
            </button>
            <button @click="status = 'suppressed'; filter()"
                    :class="['bg-white border rounded-xl p-4 text-center transition-all', status === 'suppressed' ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200 hover:border-slate-300']">
                <p class="text-2xl font-semibold text-orange-700">{{ totals.suppressed.toLocaleString('pt-PT') }}</p>
                <p class="text-xs text-slate-500 mt-0.5">Suprimidos</p>
            </button>
        </div>

        <!-- Filtros -->
        <div class="flex items-center gap-3 mb-4">
            <input v-model="search" @keyup.enter="filter" type="search"
                   placeholder="Pesquisar por email…"
                   class="px-3 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900" />
            <select v-model="status" @change="filter"
                    class="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
                <option value="">Todos os estados</option>
                <option v-for="(label, val) in statusLabel" :key="val" :value="val">{{ label }}</option>
            </select>
            <button v-if="status || search" @click="status = ''; search = ''; filter()"
                    class="text-xs text-slate-400 hover:text-slate-700">Limpar</button>
        </div>

        <!-- Tabela -->
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Destinatário</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Estado</th>
                        <th class="px-4 py-3 text-center font-medium text-slate-500">Aberturas</th>
                        <th class="px-4 py-3 text-center font-medium text-slate-500">Cliques</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Data</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="r in recipients.data" :key="r.id"
                        class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                        <td class="px-4 py-3">
                            <p class="text-slate-900 font-medium">{{ r.name ?? r.email }}</p>
                            <p v-if="r.name" class="text-xs text-slate-400">{{ r.email }}</p>
                        </td>
                        <td class="px-4 py-3">
                            <span :class="['px-2.5 py-0.5 rounded-full text-xs font-medium', statusStyle[r.status]]">
                                {{ statusLabel[r.status] ?? r.status }}
                            </span>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <span v-if="r.opens > 0" class="text-green-700 font-semibold">{{ r.opens }}</span>
                            <span v-else class="text-slate-300">—</span>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <span v-if="r.clicks > 0" class="text-blue-700 font-semibold">{{ r.clicks }}</span>
                            <span v-else class="text-slate-300">—</span>
                        </td>
                        <td class="px-4 py-3 text-xs text-slate-500">
                            <span v-if="r.sent_at">{{ new Date(r.sent_at).toLocaleString('pt-PT') }}</span>
                            <span v-else-if="r.failed_at">{{ new Date(r.failed_at).toLocaleString('pt-PT') }}</span>
                            <span v-else>—</span>
                        </td>
                    </tr>
                    <tr v-if="!recipients.data.length">
                        <td colspan="5" class="px-4 py-12 text-center text-slate-400">
                            Nenhum resultado para os filtros seleccionados.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Pagination :links="recipients.links" class="mt-4" />
    </AppLayout>
</template>
