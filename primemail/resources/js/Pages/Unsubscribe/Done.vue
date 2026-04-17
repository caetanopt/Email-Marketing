<script setup>
defineProps({ email: { type: String, required: true } });
</script>

<template>
    <div class="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div class="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center shadow-sm">
            <div class="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <svg class="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                </svg>
            </div>
            <h1 class="text-xl font-semibold text-slate-900 mb-2">Subscrição cancelada</h1>
            <p class="text-sm text-slate-500">
                O endereço <span class="font-medium text-slate-700">{{ email }}</span>
                foi removido da lista. Não receberás mais emails de marketing desta marca.
            </p>
        </div>
    </div>
</template>
