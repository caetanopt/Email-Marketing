<script setup>
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    list: { type: Object, required: true },
});

const form = useForm({
    name:        props.list.name,
    description: props.list.description ?? '',
});

const submit = () => form.put(route('lists.update', props.list.id));
</script>

<template>
    <AppLayout :title="`Editar Lista — ${list.name}`">
        <div class="max-w-xl">
            <form @submit.prevent="submit" class="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Nome da Lista *</label>
                    <input v-model="form.name" type="text" required
                           :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900',
                                    form.errors.name ? 'border-red-400' : 'border-slate-200']"
                           placeholder="Ex: Newsletter BMW Setembro 2026" />
                    <p v-if="form.errors.name" class="mt-1 text-xs text-red-600">{{ form.errors.name }}</p>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Descrição (opcional)</label>
                    <textarea v-model="form.description" rows="3"
                              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
                              placeholder="Para que serve esta lista?" />
                </div>
                <div class="flex items-center gap-3 pt-1">
                    <button type="submit" :disabled="form.processing || !form.isDirty"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        Guardar alterações
                    </button>
                    <Link :href="route('lists.index')" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">
                        Cancelar
                    </Link>
                </div>
            </form>
        </div>
    </AppLayout>
</template>
