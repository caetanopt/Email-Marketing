<script setup>
import { ref, computed } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    templates: { type: Array, required: true },
    lists:     { type: Array, required: true },
    brand:     { type: Object, required: true },
});

const step = ref(1);
const totalSteps = 3;

const form = useForm({
    name:         '',
    subject:      '',
    preview_text: '',
    from_name:    props.brand.from_name,
    from_email:   props.brand.from_email,
    reply_to:     '',
    template_id:  null,
    mjml_source:  null,
    content_text: null,
    list_ids:     [],
    scheduled_at: null,
});

// Preview do template seleccionado
const selectedTemplate = computed(() =>
    props.templates.find(t => t.id === form.template_id) ?? null
);

const canGoNext = computed(() => {
    if (step.value === 1) return form.name && form.subject && form.from_name && form.from_email;
    if (step.value === 2) return form.template_id !== null;
    if (step.value === 3) return form.list_ids.length > 0;
    return true;
});

const submit = () => form.post(route('campaigns.store'));
</script>

<template>
    <AppLayout title="Nova Campanha">
        <!-- Progress steps -->
        <div class="flex items-center gap-3 mb-8 max-w-2xl">
            <template v-for="n in totalSteps" :key="n">
                <div :class="[
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                    n === step ? 'bg-slate-900 text-white' : n < step ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'
                ]">
                    <svg v-if="n < step" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span v-else>{{ n }}</span>
                </div>
                <div v-if="n < totalSteps" :class="['flex-1 h-px', n < step ? 'bg-green-500' : 'bg-slate-200']" />
            </template>
            <div class="ml-2 text-sm text-slate-500">
                {{ ['Informação', 'Template', 'Listas'][step - 1] }}
            </div>
        </div>

        <div class="max-w-2xl">
            <!-- ── Step 1 — Informação ──────────────────────────────────── -->
            <div v-show="step === 1" class="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Nome interno da campanha *</label>
                    <input v-model="form.name" type="text" required
                           :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.name ? 'border-red-400' : 'border-slate-200']"
                           placeholder="Ex: Newsletter BMW — Setembro 2026" />
                    <p class="mt-1 text-xs text-slate-400">Apenas visível internamente</p>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Assunto do email *</label>
                    <input v-model="form.subject" type="text" required maxlength="998"
                           :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.subject ? 'border-red-400' : 'border-slate-200']"
                           placeholder="O que os destinatários vêem na caixa de entrada" />
                    <p class="mt-1 text-xs text-slate-400">{{ form.subject.length }}/998 caracteres</p>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700 mb-1">Texto de preview</label>
                    <input v-model="form.preview_text" type="text" maxlength="255"
                           class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                           placeholder="Breve resumo do email (após o assunto)" />
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Nome do remetente *</label>
                        <input v-model="form.from_name" type="text" required
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Email do remetente *</label>
                        <input v-model="form.from_email" type="email" required
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                </div>
            </div>

            <!-- ── Step 2 — Template ───────────────────────────────────── -->
            <div v-show="step === 2" class="space-y-3">
                <p v-if="!templates.length" class="text-sm text-slate-500 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    Não há templates compilados. <Link :href="route('templates.create')" class="text-yellow-800 underline">Cria um template MJML</Link> primeiro.
                </p>
                <button
                    v-for="t in templates"
                    :key="t.id"
                    type="button"
                    @click="form.template_id = t.id"
                    :class="[
                        'w-full flex items-center gap-4 p-4 border-2 rounded-xl text-left transition-all',
                        form.template_id === t.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'
                    ]"
                >
                    <div :class="['w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0', form.template_id === t.id ? 'border-slate-900' : 'border-slate-300']">
                        <div v-if="form.template_id === t.id" class="w-2.5 h-2.5 rounded-full bg-slate-900" />
                    </div>
                    <div>
                        <p class="font-medium text-slate-900">{{ t.name }}</p>
                        <p v-if="t.is_shared" class="text-xs text-slate-400 mt-0.5">Template partilhado</p>
                    </div>
                </button>
            </div>

            <!-- ── Step 3 — Listas ────────────────────────────────────── -->
            <div v-show="step === 3" class="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <p class="text-sm text-slate-600">Selecciona as listas que irão receber esta campanha.</p>

                <div v-if="!lists.length" class="text-sm text-slate-400">
                    Não há listas. <Link :href="route('lists.create')" class="text-slate-600 underline">Cria uma lista</Link> primeiro.
                </div>
                <div v-else class="space-y-2">
                    <label
                        v-for="list in lists"
                        :key="list.id"
                        class="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                        <input type="checkbox" :value="list.id" v-model="form.list_ids"
                               class="w-4 h-4 rounded border-slate-300 text-slate-900" />
                        <div class="flex-1">
                            <p class="font-medium text-slate-900 text-sm">{{ list.name }}</p>
                            <p class="text-xs text-slate-500">{{ list.active_contacts?.toLocaleString('pt-PT') ?? '—' }} contactos activos</p>
                        </div>
                    </label>
                </div>
                <p v-if="form.errors.list_ids" class="text-xs text-red-600">{{ form.errors.list_ids }}</p>

                <!-- Agendamento opcional -->
                <div class="pt-2 border-t border-slate-100">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Agendar para (opcional)</label>
                    <input v-model="form.scheduled_at" type="datetime-local"
                           class="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    <p class="mt-1 text-xs text-slate-400">Deixa em branco para enviar manualmente</p>
                </div>
            </div>

            <!-- Navegação -->
            <div class="flex items-center justify-between mt-6">
                <button v-if="step > 1" type="button" @click="step--"
                        class="px-5 py-2 border border-slate-200 text-sm text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                    ← Anterior
                </button>
                <div v-else />

                <div class="flex items-center gap-3">
                    <Link :href="route('campaigns.index')" class="px-5 py-2 text-sm text-slate-500 hover:text-slate-900">Cancelar</Link>
                    <button v-if="step < totalSteps" type="button" @click="step++" :disabled="!canGoNext"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors">
                        Seguinte →
                    </button>
                    <button v-else type="button" @click="submit" :disabled="!canGoNext || form.processing"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors">
                        Criar Campanha
                    </button>
                </div>
            </div>
        </div>
    </AppLayout>
</template>
