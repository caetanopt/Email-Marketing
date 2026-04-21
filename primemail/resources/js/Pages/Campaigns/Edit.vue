<script setup>
import { computed } from 'vue';
import { useForm, Link } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    campaign:  { type: Object, required: true },
    templates: { type: Array,  required: true },
    lists:     { type: Array,  required: true },
});

const form = useForm({
    name:         props.campaign.name,
    subject:      props.campaign.subject,
    preview_text: props.campaign.preview_text ?? '',
    from_name:    props.campaign.from_name,
    from_email:   props.campaign.from_email,
    reply_to:     props.campaign.reply_to ?? '',
    template_id:  props.campaign.template_id,
    list_ids:     props.campaign.campaign_lists?.map(cl => cl.list_id) ?? [],
    scheduled_at: props.campaign.scheduled_at ?? null,
});

const submit = () => form.put(route('campaigns.update', props.campaign.id));

const selectedTemplate = computed(() =>
    props.templates.find(t => t.id === form.template_id) ?? null
);
</script>

<template>
    <AppLayout :title="`Editar — ${campaign.name}`">
        <div class="max-w-2xl">
            <form @submit.prevent="submit" class="space-y-6">
                <!-- Info básica -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                    <h2 class="font-semibold text-slate-900">Informação da campanha</h2>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Nome interno *</label>
                        <input v-model="form.name" type="text" required
                               :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.name ? 'border-red-400' : 'border-slate-200']" />
                        <p v-if="form.errors.name" class="mt-1 text-xs text-red-600">{{ form.errors.name }}</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Assunto *</label>
                        <input v-model="form.subject" type="text" required maxlength="998"
                               :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.subject ? 'border-red-400' : 'border-slate-200']" />
                        <p class="mt-1 text-xs text-slate-400">{{ form.subject.length }}/998 caracteres</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Texto de preview</label>
                        <input v-model="form.preview_text" type="text" maxlength="255"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
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
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Reply-To (opcional)</label>
                        <input v-model="form.reply_to" type="email"
                               :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.reply_to ? 'border-red-400' : 'border-slate-200']"
                               placeholder="Deixa em branco para usar o email do remetente" />
                        <p v-if="form.errors.reply_to" class="mt-1 text-xs text-red-600">{{ form.errors.reply_to }}</p>
                    </div>
                </div>

                <!-- Template -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                    <h2 class="font-semibold text-slate-900 mb-1">Template MJML</h2>
                    <button
                        v-for="t in templates" :key="t.id"
                        type="button"
                        @click="form.template_id = t.id"
                        :class="[
                            'w-full flex items-center gap-4 p-3 border-2 rounded-xl text-left transition-all text-sm',
                            form.template_id === t.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'
                        ]"
                    >
                        <div :class="['w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0', form.template_id === t.id ? 'border-slate-900' : 'border-slate-300']">
                            <div v-if="form.template_id === t.id" class="w-2 h-2 rounded-full bg-slate-900" />
                        </div>
                        <span class="font-medium text-slate-900">{{ t.name }}</span>
                    </button>
                    <p v-if="form.errors.template_id" class="text-xs text-red-600">{{ form.errors.template_id }}</p>
                </div>

                <!-- Listas -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h2 class="font-semibold text-slate-900">Listas destinatárias</h2>
                    <div class="space-y-2">
                        <label v-for="list in lists" :key="list.id"
                               class="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                            <input type="checkbox" :value="list.id" v-model="form.list_ids"
                                   class="w-4 h-4 rounded border-slate-300 text-slate-900" />
                            <span class="font-medium text-slate-900 text-sm">{{ list.name }}</span>
                        </label>
                    </div>
                    <p v-if="form.errors.list_ids" class="text-xs text-red-600">{{ form.errors.list_ids }}</p>

                    <div class="pt-2 border-t border-slate-100">
                        <label class="block text-sm font-medium text-slate-700 mb-1">Agendar para (opcional)</label>
                        <input v-model="form.scheduled_at" type="datetime-local"
                               class="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                </div>

                <!-- Acções -->
                <div class="flex items-center gap-3">
                    <button type="submit" :disabled="form.processing"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        Guardar Alterações
                    </button>
                    <Link :href="route('campaigns.show', campaign.id)"
                          class="px-5 py-2 text-sm text-slate-500 hover:text-slate-900">
                        Cancelar
                    </Link>
                </div>
            </form>
        </div>
    </AppLayout>
</template>
