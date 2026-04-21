<script setup>
import { computed } from 'vue';
import { Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    stats:           { type: Object, required: true },
    recentCampaigns: { type: Array,  default: () => [] },
});

const openRateColor  = computed(() => {
    if (props.stats.avg_open_rate >= 25) return 'text-green-700';
    if (props.stats.avg_open_rate >= 15) return 'text-yellow-700';
    return 'text-red-600';
});
</script>

<template>
    <AppLayout title="Dashboard">
        <!-- KPI cards -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="bg-white border border-slate-200 rounded-xl p-5">
                <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Contactos activos</p>
                <p class="text-3xl font-semibold text-slate-900">{{ stats.active_contacts.toLocaleString('pt-PT') }}</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-5">
                <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Campanhas enviadas (30 d)</p>
                <p class="text-3xl font-semibold text-slate-900">{{ stats.sent_campaigns_30d }}</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-5">
                <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Emails enviados (30 d)</p>
                <p class="text-3xl font-semibold text-slate-900">{{ stats.emails_sent_30d.toLocaleString('pt-PT') }}</p>
            </div>
            <div class="bg-white border border-slate-200 rounded-xl p-5">
                <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Taxa de abertura média</p>
                <p class="text-3xl font-semibold" :class="openRateColor">{{ stats.avg_open_rate }}%</p>
                <p class="text-xs text-slate-400 mt-0.5">Últimas 10 campanhas</p>
            </div>
        </div>

        <div class="grid grid-cols-3 gap-6">
            <!-- Recent campaigns -->
            <div class="col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 class="font-semibold text-slate-900 text-sm">Campanhas recentes</h3>
                    <Link :href="route('campaigns.index')" class="text-xs text-slate-500 hover:text-slate-900">Ver todas →</Link>
                </div>
                <table class="w-full text-sm">
                    <tbody>
                        <tr v-for="c in recentCampaigns" :key="c.id"
                            class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                            <td class="px-5 py-3">
                                <Link :href="route('campaigns.show', c.id)" class="font-medium text-slate-900 hover:text-blue-600 truncate block max-w-[220px]">
                                    {{ c.name }}
                                </Link>
                                <p class="text-xs text-slate-400 truncate max-w-[220px]">{{ c.subject }}</p>
                            </td>
                            <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                                {{ c.sent_at ? new Date(c.sent_at).toLocaleDateString('pt-PT') : '—' }}
                            </td>
                            <td class="px-4 py-3 text-right">
                                <div class="flex items-center gap-3 justify-end text-xs">
                                    <span class="text-slate-500">{{ c.open_rate }}% abertos</span>
                                    <span class="text-blue-600">{{ c.click_rate }}% cliques</span>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!recentCampaigns.length">
                            <td colspan="3" class="px-5 py-10 text-center text-slate-400 text-sm">
                                Nenhuma campanha enviada ainda.
                                <Link :href="route('campaigns.create')" class="text-slate-600 underline ml-1">Criar campanha</Link>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Quick stats sidebar -->
            <div class="space-y-4">
                <!-- Engagement breakdown -->
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <h3 class="font-semibold text-slate-900 text-sm mb-4">Métricas globais (30 d)</h3>
                    <div class="space-y-3">
                        <div>
                            <div class="flex justify-between text-xs mb-1">
                                <span class="text-slate-500">Abertura</span>
                                <span class="font-medium">{{ stats.avg_open_rate }}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5">
                                <div class="h-1.5 bg-green-500 rounded-full transition-all" :style="{ width: Math.min(stats.avg_open_rate, 100) + '%' }" />
                            </div>
                        </div>
                        <div>
                            <div class="flex justify-between text-xs mb-1">
                                <span class="text-slate-500">Clique</span>
                                <span class="font-medium">{{ stats.avg_click_rate }}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5">
                                <div class="h-1.5 bg-blue-500 rounded-full transition-all" :style="{ width: Math.min(stats.avg_click_rate, 100) + '%' }" />
                            </div>
                        </div>
                        <div>
                            <div class="flex justify-between text-xs mb-1">
                                <span class="text-slate-500">Bounce</span>
                                <span class="font-medium text-red-600">{{ stats.bounce_rate }}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5">
                                <div class="h-1.5 bg-red-400 rounded-full transition-all" :style="{ width: Math.min(stats.bounce_rate, 100) + '%' }" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Quick links -->
                <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                    <h3 class="font-semibold text-slate-900 text-sm mb-3">Acesso rápido</h3>
                    <Link :href="route('campaigns.create')"
                          class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors text-sm text-slate-700">
                        <span class="w-8 h-8 bg-green-100 text-green-700 rounded-lg flex items-center justify-center text-base">📢</span>
                        Nova campanha
                    </Link>
                    <Link :href="route('templates.create')"
                          class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors text-sm text-slate-700">
                        <span class="w-8 h-8 bg-purple-100 text-purple-700 rounded-lg flex items-center justify-center text-base">🎨</span>
                        Novo template MJML
                    </Link>
                    <Link :href="route('imports.index')"
                          class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors text-sm text-slate-700">
                        <span class="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center text-base">📥</span>
                        Importar contactos
                    </Link>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
