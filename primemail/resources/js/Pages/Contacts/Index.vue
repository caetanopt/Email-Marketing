<script setup>
import { ref, watch } from 'vue';
import { router, Link } from '@inertiajs/vue3';
import { useDebounceFn } from '@vueuse/core';
import AppLayout from '@/Layouts/AppLayout.vue';
import Pagination from '@/Components/Pagination.vue';
import SearchInput from '@/Components/SearchInput.vue';

const props = defineProps({
    contacts: { type: Object, required: true },
    lists:    { type: Array, required: true },
    filters:  { type: Object, default: () => ({}) },
});

const search  = ref(props.filters.search  ?? '');
const listId  = ref(props.filters.list_id ?? '');

const applyFilters = useDebounceFn(() => {
    router.get(route('contacts.index'), {
        search:  search.value  || undefined,
        list_id: listId.value  || undefined,
    }, { preserveState: true, replace: true });
}, 350);

watch([search, listId], applyFilters);
</script>

<template>
    <AppLayout title="Contactos">
        <template #actions>
            <Link :href="route('imports.index')" class="flex items-center gap-2 px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                Importar
            </Link>
            <Link :href="route('contacts.create')" class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Novo Contacto
            </Link>
        </template>

        <!-- Filtros -->
        <div class="flex gap-3 mb-5">
            <SearchInput v-model="search" placeholder="Pesquisar por email, nome ou empresa…" class="flex-1 max-w-sm" />
            <select v-model="listId" class="border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900">
                <option value="">Todas as listas</option>
                <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
            </select>
        </div>

        <!-- Tabela -->
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Email</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Nome</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Empresa</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Criado em</th>
                        <th class="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="contact in contacts.data"
                        :key="contact.id"
                        class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                    >
                        <td class="px-4 py-3">
                            <Link :href="route('contacts.show', contact.id)" class="text-slate-900 hover:text-blue-600 font-medium">
                                {{ contact.email }}
                            </Link>
                        </td>
                        <td class="px-4 py-3 text-slate-600">
                            {{ [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—' }}
                        </td>
                        <td class="px-4 py-3 text-slate-600">{{ contact.company || '—' }}</td>
                        <td class="px-4 py-3 text-slate-500 text-xs">{{ new Date(contact.created_at).toLocaleDateString('pt-PT') }}</td>
                        <td class="px-4 py-3 text-right">
                            <Link :href="route('contacts.edit', contact.id)" class="text-slate-500 hover:text-slate-900 transition-colors text-xs">Editar</Link>
                        </td>
                    </tr>
                    <tr v-if="contacts.data.length === 0">
                        <td colspan="5" class="px-4 py-12 text-center text-slate-400">
                            Nenhum contacto encontrado.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Pagination :links="contacts.links" class="mt-4" />

        <p class="text-xs text-slate-400 mt-2">{{ contacts.total }} contacto{{ contacts.total === 1 ? '' : 's' }} no total</p>
    </AppLayout>
</template>
