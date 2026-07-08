<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { IonButton, IonInput, IonRadioGroup, IonRadio, IonCheckbox } from '@ionic/vue'
import { CircleHelp, Check } from 'lucide-vue-next'
import type { AskUserQuestionItem, AskUserAnswers } from '@/types/agent'

interface PendingQuestion {
  id: string
  questions: AskUserQuestionItem[]
}

interface Props {
  request: PendingQuestion
}

const props = defineProps<Props>()

const emit = defineEmits<{
  submit: [id: string, answers: AskUserAnswers]
}>()

const { t } = useI18n()

interface QuestionState {
  selected: string[]
  other: string
}

const state = reactive<Record<string, QuestionState>>(
  Object.fromEntries(props.request.questions.map((q) => [q.id, { selected: [], other: '' }]))
)

// --- Stepper navigation ---

const currentIndex = ref(0)
const totalSteps = computed(() => props.request.questions.length)
const currentQuestion = computed(() => props.request.questions[currentIndex.value])
const isLastStep = computed(() => currentIndex.value === totalSteps.value - 1)

function goToStep(index: number): void {
  if (index >= 0 && index < totalSteps.value) {
    currentIndex.value = index
  }
}

function nextStep(): void {
  goToStep(currentIndex.value + 1)
}

function prevStep(): void {
  goToStep(currentIndex.value - 1)
}

// --- Answers ---

function isAnswered(question: AskUserQuestionItem): boolean {
  const qs = state[question.id]
  return !!qs && (qs.selected.length > 0 || qs.other.trim().length > 0)
}

function toggleOption(question: AskUserQuestionItem, label: string): void {
  const qs = state[question.id]
  if (!qs) return
  if (question.multiSelect) {
    const idx = qs.selected.indexOf(label)
    if (idx >= 0) {
      qs.selected.splice(idx, 1)
    } else {
      qs.selected.push(label)
    }
  } else {
    // Single-select: one effective answer — picking an option clears "Other"
    qs.selected = qs.selected[0] === label ? [] : [label]
    if (qs.selected.length > 0) qs.other = ''
  }
}

function onOtherInput(question: AskUserQuestionItem, value: string): void {
  const qs = state[question.id]
  if (!qs) return
  qs.other = value
  // Single-select: typing "Other" deselects the picked option
  if (!question.multiSelect && value.trim()) {
    qs.selected = []
  }
}

function isSelected(question: AskUserQuestionItem, label: string): boolean {
  return state[question.id]?.selected.includes(label) ?? false
}

const allAnswered = computed(() => props.request.questions.every((q) => isAnswered(q)))

function handleSubmit(): void {
  if (!allAnswered.value) return
  const answers: AskUserAnswers = {}
  for (const q of props.request.questions) {
    const qs = state[q.id]
    if (!qs) continue
    const other = qs.other.trim()
    answers[q.id] = {
      selected: [...qs.selected],
      ...(other ? { otherText: other } : {}),
    }
  }
  emit('submit', props.request.id, answers)
}
</script>

<template>
  <div :class="$style.card">
    <div :class="$style.header">
      <CircleHelp :size="16" :class="$style.icon" />
      <span :class="$style.title">{{ t('agentPanel.question.title') }}</span>
      <span v-if="totalSteps > 1" :class="$style.stepCounter">
        {{ t('agentPanel.question.stepCounter', { current: currentIndex + 1, total: totalSteps }) }}
      </span>
    </div>

    <!-- Step tabs — one per question, jumpable -->
    <div v-if="totalSteps > 1" :class="$style.stepTabs" role="tablist">
      <button
        v-for="(question, index) in request.questions"
        :key="question.id"
        type="button"
        role="tab"
        :aria-selected="index === currentIndex"
        :title="question.question"
        :class="[
          $style.stepTab,
          index === currentIndex && $style.stepTabActive,
          isAnswered(question) && $style.stepTabAnswered,
        ]"
        @click="goToStep(index)"
      >
        <Check v-if="isAnswered(question)" :size="12" :class="$style.stepTabCheck" />
        <span v-else>{{ index + 1 }}</span>
      </button>
    </div>

    <div v-if="currentQuestion" :key="currentQuestion.id" :class="$style.body">
      <div :class="$style.question">
        <p :class="$style.questionText">{{ currentQuestion.question }}</p>
        <p :class="$style.selectHint">
          {{ currentQuestion.multiSelect ? t('agentPanel.question.selectAny') : t('agentPanel.question.selectOne') }}
        </p>

        <ion-radio-group
          v-if="!currentQuestion.multiSelect"
          :value="state[currentQuestion.id]?.selected[0] ?? null"
        >
          <div
            v-for="option in currentQuestion.options"
            :key="option.label"
            :class="[$style.option, isSelected(currentQuestion, option.label) && $style.optionSelected]"
            role="radio"
            :aria-checked="isSelected(currentQuestion, option.label)"
            tabindex="0"
            @click="toggleOption(currentQuestion, option.label)"
            @keydown.enter.prevent="toggleOption(currentQuestion, option.label)"
            @keydown.space.prevent="toggleOption(currentQuestion, option.label)"
          >
            <ion-radio :value="option.label" :class="$style.control" />
            <div :class="$style.optionText">
              <span :class="$style.optionLabel">{{ option.label }}</span>
              <span v-if="option.description" :class="$style.optionDescription">{{ option.description }}</span>
            </div>
          </div>
        </ion-radio-group>

        <template v-else>
          <div
            v-for="option in currentQuestion.options"
            :key="option.label"
            :class="[$style.option, isSelected(currentQuestion, option.label) && $style.optionSelected]"
            role="checkbox"
            :aria-checked="isSelected(currentQuestion, option.label)"
            tabindex="0"
            @click="toggleOption(currentQuestion, option.label)"
            @keydown.enter.prevent="toggleOption(currentQuestion, option.label)"
            @keydown.space.prevent="toggleOption(currentQuestion, option.label)"
          >
            <ion-checkbox :checked="isSelected(currentQuestion, option.label)" :class="$style.control" />
            <div :class="$style.optionText">
              <span :class="$style.optionLabel">{{ option.label }}</span>
              <span v-if="option.description" :class="$style.optionDescription">{{ option.description }}</span>
            </div>
          </div>
        </template>

        <ion-input
          :value="state[currentQuestion.id]?.other ?? ''"
          fill="outline"
          label-placement="stacked"
          :label="t('agentPanel.question.otherLabel')"
          :placeholder="t('agentPanel.question.otherPlaceholder')"
          :class="$style.otherInput"
          @ion-input="onOtherInput(currentQuestion, String($event.detail?.value ?? ''))"
        />
      </div>

      <div :class="$style.actions">
        <ion-button
          v-if="totalSteps > 1"
          fill="outline"
          color="medium"
          size="small"
          :disabled="currentIndex === 0"
          :class="$style.backButton"
          @click="prevStep"
        >
          {{ t('agentPanel.question.back') }}
        </ion-button>
        <ion-button
          v-if="!isLastStep"
          color="primary"
          size="small"
          @click="nextStep"
        >
          {{ t('agentPanel.question.next') }}
        </ion-button>
        <ion-button
          v-else
          color="primary"
          size="small"
          :disabled="!allAnswered"
          @click="handleSubmit"
        >
          {{ t('agentPanel.question.submit') }}
        </ion-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.card {
  border: 1px solid var(--color--primary, #ff6d5a);
  border-radius: 8px;
  overflow: hidden;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  margin: 4px 0;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color--primary, #ff6d5a) 8%, transparent);
  border-bottom: 1px solid var(--color--primary, #ff6d5a);
}

.icon {
  color: var(--color--primary, #ff6d5a);
  flex-shrink: 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color--text--shade-1);
}

.stepCounter {
  margin-left: auto;
  font-size: 12px;
  color: var(--color--text--tint-1);
}

.stepTabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 0;
}

.stepTab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--color--text--tint-1);
  background: transparent;
  color: var(--color--text--tint-1);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;

  &:hover {
    border-color: var(--color--primary, #ff6d5a);
    color: var(--color--primary, #ff6d5a);
  }
}

.stepTabAnswered {
  border-color: var(--color--primary, #ff6d5a);
  color: var(--color--primary, #ff6d5a);
}

.stepTabActive {
  border-color: var(--color--primary, #ff6d5a);
  background: var(--color--primary, #ff6d5a);
  color: var(--color--foreground--tint-2, #fff);

  &:hover {
    color: var(--color--foreground--tint-2, #fff);
  }
}

.stepTabCheck {
  flex-shrink: 0;
}

.body {
  padding: 12px;
}

.question {
  margin-bottom: 4px;
}

.questionText {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--color--text--shade-1);
  margin: 0 0 2px;
}

.selectHint {
  font-size: 11px;
  color: var(--color--text--tint-1);
  margin: 0 0 8px;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
  background: var(--n8n-desk--content-bg, var(--color--background));
  transition: border-color 0.15s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--color--primary, #ff6d5a) 50%, transparent);
  }
}

.optionSelected {
  border-color: var(--color--primary, #ff6d5a);
}

.control {
  pointer-events: none;
  flex-shrink: 0;
  margin-top: 1px;
}

.optionText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.optionLabel {
  font-size: 13px;
  color: var(--color--text--shade-1);
}

.optionDescription {
  font-size: 12px;
  line-height: 1.4;
  color: var(--color--text--tint-1);
}

.otherInput {
  margin-top: 8px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.backButton {
  margin-right: auto;
}

.actions :global(ion-button) {
  --border-radius: 6px;
}
</style>
