<script setup>
import { Link } from '@inertiajs/vue3';

defineProps({
    links: { type: Array, required: true },
});
</script>

<template>
    <nav v-if="links.length > 3" class="flex items-center justify-between border-t border-slate-200 pt-4 mt-4">
        <div class="flex items-center gap-1">
            <template v-for="link in links" :key="link.label">
                <Link
                    v-if="link.url"
                    :href="link.url"
                    preserve-scroll
                    :class="[
                        'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                        link.active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'text-slate-600 border-slate-200 hover:border-slate-400'
                    ]"
                    v-html="link.label"
                />
                <span
                    v-else
                    class="px-3 py-1.5 text-sm text-slate-400"
                    v-html="link.label"
                />
            </template>
        </div>
    </nav>
</template>
