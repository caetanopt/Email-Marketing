<script setup>
import { useForm, Head } from '@inertiajs/vue3';
import GuestLayout from '@/Layouts/GuestLayout.vue';

defineProps({
    canResetPassword: Boolean,
});

const form = useForm({
    email: '',
    password: '',
    remember: false,
});

const submit = () => {
    form.post(route('login'), {
        onFinish: () => form.reset('password'),
    });
};
</script>

<template>
    <Head title="Iniciar Sessão" />

    <GuestLayout title="Iniciar Sessão">
        <form @submit.prevent="submit" class="space-y-5">
            <!-- Email -->
            <div>
                <label for="email" class="block text-sm font-medium text-slate-700 mb-1.5">
                    Email
                </label>
                <input
                    id="email"
                    v-model="form.email"
                    type="email"
                    required
                    autofocus
                    autocomplete="username"
                    :class="[
                        'w-full px-4 py-2.5 rounded-lg border text-slate-900 placeholder-slate-400',
                        'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
                        'transition-colors',
                        form.errors.email ? 'border-red-400' : 'border-slate-300'
                    ]"
                    placeholder="admin@caetano.pt"
                />
                <p v-if="form.errors.email" class="mt-1.5 text-sm text-red-600">
                    {{ form.errors.email }}
                </p>
            </div>

            <!-- Password -->
            <div>
                <label for="password" class="block text-sm font-medium text-slate-700 mb-1.5">
                    Palavra-passe
                </label>
                <input
                    id="password"
                    v-model="form.password"
                    type="password"
                    required
                    autocomplete="current-password"
                    :class="[
                        'w-full px-4 py-2.5 rounded-lg border text-slate-900 placeholder-slate-400',
                        'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent',
                        'transition-colors',
                        form.errors.password ? 'border-red-400' : 'border-slate-300'
                    ]"
                    placeholder="••••••••••"
                />
                <p v-if="form.errors.password" class="mt-1.5 text-sm text-red-600">
                    {{ form.errors.password }}
                </p>
            </div>

            <!-- Remember + Reset -->
            <div class="flex items-center justify-between">
                <label class="flex items-center cursor-pointer">
                    <input
                        v-model="form.remember"
                        type="checkbox"
                        class="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span class="ml-2 text-sm text-slate-600">Manter sessão iniciada</span>
                </label>
                <a
                    v-if="canResetPassword"
                    href="#"
                    class="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                >
                    Esqueci-me da palavra-passe
                </a>
            </div>

            <!-- Submit -->
            <button
                type="submit"
                :disabled="form.processing"
                class="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center"
            >
                <svg
                    v-if="form.processing"
                    class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                >
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                Entrar
            </button>
        </form>
    </GuestLayout>
</template>
