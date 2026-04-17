<script setup>
import { computed } from 'vue';
import { router, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    contact: { type: Object, required: true },
    stats:   { type: Object, required: true },
});

const fullName = computed(() =>
    [props.contact.first_name, props.contact.last_name].filter(Boolean).join(' ') || '—'
);

const relation = computed(() => props.contact.brand_relations?.[0] ?? null);

const removeContact = () => {
    if (!confirm(`Remover ${fullName.value} desta marca?`)) return;
    router.delete(route('contacts.destroy', props.contact.id));
};
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
            <!-- Info principal -->
            <div class="col-span-2 space-y-5">
                <div class="bg-white border border-slate-200 rounded-xl p-6">
                    <div class="flex items-center gap-4 mb-6">
                        <div class="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-xl font-semibold text-slate-600">
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
                                <span :class="relation.status === 'active' ? 'text-green-700 bg-green-100' : 'text-slate-600 bg-slate-100'"
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
                            <span class="text-sm text-slate-700">{{ m.list?.name ?? '—' }}</span>
                            <span :class="m.status === 'active' ? 'text-green-700 bg-green-100' : 'text-slate-500 bg-slate-100'"
                                  class="px-2 py-0.5 rounded-full text-xs font-medium">
                                {{ m.status === 'active' ? 'Subscrito' : 'Removido' }}
                            </span>
                        </div>
                        <p v-if="!contact.list_memberships?.length" class="text-sm text-slate-400">
                            Sem listas associadas.
                        </p>
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

            <!-- Engagement stats -->
            <div class="space-y-4">
                <div class="bg-white border border-slate-200 rounded-xl p-5">
                    <h3 class="font-semibold text-slate-900 mb-4 text-sm">Engagement</h3>
                    <div class="grid grid-cols-1 gap-3">
                        <div class="text-center p-3 bg-slate-50 rounded-lg">
                            <p class="text-2xl font-semibold text-slate-900">{{ stats.emails_sent.toLocaleString('pt-PT') }}</p>
                            <p class="text-xs text-slate-500 mt-0.5">Emails recebidos</p>
                        </div>
                        <div class="text-center p-3 bg-green-50 rounded-lg">
                            <p class="text-2xl font-semibold text-green-700">{{ stats.emails_opened.toLocaleString('pt-PT') }}</p>
                            <p class="text-xs text-slate-500 mt-0.5">Abertos</p>
                        </div>
                        <div class="text-center p-3 bg-blue-50 rounded-lg">
                            <p class="text-2xl font-semibold text-blue-700">{{ stats.emails_clicked.toLocaleString('pt-PT') }}</p>
                            <p class="text-xs text-slate-500 mt-0.5">Cliques</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
