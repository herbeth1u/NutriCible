// src/components/ExportDialog.js — « Exporter vers Notion » : CSV généré à la volée depuis les données actuelles.
import { computed, ref } from '../vue.js';
import * as S from '../store.js';
import { buildCsv, csvFileName } from '../notion-export.js';
import Modal from './Modal.js';

export default {
  components: { Modal },
  emits: ['close'],
  setup() {
    const includePerso = ref(true);
    const res = computed(() => buildCsv(S.meals.value, { includePerso: includePerso.value }));
    const persoCount = computed(() => S.meals.value.filter((m) => m.origin === 'perso').length);
    const download = () => { S.downloadFile(csvFileName(), res.value.csv, 'text/csv;charset=utf-8'); S.toast('Export téléchargé.'); };
    const copy = () => S.copyWithToast(res.value.text, 'CSV copié dans le presse-papiers.');
    return { includePerso, res, persoCount, download, copy, fileName: csvFileName() };
  },
  template: `
    <modal title="Exporter vers Notion" @close="$emit('close')">
      <label class="check"><input type="checkbox" v-model="includePerso"> Inclure mes repas perso ({{ persoCount }})</label>
      <p aria-live="polite"><b>{{ res.rows.length }}</b> repas seront exportés dans <code>{{ fileName }}</code> (UTF-8 avec BOM, séparateur virgule, point décimal). Le profil n'est jamais exporté.</p>
      <div v-if="res.excluded.length" class="notice warn">
        <b>{{ res.excluded.length }} repas « ⚠ Incomplet » exclus de l'export</b> (un aliment a été supprimé) :
        <ul class="used"><li v-for="n in res.excluded" :key="n">{{ n }}</li></ul>
      </div>
      <div class="help">
        <p><b>Première fois :</b> dans Notion, Importer → CSV, puis vérifier les types de colonnes (Nom : titre ; Origine, Catégorie, Densité : sélection ; Contextes, Aliments principaux, Tags : sélection multiple ; Kcal, macros, Temps : nombre ; Ingrédients, Préparation : texte).</p>
        <p><b>Mises à jour :</b> importer à nouveau le CSV dans la base existante, via l'option « Merge with CSV » du menu de la base : la fusion s'appuie sur la colonne Nom.</p>
        <p class="muted small">Les noms de colonnes et les valeurs de catégories, contextes et tags restent identiques d'un export à l'autre, sinon Notion crée des doublons.</p>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="$emit('close')">Fermer</button>
        <button type="button" class="btn" @click="copy">Copier le CSV</button>
        <button type="button" class="btn primary" @click="download">Télécharger le CSV</button>
      </template>
    </modal>`,
};
