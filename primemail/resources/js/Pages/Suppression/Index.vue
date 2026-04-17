<script setup>
import { ref } from 'vue';
import { router, useForm } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';
import Pagination from '@/Components/Pagination.vue';

const props = defineProps({
    suppressions: { type: Object, required: true },
    filters:      { type: Object, default: () => ({}) },
    reasons:      { type: Array,  default: () => [] },
});

const search = ref(props.filters.search ?? '');
const reason = ref(props.filters.reason ?? '');

const filter = () => {
    router.get(route('suppression.index'), { search: search.value, reason: reason.value }, {
        preserveState: true, replace: true,
    });
};

const remove = (id, email) => {
    if (!confirm(`Remover "${email}" da lista de supressão?`)) return;
    router.delete(route('suppression.destroy', id));
};

const reasonLabel = {
    unsubscribe:     'Dessubscrição',
    hard_bounce:     'Hard Bounce',
    spam_complaint:  'Queixa de spam',
    manual:          'Manual',
    import:          'Importação',
};
</script>

<template>
    <AppLayout title="Lista de Supressão">
        <!-- Filtros -->
        <div class="flex items-center gap-3 mb-4">
            <input v-model="search" @keyup.enter="filter" type="search"
                   placeholder="Pesquisar por email…"
                   class="px-3 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900" />
            <select v-model="reason" @change="filter"
                    class="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
                <option value="">Todos os motivos</option>
                <option v-for="r in reasons" :key="r" :value="r">{{ reasonLabel[r] ?? r }}</option>
            </select>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Email</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Motivo</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Adicionado em</th>
                        <th class="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="s in suppressions.data" :key="s.id"
                        class="border-b border-slate-100 last:border-0">
                        <td class="px-4 py-3 font-mono text-xs text-slate-700">{{ s.email }}</td>
                        <td class="px-4 py-3">
                            <span :class="{
                                'bg-red-100 text-red-700':    s.reason === 'hard_bounce',
                                'bg-orange-100 text-orange-700': s.reason === 'spam_complaint',
                                'bg-slate-100 text-slate-600': !['hard_bounce', 'spam_complaint'].includes(s.reason),
                            }" class="px-2.5 py-0.5 rounded-full text-xs font-medium">
                                {{ reasonLabel[s.reason] ?? s.reason }}
                            </span>
                        </td>
                        <td class="px-4 py-3 text-xs text-slate-500">
                            {{ new Date(s.added_at).toLocaleDateString('pt-PT') }}
                        </td>
                        <td class="px-4 py-3 text-right">
                            <button @click="remove(s.id, s.email)"
                                    class="text-xs text-red-500 hover:text-red-700 transition-colors">
                                Remover
                            </button>
                        </td>
                    </tr>
                    <tr v-if="!suppressions.data.length">
                        <td colspan="4" class="px-4 py-12 text-center text-slate-400">
                            Nenhum endereço suprimido.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Pagination :links="suppressions.links" class="mt-4" />
    </AppLayout>
</template>
