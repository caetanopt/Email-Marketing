import './bootstrap';
import { createApp, h } from 'vue';
import { createInertiaApp } from '@inertiajs/vue3';

createInertiaApp({
    title: (title) => title ? `${title} — Caetano PrimeMail` : 'Caetano PrimeMail',

    resolve: (name) => {
        const pages = import.meta.glob('./Pages/**/*.vue', { eager: false });
        return pages[`./Pages/${name}.vue`]();
    },

    setup({ el, App, props, plugin }) {
        createApp({ render: () => h(App, props) })
            .use(plugin)
            .mount(el);
    },

    progress: {
        color: '#1A1A2E',
        showSpinner: true,
    },
});
