<script setup>
import { useForm, router } from '@inertiajs/vue3';
import AppLayout from '@/Layouts/AppLayout.vue';

const props = defineProps({
    brand:   { type: Object, required: true },
    hasSmtp: { type: Boolean, default: false },
});

const form = useForm({
    name:              props.brand.name,
    primary_color:     props.brand.primary_color ?? '#1A1A2E',
    from_name:         props.brand.from_name ?? '',
    from_email:        props.brand.from_email ?? '',
    reply_to_email:    props.brand.reply_to_email ?? '',
    email_footer_html: props.brand.email_footer_html ?? '',
    physical_address:  props.brand.physical_address ?? '',
    unsubscribe_url:   props.brand.unsubscribe_url ?? '',
    smtp_host:         '',
    smtp_port:         587,
    smtp_username:     '',
    smtp_password:     '',
    smtp_encryption:   'tls',
});

const submit = () => form.put(route('brand.settings.update'));
const clearSmtp = () => {
    if (!confirm('Remover configuração SMTP personalizada?')) return;
    router.delete(route('brand.settings.clear-smtp'));
};
</script>

<template>
    <AppLayout title="Definições da Marca">
        <div class="max-w-2xl">
            <form @submit.prevent="submit" class="space-y-6">
                <!-- Identidade -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                    <h2 class="font-semibold text-slate-900">Identidade</h2>

                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Nome da marca *</label>
                        <input v-model="form.name" type="text" required
                               :class="['w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900', form.errors.name ? 'border-red-400' : 'border-slate-200']" />
                        <p v-if="form.errors.name" class="mt-1 text-xs text-red-600">{{ form.errors.name }}</p>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Cor principal</label>
                        <div class="flex items-center gap-3">
                            <input v-model="form.primary_color" type="color"
                                   class="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                            <input v-model="form.primary_color" type="text" maxlength="7"
                                   class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono w-28 focus:outline-none focus:ring-2 focus:ring-slate-900"
                                   placeholder="#1A1A2E" />
                        </div>
                    </div>
                </div>

                <!-- Remetente -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h2 class="font-semibold text-slate-900">Remetente padrão</h2>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
                            <input v-model="form.from_name" type="text" required
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                            <input v-model="form.from_email" type="email" required
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Reply-To (opcional)</label>
                        <input v-model="form.reply_to_email" type="email"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                </div>

                <!-- Rodapé e endereço -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h2 class="font-semibold text-slate-900">Compliance (GDPR / CAN-SPAM)</h2>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Endereço físico</label>
                        <textarea v-model="form.physical_address" rows="2"
                                  class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                                  placeholder="Rua Exemplo 123, 1000-001 Lisboa, Portugal" />
                        <p class="mt-1 text-xs text-slate-400">Obrigatório por lei em emails comerciais</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">URL de dessubscrição personalizado</label>
                        <input v-model="form.unsubscribe_url" type="url"
                               class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                               placeholder="https://..." />
                        <p class="mt-1 text-xs text-slate-400">Deixa em branco para usar o sistema integrado</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Rodapé HTML do email</label>
                        <textarea v-model="form.email_footer_html" rows="3"
                                  class="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                                  placeholder="<p>© 2026 Marca Exemplo</p>" />
                    </div>
                </div>

                <!-- SMTP override -->
                <div class="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <h2 class="font-semibold text-slate-900">SMTP personalizado</h2>
                        <button v-if="hasSmtp" type="button" @click="clearSmtp"
                                class="text-xs text-red-500 hover:text-red-700">
                            Remover configuração
                        </button>
                    </div>
                    <p class="text-xs text-slate-500">
                        Opcional — anula o Mailgun global para esta marca.
                        <span v-if="hasSmtp" class="text-green-600 font-medium">✓ Configuração activa</span>
                        <span v-else class="text-slate-400">Nenhuma configuração — usa Mailgun global</span>
                    </p>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="col-span-2">
                            <label class="block text-sm font-medium text-slate-700 mb-1">Host SMTP</label>
                            <input v-model="form.smtp_host" type="text"
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                                   placeholder="smtp.exemplo.pt" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Porta</label>
                            <input v-model.number="form.smtp_port" type="number"
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                                   placeholder="587" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Encriptação</label>
                            <select v-model="form.smtp_encryption"
                                    class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
                                <option value="tls">TLS</option>
                                <option value="ssl">SSL</option>
                                <option value="starttls">STARTTLS</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Utilizador SMTP</label>
                            <input v-model="form.smtp_username" type="text" autocomplete="off"
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Password SMTP</label>
                            <input v-model="form.smtp_password" type="password" autocomplete="new-password"
                                   class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                                   placeholder="Deixa em branco para manter a actual" />
                        </div>
                    </div>
                </div>

                <!-- Acções -->
                <div class="flex items-center gap-3">
                    <button type="submit" :disabled="form.processing"
                            class="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                        Guardar Definições
                    </button>
                </div>
            </form>
        </div>
    </AppLayout>
</template>
