<script setup lang="ts">
defineProps<{
  active?: boolean
  variant?: 'default' | 'danger'
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <button
    class="settings-nav-item"
    :class="{
      'settings-nav-item--active': active,
      'settings-nav-item--danger': variant === 'danger',
    }"
    @click="emit('click')"
  >
    <span v-if="$slots.icon" class="nav-item-icon">
      <slot name="icon" />
    </span>
    <span class="nav-item-label">
      <slot />
    </span>
  </button>
</template>

<style scoped lang="scss">
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  width: 100%;
  padding: var(--spacing--2xs) var(--spacing--sm);
  margin: 0;
  border: none;
  border-radius: var(--radius--xs);
  background: transparent;
  color: var(--color--text);
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--regular, 400);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
  }

  &--active {
    background: rgba(255, 109, 90, 0.15);
    color: var(--color--primary);
    font-weight: var(--font-weight--medium);

    .nav-item-icon {
      color: var(--color--primary);
    }
  }

  &--danger {
    color: var(--color--danger);

    .nav-item-icon {
      color: var(--color--danger);
    }

    &:hover {
      background: var(--color--danger--tint-2, rgba(220, 38, 38, 0.08));
    }
  }
}

.nav-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--color--text--tint-1);
}

.nav-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
