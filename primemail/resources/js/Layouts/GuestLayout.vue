<script setup>
defineProps({
    title: { type: String, default: '' },
});
</script>

<template>
    <div class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-8 px-4">
        <div class="w-full max-w-md">
            <!-- Logo Caetano -->
            <div class="mb-8 text-center">
                <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-xl mb-4">
                    <svg class="w-9 h-9 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </div>
                <h1 class="text-2xl font-semibold text-white tracking-tight">Caetano PrimeMail</h1>
                <p class="text-sm text-slate-400 mt-1">Plataforma de Email Marketing Multi-Marca</p>
            </div>

            <!-- Card de conteúdo -->
            <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8">
                <h2 v-if="title" class="text-xl font-semibold text-slate-900 mb-6">{{ title }}</h2>
                <slot />
            </div>

            <p class="text-center text-xs text-slate-500 mt-6">
                © {{ new Date().getFullYear() }} Grupo Caetano. Todos os direitos reservados.
            </p>
        </div>
    </div>
</template>
