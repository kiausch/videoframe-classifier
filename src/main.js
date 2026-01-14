import { createApp } from 'vue';
import App from './App.vue';

// Vuetify
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'

import { app, events, init, window as neuWindow } from '@neutralinojs/lib';

init();

const vuetify = createVuetify();

createApp(App).use(vuetify).mount('#app');

function onWindowClose() {
  app.exit();
}

events.on('windowClose', onWindowClose);

neuWindow.focus();
