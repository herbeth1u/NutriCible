// src/components/Pills.js — groupe de pastilles à bascule (OU au sein du groupe, v-model sur un tableau).
export default {
  props: { label: String, options: { type: Array, required: true }, modelValue: { type: Array, required: true } },
  emits: ['update:modelValue'],
  computed: { opts() { return this.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)); } },
  methods: {
    toggle(v) {
      const s = new Set(this.modelValue);
      if (s.has(v)) s.delete(v); else s.add(v);
      this.$emit('update:modelValue', [...s]);
    },
  },
  template: `
    <fieldset class="pills">
      <legend>{{ label }}</legend>
      <button v-for="o in opts" :key="o.value" type="button" class="pill" :class="{ on: modelValue.includes(o.value) }" :aria-pressed="modelValue.includes(o.value)" @click="toggle(o.value)">{{ o.label }}</button>
    </fieldset>`,
};
