// src/components/Bar.js — barre de progression vers une cible (jamais la couleur seule : texte et pourcentage).
import { fmtNum } from '../calc.js';

export default {
  props: {
    label: { type: String, required: true },
    value: { type: Number, required: true },
    target: { type: Number, default: null }, // cible ponctuelle
    min: { type: Number, default: null },    // ou fourchette (protéines)
    max: { type: Number, default: null },
    unit: { type: String, default: 'g' },
  },
  computed: {
    ref() { return this.target ?? (this.min !== null && this.max !== null ? (this.min + this.max) / 2 : null); },
    pct() { return this.ref ? Math.round((this.value / this.ref) * 100) : null; },
    level() {
      if (this.pct === null) return 'none';
      if (this.min !== null && this.max !== null) return this.value < this.min * 0.95 ? 'low' : this.value > this.max * 1.05 ? 'high' : 'ok';
      return this.pct < 90 ? 'low' : this.pct > 110 ? 'high' : 'ok';
    },
    text() { return { low: 'en dessous', high: 'au-dessus', ok: 'dans la cible', none: '' }[this.level]; },
    shown() { return this.min !== null && this.max !== null ? `${fmtNum(Math.round(this.min))}–${fmtNum(Math.round(this.max))}` : this.target !== null ? fmtNum(Math.round(this.target)) : ''; },
  },
  methods: { n: (v) => fmtNum(Math.round(v)) },
  template: `
    <div class="bar">
      <div class="bar-head"><span>{{ label }}</span><b>{{ n(value) }} {{ unit }}<template v-if="shown"> / {{ shown }} {{ unit }}</template></b></div>
      <div v-if="pct !== null" class="bar-track" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="150" :aria-label="label + ' : ' + pct + ' % de la cible'">
        <div class="bar-fill" :class="level" :style="{ width: Math.min(pct, 150) / 1.5 + '%' }"></div>
      </div>
      <small v-if="pct !== null" class="bar-note" :class="level">{{ pct }} % · {{ text }}</small>
    </div>`,
};
