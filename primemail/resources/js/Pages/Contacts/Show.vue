<script setup>
import { computed } from 'vue';
import { router, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    contact: { type: Object, required: true },
    stats:   { type: Object, required: true },
    events:  { type: Array,  default: () => [] },
});

const fullName = computed(() =>
    [props.contact.first_name, props.contact.last_name].filter(Boolean).join(' ') || '—'
);

const relation = computed(() => props.contact.brand_relations?.[0] ?? null);

const removeContact = () => {
    if (!confirm(`Remover ${fullName.value} desta marca?`)) return;
    router.delete(route('contacts.destroy', props.contact.id));
};

const eventStyle = {
    open:        { dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700',   label: 'Abertura' },
    click:       { dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-700',     label: 'Clique' },
    delivered:   { dot: 'bg-slate-400',  badge: 'bg-slate-100 text-slate-600',   label: 'Entregue' },
    bounce:      { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700',       label: 'Bounce' },
    unsubscribe: { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700', label: 'Dessubscrição' },
    spam:        { dot: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700', label: 'Spam' },
};

const fmt = (iso) => iso
    ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
</script>

<template>
    <AppLayout :title="fullName">
        <template #actions>
            <Link :href="route('contacts.edit', contact.id)"
                  class="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                Editar
            </Link>
        </template>

        <div class="grid grid-cols-3 gap-6">
            <!-- Col principal -->
            <div class="col-span-2 space-y-5">

                <!-- Info do contacto -->
                <div class="bg-white border border-slate-200 rounded-xl p-6">
                    <div class="flex items-center gap-4 mb-6">
                        <div class="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-xl font-semibold text-slate-600 flex-shrink-0">
                            {{ contact.first_name?.[0]?.toUpperCase() ?? contact.email[0].toUpperCase() }}
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900">{{ fullName }}</h2>
                            <p class="text-sm text-slate-500">{{ contact.email }}</p>
                        </div>
                    </div>

                    <dl class="grid grid-cols-2 gap-4 text-sm">
                        <div v-if="contact.phone">
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Telefone</dt>
                            <dd class="text-slate-900">{{ contact.phone }}</dd>
                        </div>
                        <div v-if="contact.company">
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Empresa</dt>
                            <dd class="text-slate-900">{{ contact.company }}</dd>
                        </div>
                        <div>
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Registado em</dt>
                            <dd class="text-slate-900">{{ new Date(contact.created_at).toLocaleDateString('pt-PT') }}</dd>
                        </div>
                        <div v-if="relation">
                            <dt class="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Estado</dt>
                            <dd>
                                <span :class="relation.status === 'active'
                                        ? 'text-green-700 bg-green-100'
                                        : 'text-slate-600 bg-slate-100'"
                                      class="px-2 py-0.5 rounded-full text-xs font-medium">
                                    {{ relation.status === 'active' ? 'Activo' : 'Removido' }}
                                </span>
                            </dd>
                        </div>
                    </dl>
                </div>

                <!-- Listas -->
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <h3 class="font-semibold text-slate-900 mb-3 text-sm">Listas</h3>
                    <div class="space-y-2">
                        <div v-for="m in contact.list_memberships" :key="m.id"
                             class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                            <Link :href="route('lists.edit', m.list?.id)"
                                  class="text-sm text-slate-700 hover:text-slate-900 hover:underline">
                                {{ m.list?.name ?? '—' }}
                            </Link>
                            <span :class="m.status === 'active'
                                    ? 'text-green-700 bg-green-100'
                                    : 'text-slate-500 bg-slate-100'"
                                  class="px-2 py-0.5 rounded-full text-xs font-medium">
                                {{ m.status === 'active' ? 'Subscrito' : 'Removido' }}
                            </span>
                        </div>
                        <p v-if="!contact.list_memberships?.length" class="text-sm text-slate-400">
                            Sem listas associadas.
                        </p>
                    </div>
                </div>

                <!-- Histórico de eventos -->
                <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div class="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
                        <h3 class="font-semibold text-slate-900 text-sm">Histórico de eventos</h3>
                        <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                            {{ events.length }}
                        </span>
                    </div>

                    <div v-if="events.length" class="divide-y divide-slate-100">
                        <div v-for="ev in events" :key="ev.id"
                             class="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                            <!-- Dot -->
                            <div class="mt-1.5 flex-shrink-0">
                                <div :class="['w-2 h-2 rounded-full', eventStyle[ev.event_type]?.dot ?? 'bg-slate-300']"></div>
                            </div>
                            <!-- Badge + campanha -->
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span :class="['px-2 py-0.5 rounded text-xs font-medium', eventStyle[ev.event_type]?.badge ?? 'bg-slate-100 text-slate-600']">
                                        {{ eventStyle[ev.event_type]?.label ?? ev.event_type }}
                                    </span>
                                    <span v-if="ev.campaign?.name" class="text-sm text-slate-700 truncate">
                                        {{ ev.campaign.name }}
                                    </span>
                                </div>
                                <!-- URL clicado (se existir) -->
                                <p v-if="ev.event_data?.url" class="text-xs text-slate-400 mt-0.5 truncate">
                                    {{ ev.event_data.url }}
                                </p>
                            </div>
                            <!-- Data -->
                            <span class="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                                {{ fmt(ev.occurred_at) }}
                            </span>
                        </div>
                    </div>

                    <div v-else class="px-5 py-10 text-center text-slate-400 text-sm">
                        Ainda não há eventos registados para este contacto.
                    </div>
                </div>

                <!-- Danger zone -->
                <div class="bg-white border border-red-200 rounded-xl p-4">
                    <h4 class="text-sm font-medium text-red-700 mb-2">Zona de perigo</h4>
                    <button @click="removeContact"
                            class="text-sm text-red-600 hover:text-red-800 transition-colors">
                        Remover desta marca
                    </button>
                </div>
            </div>

            <!-- Coluna lateral — engagement -->
            <div class="space-y-4">
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <h3 class="font-semibold text-slate-900 text-sm mb-4">Engagement</h3>
                    <div class="space-y-3">
                        <div class="text-center p-4 bg-slate-50 rounded-xl">
                            <p class="text-3xl font-semibold text-slate-900">{{ stats.emails_sent.toLocaleString('pt-PT') }}</p>
                            <p class="text-xs text-slate-500 mt-0.5">Emails entregues</p>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div class="text-center p-3 bg-green-50 rounded-xl">
                                <p class="text-2xl font-semibold text-green-700">{{ stats.emails_opened.toLocaleString('pt-PT') }}</p>
                                <p class="text-xs text-slate-500 mt-0.5">Abertos</p>
                            </div>
                            <div class="text-center p-3 bg-blue-50 rounded-xl">
                                <p class="text-2xl font-semibold text-blue-700">{{ stats.emails_clicked.toLocaleString('pt-PT') }}</p>
                                <p class="text-xs text-slate-500 mt-0.5">Cliques</p>
                            </div>
                        </div>
                        <!-- Taxa de abertura -->
                        <div v-if="stats.emails_sent > 0" class="pt-1">
                            <div class="flex justify-between text-xs mb-1">
                                <span class="text-slate-500">Taxa de abertura</span>
                                <span class="font-medium">{{ Math.round(stats.emails_opened / stats.emails_sent * 100) }}%</span>
                            </div>
                            <div class="w-full bg-slate-100 rounded-full h-1.5">
                                <div class="h-1.5 bg-green-500 rounded-full"
                                     :style="{ width: Math.min(Math.round(stats.emails_opened / stats.emails_sent * 100), 100) + '%' }"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
