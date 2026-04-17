<script setup>
import { ref } from 'vue';
import { useForm, router } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    members: { type: Array,  required: true },
    roles:   { type: Array,  required: true },
});

const inviteForm = useForm({
    email:   '',
    role_id: props.roles[0]?.id ?? null,
});

const showInvite = ref(false);
const invite = () => inviteForm.post(route('team.invite'), {
    onSuccess: () => { inviteForm.reset(); showInvite.value = false; },
});

const remove = (memberId, name) => {
    if (!confirm(`Remover ${name} desta marca?`)) return;
    router.delete(route('team.remove', memberId));
};

const roleLabel = (name) => ({
    admin:        'Administrador',
    editor:       'Editor',
    viewer:       'Visualizador',
    manager:      'Gestor',
    group_admin:  'Admin de Grupo',
})[name] ?? name;
</script>

<template>
    <AppLayout title="Equipa">
        <template #actions>
            <button @click="showInvite = !showInvite"
                    class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Adicionar membro
            </button>
        </template>

        <!-- Formulário de convite -->
        <div v-if="showInvite" class="bg-white border border-slate-200 rounded-xl p-5 mb-5 max-w-lg">
            <h3 class="font-semibold text-slate-900 mb-4 text-sm">Adicionar membro à marca</h3>
            <form @submit.prevent="invite" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                    <input v-model="inviteForm.email" type="email" required
                           :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', inviteForm.errors.email ? 'border-red-400' : 'border-slate-200']"
                           placeholder="utilizador@exemplo.pt" />
                    <p v-if="inviteForm.errors.email" class="mt-1 text-xs text-red-600">{{ inviteForm.errors.email }}</p>
                    <p class="mt-1 text-xs text-slate-400">O utilizador deve já ter conta na plataforma.</p>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Papel *</label>
                    <select v-model="inviteForm.role_id"
                            class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
                        <option v-for="r in roles" :key="r.id" :value="r.id">{{ roleLabel(r.name) }}</option>
                    </select>
                </div>
                <div class="flex gap-3">
                    <button type="submit" :disabled="inviteForm.processing"
                            class="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        Adicionar
                    </button>
                    <button type="button" @click="showInvite = false"
                            class="px-4 py-2 text-sm text-slate-500 hover:text-slate-900">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>

        <!-- Lista de membros -->
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200 bg-slate-50">
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Utilizador</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Papel</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Adicionado por</th>
                        <th class="px-4 py-3 text-left font-medium text-slate-500">Data</th>
                        <th class="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="m in members" :key="m.id"
                        class="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                        <td class="px-4 py-3">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                                    {{ m.name[0]?.toUpperCase() }}
                                </div>
                                <div>
                                    <p class="font-medium text-slate-900">{{ m.name }}
                                        <span v-if="m.is_self" class="ml-1 text-xs text-slate-400">(tu)</span>
                                    </p>
                                    <p class="text-xs text-slate-400">{{ m.email }}</p>
                                </div>
                            </div>
                        </td>
                        <td class="px-4 py-3">
                            <span class="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full text-xs font-medium">
                                {{ roleLabel(m.role) }}
                            </span>
                        </td>
                        <td class="px-4 py-3 text-slate-500 text-xs">{{ m.granted_by ?? '—' }}</td>
                        <td class="px-4 py-3 text-xs text-slate-500">
                            {{ new Date(m.granted_at).toLocaleDateString('pt-PT') }}
                        </td>
                        <td class="px-4 py-3 text-right">
                            <button v-if="!m.is_self" @click="remove(m.id, m.name)"
                                    class="text-xs text-red-500 hover:text-red-700 transition-colors">
                                Remover
                            </button>
                        </td>
                    </tr>
                    <tr v-if="!members.length">
                        <td colspan="5" class="px-4 py-12 text-center text-slate-400">
                            Nenhum membro na equipa.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </AppLayout>
</template>
