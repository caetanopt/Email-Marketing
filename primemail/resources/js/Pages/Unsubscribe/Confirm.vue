<script setup>
import { useForm } from '@inertiajs/vue3';

const props = defineProps({
    brandId:   { type: Number, required: true },
    emailHash: { type: String, required: true },
});

const form = useForm({});
const submit = () => form.post(route('unsubscribe', { brandId: props.brandId, emailHash: props.emailHash }));
</script>

<template>
    <div class="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div class="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center shadow-sm">
            <div class="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <svg class="w-7 h-7 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
            </div>
            <h1 class="text-xl font-semibold text-slate-900 mb-2">Cancelar subscrição</h1>
            <p class="text-sm text-slate-500 mb-7">
                Clica no botão abaixo para deixar de receber emails desta lista.
                Não receberás mais comunicações de marketing desta marca.
            </p>
            <button @click="submit" :disabled="form.processing"
                    class="w-full py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                Confirmar cancelamento
            </button>
        </div>
    </div>
</template>
