<script setup>
import { Link, router } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';
import Pagination from '@/Components/Pagination.vue';

defineProps({
    campaigns: { type: Object, required: true },
    statuses:  { type: Array, default: () => [] },
});

const statusStyle = {
    draft:     'bg-slate-100 text-slate-600',
    scheduled: 'bg-blue-100 text-blue-700',
    sending:   'bg-yellow-100 text-yellow-700',
    sent:      'bg-green-100 text-green-700',
    paused:    'bg-orange-100 text-orange-700',
    cancelled: 'bg-slate-100 text-slate-500',
    failed:    'bg-red-100 text-red-700',
};

const labelPT = {
    draft: 'Rascunho', scheduled: 'Agendada', sending: 'A enviar',
    sent: 'Enviada', paused: 'Pausada', cancelled: 'Cancelada', failed: 'Falhada',
};
</script>

<template>
    <AppLayout title="Campanhas">
        <template #actions>
            <Link :href="route('campaigns.create')" class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Nova Campanha
            </Link>
        </template>

        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Campanha</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Estado</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Destinatários</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Data</th>
                        <th class="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="campaign in campaigns.data"
                        :key="campaign.id"
                        class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                    >
                        <td class="px-4 py-3">
                            <Link :href="route('campaigns.show', campaign.id)" class="font-medium text-slate-900 hover:text-blue-600">
                                {{ campaign.name }}
                            </Link>
                            <p class="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{{ campaign.subject }}</p>
                        </td>
                        <td class="px-4 py-3">
                            <span :class="['px-2.5 py-1 rounded-full text-xs font-medium', statusStyle[campaign.status]]">
                                {{ labelPT[campaign.status] ?? campaign.status }}
                            </span>
                        </td>
                        <td class="px-4 py-3 text-slate-700">
                            {{ campaign.actual_recipients?.toLocaleString('pt-PT') ?? campaign.estimated_recipients?.toLocaleString('pt-PT') ?? '—' }}
                        </td>
                        <td class="px-4 py-3 text-xs text-slate-500">
                            <span v-if="campaign.sent_at">{{ new Date(campaign.sent_at).toLocaleDateString('pt-PT') }}</span>
                            <span v-else-if="campaign.scheduled_at">📅 {{ new Date(campaign.scheduled_at).toLocaleDateString('pt-PT') }}</span>
                            <span v-else>{{ new Date(campaign.created_at).toLocaleDateString('pt-PT') }}</span>
                        </td>
                        <td class="px-4 py-3 text-right">
                            <Link :href="route('campaigns.show', campaign.id)" class="text-xs text-slate-500 hover:text-slate-900 transition-colors">Ver</Link>
                        </td>
                    </tr>
                    <tr v-if="!campaigns.data.length">
                        <td colspan="5" class="px-4 py-12 text-center text-slate-400">
                            Nenhuma campanha criada. <Link :href="route('campaigns.create')" class="text-slate-600 underline">Criar primeira campanha</Link>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Pagination :links="campaigns.links" class="mt-4" />
    </AppLayout>
</template>
