<script setup>
import { Head, usePage, router } from '@inertiajs/vue3';
import { computed } from 'vue';

const page = usePage();
const user = computed(() => page.props.auth.user);
const activeBrand = computed(() => page.props.activeBrand);

const switchBrand = () => router.post(route('brands.switch'));
const logout = () => router.post(route('logout'));
</script>

<template>
    <Head title="Dashboard" />

    <div class="min-h-screen bg-slate-50">
        <!-- Header -->
        <header class="bg-white border-b border-slate-200">
            <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <div
                        class="w-10 h-10 rounded-lg shadow-inner ring-1 ring-slate-200"
                        :style="{ backgroundColor: activeBrand?.primary_color }"
                    ></div>
                    <div>
                        <h1 class="text-lg font-semibold text-slate-900">{{ activeBrand?.name }}</h1>
                        <p class="text-xs text-slate-500">{{ activeBrand?.slug }}</p>
                    </div>
                </div>

                <div class="flex items-center gap-4">
                    <button
                        @click="switchBrand"
                        class="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                    >
                        Trocar de marca
                    </button>

                    <div class="h-8 w-px bg-slate-200"></div>

                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold">
                            {{ user?.name?.[0]?.toUpperCase() }}
                        </div>
                        <div class="text-sm">
                            <p class="font-medium text-slate-900">{{ user?.name }}</p>
                            <button
                                @click="logout"
                                class="text-xs text-slate-500 hover:text-red-600 transition-colors"
                            >
                                Terminar sessão
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <!-- Conteúdo -->
        <main class="max-w-7xl mx-auto px-6 py-8">
            <h2 class="text-2xl font-semibold text-slate-900 mb-6">Dashboard</h2>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-white rounded-xl border border-slate-200 p-6">
                    <p class="text-sm text-slate-500">Campanhas Enviadas</p>
                    <p class="text-3xl font-semibold text-slate-900 mt-2">—</p>
                    <p class="text-xs text-slate-400 mt-1">Últimos 30 dias</p>
                </div>
                <div class="bg-white rounded-xl border border-slate-200 p-6">
                    <p class="text-sm text-slate-500">Contactos Ativos</p>
                    <p class="text-3xl font-semibold text-slate-900 mt-2">—</p>
                    <p class="text-xs text-slate-400 mt-1">Lista geral</p>
                </div>
                <div class="bg-white rounded-xl border border-slate-200 p-6">
                    <p class="text-sm text-slate-500">Taxa de Abertura Média</p>
                    <p class="text-3xl font-semibold text-slate-900 mt-2">—</p>
                    <p class="text-xs text-slate-400 mt-1">Últimas 10 campanhas</p>
                </div>
            </div>

            <div class="mt-8 bg-white rounded-xl border border-slate-200 p-6">
                <h3 class="font-semibold text-slate-900 mb-2">Próximos Passos</h3>
                <ul class="text-sm text-slate-600 space-y-1.5 mt-3">
                    <li>→ Criar controllers para Campanhas, Contactos e Templates</li>
                    <li>→ UI de importação de contactos (drag &amp; drop CSV)</li>
                    <li>→ Editor MJML com preview em tempo real</li>
                    <li>→ Integração Mailgun + tracking de aberturas/cliques</li>
                </ul>
            </div>
        </main>
    </div>
</template>
