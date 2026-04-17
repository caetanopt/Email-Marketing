<script setup>
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    contact:  { type: Object, required: true },
    relation: { type: Object, default: null },
});

const form = useForm({
    first_name: props.contact.first_name ?? '',
    last_name:  props.contact.last_name  ?? '',
    phone:      props.contact.phone      ?? '',
    company:    props.contact.company    ?? '',
    consent:    props.relation?.consent_given ?? false,
});

const submit = () => form.put(route('contacts.update', props.contact.id));
</script>

<template>
    <AppLayout :title="`Editar — ${contact.email}`">
        <div class="max-w-2xl">
            <form @submit.prevent="submit" class="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                <!-- Email (read-only) -->
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input :value="contact.email" type="email" disabled
                           class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed" />
                    <p class="mt-1 text-xs text-slate-400">O email não pode ser alterado.</p>
                </div>

                <!-- Nome -->
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Primeiro Nome</label>
                        <input v-model="form.first_name" type="text"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Apelido</label>
                        <input v-model="form.last_name" type="text"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                        <input v-model="form.phone" type="tel"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Empresa</label>
                        <input v-model="form.company" type="text"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                </div>

                <label class="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" v-model="form.consent" class="mt-0.5 rounded border-slate-300 text-slate-900" />
                    <span class="text-sm text-slate-700">Consentimento de marketing (RGPD)</span>
                </label>

                <div class="flex items-center gap-3 pt-2">
                    <button type="submit" :disabled="form.processing"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        Guardar Alterações
                    </button>
                    <Link :href="route('contacts.show', contact.id)" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">
                        Cancelar
                    </Link>
                </div>
            </form>
        </div>
    </AppLayout>
</template>
