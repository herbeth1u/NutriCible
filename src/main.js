// src/main.js — point d'entrée : charge les données, puis monte l'application.
import { createApp } from './vue.js';
import * as S from './store.js';
import App from './components/App.js';

await S.init();
createApp(App).mount('#app');
