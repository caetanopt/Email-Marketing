<script setup>
import { Link, router } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

defineProps({
    lists: { type: Array, required: true },
});

const destroy = (list) => {
    if (!confirm(`Eliminar a lista "${list.name}"? Os contactos não serão apagados.`)) return;
    router.delete(route('lists.destroy', list.id));
};
</script>

<template>
    <AppLayout title="Listas de Contactos">
        <template #actions>
            <Link :href="route('lists.create')" class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Nova Lista
            </Link>
        </template>

        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Nome</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Contactos Activos</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Criada em</th>
                        <th class="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="list in lists"
                        :key="list.id"
                        class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                    >
                        <td class="px-4 py-3">
                            <p class="font-medium text-slate-900">{{ list.name }}</p>
                            <p v-if="list.description" class="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{{ list.description }}</p>
                        </td>
                        <td class="px-4 py-3 text-slate-700">
                            {{ (list.active_count ?? 0).toLocaleString('pt-PT') }}
                        </td>
                        <td class="px-4 py-3 text-xs text-slate-500">
                            {{ new Date(list.created_at).toLocaleDateString('pt-PT') }}
                        </td>
                        <td class="px-4 py-3 text-right">
                            <div class="flex items-center justify-end gap-3">
                                <Link :href="route('lists.edit', list.id)" class="text-xs text-slate-500 hover:text-slate-900 transition-colors">Editar</Link>
                                <button @click="destroy(list)" class="text-xs text-red-500 hover:text-red-700 transition-colors">Eliminar</button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!lists.length">
                        <td colspan="4" class="px-4 py-12 text-center text-slate-400">
                            Nenhuma lista criada. <Link :href="route('lists.create')" class="text-slate-600 underline">Criar primeira lista</Link>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </AppLayout>
</template>
