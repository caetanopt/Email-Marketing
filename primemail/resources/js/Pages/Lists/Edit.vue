<script setup>
import { ref } from 'vue';
import { useForm, router, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    list:    { type: Object, required: true },
    members: { type: Object, required: true },
    search:  { type: String, default: '' },
});

const form = useForm({
    name:        props.list.name,
    description: props.list.description ?? '',
});

const submit = () => form.put(route('lists.update', props.list.id));

const searchQuery = ref(props.search ?? '');
const doSearch = () => {
    router.get(route('lists.edit', props.list.id), { search: searchQuery.value }, { preserveState: true });
};

const removeMember = (contact) => {
    if (!confirm(`Remover "${contact.first_name ?? contact.email}" desta lista?`)) return;
    router.delete(route('lists.members.remove', [props.list.id, contact.id]), {
        preserveScroll: true,
    });
};

const statusStyle = {
    active:       'bg-green-100 text-green-700',
    unsubscribed: 'bg-yellow-100 text-yellow-700',
    bounced:      'bg-red-100 text-red-700',
    suppressed:   'bg-orange-100 text-orange-700',
};
const statusLabel = {
    active:       'Activo',
    unsubscribed: 'Dessubscrito',
    bounced:      'Bounce',
    suppressed:   'Suprimido',
};
</script>

<template>
    <AppLayout :title="list.name">
        <template #actions>
            <button
                type="button"
                @click="submit"
                :disabled="form.processing || !form.isDirty"
                class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
                {{ form.processing ? 'A guardar…' : 'Guardar alterações' }}
            </button>
        </template>

        <div class="space-y-6">

            <!-- Formulário de edição -->
            <form @submit.prevent="submit" class="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 gap-4 items-start">
                <div>
                    <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Nome da Lista *</label>
                    <input
                        v-model="form.name"
                        type="text"
                        required
                        :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900',
                                 form.errors.name ? 'border-red-400' : 'border-slate-200']"
                    />
                    <p v-if="form.errors.name" class="mt-1 text-xs text-red-600">{{ form.errors.name }}</p>
                </div>
                <div>
                    <label class="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Descrição</label>
                    <input
                        v-model="form.description"
                        type="text"
                        class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                        placeholder="Opcional"
                    />
                </div>
            </form>

            <!-- Tabela de contactos -->
            <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <!-- Cabeçalho -->
                <div class="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
                    <div class="flex items-center gap-2">
                        <h2 class="font-semibold text-slate-900 text-sm">Contactos na lista</h2>
                        <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                            {{ members.total?.toLocaleString('pt-PT') ?? 0 }}
                        </span>
                    </div>
                    <form @submit.prevent="doSearch" class="flex items-center gap-2">
                        <input
                            v-model="searchQuery"
                            type="text"
                            placeholder="Pesquisar por nome ou email…"
                            class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                        <button type="submit" class="px-3 py-1.5 border border-slate-200 rounded-lg text-xs hover:bg-slate-50">
                            Pesquisar
                        </button>
                        <Link
                            v-if="search"
                            :href="route('lists.edit', list.id)"
                            class="text-xs text-slate-400 hover:text-slate-700"
                        >Limpar</Link>
                    </form>
                </div>

                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-slate-200 bg-slate-50">
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Contacto</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Email</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Estado</th>
                            <th class="px-4 py-3 text-left font-medium text-slate-500">Adicionado em</th>
                            <th class="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="m in members.data"
                            :key="m.id"
                            class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                        >
                            <td class="px-4 py-3 font-medium text-slate-900">
                                {{ [m.contact?.first_name, m.contact?.last_name].filter(Boolean).join(' ') || '—' }}
                            </td>
                            <td class="px-4 py-3 text-slate-600">
                                <Link :href="route('contacts.show', m.contact?.id)"
                                      class="hover:underline hover:text-slate-900">
                                    {{ m.contact?.email }}
                                </Link>
                            </td>
                            <td class="px-4 py-3">
                                <span :class="['px-2.5 py-0.5 rounded-full text-xs font-medium', statusStyle[m.status] ?? 'bg-slate-100 text-slate-500']">
                                    {{ statusLabel[m.status] ?? m.status }}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-xs text-slate-500">
                                {{ m.subscribed_at ? new Date(m.subscribed_at).toLocaleDateString('pt-PT') : '—' }}
                            </td>
                            <td class="px-4 py-3 text-right">
                                <button
                                    @click="removeMember(m.contact)"
                                    class="text-xs text-red-500 hover:text-red-700 transition-colors"
                                >
                                    Remover
                                </button>
                            </td>
                        </tr>
                        <tr v-if="!members.data?.length">
                            <td colspan="5" class="px-4 py-12 text-center text-slate-400">
                                <span v-if="search">Nenhum contacto encontrado para "{{ search }}".</span>
                                <span v-else>Esta lista não tem contactos.</span>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <!-- Paginação -->
                <div
                    v-if="members.last_page > 1"
                    class="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500"
                >
                    <span>Mostrando {{ members.from }}–{{ members.to }} de {{ members.total?.toLocaleString('pt-PT') }}</span>
                    <div class="flex gap-1">
                        <Link
                            v-for="link in members.links"
                            :key="link.label"
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

        </div>
    </AppLayout>
</template>
