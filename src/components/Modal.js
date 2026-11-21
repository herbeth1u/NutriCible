// src/components/Modal.js — boîte de dialogue accessible : Échap, focus piégé, focus rendu à la fermeture.
export default {
  props: { title: { type: String, required: true }, wide: Boolean },
  emits: ['close'],
  mounted() { this.prev = document.activeElement; this.$refs.box.focus(); },
  beforeUnmount() { if (this.prev && this.prev.focus) this.prev.focus(); },
  methods: {
    onKey(e) {
      if (e.key === 'Escape') { this.$emit('close'); return; }
      if (e.key !== 'Tab') return;
      const els = [...this.$refs.box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    },
  },
  template: `
    <div class="backdrop" @mousedown.self="$emit('close')" @keydown="onKey">
      <div class="modal" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title" ref="box" tabindex="-1">
        <header class="modal-head"><h2>{{ title }}</h2><button type="button" class="icon" @click="$emit('close')" aria-label="Fermer">✕</button></header>
        <div class="modal-body"><slot /></div>
        <footer class="modal-foot" v-if="$slots.footer"><slot name="footer" /></footer>
      </div>
    </div>`,
};
