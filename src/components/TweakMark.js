// src/components/TweakMark.js — pastille « ± » d'un repas dont des quantités ont été retouchées par le planificateur.
// Bleue pour une retouche légère, jaune (bordure plus épaisse) pour une retouche importante ; le niveau vient de src/tweaks.js
// (`mealTweakLevel`) : ici aucun rapport n'est comparé à un seuil. Un vrai <button> (clavier) qui émet `open` (ouvre la fiche du repas,
// qui détaille les aliments : un `title` ne s'affiche pas au toucher), ou, avec `plain`, une pastille non cliquable focalisable (fiche, liste).
// L'infobulle et le aria-label disent le niveau en toutes lettres : la couleur n'est jamais le seul indice.
import { computed } from '../vue.js';
import { mealTweakLevel, tweakLevelLabel, tweakTitle } from '../tweaks.js';

export default {
  props: {
    meal: { type: Object, default: null }, // repas retouché (porte `tweaks`)
    factor: { type: Number, default: 1 }, // facteur de portion affiché du repas
    level: { type: String, default: '' }, // niveau imposé (pastille d'une seule ligne d'ingrédient)
    label: { type: String, default: '' }, // texte imposé (pastille d'une seule ligne d'ingrédient)
    plain: Boolean,
  },
  emits: ['open'],
  setup(props) {
    const lvl = computed(() => props.level || mealTweakLevel(props.meal?.tweaks) || 'minor');
    const text = computed(() => props.label || (props.meal?.tweaks?.length ? tweakTitle(props.meal, props.factor) : tweakLevelLabel(lvl.value)));
    return { lvl, text };
  },
  template: `
    <span v-if="plain" class="icon tweak-mark" :class="lvl" role="img" tabindex="0" :title="text" :aria-label="text">±</span>
    <button v-else type="button" class="icon tweak-mark" :class="lvl" :title="text" :aria-label="text" @click.stop="$emit('open')">±</button>`,
};
