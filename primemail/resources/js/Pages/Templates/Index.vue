<script setup>
import { Link, router } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

defineProps({
    templates: { type: Array, required: true },
});

const destroy = (t) => {
    if (!confirm(`Eliminar o template "${t.name}"?`)) return;
    router.delete(route('templates.destroy', t.id));
};

const statusBadge = (t) => {
    if (t.has_error)  return { label: 'Erro MJML', class: 'bg-red-100 text-red-700' };
    if (t.is_ready)   return { label: 'Pronto',    class: 'bg-green-100 text-green-700' };
    return { label: 'Sem compilar', class: 'bg-slate-100 text-slate-600' };
};
</script>

<template>
    <AppLayout title="Templates">
        <template #actions>
            <Link :href="route('templates.create')" class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Novo Template
            </Link>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div
                v-for="template in templates"
                :key="template.id"
                class="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow"
            >
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <h3 class="font-semibold text-slate-900 truncate">{{ template.name }}</h3>
                        <p v-if="template.description" class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ template.description }}</p>
                    </div>
                    <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(template).class]">
                            {{ statusBadge(template).label }}
                        </span>
                        <span v-if="template.is_shared" class="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">Partilhado</span>
                    </div>
                </div>

                <p v-if="template.has_error" class="text-xs text-red-600 bg-red-50 p-2 rounded font-mono truncate">
                    {{ template.compile_error }}
                </p>

                <div class="flex items-center gap-3 mt-auto pt-2 border-t border-slate-100">
                    <Link :href="route('templates.edit', template.id)"
                          class="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium">
                        Editar
                    </Link>
                    <button @click="destroy(template)"
                            class="text-sm text-red-500 hover:text-red-700 transition-colors ml-auto">
                        Eliminar
                    </button>
                </div>
            </div>

            <!-- Empty state -->
            <div v-if="!templates.length" class="col-span-3 py-16 text-center text-slate-400">
                <svg class="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z"/>
                </svg>
                <p>Nenhum template criado.</p>
                <Link :href="route('templates.create')" class="text-slate-600 underline text-sm mt-1 inline-block">Criar primeiro template</Link>
            </div>
        </div>
    </AppLayout>
</template>
