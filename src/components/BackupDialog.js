// src/components/BackupDialog.js — sauvegarde et restauration JSON de mes données (profil, repas et aliments perso,
// modifications et suppressions d'aliments), avec gestion des conflits de noms.
import { computed, reactive } from '../vue.js';
import * as S from '../store.js';
import { parseBackup } from '../backup.js';
import Modal from './Modal.js';

export default {
  components: { Modal },
  emits: ['close'],
  setup(_, { emit }) {
    const r = reactive({ error: '', data: null, name: '', exportedAt: '', mode: 'merge', strategy: 'keep', report: null });
    const counts = computed(() => (r.data ? { meals: r.data.meals.length, foods: r.data.foods.length, edits: Object.keys(r.data.foodEdits).length, deleted: r.data.deletedFoods.length, profile: Object.values(r.data.profile).some((v) => v !== null && v !== '') } : null));
    const save = () => { S.exportBackup(); S.toast('Sauvegarde téléchargée : garde-la hors du dépôt, elle contient ton profil.'); };
    const pick = async (e) => {
      const file = e.target.files && e.target.files[0];
      r.error = ''; r.data = null; r.report = null;
      if (!file) return;
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) { r.error = parsed.error; return; }
      r.data = parsed.data; r.name = file.name; r.exportedAt = parsed.exportedAt ?? '';
    };
    const apply = () => {
      if (!r.data) return;
      if (r.mode === 'replace-all' && !window.confirm('Remplacer toutes tes données actuelles par celles de la sauvegarde ?')) return;
      r.report = S.restoreBackup(r.data, r.mode === 'replace-all' ? 'replace-all' : r.strategy);
      S.toast('Sauvegarde restaurée.');
    };
    return { r, counts, save, pick, apply, close: () => emit('close') };
  },
  template: `
    <modal title="Sauvegarde de mes données" @close="$emit('close')">
      <section>
        <h3>Sauvegarder</h3>
        <p class="notice warn">⚠ Ce fichier contient des <b>données personnelles</b> (ton profil) : ne le publie pas et ne le dépose pas dans le dépôt.</p>
        <p>Il garde ton profil, tes repas et aliments perso, tes modifications et suppressions d'aliments : utile pour changer d'appareil ou de navigateur.</p>
        <button type="button" class="btn primary" @click="save">Sauvegarder mes données (JSON)</button>
      </section>
      <section>
        <h3>Restaurer</h3>
        <label>Fichier de sauvegarde <input type="file" accept="application/json,.json" @change="pick"></label>
        <p v-if="r.error" class="errors" role="alert">{{ r.error }}</p>
        <div v-if="counts" aria-live="polite">
          <p><b>{{ r.name }}</b><template v-if="r.exportedAt"> (créé le {{ r.exportedAt.slice(0, 10) }})</template> : {{ counts.meals }} repas perso, {{ counts.foods }} aliments perso, {{ counts.edits }} aliments modifiés, {{ counts.deleted }} supprimés<template v-if="counts.profile">, profil</template>.</p>
          <fieldset class="box">
            <legend>Mode</legend>
            <label class="check"><input type="radio" value="merge" v-model="r.mode"> Fusionner avec mes données actuelles</label>
            <label class="check"><input type="radio" value="replace-all" v-model="r.mode"> Tout remplacer par la sauvegarde</label>
            <label v-if="r.mode === 'merge'">En cas de conflit de nom
              <select v-model="r.strategy"><option value="keep">Garder l'existant</option><option value="replace">Remplacer par la sauvegarde</option><option value="rename">Importer en renommant (importé)</option></select>
            </label>
          </fieldset>
          <button type="button" class="btn primary" @click="apply">Restaurer</button>
        </div>
        <p v-if="r.report" class="notice" role="status">
          <template v-if="r.report.mode">Toutes les données ont été remplacées.</template>
          <template v-else>Repas : {{ r.report.addedMeals }} ajoutés, {{ r.report.replacedMeals }} remplacés, {{ r.report.renamedMeals }} renommés, {{ r.report.skippedMeals }} ignorés. Aliments : {{ r.report.addedFoods }} ajoutés, {{ r.report.replacedFoods }} remplacés, {{ r.report.renamedFoods }} renommés, {{ r.report.skippedFoods }} ignorés.</template>
        </p>
      </section>
      <template #footer><button type="button" class="btn" @click="close">Fermer</button></template>
    </modal>`,
};
