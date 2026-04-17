<script setup>
import { computed } from 'vue';
import { usePage, router, Link, Head } from '@inertiajs/vue3';

defineProps({
    title: { type: String, default: '' },
});

const page = usePage();
const user        = computed(() => page.props.auth.user);
const activeBrand = computed(() => page.props.activeBrand);
const flash       = computed(() => page.props.flash);

const nav = [
    { name: 'Dashboard',  route: 'dashboard',      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { name: 'Contactos',  route: 'contacts.index',  icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
    { name: 'Listas',     route: 'lists.index',     icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
    { name: 'Importações',route: 'imports.index',   icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' },
    { name: 'Templates',  route: 'templates.index', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
    { name: 'Campanhas',  route: 'campaigns.index',  icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { name: 'Supressão',  route: 'suppression.index', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
];

const isActive = (routeName) => route().current(routeName + '*') || route().current(routeName);

const switchBrand = () => router.post(route('brands.switch'));
const logout      = () => router.post(route('logout'));
</script>

<template>
    <div class="min-h-screen bg-slate-50 flex">
        <!-- Sidebar -->
        <aside class="w-64 bg-slate-900 flex flex-col fixed inset-y-0 left-0 z-20">
            <!-- Marca ativa -->
            <div class="px-5 py-5 border-b border-slate-700">
                <div class="flex items-center gap-3">
                    <div
                        class="w-9 h-9 rounded-lg flex-shrink-0 ring-1 ring-slate-600"
                        :style="{ backgroundColor: activeBrand?.primary_color }"
                    ></div>
                    <div class="min-w-0">
                        <p class="text-white font-semibold text-sm truncate">{{ activeBrand?.name }}</p>
                        <button
                            @click="switchBrand"
                            class="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                        >
                            Trocar de marca
                        </button>
                    </div>
                </div>
            </div>

            <!-- Nav -->
            <nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                <template v-for="item in nav" :key="item.name">
                    <Link
                        :href="route(item.route)"
                        :class="[
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                            isActive(item.route)
                                ? 'bg-slate-700 text-white'
                                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        ]"
                    >
                        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" :d="item.icon" />
                        </svg>
                        {{ item.name }}
                    </Link>
                </template>
            </nav>

            <!-- Utilizador -->
            <div class="px-4 py-4 border-t border-slate-700">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-slate-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                        {{ user?.name?.[0]?.toUpperCase() }}
                    </div>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium text-white truncate">{{ user?.name }}</p>
                        <p class="text-xs text-slate-400 truncate">{{ user?.email }}</p>
                    </div>
                    <button @click="logout" title="Terminar sessão" class="text-slate-400 hover:text-red-400 transition-colors flex-shrink-0">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>
                </div>
            </div>
        </aside>

        <!-- Conteúdo -->
        <div class="flex-1 ml-64 flex flex-col min-h-screen">
            <!-- Header -->
            <header class="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
                <h1 v-if="title" class="text-xl font-semibold text-slate-900">{{ title }}</h1>
                <div class="ml-auto flex items-center gap-3">
                    <slot name="actions" />
                </div>
            </header>

            <!-- Flash messages -->
            <div v-if="flash?.success || flash?.error" class="px-8 pt-4">
                <div v-if="flash?.success" class="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
                    <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                    {{ flash.success }}
                </div>
                <div v-if="flash?.error" class="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
                    <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    {{ flash.error }}
                </div>
            </div>

            <!-- Slot principal -->
            <main class="flex-1 px-8 py-6">
                <slot />
            </main>
        </div>
    </div>

    <Head :title="title" />
</template>
