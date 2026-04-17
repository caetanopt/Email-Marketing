<script setup>
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

defineProps({
    lists: { type: Array, default: () => [] },
});

const form = useForm({
    email:      '',
    first_name: '',
    last_name:  '',
    phone:      '',
    company:    '',
    consent:    false,
    list_ids:   [],
});

const submit = () => form.post(route('contacts.store'));
</script>

<template>
    <AppLayout title="Novo Contacto">
        <div class="max-w-2xl">
            <form @submit.prevent="submit" class="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                <!-- Email -->
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                    <input v-model="form.email" type="email" required
                           :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.email ? 'border-red-400' : 'border-slate-200']" />
                    <p v-if="form.errors.email" class="mt-1 text-xs text-red-600">{{ form.errors.email }}</p>
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

                <!-- Telefone + Empresa -->
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

                <!-- Listas -->
                <div v-if="lists.length">
                    <label class="block text-sm font-medium text-slate-700 mb-2">Adicionar a listas</label>
                    <div class="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                        <label v-for="list in lists" :key="list.id" class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer">
                            <input type="checkbox" :value="list.id" v-model="form.list_ids"
                                   class="rounded border-slate-300 text-slate-900" />
                            <span class="text-sm text-slate-700">{{ list.name }}</span>
                        </label>
                    </div>
                </div>

                <!-- Consentimento -->
                <label class="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" v-model="form.consent" class="mt-0.5 rounded border-slate-300 text-slate-900" />
                    <span class="text-sm text-slate-700">
                        O contacto deu consentimento para receber comunicações de marketing desta marca (RGPD).
                    </span>
                </label>

                <!-- Acções -->
                <div class="flex items-center gap-3 pt-2">
                    <button type="submit" :disabled="form.processing"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        Criar Contacto
                    </button>
                    <Link :href="route('contacts.index')" class="px-5 py-2 text-sm text-slate-600 hover:text-slate-900">
                        Cancelar
                    </Link>
                </div>
            </form>
        </div>
    </AppLayout>
</template>
