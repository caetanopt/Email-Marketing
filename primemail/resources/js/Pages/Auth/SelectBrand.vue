<script setup>
import { useForm, Head, router } from '@inertiajs/vue3';
import GuestLayout from '@/Layouts/GuestLayout.vue';

const props = defineProps({
    brands: { type: Array, required: true },
    activeBrandId: { type: Number, default: null },
});

const form = useForm({
    brand_id: props.activeBrandId,
});

const selectBrand = (brandId) => {
    form.brand_id = brandId;
    form.post(route('brands.store'));
};

const logout = () => {
    router.post(route('logout'));
};
</script>

<template>
    <Head title="Selecionar Marca" />

    <GuestLayout title="Selecionar Marca">
        <p class="text-sm text-slate-600 mb-6">
            Tem acesso a {{ brands.length }} marca{{ brands.length === 1 ? '' : 's' }}. Escolha com qual pretende trabalhar.
        </p>

        <div class="space-y-2.5">
            <button
                v-for="brand in brands"
                :key="brand.id"
                @click="selectBrand(brand.id)"
                :disabled="form.processing"
                class="w-full flex items-center gap-4 p-4 border-2 border-slate-200 rounded-xl hover:border-slate-900 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all group text-left"
            >
                <!-- Círculo da cor da marca -->
                <div
                    class="w-12 h-12 rounded-lg flex-shrink-0 shadow-inner ring-1 ring-slate-200"
                    :style="{ backgroundColor: brand.primary_color }"
                ></div>

                <div class="flex-1 min-w-0">
                    <h3 class="font-semibold text-slate-900 truncate">{{ brand.name }}</h3>
                    <p class="text-xs text-slate-500 mt-0.5">{{ brand.slug }}</p>
                </div>

                <svg
                    class="w-5 h-5 text-slate-400 group-hover:text-slate-900 transition-colors flex-shrink-0"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <div v-if="brands.length === 0" class="text-center py-8">
            <p class="text-slate-500 text-sm">
                Não tem acesso a nenhuma marca. Contacte o administrador.
            </p>
        </div>

        <div class="mt-6 pt-6 border-t border-slate-200 text-center">
            <button
                @click="logout"
                class="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
                Terminar sessão
            </button>
        </div>
    </GuestLayout>
</template>
