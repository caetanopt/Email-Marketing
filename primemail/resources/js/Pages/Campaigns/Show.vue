<script setup>
import { computed } from 'vue';
import { router, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    campaign: { type: Object, required: true },
    stats:    { type: Object, required: true },
});

const statusStyle = {
    draft:     'bg-slate-100 text-slate-600',
    scheduled: 'bg-blue-100 text-blue-700',
    sending:   'bg-yellow-100 text-yellow-700',
    sent:      'bg-green-100 text-green-700',
    failed:    'bg-red-100 text-red-700',
};

const labelPT = {
    draft: 'Rascunho', scheduled: 'Agendada', sending: 'A enviar',
    sent: 'Enviada', failed: 'Falhada',
};

const canSend    = computed(() => ['draft', 'scheduled'].includes(props.campaign.status));
const canEdit    = computed(() => !['sending', 'sent', 'cancelled', 'failed'].includes(props.campaign.status));
const isSending  = computed(() => props.campaign.status === 'sending');

const sendCampaign = () => {
    if (!confirm('Enviar a campanha agora para todos os destinatários das listas seleccionadas?')) return;
    router.post(route('campaigns.send', props.campaign.id));
};

const deleteCampaign = () => {
    if (!confirm(`Eliminar a campanha "${props.campaign.name}"?`)) return;
    router.delete(route('campaigns.destroy', props.campaign.id));
};
</script>

<template>
    <AppLayout :title="campaign.name">
        <template #actions>
            <Link v-if="canEdit" :href="route('campaigns.edit', campaign.id)"
                  class="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                Editar
            </Link>
            <button v-if="canSend" @click="sendCampaign"
                    class="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                </svg>
                Enviar Agora
            </button>
        </template>

        <div class="grid grid-cols-3 gap-6">
            <!-- ── Detalhes ─────────────────────────────────────────────── -->
            <div class="col-span-2 space-y-5">
                <!-- Header -->
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <div class="flex items-center gap-3 mb-4">
                        <span :class="['px-2.5 py-1 rounded-full text-xs font-medium', statusStyle[campaign.status]]">
                            {{ labelPT[campaign.status] ?? campaign.status }}
                        </span>
                        <span v-if="isSending" class="text-xs text-slate-400 flex items-center gap-1">
                            <svg class="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                            A processar…
                        </span>
                    </div>

                    <dl class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Assunto</dt>
                            <dd class="text-slate-900 font-medium">{{ campaign.subject }}</dd>
                        </div>
                        <div v-if="campaign.preview_text">
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Preview</dt>
                            <dd class="text-slate-700">{{ campaign.preview_text }}</dd>
                        </div>
                        <div>
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Remetente</dt>
                            <dd class="text-slate-900">{{ campaign.from_name }} &lt;{{ campaign.from_email }}&gt;</dd>
                        </div>
                        <div v-if="campaign.sent_at">
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Enviado em</dt>
                            <dd class="text-slate-900">{{ new Date(campaign.sent_at).toLocaleString('pt-PT') }}</dd>
                        </div>
                    </dl>
                </div>

                <!-- Listas -->
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <h3 class="font-semibold text-slate-900 mb-3 text-sm">Listas destinatárias</h3>
                    <div class="space-y-2">
                        <div v-for="cl in campaign.campaign_lists" :key="cl.id"
                             class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                            <span class="text-sm text-slate-700">{{ cl.list?.name ?? '—' }}</span>
                        </div>
                        <p v-if="!campaign.campaign_lists?.length" class="text-sm text-slate-400">Nenhuma lista associada.</p>
                    </div>
                </div>

                <!-- Preview HTML (se enviada) -->
                <div v-if="campaign.compiled_html" class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                        <div class="w-3 h-3 rounded-full bg-red-400"></div>
                        <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                        <div class="w-3 h-3 rounded-full bg-green-400"></div>
                        <span class="text-xs text-slate-500 ml-2">Email renderizado</span>
                    </div>
                    <iframe :srcdoc="campaign.compiled_html" class="w-full border-0" style="height:500px"
                            sandbox="allow-same-origin" title="Preview do email" />
                </div>
            </div>

            <!-- ── Métricas ─────────────────────────────────────────────── -->
            <div class="space-y-4">
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <h3 class="font-semibold text-slate-900 mb-4 text-sm">Desempenho</h3>
                    <div class="space-y-4">
                        <div>
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-slate-500">Enviados</span>
                                <span class="font-semibold">{{ stats.sent.toLocaleString('pt-PT') }}</span>
                            </div>
                        </div>
                        <div>
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-slate-500">Taxa de abertura</span>
                                <span class="font-semibold text-green-700">{{ stats.open_rate }}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5">
                                <div class="h-1.5 bg-green-500 rounded-full" :style="{ width: stats.open_rate + '%' }" />
                            </div>
                        </div>
                        <div>
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-slate-500">Taxa de clique</span>
                                <span class="font-semibold text-blue-700">{{ stats.click_rate }}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5">
                                <div class="h-1.5 bg-blue-500 rounded-full" :style="{ width: stats.click_rate + '%' }" />
                            </div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                        <p class="text-xl font-semibold text-slate-900">{{ stats.opens.toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-slate-500 mt-0.5">Aberturas</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                        <p class="text-xl font-semibold text-slate-900">{{ stats.clicks.toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-slate-500 mt-0.5">Cliques únicos</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                        <p class="text-xl font-semibold text-red-600">{{ stats.failed.toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-slate-500 mt-0.5">Falhados</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-xl p-4 text-center">
                        <p class="text-xl font-semibold text-slate-500">{{ stats.suppressed.toLocaleString('pt-PT') }}</p>
                        <p class="text-xs text-slate-500 mt-0.5">Suprimidos</p>
                    </div>
                </div>

                <!-- Danger zone -->
                <div class="bg-white border border-red-200 rounded-xl p-4">
                    <h4 class="text-sm font-medium text-red-700 mb-2">Zona de perigo</h4>
                    <button @click="deleteCampaign" :disabled="isSending"
                            class="text-sm text-red-600 hover:text-red-800 disabled:opacity-40 transition-colors">
                        Eliminar campanha
                    </button>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
