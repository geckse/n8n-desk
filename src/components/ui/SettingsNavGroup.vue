<script setup lang="ts">
defineProps<{
  label: string
  variant?: 'default' | 'danger'
}>()
</script>

<template>
  <div class="settings-nav-group">
    <div
      class="nav-group-label"
      :class="{ 'nav-group-label--danger': variant === 'danger' }"
    >
      {{ label }}
    </div>
    <div class="nav-group-items">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.settings-nav-group {
  padding: 0 var(--spacing--xs);

  & + & {
    margin-top: var(--spacing--md);
  }
}

.nav-group-label {
  font-size: var(--font-size--3xs, 10px);
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color--text--tint-1);
  padding: var(--spacing--2xs) var(--spacing--sm);
  margin-bottom: var(--spacing--3xs);

  &--danger {
    color: var(--color--danger);
  }
}

.nav-group-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
